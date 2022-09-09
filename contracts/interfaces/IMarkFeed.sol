// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/Derivative.sol";

/**
 * @notice Interface for an oracle to query mark prices
 */
interface IMarkFeed {
    /**
     * @notice Returns the prices from the latest round
     * @param isCall true (call) or false (put)
     * @param strikeLevel A digit from 0 to 11 for which mark to fetch
     * @return roundId The round Identifier
     * @return mark The call price
     * @return roundTimestamp Timestamp of when the round was created
     */
    function latestRoundData(bool isCall, Derivative.StrikeLevel strikeLevel)
        external
        view
        returns (uint80 roundId, uint256 mark, uint256 roundTimestamp);
}