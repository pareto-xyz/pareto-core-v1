// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Interface for an oracle to query spot, mark, and rate
 */
interface IOracle {
    /**
     * @notice Returns the spot price from the latest round
     * @return roundId The round Identifier
     * @return spot The spot price
     * @return roundTimestamp Timestamp of when the round was created
     * @return decimals Decimals for the spot price
     */
    function latestRoundSpot()
        external
        view
        returns (uint80 roundId, uint256 spot, uint256 roundTimestamp, uint8 decimals);

    /**
     * @notice Returns the interest rate from the latest round
     * @return roundId The round Identifier
     * @return rate The interest rate
     * @return roundTimestamp Timestamp of when the round was created
     * @return decimals Decimals for the rate
     */
    function latestRoundRate()
        external
        view
        returns (uint80 roundId, uint256 rate, uint256 roundTimestamp, uint8 decimals);

    /**
     * @notice Returns the marks from the latest round
     * @param isCall Whether we want call prices or put prices
     * @return roundId The round Identifier
     * @return marks The mark prices for 11 strikes
     * @return roundTimestamp Timestamp of when the round was created
     * @return decimals Decimals for the mark prices
     */
    function latestRoundMarks(bool isCall)
        external
        view
        returns (uint80 roundId, uint256[11] memory marks, uint256 roundTimestamp, uint8 decimals);

    /**
     * @notice Returns the marks from the latest round
     * @param isCall Whether we want call prices or put prices
     * @param strikeLevel Number between 0 and 11
     * @return roundId The round Identifier
     * @return mark The mark price for a single strike
     * @return roundTimestamp Timestamp of when the round was created
     * @return decimals Decimals for the mark price
     */
    function latestRoundMark(bool isCall, uint8 strikeLevel)
        external
        view
        returns (uint80 roundId, uint256 mark, uint256 roundTimestamp, uint8 decimals);
}