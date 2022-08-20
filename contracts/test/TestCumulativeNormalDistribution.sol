// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/CumulativeNormalDistribution.sol";

/**
 * @notice Test contract to wrap around `CumulativeNormalDistribution.sol`
 */
contract TestCumulativeNormalDistribution {
    function getCDF(int128 x) external pure returns (int128) {
        return CumulativeNormalDistribution.getCDF(x);
    }

    function getInverseCDF(int128 p) internal pure returns (int128) {
        return CumulativeNormalDistribution.getInverseCDF(p);
    }
}