// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title UserDatabase — v1.1
/// @notice Source of truth for contributor identity, XP, level and earned UCN.
///
/// Changes from v1.0 (see docs/AUDIT.md):
///  - Registration requires an EIP-712 attestation from the backend that the caller's
///    GitHub OAuth session belongs to `githubId`/`login`, and binds one GitHub account to
///    one wallet (v1.0 accepted any self-declared username).
///  - XP is synchronised from an all-time contribution count and can only increase
///    (v1.0 overwrote XP, so it could drop).
///  - Level and earned UCN are computed on chain when XP rises (v1.0 computed them in the
///    browser and kept "claimed" amounts in localStorage).
///  - The profile is packed into one storage slot; logins are kept in a separate mapping
///    only for display.
///  - Users are suspended, not deleted, so history cannot be reset by re-registering.
///  - `getAllUsers` is replaced by a paginated `getUsers`.
contract UserDatabase is AccessControl, EIP712 {
    // ------------------------------------------------------------------ types
    /// @dev 64 + 32 + 8 + 96 + 40 + 8 = 248 bits -> one storage slot.
    struct User {
        uint64 githubId;      // immutable numeric GitHub account id (0 = not registered)
        uint32 xp;            // 50 XP per counted contribution
        uint8 level;          // derived from xp, cached for cheap reads
        uint96 earned;        // total UCN (wei) earned through level-ups
        uint40 lastSync;      // timestamp of the last XP increase
        bool suspended;       // admin flag; suspended users cannot accrue or withdraw
    }

    // ------------------------------------------------------------------ constants
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant XP_UPDATER_ROLE = keccak256("XP_UPDATER_ROLE");

    uint32 public constant XP_PER_CONTRIBUTION = 50;
    uint8 public constant MAX_LEVEL = 100;
    uint32 public constant REVIEWER_XP = 21_000; // = 50 * 20 * 21, i.e. level 20
    uint256 public constant BASE_REWARD = 5e18;  // level L pays 5 * 1.08^L UCN

    bytes32 private constant BIND_TYPEHASH =
        keccak256("Bind(address wallet,uint64 githubId,string login,uint256 deadline)");

    /// @notice UCN the treasury can pay out in total; earned rewards never exceed it.
    uint256 public immutable rewardBudget;

    // ------------------------------------------------------------------ storage
    mapping(address => User) private _users;
    mapping(uint64 => address) public walletOfGithubId;
    mapping(address => string) public loginOf;
    address[] private _userList;
    uint256 public totalEarned;

    // ------------------------------------------------------------------ events
    event UserRegistered(address indexed wallet, uint64 indexed githubId, string login);
    event UserXPUpdated(address indexed wallet, uint32 newTotalXP, uint8 level);
    event LevelUp(address indexed wallet, uint8 fromLevel, uint8 toLevel, uint256 reward);
    event ReviewerPromoted(address indexed wallet, uint32 xp);
    event UserSuspended(address indexed wallet, bool suspended);

    // ------------------------------------------------------------------ errors
    error AlreadyRegistered();
    error GithubAlreadyLinked();
    error InvalidGithubId();
    error SignatureExpired();
    error InvalidAttestation();
    error NotRegistered();
    error LengthMismatch();

    constructor(address admin, address attester, address xpUpdater, uint256 rewardBudget_)
        EIP712("BlockSource", "1.1")
    {
        require(admin != address(0) && attester != address(0) && xpUpdater != address(0), "UD: zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, attester);
        _grantRole(XP_UPDATER_ROLE, xpUpdater);
        rewardBudget = rewardBudget_;
    }

    // ------------------------------------------------------------------ registration
    /// @notice Called from the user's own wallet with an attestation issued by the backend
    ///         after GitHub OAuth. Binds msg.sender <-> githubId one-to-one.
    function register(uint64 githubId, string calldata login, uint256 deadline, bytes calldata sig) external {
        if (githubId == 0) revert InvalidGithubId();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (_users[msg.sender].githubId != 0) revert AlreadyRegistered();
        if (walletOfGithubId[githubId] != address(0)) revert GithubAlreadyLinked();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(BIND_TYPEHASH, msg.sender, githubId, keccak256(bytes(login)), deadline))
        );
        if (!hasRole(ATTESTER_ROLE, ECDSA.recover(digest, sig))) revert InvalidAttestation();

        _users[msg.sender] = User({githubId: githubId, xp: 0, level: 0, earned: 0, lastSync: 0, suspended: false});
        walletOfGithubId[githubId] = msg.sender;
        loginOf[msg.sender] = login;
        _userList.push(msg.sender);
        emit UserRegistered(msg.sender, githubId, login);
    }

    // ------------------------------------------------------------------ XP synchronisation
    /// @notice Sets XP from the user's all-time public contribution count.
    ///         Idempotent and monotonic: a count that does not raise XP is ignored.
    function syncXP(address user, uint32 contributionCount) external onlyRole(XP_UPDATER_ROLE) {
        _sync(user, contributionCount);
    }

    /// @notice Batched form used by the periodic sync job.
    function syncXPBatch(address[] calldata users, uint32[] calldata counts) external onlyRole(XP_UPDATER_ROLE) {
        if (users.length != counts.length) revert LengthMismatch();
        for (uint256 i; i < users.length; ++i) _sync(users[i], counts[i]);
    }

    function _sync(address user, uint32 count) internal {
        User memory u = _users[user];
        if (u.githubId == 0) revert NotRegistered();
        if (u.suspended) return;
        uint256 newXp = uint256(count) * XP_PER_CONTRIBUTION;
        if (newXp <= u.xp) return; // never decrease, never re-pay
        require(newXp <= type(uint32).max, "UD: xp overflow");

        uint32 oldXp = u.xp;
        u.xp = uint32(newXp);
        u.lastSync = uint40(block.timestamp);

        uint8 newLevel = levelForXp(newXp);
        if (newLevel > u.level) {
            uint256 reward = rewardBetween(u.level, newLevel);
            uint256 remaining = rewardBudget - totalEarned;
            if (reward > remaining) reward = remaining;
            emit LevelUp(user, u.level, newLevel, reward);
            u.level = newLevel;
            u.earned += uint96(reward);
            totalEarned += reward;
        }
        if (oldXp < REVIEWER_XP && newXp >= REVIEWER_XP) emit ReviewerPromoted(user, uint32(newXp));
        _users[user] = u;
        emit UserXPUpdated(user, uint32(newXp), u.level);
    }

    // ------------------------------------------------------------------ admin
    function setSuspended(address user, bool suspended) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_users[user].githubId == 0) revert NotRegistered();
        _users[user].suspended = suspended;
        emit UserSuspended(user, suspended);
    }

    // ------------------------------------------------------------------ maths (pure)
    /// @notice Largest n <= 100 with 50 n (n+1) <= xp, computed exactly with an integer sqrt.
    function levelForXp(uint256 xp) public pure returns (uint8) {
        uint256 m = xp / XP_PER_CONTRIBUTION; // n(n+1) <= m  <=>  (2n+1)^2 <= 4m+1
        uint256 n = (Math.sqrt(4 * m + 1) - 1) / 2;
        return n > MAX_LEVEL ? MAX_LEVEL : uint8(n);
    }

    function xpForLevel(uint256 n) public pure returns (uint256) {
        return 50 * n * (n + 1);
    }

    /// @notice 5 * 1.08^level UCN, 18-decimal fixed point, truncating at each step.
    function rewardForLevel(uint256 level) public pure returns (uint256 r) {
        r = BASE_REWARD;
        for (uint256 i; i < level; ++i) r = (r * 108) / 100;
    }

    /// @notice Sum of rewardForLevel over levels (from, to].
    function rewardBetween(uint256 from, uint256 to) public pure returns (uint256 sum) {
        uint256 r = rewardForLevel(from);
        for (uint256 l = from + 1; l <= to; ++l) {
            r = (r * 108) / 100;
            sum += r;
        }
    }

    // ------------------------------------------------------------------ views
    function getUser(address user) external view returns (User memory) {
        if (_users[user].githubId == 0) revert NotRegistered();
        return _users[user];
    }

    function isRegistered(address user) external view returns (bool) {
        return _users[user].githubId != 0;
    }

    function earnedOf(address user) external view returns (uint256 earned, bool active) {
        User storage u = _users[user];
        return (u.earned, u.githubId != 0 && !u.suspended);
    }

    /// @notice Role is derived from XP: no storage write on promotion.
    function isReviewer(address user) external view returns (bool) {
        return _users[user].xp >= REVIEWER_XP;
    }

    /// @notice Index into the 21 milestone titles (0..20): floor(level / 5).
    function titleIndexOf(address user) external view returns (uint8) {
        return _users[user].level / 5;
    }

    function getUserCount() external view returns (uint256) {
        return _userList.length;
    }

    /// @notice Paginated listing for leaderboards and the sync job.
    function getUsers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory wallets, User[] memory profiles, string[] memory logins)
    {
        uint256 n = _userList.length;
        uint256 end = offset >= n ? offset : Math.min(n, offset + limit);
        uint256 len = end - offset;
        wallets = new address[](len);
        profiles = new User[](len);
        logins = new string[](len);
        for (uint256 i; i < len; ++i) {
            address w = _userList[offset + i];
            wallets[i] = w;
            profiles[i] = _users[w];
            logins[i] = loginOf[w];
        }
    }

    function bindDigest(address wallet, uint64 githubId, string calldata login, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(BIND_TYPEHASH, wallet, githubId, keccak256(bytes(login)), deadline)));
    }
}
