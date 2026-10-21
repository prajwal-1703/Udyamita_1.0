// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title UCoin (UCN) — v1.1
/// @notice Fixed-supply ERC-20. The whole supply is minted once in the constructor:
///         70% to the reward treasury (the RewardMechanism contract that deploys this token)
///         and 30% to the developer wallet. There is no mint or owner function, so the
///         supply can never change after deployment.
/// @dev v1.0 used a hand-written ERC-20 with 1,000,001 UCN. v1.1 uses OpenZeppelin's audited
///      implementation and 100,000,000 UCN so that the treasury can fund the reward schedule
///      for a realistic number of contributors (see docs/ECONOMICS.md).
contract UCoin is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 100_000_000e18;
    uint256 public constant TREASURY_SHARE = 70_000_000e18;
    uint256 public constant DEV_SHARE = TOTAL_SUPPLY - TREASURY_SHARE;

    address public immutable rewardTreasury;
    address public immutable devWallet;

    constructor(address rewardTreasury_, address devWallet_) ERC20("UCoin", "UCN") {
        require(rewardTreasury_ != address(0) && devWallet_ != address(0), "UCoin: zero address");
        rewardTreasury = rewardTreasury_;
        devWallet = devWallet_;
        _mint(rewardTreasury_, TREASURY_SHARE);
        _mint(devWallet_, DEV_SHARE);
    }
}
