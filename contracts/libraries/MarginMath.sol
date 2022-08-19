// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BasicMath.sol";
import "./Derivative.sol";
import "./BlackScholesMath.sol";

/**
 * @notice Library for RegT style margin heuristics
 * @dev Based on https://zetamarkets.gitbook.io/zeta/zeta-protocol/collateral-framework/options-margin-requirements
 */
library MarginMath {
    using BasicMath for uint256;

    /************************************************
     * External Functions
     ***********************************************/

    /**
     * @notice Compute initial margin
     * @dev Separate heuristics for short/long call/put
     * @param trader Address of the trader
     * @param spot Current spot price
     * @param order Order object containing option parameters and price/quantity
     * @param smile Volatility smile to get implied vol
     * @return margin Initial margin for position
     */
    function getInitialMargin(
        address trader,
        uint256 spot,
        Derivative.Order memory order,
        Derivative.VolatilitySmile memory smile
    )
        external
        view
        returns (uint256 margin) 
    {
        require(
            (trader == order.buyer) || (trader == order.seller),
            "getInitialMargin: trader must be buyer or seller"
        );
        Derivative.Option memory option = order.option;
        require(
            option.expiry > block.timestamp,
            "getInitialMargin: option is expired"
        );

        // Case 1: long position
        // min(100% of mark price, 10% of spot)
        if (isLong(trader, order)) {
            // Compute time to expiry
            uint256 tau = option.expiry - block.timestamp;

            // Compute current moneyness (times by 100 for moneyness decimals)
            uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

            // Interpolate against existing smiles to get sigma
            uint256 vol = Derivative.interpolate([50,75,100,125,150], smile.volAtMoneyness, curMoneyness);

            // Convert implied vol to sigma
            uint256 sigma = BlackScholesMath.volToSigma(vol, tau);

            // Compute mark price
            uint256 markPrice = Derivative.getMarkPrice(option, spot, sigma, tau);

            // min(100% of mark price, 10% of spot)
            // = min(mark price, 0.1 * spot) 
            // = min(mark price * 10, spot) / 10
            margin = spot.min(markPrice * 10) / 10;

        // Case 2: short call position 
        // max((20% - OTM Amount/spot)*spot, 12.5% * spot) 
        } else if (isCall(order)) {
            (uint256 otmAmount, bool isNegative) = option.strike.absdiff(spot);
            uint256 spot200SubOTM = isNegative ? (200 * spot + otmAmount) : (200 * spot - otmAmount);
            uint256 spot125 = 125 * spot;

            // max((20% - OTM Amount/spot)*spot, 12.5% * spot) 
            margin = spot200SubOTM.max(spot125) / 1000;

        // Case 3: short put position
        // min(max((20% - OTM Amount/spot)*spot, 12.5% * spot), 50% of strike)
        } else {
            // Compute max((20% - OTM Amount/spot)*spot, 12.5% * spot)
            (uint256 otmAmount, bool isNegative) = option.strike.absdiff(spot);
            uint256 spot200SubOTM = isNegative ? (200 * spot + otmAmount) : (200 * spot - otmAmount);
            uint256 spot125 = 125 * spot;

            // Compute max but don't divide by 1000 yet
            uint256 maxChoice = spot200SubOTM.max(spot125);

            // Compute min(maxChoice, 50% of strike)
            uint256 halfStrike = 500 * option.strike;
            margin = maxChoice.min(halfStrike) / 1000;
        }
    }

    /**
     * @notice Compute maintainence margin
     * @dev Separate heuristics for short/long call/put
     * @param trader Address of the trader
     * @param spot Current spot price
     * @param order Order object containing option parameters and price/quantity
     * @param smile Volatility smile to get implied vol
     * @return margin Maintainence margin for position
     */
    function getMaintainenceMargin(
        address trader,
        uint256 spot,
        Derivative.Order memory order,
        Derivative.VolatilitySmile memory smile
    ) 
        external
        view
        returns (uint256 margin) 
    {
        require(
            (trader == order.buyer) || (trader == order.seller),
            "getInitialMargin: trader must be buyer or seller"
        );
        Derivative.Option memory option = order.option;
        require(
            option.expiry > block.timestamp,
            "getInitialMargin: option is expired"
        );

        // Case 1: long position
        // min(100% of mark price, 6.5% of spot)
        if (isLong(trader, order)) {
            // Compute time to expiry
            uint256 tau = option.expiry - block.timestamp;

            // Compute current moneyness (times by 100 for moneyness decimals)
            uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

            // Interpolate against existing smiles to get sigma
            uint256 vol = Derivative.interpolate([50,75,100,125,150], smile.volAtMoneyness, curMoneyness);

            // Convert implied vol to sigma
            uint256 sigma = BlackScholesMath.volToSigma(vol, tau);

            // Compute mark price
            uint256 markPrice = Derivative.getMarkPrice(option, spot, sigma, tau);

            // min(100% of mark price, 6.5% of spot)
            // = min(mark price, 0.065 * spot)
            // = min(1000 * mark price, 65 * spot) / 1000
            margin = (spot * 65).min(markPrice * 1000) / 1000;

        // Case 2: short call position 
        // max((10% - OTM Amount/spot)*spot, 8% * spot) 
        } else if (isCall(order)) {
            (uint256 otmAmount, bool isNegative) = option.strike.absdiff(spot);
            uint256 spot100SubOTM = isNegative ? (100 * spot + otmAmount) : (100 * spot - otmAmount);
            uint256 spot80 = 80 * spot;

            // max((10% - OTM Amount/spot)*spot, 8% * spot) 
            margin = spot100SubOTM.max(spot80) / 1000;

        // Case 3: short put position
        // min(max((10% - OTM Amount/spot)*spot, 12.5% * spot), 50% of strike)
        } else {
            // Compute max((10% - OTM Amount/spot)*spot, 12.5% * spot)
            (uint256 otmAmount, bool isNegative) = option.strike.absdiff(spot);
            uint256 spot100SubOTM = isNegative ? (100 * spot + otmAmount) : (100 * spot - otmAmount);
            uint256 spot80 = 80 * spot;

            // Compute max but don't divide by 1000 yet
            uint256 maxChoice = spot100SubOTM.max(spot80);

            // Compute min(maxChoice, 50% of strike)
            uint256 halfStrike = 500 * option.strike;
            margin = maxChoice.min(halfStrike) / 1000;
        }
    }

    /**
     * @notice Computes payoff for option i.e. unrealized P&L
     * @param trader Address of the trader
     * @param spot Current spot price
     * @param order Order object containing option parameters and price/quantity
     * @return payoff Profit or loss of position @ spot
     * @return isNegative Is `payoff < 0` (true) or `payoff >= 0` (false)
     */
    function getPayoff(
        address trader,
        uint256 spot,
        Derivative.Order memory order
    ) 
        external
        pure
        returns (uint256 payoff, bool isNegative) 
    {
        require(
            (trader == order.buyer) || (trader == order.seller),
            "getInitialMargin: trader must be buyer or seller"
        );
        Derivative.Option memory option = order.option;

        uint256 payoffNoPremium;

        // Cover four cases: long/short call/put
        if (isCall(order)) {
            /**
             * Case #1/2: trader bought/sold a call
             * payoff = max(spot - strike, 0) 
             * = max(strike, spot) - strike
             */
            payoffNoPremium = spot.max(option.strike) - option.strike;
            (payoff, isNegative) = payoffNoPremium.absdiff(order.tradePrice);
            
            // If we are selling (shorting) the call, we just have to 
            // flip the negative
            if (!isLong(trader, order)) {
                isNegative = !isNegative;
            }
        } else {
            /**
             * Case #3/4: trader bought/sold a put
             * payoff = max(strike - spot, 0) 
             * = max(strike, spot) - spot
             */
            payoffNoPremium = option.strike.max(spot) - spot;
            (payoff, isNegative) = payoffNoPremium.absdiff(order.tradePrice);
            
            // If we are selling (shorting) the call, we just have to 
            // flip the negative
            if (!isLong(trader, order)) {
                isNegative = !isNegative;
            }
        }

        // Multiply payoff by the order size
        payoff = payoff * order.quantity;
    }

    /************************************************
     * Helper Functions
     ***********************************************/
    
    /**
     * @notice Returns true if order contains a call, else false if a put
     * @param order `Order` object containing an `Option` object
     */
    function isCall(Derivative.Order memory order)
        internal
        pure
        returns (bool) 
    {
        return order.option.optionType == Derivative.OptionType.CALL;
    }

    /**
     * @notice Returns true if order is a long position, else false
     * if order is a short position
     * @param trader Address of the trader
     * @param order `Order` object containing an `Option` object
     */
    function isLong(address trader, Derivative.Order memory order)
        internal
        pure
        returns (bool) 
    {
        require(
            (trader == order.buyer) || (trader == order.seller),
            "isLong: trader must be buyer or seller"
        );
        return trader == order.buyer;
    }
}