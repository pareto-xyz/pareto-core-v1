// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.6;

contract MockAggregatorV3 {
    /**
     * @notice Hardcoded answer to return
     */
    uint256 public savedAnswer;
    uint80 public round = 1;
    uint8 public decimals = 18;

    function setLatestAnswer(uint256 answer) public {
        savedAnswer = answer;
    }

    /**
     * @notice Set the new value for decimals
     * @dev This is purely for testing
     */
    function setDecimals(uint8 _decimals) public {
        savedAnswer = savedAnswer * (10**_decimals) / (10**decimals);
        decimals = _decimals;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        roundId = round;
        answer = int256(savedAnswer);
        // Spoof startedAt and updatedAt as current times
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        // Spoof as current round
        answeredInRound = round;
    }
}