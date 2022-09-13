// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BasicMath.sol";
import "./Derivative.sol";

/**
 * @notice Library for RegT style margin heuristics
 * @dev Based on https://zetamarkets.gitbook.io/zeta/zeta-protocol/collateral-framework/options-margin-requirements
 */
library MarginMath {
    using BasicMath for uint256;

    /**
     * @notice Compute maintainence margin for a single unit of underlying
     * @dev Separate heuristics for short/long call/put
     * @param spot Current spot price
     * @param isBuyer Is the trader going long or short
     * @param option Option object containing strike, expiry info
     * @param markPrice Mark price for option
     * @param minMarginPerc Alternative minimum percentage
     * @return margin Maintainence margin for position
     */
    function getMaintainenceMargin(
        uint256 spot,
        bool isBuyer,
        Derivative.Option memory option,
        uint256 markPrice,
        uint256 minMarginPerc
    ) 
        internal
        view
        returns (uint256 margin) 
    {
        require(
            option.expiry > block.timestamp,
            "getMaintainenceMargin: option is expired"
        );

        // Case 1: long position
        // min(100% of mark price, 6.5% of spot)
        if (isBuyer) {
            // min(100% of mark price, 6.5% of spot)
            // = min(mark price, 0.065 * spot)
            // = min(1000 * mark price, 65 * spot) / 1000
            margin = (spot * 65).min(markPrice * 1000) / 1000;

        // Case 2: short call position 
        // max((10% - OTM Amount/spot)*spot, 8% * spot) 
        } else if (option.isCall) {
            // max((10% - OTM Amount/spot)*spot, 8% * spot)
            // max(10% spot - OTM Amount, 8% * spot)
            // max(0.1 * spot - OTM Amount, 0.08 * spot)
            // max(0.1 * spot - OTM Amount, 0.08 * spot) * 100 / 100
            // max((0.1 * spot - OTM Amount) * 100, 0.08 * spot * 100) / 100
            // max((10 * spot - 100 * OTM Amount), 8 * spot) / 100
            /// @dev For a call, OTM Amount = strike - spot
            int256 otmAmount = int256(option.strike) - int256(spot);

            // If negative, OTM amount is zero
            if (otmAmount < 0) {
                otmAmount = 0;
            }

            // 0.1 * spot - OTM amount
            int256 spot100SubOTM = 10 * int256(spot) - 100 * otmAmount;

            // 0.08 * spot
            uint256 spot80 = 8 * spot;

            if (spot100SubOTM < 0) {
                // if spot100SubOTM < 0, then it cannot be max
                margin = spot80 / 100;
            } else {
                margin = uint256(spot100SubOTM).max(spot80) / 100;
            }

        // Case 3: short put position
        // min(max((10% - OTM Amount/spot)*spot, 8% * spot), 50% of strike)
        } else {
            // max((10% - OTM Amount/spot)*spot, 8% * spot)
            // max(10% spot - OTM Amount, 8% * spot)
            // max(0.1 * spot - OTM Amount, 0.08 * spot)
            // max(0.1 * spot - OTM Amount, 0.08 * spot) * 100 / 100
            // max((0.1 * spot - OTM Amount) * 100, 0.08 * spot * 100) / 100
            // max((10 * spot - 100 * OTM Amount), 8 * spot) / 100
            /// @dev For a put, OTM Amount = spot - strike
            int256 otmAmount = int256(spot) - int256(option.strike);

            // If negative, OTM amount is zero
            if (otmAmount < 0) {
                otmAmount = 0;
            }

            // 0.1 * spot - OTM amount
            int256 spot100SubOTM = 10 * int256(spot) - 100 * otmAmount;

            // 0.08 * spot
            uint256 spot80 = 8 * spot;

            // Compute max but don't divide by 100 yet
            uint256 maxChoice;
            // If 0.1 * spot - OTM amount < 0, it is not the max
            if (spot100SubOTM < 0) {
                maxChoice = spot80;
            } else {
                maxChoice = uint256(spot100SubOTM).max(spot80);
            }

            // min(maxChoice, 50% of strike * 100) / 100
            // min(maxChoice, 0.5 * strike * 100) / 100
            // min(maxChoice, 50 * strike) / 100
            margin = maxChoice.min(50 * option.strike) / 100;
        }

        // Compute alternative minimum margin
        uint256 minMargin = getAlternativeMinimum(spot, minMarginPerc);

        // Ensure margin is at least minimum
        if (minMargin > margin) {
            margin = minMargin;
        }
    }

    /**
     * @notice Compute initial margin for a single unit of underlying
     * @dev This is typically used for unmatched orders, which never make it on chain
     * but we may use it as a more aggressive margin off-chain
     * @dev Almost a clone of `getMaintainenceMargin`
     */
    function getInitialMargin(
        uint256 spot,
        bool isBuyer,
        Derivative.Option memory option,
        uint256 markPrice,
        uint256 minMarginPerc
    )
        internal
        view
        returns (uint256 margin) 
    {
        require(
            option.expiry > block.timestamp,
            "getInitialMargin: option is expired"
        );

        // Case 1: long position
        // min(100% of mark price, 10% of spot)
        if (isBuyer) {
            // min(100% of mark price, 10% of spot)
            // = min(mark price, 0.1 * spot)
            // = min(10 * mark price, spot) / 10
            margin = (spot).min(markPrice * 10) / 10;
        
        // Case 2: short call position 
        // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
        } else if (option.isCall) {
            // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
            // max((20% spot - OTM Amount), 12.5% * spot)
            // max((0.2 * spot - OTM Amount), 0.125 * spot)
            // max((0.2 * spot - OTM Amount), 0.125 * spot) * 1000 / 1000
            // max((0.2 * spot - OTM Amount) * 1000, 0.125 * spot * 1000) / 1000
            // max((200 * spot - 1000 * OTM Amount), 125 * spot) / 1000
            /// @dev For a call, OTM Amount = strike - spot
            int256 otmAmount = int256(option.strike) - int256(spot);

            // If negative, OTM amount is zero
            if (otmAmount < 0) {
                otmAmount = 0;
            }

            // 0.2 * spot - OTM amount
            int256 spot200SubOTM = 200 * int256(spot) - 1000 * otmAmount;

            // 0.125 * spot
            uint256 spot125 = 125 * spot;

            if (spot200SubOTM < 0) {
                // if spot200SubOTM < 0, then it cannot be the max
                margin = spot125 / 1000;
            } else {
                margin = uint256(spot200SubOTM).max(spot125) / 1000;
            }

        // Case 3: short put position
        // min(max((20% - OTM Amount/spot)*spot, 12.5% * spot), 50% of strike)
        } else {
            // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
            // max(20% spot - OTM Amount, 12.5% * spot)
            // max(0.2 * spot - OTM Amount, 0.125 * spot)
            // max(0.2 * spot - OTM Amount, 0.125 * spot) * 1000 / 1000
            // max((0.2 * spot - OTM Amount) * 1000, 0.125 * spot * 1000) / 1000
            // max((200 * spot - 1000 * OTM Amount), 125 * spot) / 1000
            /// @dev For a put, OTM Amount = spot - strike
            int256 otmAmount = int256(spot) - int256(option.strike);

            // If negative, OTM amount is zero
            if (otmAmount < 0) {
                otmAmount = 0;
            }

            // 0.2 * spot - OTM amount
            int256 spot200SubOTM = 200 * int256(spot) - 1000 * otmAmount;

            // 0.125 * spot
            uint256 spot125 = 125 * spot;

            // This variable stores the max multiplied by 1k
            uint256 maxChoice;
            // If 0.2 * spot - OTM amount < 0, it is not the max
            if (spot200SubOTM < 0) {
                maxChoice = spot125;
            } else {
                maxChoice = uint256(spot200SubOTM).max(spot125);
            }

            // min(maxChoice, 50% of strike * 1000) / 1000
            // min(maxChoice, 0.5 * strike * 1000) / 1000
            // min(maxChoice, 500 * strike) / 1000
            margin = maxChoice.min(500 * option.strike) / 1000;
        }

        // Compute alternative minimum margin
        uint256 minMargin = getAlternativeMinimum(spot, minMarginPerc);

        // Ensure margin is at least minimum
        if (minMargin > margin) {
            margin = minMargin;
        }
    }

    /**
     * @notice Compute alternative minimum for 1 naked calls / puts.
     * For example, if you were to sell 1 ABC call while ABC is trading at $500 and the variable percentage for ABC is 1%, 
     * the alternative minimum requirement for this ABC position would be $250 ($500 x 0.5%).
     * @param spot The spot price
     * @param percent Percentage multiplier 
     */
    function getAlternativeMinimum(uint256 spot, uint256 percent) 
        internal pure returns (uint256) 
    {
        return spot * percent / 10**4;
    }

    /**
     * @notice Computes payoff for option i.e. unrealized P&L
     * @dev Accounts for premium already
     * @param trader Address of the trader
     * @param spot Current spot price
     * @param order Order object containing option parameters and price/quantity
     * @return payoff Profit or loss of position @ spot (can be negative)
     */
    function getPayoff(
        address trader,
        uint256 spot,
        Derivative.Order memory order
    ) 
        internal
        pure
        returns (int256 payoff) 
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
        int256 payoffNoPremium;

        // Cover four cases: long/short call/put
        if (order.option.isCall) {
            /**
             * Case #1/2: trader bought/sold a call
             * payoff = max(spot - strike, 0) 
             * = max(strike, spot) - strike
             */
            payoffNoPremium = int256(spot.max(option.strike)) - int256(option.strike);
        } else {
            /**
             * Case #3/4: trader bought/sold a put
             * payoff = max(strike - spot, 0) 
             * = max(strike, spot) - spot
             */
            payoffNoPremium = int256(option.strike.max(spot)) - int256(spot);
        }

        payoff = payoffNoPremium - int256(order.tradePrice);

        // If we are selling (shorting) the option, reverse the sign
        if (!isBuyer) {
            payoff *= -1;
        }

        // Multiply payoff by the order size
        payoff = payoff * int256(order.quantity);
    }
}