// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UCoin} from "./UCoin.sol";

interface IUserDatabase {
    function earnedOf(address user) external view returns (uint256 earned, bool active);
}

/// @title RewardMechanism — v1.1
/// @notice Holds the 70% UCN treasury and pays out earned rewards through a request/approval queue.
///
/// Changes from v1.0 (see docs/AUDIT.md):
///  - A request can never exceed what the user has earned on chain minus what was already
///    claimed or is pending (v1.0 accepted any amount and relied on the owner noticing).
///  - Claimed totals are recorded on chain (v1.0 kept them in the browser's localStorage).
///  - Requests up to `instantLimit` are paid immediately; larger ones wait for owner review.
///  - The contract deploys UCoin itself, so the treasury is funded atomically at deployment.
///  - Two-step ownership transfer.
contract RewardMechanism is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @dev 96 + 8 = 104 bits -> one slot.
    struct WithdrawalRequest {
        uint96 amount;
        bool isPending;
    }

    UCoin public immutable rewardToken;
    IUserDatabase public immutable userDatabase;

    /// @notice Requests at or below this amount are paid without owner review (0 = always review).
    uint96 public instantLimit;

    mapping(address => WithdrawalRequest) public withdrawalRequests;
    mapping(address => uint256) public claimed;

    event WithdrawalRequested(address indexed user, uint256 amount);
    event WithdrawalApproved(address indexed owner, address indexed user, uint256 amount);
    event WithdrawalRejected(address indexed owner, address indexed user, uint256 amount);
    event WithdrawalCancelled(address indexed user, uint256 amount);
    event InstantLimitChanged(uint256 previous, uint256 current);

    error RM_RequestAlreadyPending();
    error RM_NoPendingRequest();
    error RM_AmountMustBePositive();
    error RM_ExceedsEarned(uint256 available);
    error RM_InactiveUser();
    error RM_ZeroAddress();
    error RM_CannotRescueRewardToken();

    constructor(address userDatabase_, address devWallet) Ownable(msg.sender) {
        if (userDatabase_ == address(0) || devWallet == address(0)) revert RM_ZeroAddress();
        userDatabase = IUserDatabase(userDatabase_);
        rewardToken = new UCoin(address(this), devWallet);
    }

    // ------------------------------------------------------------------ users
    /// @notice UCN the user can still request: earned on chain - claimed - pending.
    function available(address user) public view returns (uint256) {
        (uint256 earned,) = userDatabase.earnedOf(user);
        uint256 locked = claimed[user] + withdrawalRequests[user].amount;
        return earned > locked ? earned - locked : 0;
    }

    function requestWithdrawal(uint256 amount) external {
        address user = msg.sender;
        if (amount == 0) revert RM_AmountMustBePositive();
        WithdrawalRequest storage req = withdrawalRequests[user];
        if (req.isPending) revert RM_RequestAlreadyPending();
        (uint256 earned, bool active) = userDatabase.earnedOf(user);
        if (!active) revert RM_InactiveUser();
        uint256 avail = earned - claimed[user]; // claimed <= earned is an invariant
        if (amount > avail) revert RM_ExceedsEarned(avail);

        emit WithdrawalRequested(user, amount);
        if (amount <= instantLimit) {
            _pay(user, amount);
            emit WithdrawalApproved(address(this), user, amount);
        } else {
            req.amount = uint96(amount);
            req.isPending = true;
        }
    }

    function cancelWithdrawal() external {
        WithdrawalRequest memory req = withdrawalRequests[msg.sender];
        if (!req.isPending) revert RM_NoPendingRequest();
        delete withdrawalRequests[msg.sender];
        emit WithdrawalCancelled(msg.sender, req.amount);
    }

    // ------------------------------------------------------------------ owner
    function approveWithdrawal(address user) external onlyOwner {
        WithdrawalRequest memory req = withdrawalRequests[user];
        if (!req.isPending) revert RM_NoPendingRequest();
        (, bool active) = userDatabase.earnedOf(user);
        if (!active) revert RM_InactiveUser();
        delete withdrawalRequests[user];
        _pay(user, req.amount);
        emit WithdrawalApproved(msg.sender, user, req.amount);
    }

    function rejectWithdrawal(address user) external onlyOwner {
        WithdrawalRequest memory req = withdrawalRequests[user];
        if (!req.isPending) revert RM_NoPendingRequest();
        delete withdrawalRequests[user];
        emit WithdrawalRejected(msg.sender, user, req.amount);
    }

    function setInstantLimit(uint96 limit) external onlyOwner {
        emit InstantLimitChanged(instantLimit, limit);
        instantLimit = limit;
    }

    /// @notice Recover other ERC-20 tokens sent here by mistake. The reward token cannot be withdrawn.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(rewardToken)) revert RM_CannotRescueRewardToken();
        if (to == address(0)) revert RM_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // ------------------------------------------------------------------ views
    function getPendingRequest(address user) external view returns (bool isPending, uint256 amount) {
        WithdrawalRequest memory req = withdrawalRequests[user];
        return (req.isPending, req.amount);
    }

    function treasuryBalance() external view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    function _pay(address user, uint256 amount) internal {
        claimed[user] += amount; // total paid out = TREASURY_SHARE - treasuryBalance()
        IERC20(address(rewardToken)).safeTransfer(user, amount);
    }
}
