// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../libraries/Derivative.sol";

/**
 * @notice Test contract to wrap around `Derivative.sol`
 */
contract TestDerivative {
    function hashOption(Derivative.Option memory option)
        external
        pure
        returns (bytes32 hash_) 
    {
        return Derivative.hashOption(option);
    }
}
