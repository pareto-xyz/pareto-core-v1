// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/NegativeMath.sol";

/**
 * @notice Test contract to wrap around `NegativeMath.sol`
 */
contract TestNegativeMath {
    function add(uint256 a, bool isNegA, uint256 b, bool isNegB)
        internal
        pure returns (uint256, bool) {
        return NegativeMath.add(a, isNegA, b, isNegB);
    }
}