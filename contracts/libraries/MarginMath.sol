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
     * @notice Compute maintainence margin for a single unit of underlying
     * @dev Separate heuristics for short/long call/put
     * @param spot Current spot price
     * @param isBuyer Is the trader going long or short
     * @param option Option object containing strike, expiry info
     * @param smile Volatility smile to get implied vol
     * @return margin Maintainence margin for position
     */
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
        require(
            option.expiry > block.timestamp,
            "getInitialMargin: option is expired"
        );

        // Case 1: long position
        // min(100% of mark price, 6.5% of spot)
        if (isBuyer) {
            // Compute time to expiry
            uint256 tau = option.expiry - block.timestamp;

            // Compute current moneyness (times by 100 for moneyness decimals)
            uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

            // Interpolate against existing smiles to get sigma
            uint256 sigma = Derivative.interpolate([50,75,100,125,150], smile.sigmaAtMoneyness, curMoneyness);

            // Compute mark price
            uint256 markPrice = Derivative.getMarkPrice(option, spot, sigma, tau);

            // min(100% of mark price, 6.5% of spot)
            // = min(mark price, 0.065 * spot)
            // = min(1000 * mark price, 65 * spot) / 1000
            margin = (spot * 65).min(markPrice * 1000) / 1000;

        // Case 2: short call position 
        // max((10% - OTM Amount/spot)*spot, 8% * spot) 
        } else if (isCall(option)) {
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

        // Is the trader the buyer or seller? 
        bool isBuyer = (trader == order.buyer) ? true : false;

        // Fetch the option from the order
        Derivative.Option memory option = order.option;

        // Declare variable for payoff w/o premium
        uint256 payoffNoPremium;

        // Cover four cases: long/short call/put
        if (isCall(order.option)) {
            /**
             * Case #1/2: trader bought/sold a call
             * payoff = max(spot - strike, 0) 
             * = max(strike, spot) - strike
             */
            payoffNoPremium = spot.max(option.strike) - option.strike;

            (payoff, isNegative) = payoffNoPremium.absdiff(order.tradePrice);

            // If we are selling (shorting) the call, we just have to 
            // flip the negative
            if (!isBuyer) {
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
            if (!isBuyer) {
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
     * @param option `Option` object containing strike, expiry info
     */
    function isCall(Derivative.Option memory option)
        internal
        pure
        returns (bool) 
    {
        return option.optionType == Derivative.OptionType.CALL;
    }
}