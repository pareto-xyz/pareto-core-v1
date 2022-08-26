// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/GaussianMath.sol";

/**
 * @notice Test contract to wrap around `GaussianMath.sol`
 */
contract TestGaussianMath {
    function getCDF(int128 x) external pure returns (int128) {
        return GaussianMath.getCDF(x);
    }
}