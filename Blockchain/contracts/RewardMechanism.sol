// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import necessary interfaces and contracts from OpenZeppelin
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RewardMechanism (Owner Approval Workflow)
 * @dev Manages the withdrawal of ERC20 token rewards (e.g., UCoin) via owner approval.
 * Users request a withdrawal, and the owner must approve it before tokens are transferred.
 * This contract needs to hold the ERC20 tokens intended for rewards.
 * ASSUMPTION: The reward UCoin supply is transferred to this contract's address
 * during the UCoin contract deployment (by passing this contract's address
 * as the `_rewardTreasury` parameter to the UCoin constructor).
 */
contract RewardMechanism is Ownable, ReentrancyGuard {
    // --- State Variables ---

    IERC20 public immutable rewardToken; // The ERC20 token being distributed (e.g., UCoin instance)

    // Struct to store details of a pending withdrawal request
    struct WithdrawalRequest {
        uint256 amount;   // Amount requested by the user
        bool isPending; // Flag indicating if the request is active and awaiting owner action
    }

    // Mapping from user address to their currently active withdrawal request
    // Assumes only one pending request per user at a time for simplicity.
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    // --- Events ---

    event WithdrawalRequested(address indexed user, uint256 amount);
    event WithdrawalApproved(address indexed owner, address indexed user, uint256 amount);
    event WithdrawalRejected(address indexed owner, address indexed user, uint256 amount);

    // --- Errors ---
    // Custom errors for gas efficiency and clarity
    error RM_RequestAlreadyPending();        // User tries to request when one is pending
    error RM_NoPendingRequest();             // Owner tries to act when no request is pending
    error RM_AmountMustBePositive();         // Amount requested or rescued must be > 0
    error RM_InsufficientContractBalance();  // Contract doesn't hold enough UCoins
    error RM_TokenTransferFailed();          // The UCoin.transfer() call failed
    error RM_ZeroAddress();                // Address(0) provided where not allowed
    error RM_InvalidUserAddress();         // Invalid user address provided (kept for potential future use)


    // --- Constructor ---

    /**
     * @dev Sets the address of the reward token contract (UCoin) and initializes ownership.
     * The deployer of this contract becomes the initial owner.
     * @param _rewardTokenAddress The address of the deployed UCoin ERC20 contract.
     */
    constructor(address _rewardTokenAddress) Ownable(msg.sender) { // Initialize Ownable, setting deployer as owner
        if (_rewardTokenAddress == address(0)) revert RM_ZeroAddress(); // Ensure token address is valid
        rewardToken = IERC20(_rewardTokenAddress); // Store the UCoin contract instance
    }

    // --- User Functions ---

    /**
     * @notice Allows a user to request a withdrawal of a specific amount of reward tokens.
     * @dev Creates a pending request that the owner must approve.
     * Reverts if the user already has a pending request or if the amount is zero.
     * @param _amount The amount of reward tokens the user wishes to withdraw.
     */
    function requestWithdrawal(uint256 _amount) external {
        address user = msg.sender; // The user calling the function

        // Check if user already has an active request pending owner approval
        if (withdrawalRequests[user].isPending) revert RM_RequestAlreadyPending();
        // Check if the requested amount is valid (greater than zero)
        if (_amount == 0) revert RM_AmountMustBePositive();

        // Store the new withdrawal request details for the user
        withdrawalRequests[user] = WithdrawalRequest({
            amount: _amount,   // Store the requested amount
            isPending: true    // Mark the request as active/pending
        });

        // Emit an event signaling the request was successfully made
        emit WithdrawalRequested(user, _amount);
    }


    // --- Owner-Restricted Functions ---

    /**
     * @notice Approves a specific user's pending withdrawal request and transfers the tokens. Only owner.
     * @dev Requires a pending request from the user. Checks contract balance before transfer.
     * Clears the pending request upon successful transfer. Reentrancy protected.
     * Reverts if checks fail or the token transfer fails (reverting state changes on transfer failure).
     * @param _user The address of the user whose withdrawal request is being approved.
     */
    function approveWithdrawal(address _user) external onlyOwner nonReentrant { // Only owner, prevents reentrancy
        // Get a storage pointer to the user's request for efficient access and modification
        WithdrawalRequest storage request = withdrawalRequests[_user];

        // --- Validation Checks ---
        if (!request.isPending) revert RM_NoPendingRequest(); // Ensure there's an active request

        uint256 amountToWithdraw = request.amount; // Get the requested amount from storage

        // Check if this RewardMechanism contract holds enough UCoins
        uint256 contractBalance = rewardToken.balanceOf(address(this));
        if (contractBalance < amountToWithdraw) revert RM_InsufficientContractBalance();

        // --- Effects (State Updates - BEFORE external call for security) ---
        // Mark the request as no longer pending *before* attempting the transfer
        request.isPending = false;
        // Note: We don't clear request.amount here yet, in case the transfer fails and we need to revert.

        // --- Interaction (External Call - The actual UCoin transfer) ---
        // Call the 'transfer' function of the UCoin contract (stored in 'rewardToken')
        // This sends 'amountToWithdraw' UCoins FROM this contract TO the '_user'.
        bool sent = rewardToken.transfer(_user, amountToWithdraw);

        // --- Post-Interaction Handling ---
        if (!sent) {
            // *** CRITICAL: Revert state change if transfer fails ***
            // If the UCoin transfer fails (e.g., user contract can't receive tokens),
            // reset the pending flag so the owner might retry or reject later.
            request.isPending = true;
            // Now revert the transaction with a specific error
            revert RM_TokenTransferFailed();
        }

        // If transfer succeeded, clear the amount (optional, good practice)
        request.amount = 0;

        // Emit an event logging the successful approval and transfer
        // msg.sender here is the owner who approved the withdrawal
        emit WithdrawalApproved(msg.sender, _user, amountToWithdraw);
    }

     /**
     * @notice Rejects (clears) a specific user's pending withdrawal request without transferring tokens. Only owner.
     * @dev Useful if a request is deemed invalid or should not be fulfilled for any reason.
     * @param _user The address of the user whose withdrawal request is being rejected.
     */
    function rejectWithdrawal(address _user) external onlyOwner {
         // Get a storage pointer to the user's request
        WithdrawalRequest storage request = withdrawalRequests[_user];
        uint256 requestedAmount = request.amount; // Store amount for the event before clearing

        // --- Validation Checks ---
        if (!request.isPending) revert RM_NoPendingRequest(); // Ensure there is a pending request to reject

        // --- Effects (State Update) ---
        // Clear the pending request by resetting the struct fields
        request.isPending = false;
        request.amount = 0; // Clear the amount associated with the cleared request
        // Alternatively, `delete withdrawalRequests[_user];` could be used for potential gas refunds.

        // Emit an event logging the rejection
        // msg.sender here is the owner who rejected the request
        emit WithdrawalRejected(msg.sender, _user, requestedAmount);
    }


    /**
     * @notice Allows the owner to withdraw accidental ERC20 tokens (NOT the main rewardToken). Only owner.
     * @dev Safety function to recover other tokens sent here by mistake.
     * @param _tokenAddress The address of the ERC20 token to withdraw.
     * @param _to The address to send the withdrawn tokens.
     * @param _amount The amount of tokens to withdraw (must be > 0).
     */
    function rescueERC20(address _tokenAddress, address _to, uint256 _amount) external onlyOwner {
        // Prevent rescuing the main UCoin reward token
        if (_tokenAddress == address(rewardToken)) revert("RM: Cannot rescue the designated reward token");
        if (_to == address(0)) revert RM_ZeroAddress(); // Check recipient
        if (_amount == 0) revert RM_AmountMustBePositive(); // Check amount

        IERC20 token = IERC20(_tokenAddress); // Instance of token to rescue
        uint256 contractBalance = token.balanceOf(address(this)); // Check current balance
        if (_amount > contractBalance) revert("RM: Rescue amount exceeds contract balance"); // Ensure enough exists

        // Perform the transfer
        bool success = token.transfer(_to, _amount);
        if (!success) revert("RM: Rescue transfer failed"); // Check success
    }


    // --- View Functions ---

    /**
     * @dev Returns the address of the UCoin reward token contract being managed.
     */
    function getRewardTokenAddress() external view returns (address) {
        return address(rewardToken);
    }

    /**
     * @notice Checks the status and amount of a user's pending withdrawal request.
     * @param _user The address of the user to check.
     * @return isPending True if a request is currently pending owner action, false otherwise.
     * @return amount The amount requested if `isPending` is true, otherwise the value might be stale (0 if rejected/approved correctly).
     */
    function getPendingRequest(address _user) external view returns (bool isPending, uint256 amount) {
        WithdrawalRequest storage request = withdrawalRequests[_user];
        // Return the current pending status and the associated amount from storage
        return (request.isPending, request.amount);
    }

    // Note: The `withdrawalRequests` mapping is public, so Solidity automatically
    // generates a getter function: `withdrawalRequests(address _user)` which returns
    // the tuple `(uint256 amount, bool isPending)`.
    // The custom `getPendingRequest` view function provides the same info but
    // might be preferred for explicitness in off-chain integrations.
}