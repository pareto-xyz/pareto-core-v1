// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/BlackScholesMath.sol";

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
        returns (int128 d1, int128 d2) 
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

        return BlackScholesMath.getProbabilityFactors(inputsX64);
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

    function getVega(
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
        return BlackScholesMath.getVega(inputs);
    }
}