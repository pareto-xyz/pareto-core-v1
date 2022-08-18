// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BlackScholesMath.sol";

import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @notice Contains enums and structs representing Pareto derivatives
 */
library Derivative {
    /// @notice Two types of options - calls and puts
    enum OptionType { CALL, PUT }

    /**
     * @notice A matched option order from a Pareto bookorder
     * @param bookId Identifier of the orderbook the order came from
     * @param optionType Is this a call or put option?
     * @param tradePrice Actual price that the option was matched at
     * @param underlying Address of the underlying token e.g. WETH
     * @param strike Strike price of the option
     * @param expiry Expiry in epoch time of the option
     * @param buyer Address of the buyer; the short position
     * @param seller Address of the seller; the long position
     * @param decimals Decimals for underlying
     */
    struct Option {
        string bookId;
        OptionType optionType;
        uint256 tradePrice;
        address underlying;
        uint256 strike;
        uint256 expiry;
        address buyer;
        address seller;
        uint8 decimals;
    }

    /**
     * @notice Stores a surface to track implied volatility for mark price
     * @param optionHash Keccack hash of the option. A separate smile should 
     * be stored for each option
     * @param volAtMoneyness Array of five implied volatility i.e. sigma*sqrt(tau)
     * for the five moneyness points
     * @param exists_ is a helper attribute to check existence (default false)
     */
    struct VolatilitySmile {
        bytes32 optionHash;
        uint256[5] volAtMoneyness;
        bool exists_; 
    }

    /**
     * @notice Create a new volatility smile, which uses `BlackScholesMath.sol` 
     * to approximate the implied volatility 
     * @param option Option object
     * @return smile A volatility smile
     */
    function createSmile(Option memory option)
        external
        view
        returns (VolatilitySmile memory smile) 
    {
        require(option.expiry >= block.timestamp, "createSmile: option expired");
        uint256 curTime = block.timestamp;

        // Compute scale factor
        uint256 scaleFactor = 10**(18-option.decimals);

        /// @notice Default five points for moneyness. Same as in Zeta.
        uint8[5] memory moneyness = [50, 75, 100, 125, 150];

        // Set the hash for the new smile
        smile.optionHash = hashOption(option);
        smile.exists_ = true;

        if (option.optionType == OptionType.CALL) {
            for (uint256 i = 0; i < moneyness.length; i++) {
                uint256 spot = (option.strike * moneyness[i]) / 100;
                uint256 vol = BlackScholesMath.approxVolFromCallPrice(
                    BlackScholesMath.VolCalculationInput(
                        spot,
                        option.strike,
                        option.expiry - curTime,
                        0,  // FIXME: get risk-free rate
                        scaleFactor,
                        option.tradePrice
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
                        option.expiry - curTime,
                        0,  // FIXME: get risk-free rate
                        option.tradePrice,
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
     * @param spot Spot price
     * @param option Option object
     * @param smile Current volatility smile stored on-chain
     * @param decimals Decimals for the underlying token
     */
    function updateSmile(
        uint256 spot,
        Option memory option,
        VolatilitySmile storage smile
    )
        external
        view
    {
        require(option.expiry >= block.timestamp, "createSmile: option expired");
        uint256 curTime = block.timestamp;

        // Compute current moneyness (times by 100 for moneyness decimals)
        uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

        // Find closest two data points
        (uint256 indexLower, uint256 indexUpper) = 
            findClosestTwoIndices([50,75,100,125,150], curMoneyness);

        if (indexLower == indexUpper) {
            // A single point to update
        } else {
            // Two points to update
        }
    }

    /**
     * @notice Hash option into byte string
     * @param option Option object 
     * @param hash_ SHA-3 hash of the future object
     */
    function hashOption(Option memory option)
        public
        pure
        returns (bytes32 hash_) 
    {
        hash_ = keccak256(abi.encodePacked(
            option.bookId,
            option.optionType,
            option.tradePrice,
            option.underlying, 
            option.strike,
            option.expiry,
            option.buyer,
            option.seller
        ));
    }

    /**
     * @notice Given a query point, find the indices of the closest two points 
     * @param sortedData Data to search amongst. Assume it is sorted
     * @param query Data point to search with
     * @return indexLower Index of the largest point less than `query`
     * @return indexUpper Index of the smallest point greater than `query`
     */
    function findClosestTwoIndices(uint8[5] memory sortedData, uint256 query) 
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

    /**
     * @notice Compute mark price using Black Scholes
     * @param spot Current spot price
     * @param option Option object containing strike, expiry, and price info
     * @param smile Volatility smile from moneyness to vol
     */
    function getMarkPrice(
        uint256 spot,
        Option memory option,
        VolatilitySmile storage smile
    ) 
        public
        view
        returns (uint256 price) 
    {
        require(option.expiry >= block.timestamp, "createSmile: option expired");
        uint256 tau = option.expiry - block.timestamp;
        // Times by extra 100 for moneyness decimals
        uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

        uint256 vol = interpolate(
            [50,75,100,125,150], smile.volAtMoneyness, curMoneyness);
        uint256 sigma = BlackScholesMath.volToSigma(vol, tau);
        
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
        returns (uint256 queryValue)
    {
        (uint256 indexLower, uint256 indexUpper) = 
            findClosestTwoIndices(sortedKeys, queryKey);
        if (indexLower == indexUpper) {
            queryValue = values[indexLower];
        } else {
            queryValue = (values[indexLower] + values[indexUpper]) / 2;
        }
    }
}