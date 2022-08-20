// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/Derivative.sol";
import "../libraries/MarginMath.sol";

/**
 * @notice Test contract to wrap around `MarginMath.sol`
 */
contract TestMarginMath {
    function getMaintainenceMargin(
        uint256 spot,
        bool isBuyer,
        Derivative.Option memory option,
        Derivative.VolatilitySmile memory smile
    ) 
        external
        view
        returns (uint256 margin) 
    {
        return MarginMath.getMaintainenceMargin(spot, isBuyer, option, smile);
    }

    function getPayoff(
        address trader,
        uint256 spot,
        Derivative.Order memory order
    ) 
        external
        pure
        returns (uint256 payoff, bool isNegative) 
    {
        return MarginMath.getPayoff(trader, spot, order);
    }

    function isCall(Derivative.Option memory option)
        external
        pure
        returns (bool) 
    {
        return MarginMath.isCall(option);
    }
}