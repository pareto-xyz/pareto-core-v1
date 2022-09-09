// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../interfaces/ISpotFeed.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Since chainlink updates too slowly, we opt to use a custom oracle.
 * Separate deployments of this contract will serve many purposes: 
 * 1) It will serve spot data e.g. the median price of Binance, FTX, and BitFinex
 * 2) It will serve prices of calls e.g. mark price of call options for the active expiry
 * 3) It will serve prices of puts e.g. mark price of call options for the active expiry
 * @dev This does not store past round data
 */
contract SpotFeed is ISpotFeed, Ownable {
    uint256 public spot;
    uint80 public roundId;
    string public description;
    uint256 public roundTimestamp;

    /// @notice Stores admin addresses who can publish to price feed
    mapping(address => bool) public isAdmin;

    constructor(
        string memory description_,
        address[] memory admins_
    ) {
        description = description_;
        _transferOwnership(msg.sender);

        // Set admins
        isAdmin[msg.sender] = true;
        for (uint256 i = 0; i < admins_.length; i++) {
            isAdmin[admins_[i]] = true;
        }
    }

    /**
     * @dev Throws if called by any account other than an admin.
     */
    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "onlyAdmin: caller is not an admin");
        _;
    }

    /**
     * @notice Owner can add and remove admin
     * @param account_ Account to add or remove
     * @param isAdmin_ Value to set
     */
    function setAdmin(address account_, bool isAdmin_) external onlyOwner {
        isAdmin[account_] = isAdmin_;
    }

    /// @notice Set the latest oracle price
    /// @dev Only callable by admin
    function setLatestPrice(uint256 spot_) external onlyAdmin {
        roundId = roundId + 1;
        roundTimestamp = block.timestamp;
        spot = spot_;
    }

    /**
     * @notice See `interfaces/IOracle.sol`
     */
    function latestRoundData()
        external
        override
        view
        returns (uint80, uint256, uint256)
    {
        return (roundId, spot, roundTimestamp);
    }
}