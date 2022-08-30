
//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;
import {PriceFeed} from "./PriceFeed.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PriceFeedFactory is Ownable {

    /// @notice Map from child address to owner address
    mapping(address => address) public pricefeedOwners;

    /// @notice Store number of created pricefeeds
    uint256 public numPricefeeds;

    /**
     * @notice Notifies creation of a new price feed
     * @param newPriceFeed Address of the created price feed
     * @param creator Address of the message sender
     * @param description Description of the price feed
     */
    event PriceFeedCreated(
        address newPriceFeed,
        address creator,
        string description
    );

    /**
     * @notice Function to create a new price feed
     * @dev Emits an event `PriceFeedCreated`
     * @param description Description for the pricefeed
     * @param admins List of addresses to be deemed as admin
     */
    function create(
        string calldata description,
        address[] calldata admins
    )
        external
        onlyOwner
    {
        PriceFeed pricefeed = new PriceFeed(msg.sender, description, admins);
        pricefeedOwners[address(pricefeed)] = msg.sender;
        numPricefeeds += 1;
        emit PriceFeedCreated(address(pricefeed), msg.sender, description);
    }
}