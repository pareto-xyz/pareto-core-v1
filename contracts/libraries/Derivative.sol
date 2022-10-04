// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Contains enums and structs representing Pareto derivatives
 */
library Derivative {
    /**
     * @notice List of supported underlying tokens
     */
    enum Underlying { ETH, BTC, UNI, LINK }

    /**
     * @notice Number of underlying tokens
     */
    uint8 constant NUM_UNDERLYING = 4;

    /**
     * @notice Different strike levels, 5 ITM, 1 ATM, 5 OTM
     */
    enum StrikeLevel { ITM5,ITM4,ITM3,ITM2,ITM1,ATM,OTM1,OTM2,OTM3,OTM4,OTM5 }

    /**
     * @notice Number of strike levels
     */
    uint8 constant NUM_STRIKE_LEVEL = 11;

    /**
     * @notice Decimals for quantity in an order
     * @dev 5000 => 0.5 (x 10**4)
     */
    uint8 constant QUANTITY_DECIMALS = 4;

    /**
     * @notice A matched order from the Pareto orderbook
     * @param id Identifier for the order
     * @param buyer Address of the buyer; the short position
     * @param seller Address of the seller; the long position
     * @param tradePrice Price of the actual order. Distinct from mark price
     * @param quantity Amount within the order
     * @param option Object containing option parameters
     */
    struct Order {
        string id;
        address buyer;
        address seller;
        uint256 tradePrice;
        uint256 quantity;
        Option option;
    }

    /**
     * @notice Option parameters
     * @param isCall Is this a call (true) or put option (false)?
     * @param strikeLevel Integer from 0 to 7 for level of strike
     * @param strike Strike price of the option
     * @param expiry Expiry in epoch time of the option
     * @param underlying Underlying token (see `Underlying` enum)
     * @param decimals Decimals for underlying
     */
    struct Option {
        bool isCall;
        StrikeLevel strikeLevel;
        uint256 strike;
        uint256 expiry;
        Underlying underlying;
        uint8 decimals;
    }

    /**
     * @notice Parameters to add a position
     * @param id Identifier for the new position
     * @param buyer Address of the order buyer
     * @param seller Address of the order seller
     * @param tradePrice Premium for the option
     * @param quantity Number of units in order
     * @param isCall Whether option is a call or put
     * @param strikeLevel Choice of strike from 11 levels
     * @param underlying Enum for the underlying token
     * @param isBuyerMaker Whether the buyer is a maker or taker
     * @param isSellerMaker Whether the seller is a maker or taker
     */
    struct PositionParams {
        string id;
        address buyer;
        address seller;
        uint256 tradePrice;
        uint256 quantity;
        bool isCall;
        StrikeLevel strikeLevel;
        Underlying underlying;
        bool isBuyerMaker;
        bool isSellerMaker;
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
            option.isCall,
            option.underlying, 
            option.strike,
            option.expiry
        ));
    }
}