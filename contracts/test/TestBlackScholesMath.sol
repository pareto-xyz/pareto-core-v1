// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/BlackScholesMath.sol";
import "../libraries/Units.sol";
import "hardhat/console.sol";

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
        BlackScholesMath.PriceCalculationInput memory inputs = 
            BlackScholesMath.PriceCalculationInput(
                spot,
                strike,
                sigma,
                tau,
                rate,
                scaleFactor
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

    function getCallPrice(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
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
                scaleFactor
            );
            
        return BlackScholesMath.getCallPrice(inputs);
    }

    function getPutPrice(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
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
                scaleFactor
            );
        return BlackScholesMath.getPutPrice(inputs);
    }

    function volToSigma(uint256 vol, uint256 tau)
        external
        pure
        returns (uint256 sigma) 
    {
        return BlackScholesMath.volToSigma(vol, tau);
    }

    function approxVolFromCallPrice(
        uint256 spot,
        uint256 strike,
        uint256 tau,
        uint256 rate,
        uint256 tradePrice,
        uint256 scaleFactor
    )
        external
        pure
        returns (uint256 vol) 
    {
        BlackScholesMath.VolCalculationInput memory inputs = 
            BlackScholesMath.VolCalculationInput(
                spot,
                strike,
                tau,
                rate,
                tradePrice,
                scaleFactor
            );
        return BlackScholesMath.approxVolFromCallPrice(inputs);

    }

    function approxVolFromPutPrice(
        uint256 spot,
        uint256 strike,
        uint256 tau,
        uint256 rate,
        uint256 tradePrice,
        uint256 scaleFactor
    )
        external
        pure
        returns (uint256 vol)
    {
        BlackScholesMath.VolCalculationInput memory inputs = 
            BlackScholesMath.VolCalculationInput(
                spot,
                strike,
                tau,
                rate,
                tradePrice,
                scaleFactor
            );
        return BlackScholesMath.approxVolFromPutPrice(inputs);
    }

    function getCallVega(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
    ) 
        external
        view
        returns (uint256 vega) 
    {
        BlackScholesMath.PriceCalculationInput memory inputs = 
            BlackScholesMath.PriceCalculationInput(
                spot,
                strike,
                sigma,
                tau,
                rate,
                scaleFactor
            );
        return BlackScholesMath.getCallVega(inputs);
    }

    function getPutVega(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
    ) 
        external
        pure
        returns (uint256 vega) 
    {
        BlackScholesMath.PriceCalculationInput memory inputs = 
            BlackScholesMath.PriceCalculationInput(
                spot,
                strike,
                sigma,
                tau,
                rate,
                scaleFactor
            );
        return BlackScholesMath.getPutVega(inputs);
    }
}