// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/Derivative.sol";

/**
 * @notice Test contract to wrap around `Derivative.sol`
 */
contract TestDerivative {
    function createSmile()
        external
        pure
        returns (Derivative.VolatilitySmile memory smile) 
    {
        return Derivative.createSmile();
    }

    function querySmile(
        uint256 spot,
        uint256 strike,
        Derivative.VolatilitySmile memory smile
    ) 
        external
        pure
        returns (uint256 sigma)
    {
        return Derivative.querySmile(spot, strike, smile);
    }

    function getMarkPrice(
        Derivative.Option memory option,
        uint256 spot,
        uint256 sigma,
        uint256 tau
    ) 
        external
        pure
        returns (uint256 price) 
    {
        return Derivative.getMarkPrice(option, spot, sigma, tau);
    }

    function hashOrder(Derivative.Order memory order)
        external
        pure
        returns (bytes32 hash_) 
    {
        return Derivative.hashOrder(order);
    }

    function hashOption(Derivative.Option memory option)
        external
        pure
        returns (bytes32 hash_) 
    {
        return Derivative.hashOption(option);
    }

    function interpolate(
        uint8[5] memory sortedKeys,
        uint256[5] memory values,
        uint256 queryKey
    )
        external
        pure
        returns (uint256 queryValue)
    {
        return Derivative.interpolate(sortedKeys, values, queryKey);
    }

    function findClosestIndices(uint8[5] memory sortedData, uint256 query) 
        external
        pure
        returns (uint256, uint256) 
    {
        return Derivative.findClosestIndices(sortedData, query);
    }
}
