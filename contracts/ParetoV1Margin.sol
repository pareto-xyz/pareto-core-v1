// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IERC20.sol";
import "./libraries/Derivative.sol";
import "./libraries/BlackScholesMath.sol";

/**
 * @notice Contract acting as the margin account for a Pareto trader.
 * Users will send collateral in USDC to this contract to satisfy 
 * margin requirements of their existing positions. Liquidators can 
 * use this contract to liquidate accounts whose are below margin. 
 * @dev The complete orderbook and matching are not performed within
 * this contract. Further, they are not performed on-chain. The owner
 * will post matched orders as positions. 
 * @dev This contract is upgradeable with UUPS design. See
 * https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
 * https://blog.logrocket.com/using-uups-proxy-pattern-upgrade-smart-contracts/
 */
contract ParetoV1Margin is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    /************************************************
     * Constants and Immutables
     ***********************************************/

    /// @notice Stores the address for USDC
    address public usdc;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Stores hashes of open positions for every user
    mapping(address => mapping(bytes32 => bool)) private orderPositions;

    /// @notice Stores hash to derivative order
    mapping(bytes32 => Derivative.Order) private orderHashs;

    /// @notice Track total balance (used for checks)
    uint256 private totalBalance;

    /// @notice Store volatility smiles per option
    mapping(bytes32 => Derivative.VolatilitySmile) private volSmiles;

    /************************************************
     * Initialization and Upgradeability
     ***********************************************/

    /**
     * @param usdc_ Address for the cash token (e.g. USDC)
     */
    function initialize(address usdc_) public initializer {
        usdc = usdc_;

        // Initialize the upgradeable dependencies
        __ReentrancyGuard_init();
        __Ownable_init();
    }

    /**
     * @notice Safeguards against unauthored upgrades. UUPS requires 
     * upgrade to be done from the logic contract
     * @dev required by the OZ UUPS module
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /************************************************
     * Events
     ***********************************************/
    
    /**
     * @notice Event when an order is recorded
     * @dev See `Derivative.Order` docs
     */
    event OrderRecorded(
        string indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 tradePrice,
        uint256 quantity,
        Derivative.OptionType optionType,
        address underlying,
        uint256 strike,
        uint256 expiry
    );

    /************************************************
     * External functions
     ***********************************************/

    /**
     * @notice Deposit new assets into margin account
     * @dev Requires approval from `msg.sender`
     * @param amount Amount of USDC to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "deposit: `amount` must be > 0");

        // Increment counters
        balances[msg.sender] += amount;
        totalBalance += amount;

        // Pull resources from sender to this contract
        IERC20(usdc).transferFrom(msg.sender, address(this), amount);

        // Check that balance owned and balance tracked agree
        require(
            totalBalance == IERC20(usdc).balanceOf(address(this)),
            "deposit: Balance and reserves are out of sync"
        );
    }

    /**
     * @notice Withdraw assets from margin account
     * @dev Only successful if margin accounts remain satisfied post withdraw
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
    }

    /**
     * @notice Withdraw the maximum amount allowed currently
     */
    function withdrawMax() external nonReentrant {
    }

    /**
     * @notice Check if a user's account is below margin
     * @dev The margin requirement is: AB + UP > IM + MM where 
     * AB = account balance, UP = unrealized PnL
     * IM/MM = initial and maintainence margins
     * @param user Address of the account to check
     * @param diff |AB + UP - IM - MM|, always positive
     * @param satisfied True if AB + UP > IM + MM, else false
     */
    function checkMargin(address user)
        external
        nonReentrant
        returns (
            uint256 diff, 
            bool satisfied
        ) 
    {
        uint256 balance = balances[user];
        uint256 initial = getInitialMargin(user);
        uint256 maintainence = getMaintainenceMargin(user);

        satisfied = balance > (initial + maintainence);

        if (satisfied) {
            diff = balance - initial - maintainence;
        } else {
            diff = initial + maintainence - balance;
        }
        return (diff, satisfied);
    }

    /************************************************
     * Internal functions
     ***********************************************/

    /**
     * @notice Compute the initial margin for all positions owned by user
     * @param user Address to compute IM for
     */
    function getInitialMargin(address user) internal returns (uint256) {
    }

    /**
     * @notice Compute the maintainence margin for all positions owned by user
     * @param user Address to compute MM for
     */
    function getMaintainenceMargin(address user) internal returns (uint256) {
    }

    /************************************************
     * Admin functions
     ***********************************************/

    /**
     * @notice Record a matched order from off-chain orderbook
     * @dev Saves the order to storage variables. Only the owner can call
     * this function
     */
    function recordOrder(
        string memory orderId,
        address buyer,
        address seller,
        uint256 tradePrice,
        uint256 quantity,
        Derivative.OptionType optionType,
        uint256 strike,
        uint256 expiry,
        address underlying
    ) 
        external
        nonReentrant
        onlyOwner 
    {
        require(bytes(orderId).length > 0, "recordOrder: bookId is empty");
        require(tradePrice > 0, "recordOrder: tradePrice must be > 0");
        require(quantity > 0, "recordOrder: quantity must be > 0");
        require(underlying != address(0), "recordOrder: underlying is empty");
        require(strike > 0, "recordOrder: strike must be positive");
        require(
            expiry > block.timestamp,
            "recordOrder: expiry must be > current time"
        );

        uint8 decimals = IERC20(underlying).decimals();
        Derivative.Order memory order = Derivative.Order(
            orderId,
            buyer,
            seller,
            tradePrice,
            quantity,
            Derivative.Option(
                optionType,
                strike,
                expiry,
                underlying,
                decimals
            )
        );
        bytes32 hash_ = Derivative.hashOrder(order);

        // Save the order object
        orderHashs[hash_] = order;

        // Save that the buyer/seller have this position
        orderPositions[buyer][hash_] = true;
        orderPositions[seller][hash_] = true;

        if (volSmiles[hash_].exists_) {
            // Update the volatility smile
            // FIXME: replace `1 ether` with spot price
            Derivative.updateSmile(1 ether, order, volSmiles[hash_]);
        } else {
            // Create a new volatility smile
            volSmiles[hash_] = Derivative.createSmile(order);
        }

        // Emit event 
        emit OrderRecorded(
            orderId,
            buyer,
            seller,
            tradePrice,
            quantity,
            optionType,
            underlying,
            strike,
            expiry
        );
    }
}
