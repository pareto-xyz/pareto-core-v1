// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Interface for an oracle to query token prices
 */
interface ISpotFeed {
    /**
     * @notice Returns the prices from the latest round
     * @return roundId The round Identifier
     * @return spot The spot price
     * @return roundTimestamp Timestamp of when the round was created
     */
    function latestRoundData()
        external
        view
        returns (uint80 roundId, uint256 spot, uint256 roundTimestamp);
}