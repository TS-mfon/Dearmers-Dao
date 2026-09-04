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

    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
}
