// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/Derivative.sol";

/**
 * @notice Test contract to wrap around `Derivative.sol`
 */
contract TestDerivative {
    mapping(bytes32 => Derivative.VolatilitySmile) public volSmiles;

    function createSmile(uint256 key, uint256 initSigma)
        external
        returns (Derivative.VolatilitySmile memory smile) 
    {
        smile = Derivative.createSmile(initSigma);
        volSmiles[keccak256(abi.encodePacked(key))] = smile;
    }

    function fetchSmile(uint256 key) 
        external 
        view 
        returns (Derivative.VolatilitySmile memory smile) 
    {
        return volSmiles[keccak256(abi.encodePacked(key))];
    }

    function updateSmile(
        uint256 spot,
        Derivative.Order memory order,
        uint256 key,
        uint256 avgQuantity
    )
        external
    {
        Derivative.VolatilitySmile storage smile = volSmiles[
            keccak256(abi.encodePacked(key))
        ];
        return Derivative.updateSmile(spot, order, smile, avgQuantity);
    }

    function querySmile(
        uint256 spot,
        uint256 strike,
        uint256 key
    ) 
        external
        view
        returns (uint256 sigma)
    {
        Derivative.VolatilitySmile memory smile = volSmiles[
            keccak256(abi.encodePacked(key))
        ];
        return Derivative.querySmile(spot, strike, smile);
    }

    function getMarkPrice(Derivative.Option memory option, uint256 spot, uint256 sigma) 
        external
        view
        returns (uint256 price) 
    {
        return Derivative.getMarkPrice(option, spot, sigma);
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
