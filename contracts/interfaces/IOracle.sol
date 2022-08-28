// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice General interface that we will use to query price
 * of tokens. Could be a chainlink oracle or a custom oracle
 */
interface IOracle {
    /**
     * @notice Returns the prices from the latest round
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