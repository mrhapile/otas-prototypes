// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

interface IHoldToken {
    function createHold(
        bytes32 holdId,
        address holder,
        address notary,
        uint256 amount,
        uint256 expiry
    ) external;

    function executeHold(bytes32 holdId, address to) external;

    function releaseHold(bytes32 holdId) external;

    function reclaimHold(bytes32 holdId) external;

    function availableBalanceOf(address holder) external view returns (uint256);

    function lockedBalanceOf(address holder) external view returns (uint256);
}
