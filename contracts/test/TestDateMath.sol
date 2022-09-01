// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/DateMath.sol";

/**
 * @notice Test contract to wrap around `DateMath.sol`
 */
contract TestDateMath {
    function getNextExpiry(uint256 expiry) external view returns (uint256) {
        return DateMath.getNextExpiry(expiry);
    }

    function getNextFriday(uint256 timestamp) external pure returns (uint256) {
        return DateMath.getNextFriday(timestamp);
    }
}