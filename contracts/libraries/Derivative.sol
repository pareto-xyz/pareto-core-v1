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
    }

    /**
     * @notice Stores a surface to track implied volatility for mark price
     * @param optionHash Keccack hash of the option. A separate smile should 
     * be stored for each option
     * @param ivAtMoneyness Array of five implied volatility i.e. sigma*sqrt(tau)
     * for the five moneyness points
     * @param exists_ is a helper attribute to check existence (default false)
     */
    struct VolatilitySmile {
        bytes32 optionHash;
        uint256[5] ivAtMoneyness;
        bool exists_; 
    }

    /**
     * @notice Create a new volatility smile, which uses `BlackScholesMath.sol` 
     * to approximate the implied volatility 
     * @param option Option object
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     * @return smile A volatility smile
     */
    function createSmile(Option memory option, uint256 scaleFactor)
        external
        view
        returns (VolatilitySmile memory smile) 
    {
        require(option.expiry >= block.timestamp, "createSmile: option expired");
        uint256 curTime = block.timestamp;

        /// @notice Default five points for moneyness. Same as in Zeta.
        uint8[5] memory moneyness = [50, 75, 100, 125, 150];

        // Set the hash for the new smile
        smile.optionHash = hashOption(option);
        smile.exists_ = true;

        if (option.optionType == OptionType.CALL) {
            for (uint256 i = 0; i < moneyness.length; i++) {
                uint256 spot = (option.strike * moneyness[i]) / 100;
                uint256 vol = BlackScholesMath.approxIVFromCallPrice(
                    BlackScholesMath.VolCalculationInput(
                        spot,
                        option.strike,
                        option.expiry - curTime,
                        0,  // FIXME: get risk-free rate
                        scaleFactor,
                        option.tradePrice
                    )
                );
                smile.ivAtMoneyness[i] = vol;
            }
        } else {
            for (uint256 i = 0; i < moneyness.length; i++) {
                uint256 spot = (option.strike * moneyness[i]) / 100;
                uint256 vol = BlackScholesMath.approxIVFromPutPrice(
                    BlackScholesMath.VolCalculationInput(
                        spot,
                        option.strike,
                        option.expiry - curTime,
                        0,  // FIXME: get risk-free rate
                        option.tradePrice,
                        scaleFactor
                    )
                );
                smile.ivAtMoneyness[i] = vol;
            }
        }
        return smile;
    }

    /**
     * @notice Update the volatility smile with information from a new trade
     * @dev We find the closest two points and update via interpolation
     * @param option Option object
     * @param smile Current volatility smile stored on-chain
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     */
    function updateSmile(
        Option memory option,
        VolatilitySmile storage smile,
        uint256 scaleFactor
    )
        external
        view
    {
        require(option.expiry >= block.timestamp, "createSmile: option expired");
        uint256 curTime = block.timestamp;

        /// @notice Default five points for moneyness. Same as in Zeta.
        uint8[5] memory moneyness = [50, 75, 100, 125, 150];
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

    function getMarkPrice(Option memory option) 
        public
        pure
        returns (uint256 initialMargin) 
    {
    }

    function getInitialMargin(Option memory option) 
        public
        pure
        returns (uint256 initialMargin) 
    {
    }

    function getMaintainenceMargin(Option memory option) 
        public
        pure
        returns (uint256 initialMargin) 
    {
    }
}