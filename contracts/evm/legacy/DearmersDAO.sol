// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

contract DearmersDAO {
    enum DaoMode { Operating, Grant }
    enum MembershipMode { Public, Whitelist, TokenGated }
    enum ProposalKind { Spend, Grant, Emergency }
    enum ProposalStatus { PendingReview, RevisionRequired, Voting, Rejected, Approved, Executed, Escalated, Paused, Tied, ManualFunding }
    enum ApplicationStatus { Submitted, RevisionRequired, Eligible, Rejected, Voting, Selected, NotSelected, Active, Completed, Cancelled }
    enum MilestoneStatus { Pending, Submitted, RevisionRequired, Approved, Paid, Rejected }

    struct Constitution {
        uint256 version;
        uint64 activatesAt;
        uint64 votingPeriod;
        uint256 maxProposalAmount;
        uint256 weeklySpendLimit;
        uint16 quorumBps;
        uint16 approvalBps;
        uint16 participationWeightCap;
        uint16 tokenWeightCap;
        address gateToken;
        uint256 gateBalance;
        uint256 tokenWeightUnit;
        string categories;
        string policyText;
        bool active;
    }

    struct Proposal {
        address proposer;
        address recipient;
        uint256 amount;
        uint256 constitutionVersion;
        uint256 eligibleWeightSnapshot;
        uint256 yesWeight;
        uint256 noWeight;
        uint64 createdAt;
        uint64 votingEndsAt;
        ProposalKind kind;
        ProposalStatus status;
        bytes32 evidenceHash;
        bytes32 verdictHash;
        bytes32 executionHash;
        string title;
        string description;
        string category;
        string evidenceUri;
    }

    struct GrantRound {
        uint256 budget;
        uint256 committed;
        uint256 constitutionVersion;
        uint64 applicationDeadline;
        uint64 votingEndsAt;
        uint32 maxWinners;
        uint32 selectedCount;
        bool active;
        string title;
        string criteriaUri;
    }

    struct GrantApplication {
        address applicant;
        address recipient;
        uint256 requestedAmount;
        uint256 approvedAmount;
        uint256 score;
        uint256 fitScore;
        uint256 yesWeight;
        uint256 noWeight;
        ApplicationStatus status;
        bytes32 evidenceHash;
        bytes32 verdictHash;
        string projectName;
        string applicationUri;
        string githubLoginHash;
    }

    struct Milestone {
        uint256 amount;
        MilestoneStatus status;
        bytes32 evidenceHash;
        bytes32 verdictHash;
        bytes32 executionHash;
        string title;
        string criteriaUri;
        string evidenceUri;
    }

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error NotMember();
    error DeadlineNotReached();
    error DeadlinePassed();
    error AlreadyVoted();
    error TreasuryPaused();
    error SpendingLimitExceeded();

    address public immutable registry;
    bytes32 public immutable daoId;
    DaoMode public immutable mode;
    address public admin;
    address public treasury;
    address public reviewOracle;
    address public executor;
    mapping(address => bool) public voteRelayers;
    mapping(address => bool) public proposalRelayers;
    MembershipMode public membershipMode;
    bool public emergencyPaused;
    uint256 public activeConstitutionVersion;
    uint256 public proposalCount;
    uint256 public grantRoundCount;
    uint256 public memberCount;
    uint256 public totalConfiguredWeight;
    uint256 public spentThisPeriod;
    uint64 public spendingPeriodStartedAt;

    mapping(uint256 => Constitution) private constitutions;
    mapping(uint256 => Proposal) private proposals;
    mapping(address => bool) public registeredMembers;
    mapping(address => bool) public whitelist;
    mapping(address => bool) public grantReviewers;
    mapping(address => uint256) public configuredWeight;
    mapping(address => uint256) public participationScore;
    mapping(uint256 => mapping(address => bool)) public proposalVotes;
    mapping(uint256 => GrantRound) private grantRounds;
    mapping(uint256 => uint256) public applicationCount;
    mapping(uint256 => mapping(uint256 => GrantApplication)) private applications;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public applicationVotes;
    mapping(uint256 => mapping(uint256 => uint256)) public milestoneCount;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => Milestone))) private milestones;
    mapping(address => uint256) public applicantReputation;
    mapping(address => uint64) public lastReputationReviewAt;

    event ConstitutionScheduled(uint256 indexed version, uint64 activatesAt);
    event ConstitutionActivated(uint256 indexed version);
    event MemberRegistered(address indexed member);
    event ProposalCreated(uint256 indexed proposalId, ProposalKind kind, address indexed proposer, address indexed recipient, uint256 amount);
    event ProposalReviewRecorded(uint256 indexed proposalId, ProposalStatus status, bytes32 verdictHash);
    event ProposalVoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalFinalized(uint256 indexed proposalId, ProposalStatus status);
    event ProposalTieResolved(uint256 indexed proposalId, bool support, address indexed resolver);
    event ManualFundingRequired(uint256 indexed proposalId, address indexed resolver);
    event ExecutionRecorded(uint256 indexed proposalId, bytes32 executionHash, uint256 amount);
    event GrantRoundCreated(uint256 indexed roundId, string title, uint256 budget);
    event GrantApplicationSubmitted(uint256 indexed roundId, uint256 indexed applicationId, address indexed applicant);
    event GrantApplicationReviewed(uint256 indexed roundId, uint256 indexed applicationId, ApplicationStatus status, uint256 score, uint256 fitScore);
    event GrantVoteCast(uint256 indexed roundId, uint256 indexed applicationId, address indexed reviewer, bool support, uint256 weight);
    event GrantApplicationFinalized(uint256 indexed roundId, uint256 indexed applicationId, ApplicationStatus status);
    event MilestoneSubmitted(uint256 indexed roundId, uint256 indexed applicationId, uint256 indexed milestoneId);
    event MilestoneReviewed(uint256 indexed roundId, uint256 indexed applicationId, uint256 indexed milestoneId, MilestoneStatus status);
    event MilestonePaid(uint256 indexed roundId, uint256 indexed applicationId, uint256 indexed milestoneId, bytes32 executionHash);
    event ReputationUpdated(address indexed applicant, uint256 score, uint64 reviewedAt);
    event EmergencyPauseChanged(bool paused);
    event RolesUpdated(address reviewOracle, address executor);
    event VoteRelayerChanged(address indexed relayer, bool allowed);
    event ProposalRelayerChanged(address indexed relayer, bool allowed);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyReviewOracle() {
        if (msg.sender != reviewOracle) revert Unauthorized();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert Unauthorized();
        _;
    }

    modifier onlyVoteRelayer() {
        if (!voteRelayers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(
        address admin_,
        bytes32 daoId_,
        DaoMode mode_,
        address treasury_,
        address reviewOracle_,
        address executor_,
        address registry_
    ) {
        if (admin_ == address(0) || treasury_ == address(0) || reviewOracle_ == address(0) || executor_ == address(0) || registry_ == address(0) || daoId_ == bytes32(0)) revert InvalidInput();
        admin = admin_;
        daoId = daoId_;
        mode = mode_;
        treasury = treasury_;
        reviewOracle = reviewOracle_;
        executor = executor_;
        voteRelayers[executor_] = true;
        proposalRelayers[executor_] = true;
        registry = registry_;
        spendingPeriodStartedAt = uint64(block.timestamp);
        whitelist[admin_] = true;
        registeredMembers[admin_] = true;
        configuredWeight[admin_] = 1;
        memberCount = 1;
        totalConfiguredWeight = 1;
    }

    function setRoles(address reviewOracle_, address executor_) external onlyAdmin {
        if (reviewOracle_ == address(0) || executor_ == address(0)) revert InvalidInput();
        reviewOracle = reviewOracle_;
        executor = executor_;
        voteRelayers[executor_] = true;
        proposalRelayers[executor_] = true;
        emit RolesUpdated(reviewOracle_, executor_);
    }

    function setVoteRelayer(address relayer, bool allowed) external onlyAdmin {
        if (relayer == address(0)) revert InvalidInput();
        voteRelayers[relayer] = allowed;
        emit VoteRelayerChanged(relayer, allowed);
    }

    function setProposalRelayer(address relayer, bool allowed) external onlyAdmin {
        if (relayer == address(0)) revert InvalidInput();
        proposalRelayers[relayer] = allowed;
        emit ProposalRelayerChanged(relayer, allowed);
    }

    function setTreasury(address treasury_) external onlyAdmin {
        if (treasury_ == address(0)) revert InvalidInput();
        treasury = treasury_;
    }

    function setMembershipMode(MembershipMode membershipMode_) external onlyAdmin {
        membershipMode = membershipMode_;
    }

    function configureMember(address account, bool allowed, uint256 weight, bool reviewer) external onlyAdmin {
        if (account == address(0)) revert InvalidInput();
        whitelist[account] = allowed;
        grantReviewers[account] = reviewer;
        if (allowed && !registeredMembers[account]) {
            registeredMembers[account] = true;
            memberCount++;
        }
        uint256 previous = configuredWeight[account];
        configuredWeight[account] = allowed ? weight : 0;
        totalConfiguredWeight = totalConfiguredWeight - previous + configuredWeight[account];
    }

    function registerMember() external {
        _registerMember(msg.sender);
    }

    function registerMemberFor(address account) external {
        if (!proposalRelayers[msg.sender]) revert Unauthorized();
        _registerMember(account);
    }

    function _registerMember(address account) internal {
        if (registeredMembers[account]) return;
        if (membershipMode == MembershipMode.Whitelist && !whitelist[account]) revert NotMember();
        if (membershipMode == MembershipMode.TokenGated && !_meetsTokenGate(account, activeConstitutionVersion)) revert NotMember();
        registeredMembers[account] = true;
        configuredWeight[account] = 1;
        memberCount++;
        totalConfiguredWeight++;
        emit MemberRegistered(account);
    }

    function scheduleConstitution(Constitution calldata constitution) external onlyAdmin returns (uint256 version) {
        if (constitution.votingPeriod == 0 || constitution.quorumBps > 10_000 || constitution.approvalBps > 10_000 || constitution.activatesAt < block.timestamp) revert InvalidInput();
        version = activeConstitutionVersion + 1;
        Constitution storage stored = constitutions[version];
        stored.version = version;
        stored.activatesAt = constitution.activatesAt;
        stored.votingPeriod = constitution.votingPeriod;
        stored.maxProposalAmount = constitution.maxProposalAmount;
        stored.weeklySpendLimit = constitution.weeklySpendLimit;
        stored.quorumBps = constitution.quorumBps;
        stored.approvalBps = constitution.approvalBps;
        stored.participationWeightCap = constitution.participationWeightCap;
        stored.tokenWeightCap = constitution.tokenWeightCap;
        stored.gateToken = constitution.gateToken;
        stored.gateBalance = constitution.gateBalance;
        stored.tokenWeightUnit = constitution.tokenWeightUnit;
        stored.categories = constitution.categories;
        stored.policyText = constitution.policyText;
        emit ConstitutionScheduled(version, constitution.activatesAt);
    }

    function activateConstitution(uint256 version) external {
        Constitution storage constitution = constitutions[version];
        if (constitution.version != version || block.timestamp < constitution.activatesAt) revert InvalidState();
        if (activeConstitutionVersion != 0) constitutions[activeConstitutionVersion].active = false;
        constitution.active = true;
        activeConstitutionVersion = version;
        emit ConstitutionActivated(version);
    }

    function createProposal(
        address recipient,
        uint256 amount,
        ProposalKind kind,
        string calldata title,
        string calldata description,
        string calldata category,
        string calldata evidenceUri,
        bytes32 evidenceHash
    ) external returns (uint256 proposalId) {
        return _createProposal(msg.sender, recipient, amount, kind, title, description, category, evidenceUri, evidenceHash);
    }

    function createProposalFor(
        address proposer,
        address recipient,
        uint256 amount,
        ProposalKind kind,
        string calldata title,
        string calldata description,
        string calldata category,
        string calldata evidenceUri,
        bytes32 evidenceHash
    ) external returns (uint256 proposalId) {
        if (!proposalRelayers[msg.sender]) revert Unauthorized();
        return _createProposal(proposer, recipient, amount, kind, title, description, category, evidenceUri, evidenceHash);
    }

    function _createProposal(
        address proposer,
        address recipient,
        uint256 amount,
        ProposalKind kind,
        string calldata title,
        string calldata description,
        string calldata category,
        string calldata evidenceUri,
        bytes32 evidenceHash
    ) internal returns (uint256 proposalId) {
        if (emergencyPaused) revert TreasuryPaused();
        _requireMember(proposer);
        Constitution storage constitution = constitutions[activeConstitutionVersion];
        if (!constitution.active || recipient == address(0) || amount == 0 || amount > constitution.maxProposalAmount || bytes(title).length == 0) revert InvalidInput();
        proposalId = proposalCount++;
        Proposal storage proposal = proposals[proposalId];
        proposal.proposer = proposer;
        proposal.recipient = recipient;
        proposal.amount = amount;
        proposal.constitutionVersion = activeConstitutionVersion;
        proposal.createdAt = uint64(block.timestamp);
        proposal.kind = kind;
        proposal.status = ProposalStatus.PendingReview;
        proposal.evidenceHash = evidenceHash;
        proposal.title = title;
        proposal.description = description;
        proposal.category = category;
        proposal.evidenceUri = evidenceUri;
        emit ProposalCreated(proposalId, kind, msg.sender, recipient, amount);
    }

    function recordProposalReview(uint256 proposalId, ProposalStatus status, bytes32 verdictHash, uint256 eligibleWeightSnapshot) external onlyReviewOracle {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.PendingReview && proposal.status != ProposalStatus.RevisionRequired) revert InvalidState();
        if (status != ProposalStatus.Voting && status != ProposalStatus.RevisionRequired && status != ProposalStatus.Rejected && status != ProposalStatus.Escalated && status != ProposalStatus.Paused) revert InvalidInput();
        proposal.status = status;
        proposal.verdictHash = verdictHash;
        if (status == ProposalStatus.Voting) {
            proposal.votingEndsAt = uint64(block.timestamp + constitutions[proposal.constitutionVersion].votingPeriod);
            proposal.eligibleWeightSnapshot = eligibleWeightSnapshot == 0 ? totalConfiguredWeight : eligibleWeightSnapshot;
        }
        if (status == ProposalStatus.Paused) emergencyPaused = true;
        emit ProposalReviewRecorded(proposalId, status, verdictHash);
    }

    function castProposalVote(uint256 proposalId, bool support) external {
        _castProposalVote(proposalId, msg.sender, support);
    }

    function castProposalVoteFor(uint256 proposalId, address voter, bool support) external onlyVoteRelayer {
        _castProposalVote(proposalId, voter, support);
    }

    function _castProposalVote(uint256 proposalId, address voter, bool support) internal {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.Voting) revert InvalidState();
        if (block.timestamp >= proposal.votingEndsAt) revert DeadlinePassed();
        if (proposalVotes[proposalId][voter]) revert AlreadyVoted();
        _requireMember(voter);
        uint256 weight = votingWeight(voter, proposal.constitutionVersion);
        if (weight == 0) revert NotMember();
        proposalVotes[proposalId][voter] = true;
        participationScore[voter]++;
        if (support) proposal.yesWeight += weight;
        else proposal.noWeight += weight;
        emit ProposalVoteCast(proposalId, voter, support, weight);
    }

    function finalizeProposalVote(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.Voting) revert InvalidState();
        if (block.timestamp < proposal.votingEndsAt) revert DeadlineNotReached();
        Constitution storage constitution = constitutions[proposal.constitutionVersion];
        uint256 totalVotes = proposal.yesWeight + proposal.noWeight;
        bool quorumReached = proposal.eligibleWeightSnapshot > 0 && totalVotes * 10_000 >= proposal.eligibleWeightSnapshot * constitution.quorumBps;
        bool tied = totalVotes > 0 && quorumReached && proposal.yesWeight == proposal.noWeight;
        bool approved = totalVotes > 0 && quorumReached && proposal.yesWeight > proposal.noWeight && proposal.yesWeight * 10_000 >= totalVotes * constitution.approvalBps;
        proposal.status = tied ? ProposalStatus.Tied : (approved ? ProposalStatus.Approved : ProposalStatus.Rejected);
        emit ProposalFinalized(proposalId, proposal.status);
    }

    function resolveTiedProposal(uint256 proposalId, bool support) external onlyAdmin {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.Tied) revert InvalidState();
        proposal.status = support ? ProposalStatus.Approved : ProposalStatus.Rejected;
        emit ProposalTieResolved(proposalId, support, msg.sender);
        emit ProposalFinalized(proposalId, proposal.status);
    }

    function markManualFundingRequired(uint256 proposalId) external onlyAdmin {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.Approved) revert InvalidState();
        proposal.status = ProposalStatus.ManualFunding;
        emit ManualFundingRequired(proposalId, msg.sender);
    }

    function recordProposalExecution(uint256 proposalId, bytes32 executionHash) external onlyExecutor {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.Approved || executionHash == bytes32(0)) revert InvalidState();
        _consumeSpendingLimit(proposal.amount, proposal.constitutionVersion);
        proposal.status = ProposalStatus.Executed;
        proposal.executionHash = executionHash;
        emit ExecutionRecorded(proposalId, executionHash, proposal.amount);
    }

    function createGrantRound(string calldata title, string calldata criteriaUri, uint256 budget, uint32 maxWinners, uint64 applicationDeadline) external onlyAdmin returns (uint256 roundId) {
        if (mode != DaoMode.Grant || budget == 0 || maxWinners == 0 || applicationDeadline <= block.timestamp || bytes(title).length == 0) revert InvalidInput();
        roundId = grantRoundCount++;
        grantRounds[roundId] = GrantRound(budget, 0, activeConstitutionVersion, applicationDeadline, 0, maxWinners, 0, true, title, criteriaUri);
        emit GrantRoundCreated(roundId, title, budget);
    }

    function submitGrantApplication(uint256 roundId, address recipient, uint256 requestedAmount, string calldata projectName, string calldata applicationUri, string calldata githubLoginHash, bytes32 evidenceHash) external returns (uint256 applicationId) {
        GrantRound storage round = grantRounds[roundId];
        if (!round.active || block.timestamp >= round.applicationDeadline || recipient == address(0) || requestedAmount == 0 || requestedAmount > round.budget) revert InvalidInput();
        applicationId = applicationCount[roundId]++;
        applications[roundId][applicationId] = GrantApplication(msg.sender, recipient, requestedAmount, 0, 0, 0, 0, 0, ApplicationStatus.Submitted, evidenceHash, bytes32(0), projectName, applicationUri, githubLoginHash);
        emit GrantApplicationSubmitted(roundId, applicationId, msg.sender);
    }

    function recordApplicationReview(uint256 roundId, uint256 applicationId, ApplicationStatus status, uint256 score, uint256 fitScore, bytes32 verdictHash) external onlyReviewOracle {
        GrantApplication storage application = applications[roundId][applicationId];
        if (application.status != ApplicationStatus.Submitted && application.status != ApplicationStatus.RevisionRequired) revert InvalidState();
        if (status != ApplicationStatus.Eligible && status != ApplicationStatus.Rejected && status != ApplicationStatus.RevisionRequired) revert InvalidInput();
        application.status = status;
        application.score = score;
        application.fitScore = fitScore;
        application.verdictHash = verdictHash;
        emit GrantApplicationReviewed(roundId, applicationId, status, score, fitScore);
    }

    function openGrantVoting(uint256 roundId, uint64 votingEndsAt) external onlyAdmin {
        GrantRound storage round = grantRounds[roundId];
        if (!round.active || block.timestamp < round.applicationDeadline || votingEndsAt <= block.timestamp) revert InvalidInput();
        round.votingEndsAt = votingEndsAt;
        uint256 count = applicationCount[roundId];
        for (uint256 applicationId; applicationId < count; applicationId++) {
            if (applications[roundId][applicationId].status == ApplicationStatus.Eligible) applications[roundId][applicationId].status = ApplicationStatus.Voting;
        }
    }

    function voteGrantApplication(uint256 roundId, uint256 applicationId, bool support) external {
        GrantRound storage round = grantRounds[roundId];
        GrantApplication storage application = applications[roundId][applicationId];
        if (!grantReviewers[msg.sender]) revert Unauthorized();
        if (application.status != ApplicationStatus.Voting || block.timestamp >= round.votingEndsAt) revert InvalidState();
        if (applicationVotes[roundId][applicationId][msg.sender]) revert AlreadyVoted();
        applicationVotes[roundId][applicationId][msg.sender] = true;
        uint256 weight = configuredWeight[msg.sender] == 0 ? 1 : configuredWeight[msg.sender];
        if (support) application.yesWeight += weight;
        else application.noWeight += weight;
        emit GrantVoteCast(roundId, applicationId, msg.sender, support, weight);
    }

    function finalizeGrantApplication(uint256 roundId, uint256 applicationId, uint256 approvedAmount) external {
        GrantRound storage round = grantRounds[roundId];
        GrantApplication storage application = applications[roundId][applicationId];
        if (application.status != ApplicationStatus.Voting || block.timestamp < round.votingEndsAt) revert InvalidState();
        bool selected = application.yesWeight > application.noWeight && application.yesWeight > 0 && round.selectedCount < round.maxWinners && approvedAmount > 0 && approvedAmount <= application.requestedAmount && round.committed + approvedAmount <= round.budget;
        if (selected) {
            application.status = ApplicationStatus.Selected;
            application.approvedAmount = approvedAmount;
            round.selectedCount++;
            round.committed += approvedAmount;
        } else application.status = ApplicationStatus.NotSelected;
        emit GrantApplicationFinalized(roundId, applicationId, application.status);
    }

    function addMilestone(uint256 roundId, uint256 applicationId, string calldata title, string calldata criteriaUri, uint256 amount) external onlyAdmin returns (uint256 milestoneId) {
        GrantApplication storage application = applications[roundId][applicationId];
        if (application.status != ApplicationStatus.Selected && application.status != ApplicationStatus.Active) revert InvalidState();
        if (amount == 0 || amount > application.approvedAmount) revert InvalidInput();
        milestoneId = milestoneCount[roundId][applicationId]++;
        milestones[roundId][applicationId][milestoneId] = Milestone(amount, MilestoneStatus.Pending, bytes32(0), bytes32(0), bytes32(0), title, criteriaUri, "");
        application.status = ApplicationStatus.Active;
    }

    function submitMilestone(uint256 roundId, uint256 applicationId, uint256 milestoneId, string calldata evidenceUri, bytes32 evidenceHash) external {
        GrantApplication storage application = applications[roundId][applicationId];
        Milestone storage milestone = milestones[roundId][applicationId][milestoneId];
        if (msg.sender != application.applicant || (milestone.status != MilestoneStatus.Pending && milestone.status != MilestoneStatus.RevisionRequired)) revert Unauthorized();
        milestone.evidenceUri = evidenceUri;
        milestone.evidenceHash = evidenceHash;
        milestone.status = MilestoneStatus.Submitted;
        emit MilestoneSubmitted(roundId, applicationId, milestoneId);
    }

    function recordMilestoneReview(uint256 roundId, uint256 applicationId, uint256 milestoneId, MilestoneStatus status, bytes32 verdictHash) external onlyReviewOracle {
        Milestone storage milestone = milestones[roundId][applicationId][milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidState();
        if (status != MilestoneStatus.Approved && status != MilestoneStatus.RevisionRequired && status != MilestoneStatus.Rejected) revert InvalidInput();
        milestone.status = status;
        milestone.verdictHash = verdictHash;
        emit MilestoneReviewed(roundId, applicationId, milestoneId, status);
    }

    function recordMilestonePayment(uint256 roundId, uint256 applicationId, uint256 milestoneId, bytes32 executionHash) external onlyExecutor {
        GrantApplication storage application = applications[roundId][applicationId];
        Milestone storage milestone = milestones[roundId][applicationId][milestoneId];
        if (milestone.status != MilestoneStatus.Approved || executionHash == bytes32(0)) revert InvalidState();
        _consumeSpendingLimit(milestone.amount, grantRounds[roundId].constitutionVersion);
        milestone.status = MilestoneStatus.Paid;
        milestone.executionHash = executionHash;
        applicantReputation[application.applicant] += 10;
        emit MilestonePaid(roundId, applicationId, milestoneId, executionHash);
    }

    function updateApplicantReputation(address applicant, uint256 score) external onlyReviewOracle {
        if (applicant == address(0) || score > 100) revert InvalidInput();
        if (lastReputationReviewAt[applicant] != 0 && block.timestamp < lastReputationReviewAt[applicant] + 7 days) revert DeadlineNotReached();
        applicantReputation[applicant] = score;
        lastReputationReviewAt[applicant] = uint64(block.timestamp);
        emit ReputationUpdated(applicant, score, uint64(block.timestamp));
    }

    function setEmergencyPause(bool paused) external {
        if (msg.sender != admin && msg.sender != reviewOracle) revert Unauthorized();
        emergencyPaused = paused;
        emit EmergencyPauseChanged(paused);
    }

    function votingWeight(address voter, uint256 constitutionVersion) public view returns (uint256) {
        if (!registeredMembers[voter]) return 0;
        Constitution storage constitution = constitutions[constitutionVersion];
        uint256 weight = configuredWeight[voter] == 0 ? 1 : configuredWeight[voter];
        uint256 participation = participationScore[voter];
        if (participation > constitution.participationWeightCap) participation = constitution.participationWeightCap;
        weight += participation;
        if (membershipMode == MembershipMode.TokenGated && constitution.tokenWeightUnit > 0) {
            uint256 tokenWeight = IERC20Balance(constitution.gateToken).balanceOf(voter) / constitution.tokenWeightUnit;
            if (tokenWeight > constitution.tokenWeightCap) tokenWeight = constitution.tokenWeightCap;
            weight += tokenWeight;
        }
        return weight;
    }

    function getConstitution(uint256 version) external view returns (Constitution memory) { return constitutions[version]; }
    function getProposal(uint256 proposalId) external view returns (Proposal memory) { return proposals[proposalId]; }
    function getGrantRound(uint256 roundId) external view returns (GrantRound memory) { return grantRounds[roundId]; }
    function getGrantApplication(uint256 roundId, uint256 applicationId) external view returns (GrantApplication memory) { return applications[roundId][applicationId]; }
    function getMilestone(uint256 roundId, uint256 applicationId, uint256 milestoneId) external view returns (Milestone memory) { return milestones[roundId][applicationId][milestoneId]; }

    function _requireMember(address account) internal view {
        if (!registeredMembers[account]) revert NotMember();
        if (membershipMode == MembershipMode.Whitelist && !whitelist[account]) revert NotMember();
        if (membershipMode == MembershipMode.TokenGated && !_meetsTokenGate(account, activeConstitutionVersion)) revert NotMember();
    }

    function _meetsTokenGate(address account, uint256 constitutionVersion) internal view returns (bool) {
        Constitution storage constitution = constitutions[constitutionVersion];
        return constitution.gateToken != address(0) && IERC20Balance(constitution.gateToken).balanceOf(account) >= constitution.gateBalance;
    }

    function _consumeSpendingLimit(uint256 amount, uint256 constitutionVersion) internal {
        if (emergencyPaused) revert TreasuryPaused();
        if (block.timestamp >= spendingPeriodStartedAt + 7 days) {
            spendingPeriodStartedAt = uint64(block.timestamp);
            spentThisPeriod = 0;
        }
        uint256 limit = constitutions[constitutionVersion].weeklySpendLimit;
        if (spentThisPeriod + amount > limit) revert SpendingLimitExceeded();
        spentThisPeriod += amount;
    }
}
