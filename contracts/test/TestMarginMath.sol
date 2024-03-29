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
        uint256 markPrice,
        uint256 minMarginPerc
    ) 
        external
        view
        returns (uint256 margin) 
    {
        return MarginMath.getMaintainenceMargin(spot, isBuyer, option, markPrice, minMarginPerc);
    }

    function getInitialMargin(
        uint256 spot,
        bool isBuyer,
        Derivative.Option memory option,
        uint256 markPrice,
        uint256 minMarginPerc
    ) 
        external
        view
        returns (uint256 margin) 
    {
        return MarginMath.getInitialMargin(spot, isBuyer, option, markPrice, minMarginPerc);
    }

    function getAlternativeMinimum(uint256 spot, uint256 percent) 
        external pure returns (uint256) 
    {
        return MarginMath.getAlternativeMinimum(spot, percent);
    }

    function getPayoff(
        address trader,
        uint256 spot,
        Derivative.Order memory order
    ) 
        external
        pure
        returns (int256 payoff) 
    {
        return MarginMath.getPayoff(trader, spot, order);
    }
}