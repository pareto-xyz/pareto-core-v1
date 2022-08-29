// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

/**
 * @notice Library for dates
 */
library DateMath {
    /**
     * @notice Gets the next expiry timestalmp
     * @param expiry Current expiry
     * @return nextExpiry Expiry for the next round
     */
    function getNextExpiry(uint256 expiry) internal view returns (uint256) {
        // If its past one week since last option
        if (block.timestamp > expiry + 7 days) {
            return getNextFriday(block.timestamp);
        }
        return getNextFriday(expiry);
    }

    /**
     * @notice Gets the next options expiry timestamp
     * @param timestamp Expiry timestamp of the current option
     * @dev Examples:
     * getNextFriday(week 1 thursday) -> week 1 friday
     * getNextFriday(week 1 friday) -> week 2 friday
     * getNextFriday(week 1 saturday) -> week 2 friday
     */
    function getNextFriday(uint256 timestamp) internal pure returns (uint256) {
        // dayOfWeek = 0 (sunday) - 6 (saturday)
        uint256 dayOfWeek = ((timestamp / 1 days) + 4) % 7;
        uint256 nextFriday = timestamp + ((7 + 5 - dayOfWeek) % 7) * 1 days;
        uint256 friday8am = nextFriday - (nextFriday % (24 hours)) + (8 hours);

        // If the passed timestamp is day=Friday hour>8am, we simply
        // increment it by a week to next Friday
        if (timestamp >= friday8am) {
            friday8am += 7 days;
        }
        return friday8am;
    }
}