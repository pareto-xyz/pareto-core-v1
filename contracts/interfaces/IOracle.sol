// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice General interface that we will use to query price
 * of tokens. Could be a chainlink oracle or a custom oracle
 */
interface IOracle {
    /**
     * @notice Returns the prices from the latest round
     * @return roundId The round ID
     * @return answer The price
     * @return startedAt Timestamp of when the round started
     * @return updatedAt Timestamp of when the round was updated
     * @return answeredInRound The round ID of the round in which the answer was computed
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
    }