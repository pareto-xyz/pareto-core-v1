// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IERC20.sol";
import "./libraries/SafeERC20.sol";
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
    using SafeERC20 for IERC20;

    /************************************************
     * Constants and Immutables
     ***********************************************/

    /// @notice Stores the address for USDC
    address public usdc;

    /// @notice List of keepers who can add positions
    mapping(address => bool) private keepers;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Stores hashes of open positions for every user
    mapping(address => bytes32[]) private orderPositions;

    /// @notice Stores hash to derivative order
    mapping(bytes32 => Derivative.Order) private orderHashs;

    /// @notice Track total balance (used for checks)
    uint256 private totalBalance;

    /// @notice Store volatility smiles per option (not order)
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

        // The owner is a keeper
        keepers[owner()] = true;
    }

    /**
     * @notice Safeguards against unauthored upgrades. UUPS requires 
     * upgrade to be done from the logic contract
     * @dev required by the OZ UUPS module
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /**
     * @dev Throws if called by a non-keeper account.
     */
    modifier onlyKeeper() {
        require(keepers[msg.sender], "onlyKeeper: caller is not a keeper");
        _;
    }

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
     * @notice Event when a position (matched order) is recorded
     * @dev See `Derivative.Order` docs
     */
    event RecordPositionEvent(
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

    /**
     * @notice Event to withdraw tokens 
     * @param user Address of the withdrawer
     * @param amount Amount of USDC to withdraw
     */
    event WithdrawEvent(
        address indexed user,
        uint256 amount
    );

    /**
     * @notice Event when owner adds keepers
     * @param owner Owner who added keepers
     * @param numKeepers Number of keepers added
     */
    event AddKeepersEvent(
        address indexed owner,
        uint256 numKeepers
    );

    /**
     * @notice Event when owner removes keepers
     * @param owner Owner who removed keepers
     * @param numKeepers Number of keepers removed
     */
    event RemoveKeepersEvent(
        address indexed owner,
        uint256 numKeepers
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
        require(amount > 0, "withdraw: amount must be > 0");
        require(amount <= balances[msg.sender], "withdraw: amount > balance");
        
        // Check margin post withdrawal
        (, bool satisfied) = checkMarginOnWithdrawal(msg.sender, amount);
        require(satisfied, "withdraw: margin check failed");

        // Transfer USDC to sender
        IERC20(usdc).safeTransfer(msg.sender, amount);

        // Emit event
        emit WithdrawEvent(msg.sender, amount);
    }

    /**
     * @notice Withdraw full balance. 
     * @dev Only successful if margin accounts remain satisfied post withdraw
     */
    function withdrawAll() external nonReentrant {
        uint256 balance = balances[msg.sender];
        require(balance > 0, "withdraw: empty balance");

        // Check margin post withdrawal
        (, bool satisfied) = checkMarginOnWithdrawal(msg.sender, balance);
        require(satisfied, "withdraw: margin check failed");

        // Transfer USDC to sender
        IERC20(usdc).safeTransfer(msg.sender, balance);

        // Emit event
        emit WithdrawEvent(msg.sender, balance);
    }

    /**
     * @notice Check if a user's account is below margin
     * @dev The margin requirement is: AB + UP > MM where 
     * AB = account balance, UP = unrealized PnL
     * MM = maintainence margin on open positions
     * @dev If the margin check fails, then the user margin account can be liquidated
     * @param user Address of the account to check
     * @return diff |AB + UP - MM|, always positive
     * @return satisfied True if AB + UP > MM, else false
     */
    function checkMargin(address user)
        public
        nonReentrant
        returns (uint256, bool)
    {
        uint256 spot = 1 ether;  // TODO: get real spot price
        uint256 balance = balances[user];
        uint256 maintainence = getMaintainenceMargin(user, spot);

        // Compute the unrealized PnL (actually this is only unrealized losses)
        (uint256 pnl, bool pnlIsNeg) = getPayoff(user, spot, true);

        // Compute `balance + PnL`
        (uint256 bpnl, bool bpnlIsNeg) = NegativeMath.add(balance, false, pnl, pnlIsNeg);

        // Compute `balance + PnL - MM`
        (uint256 diff, bool diffIsNeg) = NegativeMath.add(bpnl, bpnlIsNeg, maintainence, true);

        // if diff > 0, then satisfied = true
        return (diff, !diffIsNeg);
    }

    /**
     * @notice Public function to get the impled volatility from the smile
     * @dev Uses current oracle price for spot
     * @param spot Spot price for underyling 
     * @param option Option object with expiry, strike, etc. This is not an `order` object
     */
    function getImpliedVol(uint256 spot, Derivative.Option calldata option) 
        public
        view
        returns (uint256 vol, uint256 sigma) 
    {
        Derivative.VolatilitySmile memory smile = volSmiles[Derivative.hashOption(option)];
        require(smile.exists_, "getImpliedVol: smile does not exist");

        // Get time to expiry
        uint256 tau = option.expiry - block.timestamp;

        // Compute current moneyness
        uint256 curMoneyness = (spot * 10**option.decimals * 100) / option.strike;

        // Compute volatility by interpolating, then derive standard deviation
        vol = Derivative.interpolate([50,75,100,125,150], smile.volAtMoneyness, curMoneyness);
        sigma = BlackScholesMath.volToSigma(vol, tau);
    }

    /**
     * @notice Public function to get the mark price
     * @dev Uses current oracle price for spot
     * @param spot Spot price for underyling 
     * @param option Option object with expiry, strike, etc. This is not an `order` object
     */
    function getMarkPrice(uint256 spot, Derivative.Option calldata option)
        external
        view
        returns (uint256 markPrice)
    {
        // Get time to expiry
        uint256 tau = option.expiry - block.timestamp;

        // Compute standard deviation of returns
        (, uint256 sigma) = getImpliedVol(spot, option);

        // Compute mark price
        markPrice = Derivative.getMarkPrice(option, spot, sigma, tau);
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
        bytes32 optionHash;

        for (uint256 i = 0; i < positions.length; i++) {
            order = orderHashs[positions[i]];
            optionHash = Derivative.hashOption(order.option);
            smile = volSmiles[optionHash];

            // Check that the smile exists and compute MM
            require(smile.exists_, "getMaintainenceMargin: found unknown option");
            uint256 curMargin = MarginMath.getMaintainenceMargin(user, spot, order, smile);
            margin += curMargin;
        }
        return margin;
    }

    /**
     * @notice Margin check on withdrawal
     * @dev Definitions:
     * AB = account balance, UP = unrealized PnL
     * MM = maintainence margin requirements
     * @param user Address of the margin account to check
     * @param amount Amount requesting to be withdrawn from account
     * @return diff |AB - amount + UP - MM|, always positive
     * @return satisfied True if non-negative, else false
     */
    function checkMarginOnWithdrawal(address user, uint256 amount) 
        internal
        returns (uint256, bool) 
    {
        require(amount > 0, "checkMarginOnWithdrawal: amount must be > 0");
        require(amount < balances[user], "checkMarginOnWithdrawal: amount must be < balance");

        // Perform standard margin check
        (uint256 margin, bool satisfied) = checkMargin(user);

        // `satisfied = true` => `isNegative = false`, vice versa
        bool isMarginNeg = !satisfied;

        // Subtract the withdraw
        return NegativeMath.add(margin, isMarginNeg, amount, true);
    }

    /************************************************
     * Admin functions
     ***********************************************/

    /**
     * @notice Add a keeper
     * @dev Add as a list for gas efficiency
     * @param accounts Addresses to add as keepers
     */
    function addKeepers(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            require(!keepers[accounts[i]], "addKeeper: already a keeper");
            keepers[accounts[i]] = true;
        }

        // Emit event
        emit AddKeepersEvent(msg.sender, accounts.length);
    }

    /**
     * @notice Remove a keeper
     * @dev Add as a list for gas efficiency
     * @param accounts Addresses to remove as keepers
     */
    function removeKeepers(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            require(keepers[accounts[i]], "removeKeeper: not a keeper");
            keepers[accounts[i]] = false;
        }

        // Emit event
        emit RemoveKeepersEvent(msg.sender, accounts.length);
    }

    /**
     * @notice Record a position (matched order) from off-chain orderbook
     * @dev Saves the order to storage variables. Only the owner can call
     * this function
     */
    function addPosition(
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
        onlyKeeper 
    {
        require(bytes(orderId).length > 0, "addPosition: bookId is empty");
        require(tradePrice > 0, "addPosition: tradePrice must be > 0");
        require(quantity > 0, "addPosition: quantity must be > 0");
        require(underlying != address(0), "addPosition: underlying is empty");
        require(strike > 0, "addPosition: strike must be positive");
        require(
            expiry > block.timestamp,
            "addPosition: expiry must be > current time"
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
        bytes32 orderHash = Derivative.hashOrder(order);
        bytes32 optionHash = Derivative.hashOption(order.option);

        // Save the order object
        orderHashs[orderHash] = order;

        // Save that the buyer/seller have this position
        orderPositions[buyer].push(orderHash);
        orderPositions[seller].push(orderHash);

        /// @dev Smiles are unique to the option not the order
        if (volSmiles[optionHash].exists_) {
            // Update the volatility smile
            // FIXME: replace `1 ether` with spot price
            Derivative.updateSmile(1 ether, order, volSmiles[optionHash]);
        } else {
            // Create a new volatility smile
            volSmiles[optionHash] = Derivative.createSmile(order);
        }

        // Emit event 
        emit RecordPositionEvent(
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
