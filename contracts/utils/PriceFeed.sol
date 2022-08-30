// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../interfaces/IOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Since chainlink updates too slowly, we opt to use a custom oracle.
 * The median price of Binance, FTX and Bitfinex is posted.
 * @dev This does not store past round data
 */
contract PriceFeed is IOracle, Ownable {
    int256 public answer;
    uint80 public roundId;
    string public description;
    uint256 public roundTimestamp;

    /// @notice Stores admin addresses who can publish to price feed
    mapping(address => bool) public isAdmin;

    constructor(
        address owner_,
        string memory description_,
        address[] memory admins_
    ) {
        description = description_;
        _transferOwnership(owner_);

        // Set admins
        isAdmin[owner_] = true;
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

    /// @notice Get the latest answer
    function latestAnswer() external view returns (int256) {
        return answer;
    }

    /// @notice Get the latest round id
    function latestRound() external view returns (uint80) {
        return roundId;
    }

    /// @notice Set the latest oracle answer
    /// @dev Only callable by admin
    function setLatestAnswer(int256 _answer) external onlyAdmin {
        roundId = roundId + 1;
        roundTimestamp = block.timestamp;
        answer = _answer;
    }

    /**
     * @notice See `interfaces/IOracle.sol`
     */
    function latestRoundData()
        external
        override
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (
            roundId,
            answer,
            roundTimestamp,
            roundTimestamp,
            roundId
        );
    }
}