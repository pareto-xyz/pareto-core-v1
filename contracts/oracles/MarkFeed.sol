// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../interfaces/IMarkFeed.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Custom oracle for fetching the Black-Scholes call and put prices
 * @dev This does not store past round data
 */
contract MarkFeed is IMarkFeed, Ownable {
    /// @dev 11 call prices for the 11 strike levels
    uint256[11] public callPrices;

    /// @dev 11 put prices for the 11 strike levels
    uint256[11] public putPrices;

    uint80 public roundId;
    string public description;
    uint256 public roundTimestamp;

    /// @notice Stores admin addresses who can publish to price feed
    mapping(address => bool) public isAdmin;

    constructor(string memory description_, address[] memory admins_) {
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

    /**
     * @notice Set the latest oracle prices for calls and puts at different strikes
     * @dev Only callable by admin
     * @param callPrices_ An array of 11 numbers for the 11 call prices
     * @param putPrices_ An array of 11 numbers for the 11 put prices
     */ 
    function setLatestPrices(
        uint256[11] calldata callPrices_,
        uint256[11] calldata putPrices_
    ) 
        external 
        onlyAdmin 
    {
        roundId = roundId + 1;
        roundTimestamp = block.timestamp;
        callPrices = callPrices_;
        putPrices = putPrices_;
    }

    /**
     * @notice See `interfaces/IOracle.sol`
     */
    function latestRoundData(bool isCall, uint8 strikeLevel)
        external
        override
        view
        returns (uint80, uint256, uint256)
    {
        require(strikeLevel < 11, "latestRoundData: invalid strike level");

        uint256 mark = isCall ? callPrices[strikeLevel] : putPrices[strikeLevel];
        return (roundId, mark, roundTimestamp);
    }
}