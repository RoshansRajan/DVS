// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Voting
 * @notice A single election whose ballots are recorded as on-chain transactions.
 *
 * Design notes:
 *  - The tally lives in contract storage (`Candidate.voteCount`), incremented by
 *    the voter's own transaction. There is no tallying authority: no function on
 *    this contract can set, adjust, or clear a count, and the admin has no vote
 *    of its own unless it registers like anyone else.
 *  - Eligibility (one address, one ballot) and the voting window are enforced by
 *    `require`-style guards *here*, not in the UI. A caller who skips the React
 *    app and calls this contract directly is subject to exactly the same rules.
 *  - `VoteCast` is emitted as an auditable receipt, but it is not the source of
 *    truth: replaying the log must reproduce the stored tally, which is the
 *    property the test suite asserts.
 */
contract Voting {
    /* ---------------------------------------------------------------- errors */

    error NotAdmin();
    error NotRegistered();
    error AlreadyRegistered();
    error AlreadyVoted();
    error VotingNotOpen();
    error VotingClosed();
    error InvalidCandidate();
    error InvalidWindow();
    error NoCandidates();

    /* ---------------------------------------------------------------- events */

    event VoterRegistered(address indexed voter);
    event VoteCast(address indexed voter, uint256 indexed candidateId);

    /* ----------------------------------------------------------------- types */

    struct Candidate {
        string name;
        uint256 voteCount;
    }

    /* ----------------------------------------------------------------- state */

    string public title;
    address public immutable admin;

    /// Window bounds are compared against `block.timestamp`, which a proposer can
    /// nudge by a few seconds. Irrelevant at hour-scale windows; do not build a
    /// second-precision auction on this pattern.
    uint256 public immutable startTime;
    uint256 public immutable endTime;

    uint256 public totalVotes;
    uint256 public registeredCount;

    mapping(address => bool) public isRegistered;
    mapping(address => bool) public hasVoted;

    Candidate[] private candidates;

    /* ------------------------------------------------------------- modifiers */

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /* ----------------------------------------------------------- constructor */

    constructor(
        string memory _title,
        string[] memory _candidateNames,
        uint256 _startTime,
        uint256 _endTime
    ) {
        if (_candidateNames.length == 0) revert NoCandidates();
        if (_endTime <= _startTime) revert InvalidWindow();

        title = _title;
        admin = msg.sender;
        startTime = _startTime;
        endTime = _endTime;

        for (uint256 i = 0; i < _candidateNames.length; i++) {
            candidates.push(Candidate({name: _candidateNames[i], voteCount: 0}));
        }
    }

    /* ---------------------------------------------------------- registration */

    /// @notice Adds one address to the electoral roll. Admin only.
    function registerVoter(address voter) public onlyAdmin {
        if (isRegistered[voter]) revert AlreadyRegistered();

        isRegistered[voter] = true;
        registeredCount += 1;

        emit VoterRegistered(voter);
    }

    /// @notice Batch form of {registerVoter}, to keep roll setup to one transaction.
    function registerVoters(address[] calldata voters) external onlyAdmin {
        for (uint256 i = 0; i < voters.length; i++) {
            registerVoter(voters[i]);
        }
    }

    /* ---------------------------------------------------------------- voting */

    /**
     * @notice Casts the caller's single ballot for `candidateId`.
     * @dev Every precondition below is protocol-level. Reordering them changes
     *      which error an ineligible caller sees, so the order is deliberate:
     *      eligibility first, so a stranger learns nothing about the schedule.
     */
    function vote(uint256 candidateId) external {
        if (!isRegistered[msg.sender]) revert NotRegistered();
        if (hasVoted[msg.sender]) revert AlreadyVoted();
        if (block.timestamp < startTime) revert VotingNotOpen();
        if (block.timestamp > endTime) revert VotingClosed();
        if (candidateId >= candidates.length) revert InvalidCandidate();

        // Mark before mutating the tally: the ballot is spent even if anything
        // downstream were ever to become re-entrant.
        hasVoted[msg.sender] = true;
        candidates[candidateId].voteCount += 1;
        totalVotes += 1;

        emit VoteCast(msg.sender, candidateId);
    }

    /* ----------------------------------------------------------------- views */

    function candidatesCount() external view returns (uint256) {
        return candidates.length;
    }

    function candidate(uint256 candidateId) external view returns (string memory name, uint256 voteCount) {
        if (candidateId >= candidates.length) revert InvalidCandidate();
        Candidate storage c = candidates[candidateId];
        return (c.name, c.voteCount);
    }

    /// @notice The full tally, readable by anyone, at any time, without a server.
    function getResults() external view returns (string[] memory names, uint256[] memory counts) {
        uint256 length = candidates.length;
        names = new string[](length);
        counts = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            names[i] = candidates[i].name;
            counts[i] = candidates[i].voteCount;
        }
    }

    function votingOpen() external view returns (bool) {
        return block.timestamp >= startTime && block.timestamp <= endTime;
    }

    /// @notice Lowest-indexed candidate holding the highest count. Ties are not
    ///         resolved here; a caller that cares should read {getResults}.
    function winningCandidateId() external view returns (uint256 winnerId) {
        uint256 highest = 0;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i].voteCount > highest) {
                highest = candidates[i].voteCount;
                winnerId = i;
            }
        }
    }
}
