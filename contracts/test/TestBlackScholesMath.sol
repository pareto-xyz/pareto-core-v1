// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/BlackScholesMath.sol";

/**
 * @notice Test contract to wrap around `CumulativeNormalDistribution.sol`
 */
contract TestBlackScholesMath {
    function getCallPrice(
        BlackScholesMath.PriceCalculationInput memory inputs
    ) 
        external
        pure 
        returns (uint256 price)
    {
        return BlackScholesMath.getCallPrice(inputs);
    }

    function getPutPrice(
        BlackScholesMath.PriceCalculationInput memory inputs
    )
        external
        pure
        returns (uint256 price)
    {
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
        BlackScholesMath.VolCalculationInput memory inputs
    )
        external
        pure
        returns (uint256 vol) 
    {
        return BlackScholesMath.approxVolFromCallPrice(inputs);

    }

    function approxVolFromPutPrice(
        BlackScholesMath.VolCalculationInput memory inputs
    )
        external
        pure
        returns (uint256 vol)
    {
        return BlackScholesMath.approxVolFromPutPrice(inputs);
    }

    function getVega(
        BlackScholesMath.PriceCalculationInput memory inputs
    ) 
        external
        pure
        returns (uint256 vega) 
    {
        return BlackScholesMath.getVega(inputs);
    }
}