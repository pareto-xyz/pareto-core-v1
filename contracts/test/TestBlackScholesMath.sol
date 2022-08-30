// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/BlackScholesMath.sol";
import "../libraries/Units.sol";

/**
 * @notice Test contract to wrap around `CumulativeNormalDistribution.sol`
 */
contract TestBlackScholesMath {

    function getProbabilityFactors(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
    )
        external
        pure
        returns (uint256 d1abs, uint256 d2abs, bool d1IsNeg, bool d2IsNeg) 
    {
        // doesn't matter what to set `isCall`
        BlackScholesMath.PriceCalculationInput memory inputs = 
            BlackScholesMath.PriceCalculationInput(
                spot,
                strike,
                sigma,
                tau,
                rate,
                scaleFactor,
                true
            );
        BlackScholesMath.PriceCalculationX64 memory inputsX64 = 
            BlackScholesMath.priceInputToX64(inputs);

        (int128 d1, int128 d2) = BlackScholesMath.getProbabilityFactors(inputsX64);

        if (d1 < 0) {
            d1IsNeg = true;
            d1abs = Units.scaleFromX64(-d1, scaleFactor);
        } else {
            d1abs = Units.scaleFromX64(d1, scaleFactor);
        }

        if (d2 < 0) {
            d2IsNeg = true;
            d2abs = Units.scaleFromX64(-d2, scaleFactor);
        } else {
            d2abs = Units.scaleFromX64(d2, scaleFactor);
        }
    }

    function getPrice(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor,
        bool isCall
    ) 
        external
        pure 
        returns (uint256 price)
    {
        BlackScholesMath.PriceCalculationInput memory inputs = 
            BlackScholesMath.PriceCalculationInput(
                spot,
                strike,
                sigma,
                tau,
                rate,
                scaleFactor,
                isCall
            );
            
        return BlackScholesMath.getPrice(inputs);
    }

    function getSigmaByNewton(
        uint256 spot,
        uint256 strike,
        uint256 tau,
        uint256 rate,
        uint256 tradePrice,
        uint256 scaleFactor,
        bool isCall
    )
        external
        pure
        returns (uint256) 
    {
        BlackScholesMath.VolCalculationInput memory inputs = 
            BlackScholesMath.VolCalculationInput(
                spot,
                strike,
                tau,
                rate,
                tradePrice,
                scaleFactor,
                isCall
            );
        return BlackScholesMath.getSigmaByNewton(inputs, 10);
    }

    function getSigmaByBisection(
        uint256 spot,
        uint256 strike,
        uint256 tau,
        uint256 rate,
        uint256 tradePrice,
        uint256 scaleFactor,
        bool isCall
    )
        external
        pure
        returns (uint256) 
    {
        BlackScholesMath.VolCalculationInput memory inputs = 
            BlackScholesMath.VolCalculationInput(
                spot,
                strike,
                tau,
                rate,
                tradePrice,
                scaleFactor,
                isCall
            );
        return BlackScholesMath.getSigmaByBisection(inputs, 10);
    }

    function getVega(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor,
        bool isCall
    ) 
        external
        pure
        returns (uint256 vega) 
    {
        // doesn't matter what to put for isCall due to parity
        BlackScholesMath.PriceCalculationInput memory inputs = 
            BlackScholesMath.PriceCalculationInput(
                spot,
                strike,
                sigma,
                tau,
                rate,
                scaleFactor,
                isCall
            );
        return BlackScholesMath.getVega(inputs);
    }


    function getStrikeFromDelta(
        uint256 delta,
        uint256 spot,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
    )
        external
        pure
        returns (uint256 strike)
    {
        BlackScholesMath.StrikeCalculationInput memory inputs = 
            BlackScholesMath.StrikeCalculationInput(
                delta,
                spot,
                sigma,
                tau,
                rate,
                scaleFactor
            );
        return BlackScholesMath.getStrikeFromDelta(inputs);
    }
}