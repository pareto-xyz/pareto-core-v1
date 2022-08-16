// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Contains enums and structs representing Pareto derivatives
 */
library Derivative {
    /**
     * @notice A matched option order from a Pareto bookorder
     * @param bookId Identifier of the orderbook the order came from
     * @param underlying Address of the underlying token e.g. WETH
     * @param strike Strike price of the option
     * @param expiry Expiry in epoch time of the option
     * @param buyer Address of the buyer; the short position
     * @param seller Address of the seller; the long position
     */
    struct Option {
        string bookId;
        address underlying;
        uint256 strike;
        uint256 expiry;
        address buyer;
        address seller;
    }

    /**
     * @notice A matched future order from a Pareto bookorder
     * @param bookId Identifier of the orderbook the order came from
     * @param underlying Address of the underlying token e.g. WETH
     * @param expiry Expiry in epoch time of the future
     * @param buyer Address of the buyer; the short position
     * @param seller Address of the seller; the long position
     */
    struct Future {
        string bookId;
        address underlying;
        uint256 expiry;
        address buyer;
        address seller;
    }

    /**
     * @notice Hash option into byte string
     * @param option Option object 
     * @param hash_ SHA-3 hash of the future object
     */
    function hashOption(Option memory option)
        public
        pure
        returns(bytes32 hash_) 
    {
        hash_ = keccak256(abi.encodePacked(
            option.bookId,
            option.underlying, 
            option.strike,
            option.expiry,
            option.buyer,
            option.seller
        ));
    }

    /**
     * @notice Hash future into byte string
     * @param future Future object 
     * @param hash_ SHA-3 hash of the future object
     */
    function hashFuture(Future memory future)
        public
        pure
        returns(bytes32 hash_) 
    {
        hash_ = keccak256(abi.encodePacked(
            future.bookId,
            future.underlying,
            future.expiry,
            future.buyer,
            future.seller
        ));
    }
}