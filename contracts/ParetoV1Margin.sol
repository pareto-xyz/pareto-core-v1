// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IERC20.sol";
import "./libraries/Derivative.sol";
import "./libraries/MarginMath.sol";
import "./libraries/NegativeMath.sol";
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
    mapping(address => bytes32[]) private orderPositions;

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
     * @notice Event when a deposit occurs
     * @param depositor Address of the depositor
     * @param amount Amount of USDC to deposit
     */
    event DepositEvent(
        address indexed depositor,
        uint256 amount
    );

    /**
     * @notice Event when an order is recorded
     * @dev See `Derivative.Order` docs
     */
    event RecordOrderEvent(
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

        // Emit `DepositEvent`
        emit DepositEvent(msg.sender, amount);
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
     * @dev If the margin check fails, then the user margin account can be liquidated
     * @param user Address of the account to check
     * @return diff |AB + UP - IM - MM|, always positive
     * @return satisfied True if AB + UP > IM + MM, else false
     */
    function checkMargin(address user)
        public
        nonReentrant
        returns (uint256, bool)
    {
        uint256 spot = 1 ether;  // TODO: get real spot price
        uint256 balance = balances[user];
        uint256 initial = getInitialMargin(user, spot);
        uint256 maintainence = getMaintainenceMargin(user, spot);

        // Compute the unrealized PnL (actually this is losses)
        (uint256 pnl, bool pnlIsNeg) = getPayoff(user, spot);

        // Compute `balance + PnL`
        (uint256 bpnl, bool bpnlIsNeg) = NegativeMath.add(balance, false, pnl, pnlIsNeg);

        // Compute `balance + PnL - IM - MM`
        (uint256 diff, bool diffIsNeg) = NegativeMath.add(bpnl, bpnlIsNeg, initial + maintainence, true);

        // if diff > 0, then satisfied = true
        return (diff, !diffIsNeg);
    }

    /************************************************
     * Internal functions
     ***********************************************/

    /**
     * @notice Compute the initial margin for all positions owned by user
     * @dev The initial margin is equal to the sum of initial margins for all positions
     * @dev TODO Support P&L netting
     * @param user Address to compute IM for
     * @param spot The spot price
     * @param onlyLoss Do not count unrealized profits from open positions
     * @return payoff The payoff summed for all positions
     * @return isNegative True if the payoff is less than 0, else false
     */
    function getPayoff(address user, uint256 spot, bool onlyLoss)
        internal
        view
        returns (uint256, bool) 
    {
        bytes32[] memory positions = orderPositions[user];
        if (positions.length == 0) {
            return (0, false);
        }

        Derivative.Order memory order;
        uint256 payoff;
        bool isNegative;

        for (uint256 i = 0; i < positions.length; i++) {
            order = orderHashs[positions[i]];
            (uint256 curPayoff, bool curIsNegative) = MarginMath.getPayoff(user, spot, order);

            // If payoff is positive but we don't want to count positive open positions
            if (onlyLoss && !curIsNegative) {
                curPayoff = 0;
            }

            (payoff, isNegative) = NegativeMath.add(payoff, isNegative, curPayoff, curIsNegative);
        }
        return (payoff, isNegative);
    }

    /**
     * @notice Compute the initial margin for all positions owned by user
     * @dev The initial margin is equal to the sum of initial margins for all positions
     * @dev TODO Support P&L netting
     * @param user Address to compute IM for
     * @param spot The spot price
     * @return margin The initial margin summed for all positions
     */
    function getInitialMargin(address user, uint256 spot)
        internal
        view
        returns (uint256) 
    {
        bytes32[] memory positions = orderPositions[user];
        if (positions.length == 0) {
            return 0;
        }

        Derivative.Order memory order;
        Derivative.VolatilitySmile memory smile;
        uint256 margin;

        for (uint256 i = 0; i < positions.length; i++) {
            order = orderHashs[positions[i]];
            smile = volSmiles[positions[i]];
            uint256 curMargin = MarginMath.getInitialMargin(user, spot, order, smile);
            margin += curMargin;
        }
        return margin;
    }

    /**
     * @notice Compute the maintainence margin for all positions owned by user
     * @dev The maintainence margin is equal to the sum of maintainence margins for all positions
     * @dev TODO Support P&L netting
     * @param user Address to compute MM for
     * @param spot The spot price
     * @return margin The maintainence margin summed for all positions
     */
    function getMaintainenceMargin(address user, uint256 spot) 
        internal
        view
        returns (uint256) 
    {
        bytes32[] memory positions = orderPositions[user];
        if (positions.length == 0) {
            return 0;
        }

        Derivative.Order memory order;
        Derivative.VolatilitySmile memory smile;
        uint256 margin;

        for (uint256 i = 0; i < positions.length; i++) {
            order = orderHashs[positions[i]];
            smile = volSmiles[positions[i]];
            uint256 curMargin = MarginMath.getMaintainenceMargin(user, spot, order, smile);
            margin += curMargin;
        }
        return margin;
    }

    /**
     * @notice Margin check on new order
     * @dev This check must be done before the order is created
     * @dev The margin requirement is: AB + UP + min(0, IP) > IM where 
     * AB = account balance, UP = unrealized PnL
     * IP = instantaneous PnL from new order
     * IM = initial margin requirements
     * @dev This is also used when a liquidator takes over a position
     */
    function checkMarginOnNewOrder(Derivative.Order memory order)
        internal
        view
        returns (uint256, bool)
    {

    }

    /**
     * @notice Margin check on withdrawal
     * @dev The margin requirement is: AB + min(0, UP) > IM  where 
     * AB = account balance, UP = unrealized PnL
     * IM = initial margin requirements
     * @param user Address of the margin account to check
     * @param amount Amount requesting to be withdrawn from account
     * @return diff |AB + min(UP, 0) - IM|, always positive
     * @return satisfied True if AB + min(UP) > IM, else false
     */
    function checkMarginOnWithdrawal(address user, uint256 amount) 
        internal
        view
        returns (uint256, bool) 
    {
        require(amount > 0, "checkMarginOnWithdrawal: amount must be > 0");
        require(amount < balances[user], "checkMarginOnWithdrawal: amount must be < balance");
        uint256 spot = 1 ether;  // TODO: get real spot price

        // Compute initial margin
        uint256 margin = getInitialMargin(user, spot);

        // Compute balance after making withdrawal
        uint256 balancePostWithdraw = balances[user] - amount;

        // Compute the unrealized PnL (actually only unrealized loss)
        (uint256 pnl, bool pnlIsNeg) = getPayoff(user, spot, true);

        // Compute `balance + PnL`
        (uint256 bpnl, bool bpnlIsNeg) = NegativeMath.add(balancePostWithdraw, false, pnl, pnlIsNeg);
        // Compute `balance + PnL - IM - MM`
        (uint256 diff, bool diffIsNeg) = NegativeMath.add(bpnl, bpnlIsNeg, margin, true);

        // if diff > 0, then satisfied = true
        return (diff, !diffIsNeg);
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
        orderPositions[buyer].push(hash_);
        orderPositions[seller].push(hash_);

        if (volSmiles[hash_].exists_) {
            // Update the volatility smile
            // FIXME: replace `1 ether` with spot price
            Derivative.updateSmile(1 ether, order, volSmiles[hash_]);
        } else {
            // Create a new volatility smile
            volSmiles[hash_] = Derivative.createSmile(order);
        }

        // Emit event 
        emit RecordOrderEvent(
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
