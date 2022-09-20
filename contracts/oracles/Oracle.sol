// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../interfaces/IOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Since chainlink updates too slowly, we opt to use a custom oracle.
 * @dev This does not store past round data
 */
contract Oracle is IOracle, Ownable {
    uint256 public spot;
    uint256 public rate;
    uint256[11] public callMarks;
    uint256[11] public putMarks;
    uint80 public roundId;
    uint256 public roundTimestamp;

    /// @notice Stores admin addresses who can publish to price feed
    mapping(address => bool) public isAdmin;

    constructor(address[] memory admins_) {
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

    /// @notice Set the latest oracle data. Must set all data at once
    /// @dev Only callable by admin
    function setLatestData(
        uint256 spot_,
        uint256 rate_,
        uint256[11] memory callMarks_,
        uint256[11] memory putMarks_
    ) external onlyAdmin {
        roundId = roundId + 1;
        roundTimestamp = block.timestamp;
        spot = spot_;
        rate = rate_;
        callMarks = callMarks_;
        putMarks = putMarks_;
    }

    /// @dev See `../interfaces/IOracle.sol`
    function latestRoundSpot()
        external
        view
        override
        returns (uint80, uint256, uint256)
    {
        return (roundId, spot, roundTimestamp);
    }

    /// @dev See `../interfaces/IOracle.sol`
    function latestRoundRate()
        external
        view
        override
        returns (uint80, uint256, uint256)
    {
        return (roundId, rate, roundTimestamp);
    }

    /// @dev See `../interfaces/IOracle.sol`
    function latestRoundMark(bool isCall, uint8 strikeLevel)
        external
        view
        override
        returns (uint80, uint256, uint256)
    {
        require(strikeLevel < 11);
        if (isCall) {
            return (roundId, callMarks[strikeLevel], roundTimestamp);
        } else {
            return (roundId, putMarks[strikeLevel], roundTimestamp);
        }
    }

    /// @dev See `../interfaces/IOracle.sol`
    function latestRoundMarks(bool isCall)
        external
        view
        override
        returns (uint80, uint256[11] memory, uint256)
    {
        if (isCall) {
            return (roundId, callMarks, roundTimestamp);
        } else {
            return (roundId, putMarks, roundTimestamp);
        }
    }

    /// @dev See `../interfaces/IOracle.sol`
    function latestRoundData() 
        external
        view
        override
        returns (uint80, uint256, uint256, uint256[11] memory, uint256[11] memory, uint256)
    {
        return (roundId, spot, rate, callMarks, putMarks, roundTimestamp);
    }
}