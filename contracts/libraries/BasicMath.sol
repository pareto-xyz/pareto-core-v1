// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Library for basic math
 */
library BasicMath {
    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev Returns the absolute difference between two numbers, and if the 
     * difference is positive (false) or negative (true).
     */
    function absdiff(uint256 a, uint256 b) internal pure returns (uint256, bool) {
        if (a >= b) {
            return (a - b, false);
        } else {
            return (b - a, true);
        }
    }
}