// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Library to deal with negative numbers
 */
library NegativeMath {
    /**
     * @dev Returns the largest of two numbers.
     */
    function add(uint256 a, bool isNegA, uint256 b, bool isNegB)
        internal
        pure
        returns (uint256, bool) 
    {
        if (!isNegA && !isNegB) {
            return (a + b, false);
        } else if (isNegA && isNegB) {
            return (a + b, true);
        } else if (!isNegA && isNegB) {
            if (a >= b) {
                return (a - b, false);
            } else {
                return (b - a, true);
            }
        } else {  // (isNegA && !isNegB)
            if (b >= a) {
                return (b - a, false);
            } else {
                return (a - b, true);
            }
        }
    }

}