// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/GaussianMath.sol";
import "../libraries/Units.sol";
import "../libraries/ABDKMath64x64.sol";

/**
 * @notice Test contract to wrap around `GaussianMath.sol`
 */
contract TestGaussianMath {
    using ABDKMath64x64 for int128;

    function getPDF(uint256 input, bool isNegative, uint8 decimals)
        external
        pure
        returns (uint256 prob) 
    {
        uint256 scaleFactor = 10**(18 - decimals);
        int128 inputX64 = Units.scaleToX64(input, scaleFactor);
        if (isNegative) {
          inputX64 = inputX64.neg();
        }
        int128 probX64 = GaussianMath.getPDF(inputX64);
        prob = Units.scaleFromX64(probX64, scaleFactor);
    }

    function getCDF(uint256 input, bool isNegative, uint8 decimals)
        external
        pure
        returns (uint256 prob)
    {
        uint256 scaleFactor = 10**(18 - decimals);
        int128 inputX64 = Units.scaleToX64(input, scaleFactor);
        if (isNegative) {
          inputX64 = inputX64.neg();
        }
        int128 probX64 = GaussianMath.getCDF(inputX64);
        prob = Units.scaleFromX64(probX64, scaleFactor);
    }

    function getInverseCDF(uint256 p, uint8 decimals) 
        external
        pure
        returns (uint256 x) 
    {
        uint256 scaleFactor = 10**(18 - decimals);
        int128 pX64 = Units.scaleToX64(p, scaleFactor);
        int128 xX64 = GaussianMath.getInverseCDF(pX64);
        x = Units.scaleFromX64(xX64, scaleFactor);
    }
}