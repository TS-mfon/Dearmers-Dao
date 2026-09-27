// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DearmersDAO} from "../contracts/evm/DearmersDAO.sol";
import {DearmersRegistry} from "../contracts/evm/DearmersRegistry.sol";

contract DearmersDAOTest {
    address internal admin = address(0xA11CE);
    address internal treasury = address(0xB0B);
    address internal oracle = address(0x0A11CE);
    address internal executor = address(0xE0EC);

    function testFactoryConstitutionProposalVoteAndExecution() external {
        DearmersRegistry registry = new DearmersRegistry();
        vm.prank(admin);
        address daoAddress = registry.createDAO(keccak256("demo"), treasury, DearmersDAO.DaoMode.Operating, oracle, executor, "Demo", "ipfs://demo");
        DearmersDAO dao = DearmersDAO(daoAddress);
        DearmersDAO.Constitution memory constitution = DearmersDAO.Constitution(0, uint64(block.timestamp), 3 days, 250e6, 1000e6, 2000, 5000, 10, 10, address(0), 0, 0, "grants,contributors", "public constitution", false);
        vm.prank(admin);
        dao.scheduleConstitution(constitution);
        dao.activateConstitution(1);
        vm.prank(admin);
        uint256 proposalId = dao.createProposal(address(0xCAFE), 10e6, DearmersDAO.ProposalKind.Spend, "Tools", "Buy tools", "contributors", "ipfs://evidence", bytes32(0));
        vm.prank(oracle);
        dao.recordProposalReview(proposalId, DearmersDAO.ProposalStatus.Voting, keccak256("verdict"), 1);
        vm.prank(admin);
        dao.castProposalVote(proposalId, true);
        vm.warp(block.timestamp + 3 days);
        dao.finalizeProposalVote(proposalId);
        require(dao.getProposal(proposalId).status == DearmersDAO.ProposalStatus.Approved, "not approved");
        vm.prank(executor);
        require(dao.reserveProposalExecution(proposalId, keccak256("execution"), 0), "not reserved");
        vm.prank(executor);
        dao.recordProposalExecution(proposalId, keccak256("base transaction"));
        require(dao.getProposal(proposalId).status == DearmersDAO.ProposalStatus.Executed, "not executed");
    }

    function testGrantRoundMilestoneLifecycle() external {
        DearmersRegistry registry = new DearmersRegistry();
        vm.prank(admin);
        DearmersDAO dao = DearmersDAO(registry.createDAO(keccak256("grant"), treasury, DearmersDAO.DaoMode.Grant, oracle, executor, "Grant", "ipfs://grant"));
        DearmersDAO.Constitution memory constitution = DearmersDAO.Constitution(0, uint64(block.timestamp), 3 days, 500e6, 1000e6, 0, 5000, 10, 10, address(0), 0, 0, "grants", "grant constitution", false);
        vm.prank(admin);
        dao.scheduleConstitution(constitution);
        dao.activateConstitution(1);
        vm.prank(admin);
        dao.configureMember(admin, true, 10, true);
        vm.prank(admin);
        uint256 roundId = dao.createGrantRound("Builders", "ipfs://criteria", 500e6, 2, uint64(block.timestamp + 1 days));
        vm.prank(address(0xBEEF));
        uint256 applicationId = dao.submitGrantApplication(roundId, address(0xBEEF), 100e6, "Project", "ipfs://application", "github-hash", bytes32(0));
        vm.prank(oracle);
        dao.recordApplicationReview(roundId, applicationId, DearmersDAO.ApplicationStatus.Eligible, 90, 85, keccak256("review"));
        vm.warp(block.timestamp + 1 days);
        vm.prank(admin);
        dao.openGrantVoting(roundId, uint64(block.timestamp + 3 days));
        vm.prank(admin);
        dao.voteGrantApplication(roundId, applicationId, true);
        vm.warp(block.timestamp + 3 days);
        dao.finalizeGrantApplication(roundId, applicationId, 100e6);
        vm.prank(admin);
        uint256 milestoneId = dao.addMilestone(roundId, applicationId, "MVP", "ipfs://milestone", 100e6);
        vm.prank(address(0xBEEF));
        dao.submitMilestone(roundId, applicationId, milestoneId, "ipfs://evidence", keccak256("evidence"));
        vm.prank(oracle);
        dao.recordMilestoneReview(roundId, applicationId, milestoneId, DearmersDAO.MilestoneStatus.Approved, keccak256("milestone verdict"));
        vm.prank(executor);
        dao.recordMilestonePayment(roundId, applicationId, milestoneId, keccak256("payment"));
        require(dao.getMilestone(roundId, applicationId, milestoneId).status == DearmersDAO.MilestoneStatus.Paid, "milestone not paid");
    }

    function testTiedProposalWaitsForAdminResolution() external {
        DearmersDAO dao = _governedDao(250e6, 1000e6, type(uint256).max);
        address second = address(0xD00D);
        vm.prank(admin);
        dao.configureMember(second, true, 1, false);
        uint256 upheld = _votingProposal(dao, 10e6, "Tools", 2);
        uint256 dropped = _votingProposal(dao, 10e6, "Swag", 2);

        // Vote both proposals in the same order so the two members carry identical
        // participation weight on each one and the vote can only come out even.
        vm.prank(admin);
        dao.castProposalVote(upheld, true);
        vm.prank(second);
        dao.castProposalVote(upheld, false);
        vm.prank(admin);
        dao.castProposalVote(dropped, true);
        vm.prank(second);
        dao.castProposalVote(dropped, false);
        vm.warp(block.timestamp + 3 days);
        dao.finalizeProposalVote(upheld);
        dao.finalizeProposalVote(dropped);
        require(dao.getProposal(upheld).status == DearmersDAO.ProposalStatus.Tied, "even vote did not tie");
        require(dao.getProposal(dropped).status == DearmersDAO.ProposalStatus.Tied, "even vote did not tie");

        // The test contract is not the admin, so this stands in for any member trying to break the tie.
        (bool resolvedByStranger, ) = address(dao).call(abi.encodeWithSelector(DearmersDAO.resolveTiedProposal.selector, upheld, true));
        require(!resolvedByStranger, "a non-admin resolved a tie");

        vm.prank(admin);
        dao.resolveTiedProposal(upheld, true);
        require(dao.getProposal(upheld).status == DearmersDAO.ProposalStatus.Approved, "tie not upheld");
        vm.prank(admin);
        dao.resolveTiedProposal(dropped, false);
        require(dao.getProposal(dropped).status == DearmersDAO.ProposalStatus.Rejected, "tie not rejected");

        // A resolved tie is settled: the admin cannot revisit it by calling again.
        vm.prank(admin);
        (bool resolvedTwice, ) = address(dao).call(abi.encodeWithSelector(DearmersDAO.resolveTiedProposal.selector, upheld, false));
        require(!resolvedTwice, "a resolved tie was reopened");
    }

    function testWeeklySpendLimitDivertsToManualFunding() external {
        DearmersDAO dao = _governedDao(250e6, 300e6, type(uint256).max);
        uint256 first = _approvedSpend(dao, 200e6, "First");
        uint256 second = _approvedSpend(dao, 200e6, "Second");

        vm.prank(executor);
        require(dao.reserveProposalExecution(first, keccak256("first execution"), 50e6), "first reservation blocked");
        require(dao.getProposal(first).status == DearmersDAO.ProposalStatus.ExecutionReserved, "first not reserved");
        require(dao.spentThisPeriod() == 250e6, "relayer fee not charged against the cap");

        // 250e6 already spent plus 200e6 required overruns the 300e6 weekly limit.
        vm.prank(executor);
        require(!dao.reserveProposalExecution(second, keccak256("second execution"), 0), "cap overflow was auto-executed");
        require(dao.getProposal(second).status == DearmersDAO.ProposalStatus.ManualFunding, "overflow not diverted to manual funding");
        require(dao.spentThisPeriod() == 250e6, "a diverted reservation still charged the cap");

        vm.prank(admin);
        dao.recordManualFunding(second, keccak256("bank transfer"));
        require(dao.getProposal(second).status == DearmersDAO.ProposalStatus.Executed, "manual funding did not settle the proposal");
    }

    function testSpendingPeriodResetsAfterSevenDays() external {
        DearmersDAO dao = _governedDao(250e6, 300e6, type(uint256).max);
        uint256 first = _approvedSpend(dao, 200e6, "First");
        uint256 second = _approvedSpend(dao, 200e6, "Second");

        vm.prank(executor);
        require(dao.reserveProposalExecution(first, keccak256("first execution"), 0), "first reservation blocked");
        require(dao.spentThisPeriod() == 200e6, "spend not recorded");

        // Both together exceed the 300e6 cap, so only the seven-day reset lets the second through.
        vm.warp(block.timestamp + 5 days);
        vm.prank(executor);
        require(dao.reserveProposalExecution(second, keccak256("second execution"), 0), "reservation blocked after the period reset");
        require(dao.spentThisPeriod() == 200e6, "spending period did not reset");
    }

    function testManualFundingThresholdDivertsLargeProposals() external {
        DearmersDAO dao = _governedDao(250e6, 1000e6, 50e6);
        uint256 small = _approvedSpend(dao, 40e6, "Small");
        uint256 large = _approvedSpend(dao, 100e6, "Large");

        vm.prank(executor);
        require(dao.reserveProposalExecution(small, keccak256("small execution"), 0), "a proposal under the threshold was diverted");
        // Well inside the weekly cap, but over the per-proposal threshold, so a human has to fund it.
        vm.prank(executor);
        require(!dao.reserveProposalExecution(large, keccak256("large execution"), 0), "a proposal over the threshold was auto-executed");
        require(dao.getProposal(large).status == DearmersDAO.ProposalStatus.ManualFunding, "threshold breach not diverted to manual funding");
    }

    function _governedDao(uint256 maxProposalAmount, uint256 weeklySpendLimit, uint256 manualFundingThreshold) internal returns (DearmersDAO dao) {
        DearmersRegistry registry = new DearmersRegistry();
        vm.prank(admin);
        dao = DearmersDAO(registry.createDAO(keccak256("governed"), treasury, DearmersDAO.DaoMode.Operating, oracle, executor, "Governed", "ipfs://governed"));
        DearmersDAO.Constitution memory constitution = DearmersDAO.Constitution(0, uint64(block.timestamp), 3 days, maxProposalAmount, weeklySpendLimit, 2000, 5000, 10, 10, address(0), 0, 0, "grants,contributors", "public constitution", false);
        vm.prank(admin);
        dao.configurePolicy(constitution, manualFundingThreshold);
    }

    function _votingProposal(DearmersDAO dao, uint256 amount, string memory title, uint256 eligibleWeight) internal returns (uint256 proposalId) {
        vm.prank(admin);
        proposalId = dao.createProposal(address(0xCAFE), amount, DearmersDAO.ProposalKind.Spend, title, "description", "contributors", "ipfs://evidence", bytes32(0));
        vm.prank(oracle);
        dao.recordProposalReview(proposalId, DearmersDAO.ProposalStatus.Voting, keccak256("verdict"), eligibleWeight);
    }

    function _approvedSpend(DearmersDAO dao, uint256 amount, string memory title) internal returns (uint256 proposalId) {
        proposalId = _votingProposal(dao, amount, title, 1);
        vm.prank(admin);
        dao.castProposalVote(proposalId, true);
        vm.warp(block.timestamp + 3 days);
        dao.finalizeProposalVote(proposalId);
        require(dao.getProposal(proposalId).status == DearmersDAO.ProposalStatus.Approved, "proposal not approved");
    }

    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
}
