// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BlackScholesMath.sol";
import "./BasicMath.sol";
import "./NegativeMath.sol";

/**
 * @notice Contains enums and structs representing Pareto derivatives
 */
library Derivative {
    using BasicMath for uint256;

    /************************************************
     * Constants
     ***********************************************/
    
    /// @notice Maximum number of iterations for computing sigma
    uint256 internal constant MAX_ITER = 10;

    /// @notice Minimum vega allowed when updating smile = 1 / 10**3 = 0.001
    uint8 internal constant MIN_VEGA_DECIMALS = 3;

    /************************************************
     * Structs and Enums
     ***********************************************/

    /// @notice Two types of options - calls and puts
    enum OptionType { CALL, PUT }

    /**
     * @notice A matched order from the Pareto orderbook
     * @param buyer Address of the buyer; the short position
     * @param seller Address of the seller; the long position
     * @param tradePrice Price of the actual order. Distinct from mark price
     * @param quantity Amount within the order
     */
    struct Order {
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
     * @param sigmaAtMoneyness Array of five implied volatility i.e. sigma
     * for the five moneyness points
     * @param exists_ is a helper attribute to check existence (default false)
     */
    struct VolatilitySmile {
        uint256[5] sigmaAtMoneyness;
        bool exists_; 
    }

    /************************************************
     * Smile Functionality
     ***********************************************/

    /**
     * @notice Create a new volatility smile, which uses `BlackScholesMath.sol` 
     * to solve for the implied volatility. 
     * @dev Volatility is initialized at 50% for all moneyness values, which is 
     * incorrect but will be updated as orders progress
     * @param initSigma Value to initialize obtained from a deribit - 4 decimals
     * @return smile A volatility smile
     */
    function createSmile(uint256 initSigma) internal pure returns (
        VolatilitySmile memory smile
    ) {
        for (uint256 i = 0; i < 5; i++) {
            smile.sigmaAtMoneyness[i] = initSigma;  // 4 decimals
        }
        // Set that the new smile exists
        smile.exists_ = true;
        return smile;
    }

    /**
     * @notice Update the volatility smile with information from a new trade
     * @dev We find the closest two points and update via interpolation
     * @dev This function modifies the state by changing the `smile` state
     * @param spot Spot price
     * @param order Order object
     * @param smile Current volatility smile stored on-chain
     * @param avgQuantity Average trade size for this expiry/underlying
     */
    function updateSmile(
        uint256 spot,
        Order memory order,
        VolatilitySmile storage smile,
        uint256 avgQuantity
    ) internal {
        Option memory option = order.option;
        require(option.expiry >= block.timestamp, "createSmile: option expired");

        // Compute time to expiry
        uint256 tau = option.expiry - block.timestamp;

        // Compute current moneyness (times by 100 for moneyness decimals)
        uint256 curMoneyness = (spot * 100) / option.strike;

        // Interpolate against existing smiles to get sigma
        uint256 sigma = interpolate([50,75,100,125,150], smile.sigmaAtMoneyness, curMoneyness);

        // Compute mark price using current option
        uint256 markPrice = getMarkPrice(option, spot, sigma);

        // Find closest two data points
        (uint256 indexLower, uint256 indexUpper) = findClosestIndices([50,75,100,125,150], curMoneyness);

        uint256 vega;

        // Compute vega of option
        vega = BlackScholesMath.getVega(
            BlackScholesMath.PriceCalculationInput(
                spot,
                option.strike,
                sigma,
                tau,
                0, // TODO: risk-free rate
                10**(18-option.decimals),
                option.optionType == OptionType.CALL
            )
        );

        if (vega == 0) {
            // Set vega to minimum
            vega = 10**(option.decimals - MIN_VEGA_DECIMALS);
        }

        if (indexLower == indexUpper) {
            // A single point to update
            updateSigma(indexLower, smile, order.tradePrice, markPrice, order.quantity, vega, avgQuantity);
        } else {
            // Two points to update
            updateSigma(indexLower, smile, order.tradePrice, markPrice, order.quantity, vega, avgQuantity);
            updateSigma(indexUpper, smile, order.tradePrice, markPrice, order.quantity, vega, avgQuantity);
        }
    }

    /**
     * @notice Helper function to fetch an estimated for IV for moneyness input
     * @param spot Spot price
     * @param strike Strike price
     * @param smile Implied volatility smile
     */
    function querySmile(uint256 spot, uint256 strike, VolatilitySmile memory smile) 
        internal
        pure
        returns (uint256 sigma)
    {
        // Compute current moneyness (times by 100 for moneyness decimals)
        uint256 curMoneyness = (spot * 100) / strike;

        // Interpolate against existing smiles to get sigma
        sigma = interpolate([50,75,100,125,150], smile.sigmaAtMoneyness, curMoneyness);
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
     * @param avgTradeSize Average trade size
     */
    function updateSigma(
        uint256 index,
        VolatilitySmile storage smile,
        uint256 tradePrice,
        uint256 markPrice,
        uint256 tradeSize,
        uint256 optionVega,
        uint256 avgTradeSize
    )
        internal
    {
        uint256 adjustPerc;  // percentage for adjustment
        uint256 deltaPrice;  // difference between trade and mark price
        bool isNegative;     // is the difference negative

        // Fetch the current volatility from smile
        uint256 curSigma = smile.sigmaAtMoneyness[index];

        // min(tradeSize/avgTradeSize,1) = min(tradeSize,avgTradeSize)/avgTradeSize
        if (tradeSize < avgTradeSize) {
            tradeSize = avgTradeSize;
        }

        if (tradePrice >= markPrice) {
            deltaPrice = tradePrice - markPrice;
        } else {
            deltaPrice = markPrice - tradePrice;
            isNegative = true;
        }

        // 100 is for decimals e.g. 5% => 500. This allows us to capture 0.0X%
        adjustPerc = deltaPrice * 100 * tradeSize / (optionVega * avgTradeSize);

        // Do nothing if the adjustment percentage is very small
        if (adjustPerc > 0) {
            // Cap the percentage adjust to be 5%
            if (adjustPerc > 500) {
                adjustPerc = 500;
            }
            // Divide by 10000 because 2 places for decimals and 2 for percentage
            if (isNegative) {
                smile.sigmaAtMoneyness[index] = curSigma - (curSigma * adjustPerc) / 10000;
            } else {
                smile.sigmaAtMoneyness[index] = curSigma + (curSigma * adjustPerc) / 10000;
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
     */
    function getMarkPrice(Option memory option, uint256 spot, uint256 sigma) 
        internal
        view
        returns (uint256 price) 
    {   
        uint256 tau = option.expiry - block.timestamp;
        price = BlackScholesMath.getPrice(
            BlackScholesMath.PriceCalculationInput(
                spot,
                option.strike,
                sigma,
                tau,
                0,  // TODO: need to get rate
                10**(18-option.decimals),
                option.optionType == OptionType.CALL
            )
        );
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
        internal
        pure
        returns (bytes32 hash_) 
    {
        hash_ = keccak256(abi.encodePacked(
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
        internal
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

    /**
     * @notice Calls and puts of the same expiry and underlying but different 
     * strikes share the same smile
     * @param underlying Address for underlying token
     * @param expiry Expiry timestamp
     * @param hash_ SHA-3 hash of the Option object
     */
    function hashForSmile(address underlying, uint256 expiry)
        internal
        pure
        returns (bytes32 hash_)
    {
        hash_ = keccak256(abi.encodePacked(underlying, expiry));
    }

    /************************************************
     * Internal Functions
     ***********************************************/

    /**
     * @notice Compute the interpolated value based on a query key
     * @dev y = y1 + (x - x1) * (y2 - y1) / (x2 - x1)
     * @param sortedKeys Array of size 5 containing numeric keys sorted
     * @param values Array of size 5 containing numeric values (all must be positive)
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
        returns (uint256)
    {
        (uint256 indexLower, uint256 indexUpper) = findClosestIndices(sortedKeys, queryKey);

        if (indexLower == indexUpper) {
            return values[indexLower];
        } else {
            (uint256 yDiff, bool yIsNeg) = values[indexUpper].absdiff(values[indexLower]);
            uint256 xDiff = sortedKeys[indexUpper] - sortedKeys[indexLower];

            // Compute slope
            uint256 slopeAbs = (queryKey - sortedKeys[indexLower]) * yDiff / xDiff;

            // Add intercept to slope
            (uint256 queryValue, bool outIsNeg) = NegativeMath.add(values[indexLower], false, slopeAbs, yIsNeg);

            // It must be that the value is positive
            require(!outIsNeg, "interpolate: how did you get a negative?");

            return queryValue;
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
            // If the query is exactly one of the points, return point
            if (query == sortedData[i]) {
                return (i, i);
            } else if (query < sortedData[i]) {
                // First entry larger than query, we quite
                indexUpper = i;
                return (indexLower, indexUpper);
            } else if (query > sortedData[i]) {
                indexLower = i;
            }
        }
        // Should not reach here
        return (indexLower, indexUpper);
    }
}