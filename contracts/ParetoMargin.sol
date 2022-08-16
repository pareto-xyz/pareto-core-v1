// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/Derivative.sol";

/**
 * @notice Contract acting as the margin account for a Pareto trader.
 * Users will send collateral in USDC to this contract to satisfy 
 * margin requirements of their existing positions. Liquidators can 
 * use this contract to liquidate accounts whose are below margin. 
 * @dev The complete orderbook and matching are not performed within
 * this contract. Further, they are not performed on-chain. The owner
 * will post matched orders as positions. 
 */
contract ParetoMargin {

    /************************************************
     * Constants and Immutables
     ***********************************************/

    /// @notice Stores the address of the contract owner
    address public immutable owner;

    /// @notice Stores the address for USDC
    address public immutable usdc;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Stores hashes of open positions for every user
    mapping(address => mapping(bytes32 => bool)) private optionsPositions;
    mapping(address => mapping(bytes32 => bool)) private futuresPositions;

    /// @notice Stores hash to derivative object
    mapping(bytes32 => Derivative.Option) private optionsHashMap;
    mapping(bytes32 => Derivative.Future) private futuresHashMap;

    /// @notice Track total balance (used for checks)
    uint256 private totalBalance;

    /************************************************
     * Constructor and Modifers
     ***********************************************/

    /**
     * @param usdc_ Address for the cash token (e.g. USDC)
     */
    constructor(address usdc_) {
        owner = msg.sender;
        usdc = usdc_;
    }

    /**
     * @notice Modifier that restricts to only the owner
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "onlyOwner: not the owner");
        _;
    }

    /************************************************
     * Events
     ***********************************************/
    
    /**
     * @notice Event when an option is recorded
     * @dev See `Derivative.Option` docs
     */
    event OptionRecorded(
        string bookId,
        address underlying,
        uint256 strike,
        uint256 expiry,
        address indexed buyer,
        address indexed seller
    );

    /**
     * @notice Event when an future is recorded
     * @dev See `Derivative.Future` docs
     */
    event FutureRecorded(
        string bookId,
        address underlying,
        uint256 expiry,
        address indexed buyer,
        address indexed seller
    );

    /************************************************
     * External functions
     ***********************************************/

    /**
     * @notice Deposit new assets into the account
     * @dev Requires approval from `msg.sender`
     * @param amount Amount of USDC to deposit
     */
    function deposit(uint256 amount) external {
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

    /************************************************
     * Admin functions
     ***********************************************/

    /**
     * @notice Record a matched option from off-chain orderbook
     * @dev Saves the option to storage variables
     */
    function recordOption(
        string memory bookId,
        address underlying,
        uint256 strike,
        uint256 expiry,
        address buyer,
        address seller
    ) 
        external
        onlyOwner 
    {
        require(bytes(bookId).length > 0, "recordOption: bookId is empty");
        require(underlying != address(0), "recordOption: underlying is empty");
        require(strike > 0, "recordOption: strike must be positive");
        require(expiry > block.timestamp, "recordOption: expiry must be > current time");
        require(buyer != address(0), "recordOption: buyer is empty");
        require(seller != address(0), "recordOption: seller is empty");

        Derivative.Option memory option = Derivative.Option(
            bookId,
            underlying,
            strike,
            expiry,
            buyer,
            seller
        );
        bytes32 hash_ = Derivative.hashOption(option);

        // Save the option object
        optionsHashMap[hash_] = option;

        // Save that the buyer/seller have this position
        optionsPositions[buyer][hash_] = true;
        optionsPositions[seller][hash_] = true;

        // Emit event 
        emit OptionRecorded(
            bookId,
            underlying,
            strike,
            expiry,
            buyer,
            seller
        );
    }

    /**
     * @notice Record a matched future from off-chain orderbook
     * @dev Saves the future to storage variables
     */
    function recordFuture(
        string memory bookId,
        address underlying,
        uint256 expiry,
        address buyer,
        address seller
    ) 
        external
        onlyOwner 
    {
        require(bytes(bookId).length > 0, "recordOption: bookId is empty");
        require(underlying != address(0), "recordOption: underlying is empty");
        require(expiry > block.timestamp, "recordOption: expiry must be > current time");
        require(buyer != address(0), "recordOption: buyer is empty");
        require(seller != address(0), "recordOption: seller is empty");

        Derivative.Future memory future = Derivative.Future(
            bookId,
            underlying,
            expiry,
            buyer,
            seller
        );
        bytes32 hash_ = Derivative.hashFuture(future);

        // Save the option object
        futuresHashMap[hash_] = future;

        // Save that the buyer/seller have this position
        futuresPositions[buyer][hash_] = true;
        futuresPositions[seller][hash_] = true;

        // Emit event 
        emit FutureRecorded(
            bookId,
            underlying,
            expiry,
            buyer,
            seller
        );
    }
}
