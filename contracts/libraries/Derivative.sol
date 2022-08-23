// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BlackScholesMath.sol";
import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @notice Contains enums and structs representing Pareto derivatives
 */
library Derivative {
    /************************************************
     * Structs and Enums
     ***********************************************/

    /// @notice Two types of options - calls and puts
    enum OptionType { CALL, PUT }

    /**
     * @notice A matched order from the Pareto orderbook
     * @param orderId Identifier of the unique order (like a nonce)
     * @param buyer Address of the buyer; the short position
     * @param seller Address of the seller; the long position
     * @param tradePrice Price of the actual order. Distinct from mark price
     * @param quantity Amount within the order
     */
    struct Order {
        string orderId;
        address buyer;
        address seller;
        uint256 tradePrice;
        uint256 quantity;
        Option option;
    }

    /**
     * @notice Option parameters
     * @param optionType Is this a call or put option?
     * @param strike Strike price of the option
     * @param expiry Expiry in epoch time of the option
     * @param underlying Address of the underlying token e.g. WETH
     * @param decimals Decimals for underlying
     */
    struct Option {
        OptionType optionType;
        uint256 strike;
        uint256 expiry;
        address underlying;
        uint8 decimals;
    }

    /**
     * @notice Stores a surface to track implied volatility for mark price
     * @param volAtMoneyness Array of five implied volatility i.e. sigma*sqrt(tau)
     * for the five moneyness points
     * @param exists_ is a helper attribute to check existence (default false)
     */
    struct VolatilitySmile {
        uint256[5] volAtMoneyness;
        bool exists_; 
    }

    /************************************************
     * Smile Functionality
     ***********************************************/

    /**
     * @notice Create a new volatility smile, which uses `BlackScholesMath.sol` 
     * to approximate the implied volatility 
     * @param order Order object
     * @return smile A volatility smile
     */
    function createSmile(Order memory order)
        external
        view
        returns (VolatilitySmile memory smile) 
    {
        Option memory option = order.option;
        require(option.expiry >= block.timestamp, "createSmile: option expired");

        // Compute scale factor
        uint256 scaleFactor = 10**(18-option.decimals);

        /// @notice Default five points for moneyness. Same as in Zeta.
        uint8[5] memory moneyness = [50, 75, 100, 125, 150];

        // Set the hash for the new smile
        smile.exists_ = true;

        if (option.optionType == OptionType.CALL) {
            for (uint256 i = 0; i < moneyness.length; i++) {
                uint256 spot = (option.strike * moneyness[i]) / 100;
                uint256 vol = BlackScholesMath.approxVolFromCallPrice(
                    BlackScholesMath.VolCalculationInput(
                        spot,
                        option.strike,
                        option.expiry - block.timestamp,
                        0,  // FIXME: get risk-free rate
                        scaleFactor,
                        order.tradePrice
                    )
                );
                smile.volAtMoneyness[i] = vol;
            }
        } else {
            for (uint256 i = 0; i < moneyness.length; i++) {
                uint256 spot = (option.strike * moneyness[i]) / 100;
                uint256 vol = BlackScholesMath.approxVolFromPutPrice(
                    BlackScholesMath.VolCalculationInput(
                        spot,
                        option.strike,
                        option.expiry - block.timestamp,
                        0,  // FIXME: get risk-free rate
                        order.tradePrice,
                        scaleFactor
                    )
                );
                smile.volAtMoneyness[i] = vol;
            }
        }
        return smile;
    }

    /**
     * @notice Update the volatility smile with information from a new trade
     * @dev We find the closest two points and update via interpolation
     * @dev This function modifies the state by changing the `smile` state
     * @param spot Spot price
     * @param order Order object
     * @param smile Current volatility smile stored on-chain
     */
    function updateSmile(
        uint256 spot,
        Order memory order,
        VolatilitySmile storage smile
    )
        external
    {
        Option memory option = order.option;
        require(option.expiry >= block.timestamp, "createSmile: option expired");

        // Compute time to expiry
        uint256 tau = option.expiry - block.timestamp;

        // Compute current moneyness (times by 100 for moneyness decimals)
        uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

        // Interpolate against existing smiles to get sigma
        uint256 vol = interpolate(
            [50,75,100,125,150],
            smile.volAtMoneyness,
            curMoneyness
        );
        uint256 sigma = BlackScholesMath.volToSigma(vol, tau);

        // Compute mark price using current option
        uint256 markPrice = getMarkPrice(option, spot, sigma, tau);

        // Find closest two data points
        (uint256 indexLower, uint256 indexUpper) = 
            findClosestIndices([50,75,100,125,150], curMoneyness);

        // Compute vega of option
        uint256 vega = BlackScholesMath.getVega(
            BlackScholesMath.PriceCalculationInput(
                spot,
                option.strike,
                sigma,
                option.expiry - block.timestamp,
                0, // FIXME: risk-free rate
                10**(18-option.decimals)
            )
        );
    
        if (indexLower == indexUpper) {
            // A single point to update
            updateVol(
                indexLower, smile, order.tradePrice, markPrice,
                order.quantity, vega, 1000
            );
        } else {
            // Two points to update
            updateVol(
                indexLower, smile, order.tradePrice, markPrice,
                order.quantity, vega, 1000
            );
            updateVol(
                indexUpper, smile, order.tradePrice, markPrice,
                order.quantity, vega, 1000
            );
        }
    }

    /**
     * @notice Updating volatility uses the following formula:
     * @dev min((trade price - mark price) / vega * min(trade size / Z, 1)), 5%)
     * @dev This function modifies `smile`, hence modifying state
     * @param index Index of the discrete smile to update
     * @param smile Current volatility smile stored on-chain
     * @param tradePrice Actual price of the trade
     * @param markPrice Computed mark price using Black-Scholes
     * @param tradeSize Size of the trade
     * @param optionVega Vega of the option
     * @param tradeNorm Normalization constant for trade size
     */
    function updateVol(
        uint256 index,
        VolatilitySmile storage smile,
        uint256 tradePrice,
        uint256 markPrice,
        uint256 tradeSize,
        uint256 optionVega,
        uint256 tradeNorm
    )
        internal
    {
        uint256 adjustPerc;  // percentage for adjustment
        uint256 deltaPrice;  // difference between trade and mark price
        bool isNegative;     // is the difference negative

        // Fetch the current volatility from smile
        uint256 curVol = smile.volAtMoneyness[index];

        // min(tradeSize/tradeNorm,1) = min(tradeSize,tradeNorm)/tradeNorm
        if (tradeSize > tradeNorm) {
            tradeSize = tradeNorm;
        }

        if (tradePrice >= markPrice) {
            deltaPrice = tradePrice - markPrice;
        } else {
            deltaPrice = markPrice - tradePrice;
            isNegative = true;
        }

        // 100 is for decimals e.g. 5% => 500. This allows us to capture 0.0X%
        adjustPerc = deltaPrice * tradeSize * 100 / (optionVega * tradeNorm);

        // Do nothing if the adjustment percentage is very small
        if (adjustPerc > 0) {
            // Cap the percentage adjust to be 5%
            if (adjustPerc > 500) {
                adjustPerc = 500;
            }
            // Divide by 10000 because 2 places for decimals and 2 for percentage
            if (isNegative) {
                smile.volAtMoneyness[index] = 
                    curVol - (curVol * adjustPerc) / 10000;
            } else {
                smile.volAtMoneyness[index] = 
                    curVol + (curVol * adjustPerc) / 10000;
            }
        }
    } 

    /************************************************
     * Pricing Functionality
     ***********************************************/

    /**
     * @notice Compute mark price using Black Scholes
     * @param option Option object containing strike and expiry info
     * @param spot Current spot price
     * @param sigma Standard deviation in returns (volatility)
     * @param tau Time to expiry
     */
    function getMarkPrice(
        Option memory option,
        uint256 spot,
        uint256 sigma,
        uint256 tau
    ) 
        public
        view
        returns (uint256 price) 
    {   
        if (option.optionType == OptionType.CALL) {
            price = BlackScholesMath.getCallPrice(
                BlackScholesMath.PriceCalculationInput(
                    spot,
                    option.strike,
                    sigma,
                    tau,
                    0,  // FIXME: need to get rate
                    10**(18-option.decimals)
                )
            );
        } else {
            price = BlackScholesMath.getPutPrice(
                BlackScholesMath.PriceCalculationInput(
                    spot,
                    option.strike,
                    sigma,
                    tau,
                    0,  // FIXME: need to get rate
                    10**(18-option.decimals)
                )
            );
        }
    }

    /************************************************
     * Utility Functions
     ***********************************************/

    /**
     * @notice Hash order into byte string
     * @param order Order object 
     * @param hash_ SHA-3 hash of the Order object
     */
    function hashOrder(Order memory order)
        public
        pure
        returns (bytes32 hash_) 
    {
        hash_ = keccak256(abi.encodePacked(
            order.orderId,
            order.buyer,
            order.seller,
            order.tradePrice,
            order.quantity,
            hashOption(order.option)
        ));
    }

    /**
     * @notice Hash option into byte string
     * @param option Option object 
     * @param hash_ SHA-3 hash of the Option object
     */
    function hashOption(Option memory option)
        public
        pure
        returns (bytes32 hash_)
    {
        hash_ = keccak256(abi.encodePacked(
            option.optionType,
            option.underlying, 
            option.strike,
            option.expiry
        ));
    }

    /************************************************
     * Internal Functions
     ***********************************************/

    /**
     * @notice Compute the interpolated value based on a query key
     * @param sortedKeys Array of size 5 containing numeric keys sorted
     * @param values Array of size 5 containing numeric values
     * @param queryKey Key to search for
     * @return queryValue Interpolated value for the queryKey
     */
    function interpolate(
        uint8[5] memory sortedKeys,
        uint256[5] memory values,
        uint256 queryKey
    )
        internal
        pure
        returns (uint256 queryValue)
    {
        (uint256 indexLower, uint256 indexUpper) = 
            findClosestIndices(sortedKeys, queryKey);
        if (indexLower == indexUpper) {
            queryValue = values[indexLower];
        } else {
            queryValue = (values[indexLower] + values[indexUpper]) / 2;
        }
    }

    /**
     * @notice Given a query point, find the indices of the closest two points 
     * @param sortedData Data to search amongst. Assume it is sorted
     * @param query Data point to search with
     * @return indexLower Index of the largest point less than `query`
     * @return indexUpper Index of the smallest point greater than `query`
     */
    function findClosestIndices(uint8[5] memory sortedData, uint256 query) 
        internal
        pure
        returns (uint256, uint256) 
    {
        // If the query is below the smallest number, return 0 for both indices
        if (query < sortedData[0]) {
            return (0, 0);
        }
        if (query > sortedData[4]) {
            return (4, 4);
        }

        uint256 indexLower;
        uint256 indexUpper;
        for (uint256 i = 0; i < 5; i++) {
            // If the query is exactly one of the points, return only 
            // that point
            if (query == sortedData[i]) {
                return (i, i);
            } else if (query < sortedData[i]) {
                // Just keep overwriting the lower index
                indexLower = i;
            } else if (query > sortedData[i]) {
                // If we found a point bigger which we are guaranteed to find, 
                // then pick the first one this happens
                indexUpper = i;
                // We can return since we definitely have found `indexLower`
                // by the time we reach here
                return (indexLower, indexUpper);
            }
        }
        return (indexLower, indexUpper);
    }
}