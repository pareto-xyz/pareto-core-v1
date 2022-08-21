// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/BasicMath.sol";

/**
 * @notice Test contract to wrap around `BasicMath.sol`
 */
contract TestBasicMath {
    function max(uint256 a, uint256 b) external pure returns (uint256) {
        return BasicMath.max(a, b);
    }

    function min(uint256 a, uint256 b) external pure returns (uint256) {
        return BasicMath.min(a, b);
    }

    function absdiff(uint256 a, uint256 b) external pure returns (uint256, bool) {
        return BasicMath.absdiff(a, b);
    }
}