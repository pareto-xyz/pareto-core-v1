// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice This is only to be used as a mock contract. Please do not
 *         use this contract in any other context
 */
contract MockERC20 is ERC20("MockERC20", "MOCK") {
    /**
     * @notice Allow others to create new tokens
     * @param account is the owner address
     * @param amount is the amount to mint
     */
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    /**
     * @notice Allow others to destroy existing tokens
     * @param account is the owner address
     * @param amount is the amount to burn
     */
    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }
}