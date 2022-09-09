// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IERC20Upgradeable.sol";
import "./interfaces/ISpotFeed.sol";
import "./interfaces/IMarkFeed.sol";
import "./utils/SafeERC20Upgradeable.sol";
import "./libraries/Derivative.sol";
import "./libraries/MarginMath.sol";
import "./libraries/DateMath.sol";


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
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /************************************************
     * State variables
     ***********************************************/

    /// @notice Stores the address for USDC
    address public usdc;

    /// @notice Address of the insurance fund
    address public insurance;

    /// @notice Current round
    uint8 public curRound;

    /// @notice Maximum percentage the insurance fund can payoff for a single position in USDC
    uint256 public maxInsuredPerc;

    /// @notice Percentage multiplier used to decide alternative minimums
    /// Four decimals so 100 => 1% (0.01), 1000 => 10% (0.1)
    uint256 public minMarginPerc;

    /// @notice The current active expiry
    /// @dev This assumes all underlying has only one expiry.
    uint256 public activeExpiry;

    /// @notice If the contract is paused or not
    bool private isPaused;

    /// @notice Tracks if the last round has been settled
    bool private roundSettled;

    /// @notice Stores addresses for spot oracles of each underlying
    mapping(Derivative.Underlying => address) private spotOracles;

    /// @notice Stores addresses for mark price oracles of each underlying
    mapping(Derivative.Underlying => address) private markOracles;

    /// @notice Stores active underlyings
    mapping(Derivative.Underlying => bool) private isActiveUnderlying;

    /// @notice List of keepers who can add positions
    mapping(address => bool) private keepers;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Store all positions for the current round in the map
    Derivative.Order[] private roundPositions;

    /// @notice Stores map from user address to index into the current round positions
    mapping(address => uint16[]) private userRoundIxs;

    /// @notice Stores strike prices for the current round per underlying
    mapping(Derivative.Underlying => uint256[11]) public roundStrikes;

    /************************************************
     * Initialization and Upgradeability
     ***********************************************/

    /**
     * @param usdc_ Address for the USDC token (e.g. cash)
     * @param insurance_ Address for the insurance fund
     * @param underlying_ Name of underlying token to support at deployment
     * @param spotOracle_ Address of spot oracle for the underlying
     * @param markOracle_ Address of mark price oracle for the underlying
     */
    function initialize(
        address usdc_,
        address insurance_,
        Derivative.Underlying underlying_,
        address spotOracle_,
        address markOracle_
    )
        public
        initializer 
    {
        usdc = usdc_;
        insurance = insurance_;

        // Initialize the upgradeable dependencies
        __ReentrancyGuard_init();
        __Ownable_init();

        // The owner is a keeper
        keepers[owner()] = true;

        // Set insurance fund to cover max 50%
        // Decimals are 4 so 5000 => 0.5
        maxInsuredPerc = 5000;

        // Begin first round
        curRound = 1;

        // Default alternative minimum % to 1%
        // Decimals are 4, so 100 => 0.01
        minMarginPerc = 100;
    
        // Set the expiry to the next friday
        activeExpiry = DateMath.getNextExpiry(block.timestamp);

        // Create a new underlying (handles strike and smile creation)
        newUnderlying(underlying_, spotOracle_, markOracle_);
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
        uint256 tradePrice,
        uint256 quantity,
        bool isCall,
        Derivative.Underlying underlying,
        Derivative.StrikeLevel strikeLevel,
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

    /**
     * @notice Event when positions are settled
     * @param caller Caller of the settlment event
     * @param round Round that was settled
     * @param numPositions Number of positions settled
     */
    event SettlementEvent(
        address indexed caller,
        uint8 round,
        uint256 numPositions
    );

    /**
     * @notice Event when contract is paused or unpaused
     * @param owner Address who called the pause event
     * @param paused Is the contract paused?
     */
    event TogglePauseEvent(address indexed owner, bool paused);

    /**
     * @notice Event when maximum insured percentage is updated
     * @param owner Address who called the pause event
     * @param perc Max percentage for maximum insurance fund
     */
    event MaxInsuredPercEvent(address indexed owner, uint256 perc);

    /**
     * @notice Event when alternative minimum percent for margin is updated
     * @param owner Address who called the pause event
     * @param perc Max percentage for maximum insurance fund
     */
    event MinMarginPercEvent(address indexed owner, uint256 perc);

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

        // Pull resources from sender to this contract
        IERC20Upgradeable(usdc).safeTransferFrom(msg.sender, address(this), amount);

        // Emit `DepositEvent`
        emit DepositEvent(msg.sender, amount);
    }

    /**
     * @notice Withdraw assets from margin account
     * @dev Only successful if margin accounts remain satisfied post withdraw
     * @dev Withdrawals are only allowed when user has no open positions
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "withdraw: amount must be > 0");
        require(amount <= balances[msg.sender], "withdraw: amount > balance");

        // Check margin post withdrawal
        (, bool satisfied) = checkMarginOnWithdrawal(msg.sender, amount);
        require(satisfied, "withdraw: margin check failed");

        // Transfer USDC to sender
        IERC20Upgradeable(usdc).safeTransfer(msg.sender, amount);

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
        IERC20Upgradeable(usdc).safeTransfer(msg.sender, balance);

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
     * @param useInitialMargin Use IM instead of MM. Recall IM > MM
     * @return diff AB + UP - MM, signed integer
     * @return satisfied True if AB + UP > MM, else false
     */
    function checkMargin(address user, bool useInitialMargin) public view returns (int256, bool) {
        uint256 balance = balances[user];
        uint256 maintainence = getMargin(user, useInitialMargin);

        // Compute the unrealized PnL, emphasizing losses
        int256 pnl = getPayoff(user, true);

        // Compute `balance + PnL`
        int256 diff = int256(balance) + pnl - int256(maintainence);

        // if diff > 0, then satisfied = true
        bool satisfied = (diff > 0);

        return (diff, satisfied);
    }

    /**
     * @notice Performs settlement for positions of the current round. Transfers amount paid by ower
     * to this contract. Adds amount owed to each user to their margin account
     * @dev Anyone can call this though the burden falls on keepers
     * @dev This must be called before `rollover` or else positions are lost
     */
    function settle() external nonReentrant {
        require(activeExpiry <= block.timestamp, "settle: expiry must be in the past");
        require(!roundSettled, "settle: already settled this round");

        for (uint256 j = 0; j < roundPositions.length; j++) {
            Derivative.Order memory order = roundPositions[j];
            uint256 spot = getSpot(order.option.underlying);

            // Compute buyer payoff; seller payoff is exact opposite
            /// @dev Reduces calls to `MarginMath`
            int256 buyerPayoff = MarginMath.getPayoff(order.buyer, spot, order);

            // Add together the payoff and the premium
            int256 netPayoff = buyerPayoff - int256(order.tradePrice);

            // If the buyer's net payoff is negative, they are the ower
            address ower = (netPayoff < 0) ? order.buyer : order.seller;
            address owee = (netPayoff < 0) ? order.seller : order.buyer;

            uint256 absPayoff = (netPayoff >= 0) ? uint256(netPayoff) : uint256(-netPayoff);

            if (balances[ower] >= absPayoff) {
                // If the ower has enough in the margin account, then make shift
                balances[ower] -= absPayoff;
                balances[owee] += absPayoff;
            } else {
                // TODO: can this be frontrun by a withdrawal?
                // Attempt to make up the difference in the insurance fund
                uint256 partialAmount = balances[ower];
                uint256 insuredAmount = absPayoff - partialAmount;
                uint256 maxInsuredAmount = absPayoff * maxInsuredPerc / 10**4;

                // We cannot payback for more than the max insured amount
                // Prevents catastrophic depletion of the insurance fund
                if (insuredAmount > maxInsuredAmount) {
                    insuredAmount = maxInsuredAmount;
                }

                if (balances[insurance] >= insuredAmount) {
                    balances[owee] += absPayoff;
                    balances[insurance] -= insuredAmount;
                    balances[ower] = 0;
                } else {
                    // Do the best we can: the insurance fund cannot help
                    balances[owee] += partialAmount;
                    balances[ower] = 0;
                }
            }
        }

        // Track we settled last round
        roundSettled = true;

        // Emit event
        emit SettlementEvent(msg.sender, curRound, roundPositions.length);

        // Free up memory for the round
        delete roundPositions;
    }

    /**
     * @notice Performs partial liquidation on user. Liquidates the user's 
     * positions one by one until margin check succeeds. User is penalized with 35% of MM being reallocated,
     * split between liquidator and insurance fund
     * @dev Any EOA can call this on any EOA
     * @dev A liquidator need not inherit all positions of liquidatee. We allow some positions to be liquidated and others not
     * @param user Address of the user to liquidate
     * @return fullyLiquidated if true, user is fully liquidated
     */
    function liquidate(address user) external nonReentrant returns (bool fullyLiquidated) {
        require(userRoundIxs[user].length > 0, "liquidate: user has no positions");
        (, bool satisfied) = checkMargin(user, false);
        require(!satisfied, "liquidate: user passes margin check");

        address liquidator = msg.sender;

        // Default is to assume user can be fully liquidated
        fullyLiquidated = true;

        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            uint256 index = userRoundIxs[user][i];
            Derivative.Order storage order = roundPositions[index];

            // Compute mark price for option
            uint256 spot = getSpot(order.option.underlying);
            uint256 mark = getMark(order.option.underlying, order.option.isCall, order.option.strikeLevel);

            // Liquidator must pay mark price
            if (balances[liquidator] < mark) {
                fullyLiquidated = false;
                break;
            }
            balances[liquidator] -= mark;
            balances[user] += mark;

            // Add order to liquidator's positions
            userRoundIxs[liquidator].push(uint16(index));

            // Check liquidator can handle the new position and the payment to liquidatee
            (, bool liquidatorOk) = checkMargin(liquidator, false);

            if (!liquidatorOk) {
                // If the liquidator is now below margin, undo changes
                /// @dev We don't just revert to allow liquidators to take one of many positions
                delete userRoundIxs[liquidator][userRoundIxs[liquidator].length - 1];

                // Undo adding the new position (last index)
                fullyLiquidated = false;

                // Undo changes to balances
                balances[liquidator] += mark;
                balances[user] -= mark;
                break;
            }

            // If we have reached here, then the liquidator is able to inherit position
            // Delete position, dropping it from current user
            deleteUserPosition(user, index);

            // Ovewrite user's position with liquidator
            if (order.buyer == user) {
                order.buyer = liquidator;
            } else {
                order.seller = liquidator;
            }

            // Now that user no longer owns position, we reward liquidator using MM from this 
            // position (which cannot push user back below margin even if 100% of MM is gone).
            // 25% of MM -> liquidator; 10% of MM -> insurance fund
            uint256 margin = MarginMath.getMaintainenceMargin(
                spot, 
                order.buyer == liquidator, 
                order.option,
                mark, 
                minMarginPerc
            );
            balances[user] -= (margin * 35 / 100);
            balances[liquidator] += (margin * 25 / 100);
            balances[insurance] += (margin / 10);

            // Check if the user is no longer below margin, if so quit
            (, satisfied) = checkMargin(user, false);
            if (satisfied) {
                break;
            }
        }
        return fullyLiquidated;
    }

    /**
     * @notice Get balance for user
     * @dev Intended so callers can only get their own balance
     * @return balance Amount of USDC
     */
    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    /************************************************
     * Internal functions
     ***********************************************/

    /**
     * @notice Read latest oracle price data
     * @param underlying Enum for the underlying token
     * @return answer Latest price for underlying
     */
    function getSpot(Derivative.Underlying underlying) internal view returns (uint256) {
        require(spotOracles[underlying] != address(0), "getSpot: missing oracle");
        (,uint256 answer,) = ISpotFeed(spotOracles[underlying]).latestRoundData();
        return answer;
    }

    /**
     * @notice Read latest oracle of mark price
     * @param underlying Enum for the underlying token
     * @param isCall Whether we want a call price (true) or put price (false)
     * @param strikeLevel The strike that we want the mark price for
     * @return answer The mark price
     */
    function getMark(
        Derivative.Underlying underlying,
        bool isCall,
        Derivative.StrikeLevel strikeLevel
    )
        internal
        view
        returns (uint256 answer) 
    {
        require(markOracles[underlying] != address(0), "getMark: missing oracle");
        (,answer,) = IMarkFeed(markOracles[underlying]).latestRoundData(isCall, strikeLevel);
        return answer;
    }

    /**
     * @notice Given spot, compute 11 strikes. Intended for use at a new round
     * https://zetamarkets.gitbook.io/zeta/zeta-protocol/trading/derivatives-framework/options-contract-specifications/options-strike-generation-schema
     * @dev The strikes will be in the same decimals as underlying
     * @dev The chosen strikes below align with Deribit's strikes
     * @param underlying Enum for the underlying token
     * @return strikes Eleven strikes
     */
    function getStrikeMenu(Derivative.Underlying underlying)
        internal
        view
        returns (uint256[11] memory strikes)
    {
        require(activeExpiry > block.timestamp, "getStrikeMenu: expiry in the past");

        // The spot of the underlying will be in terms of decimals
        uint8 decimals = IERC20Upgradeable(usdc).decimals();

        // Fetch the spot price
        uint256 spot = getSpot(underlying);

        // Check spot is not out of range
        require(spot >= 10**(decimals - 2), "getStrikeMenu: Spot price too small");
        require(spot <= 10**(decimals + 6), "getStrikeMenu: Spot price too large");

        uint256 lower;
        uint256 upper;
        uint256 increment;

        /// @notice Store 32 lower/upper bounds for strike selection
        /// @dev Decimals are in 4
        uint40[33] memory bounds = [
            100, 200, 300, 600, 1000, 2000, 3000, 6000,
            10000, 20000, 30000, 60000, 
            100000, 200000, 400000, 700000,
            1000000, 2000000, 4000000, 7000000,
            10000000, 20000000, 40000000, 70000000,
            100000000, 200000000, 400000000, 800000000,
            1000000000, 3000000000, 5000000000, 8000000000,
            10000000000
        ];

        /// @notice Store 32 increment sizes for strike selection
        /// @dev Decimals are in 4
        uint32[32] memory increments = [
            9, 20, 30, 50, 90, 200, 300, 600, 1000, 2000, 3000, 6000, 
            10000, 20000, 30000, 60000, 100000, 200000, 400000, 600000,
            1000000, 2000000, 4000000, 7000000,
            10000000, 20000000, 40000000, 70000000,
            100000000, 200000000, 400000000, 700000000
        ];
 
        // Search which bounds the current spot falls in
        for (uint256 i = 0; i < 32; i++) {
            lower = bounds[i] * 10**(decimals - 4); 
            upper = bounds[i + 1] * 10**(decimals - 4); 
            increment = increments[i] * 10**(decimals - 4);

            // If the spot is within range
            if ((spot >= lower) && (spot < upper)) {
                for (uint256 j = 0; j < Derivative.NumStrikeLevel; j++) {
                    strikes[j] = lower + j * increment;
                }
                // Once you find the range, quit
                break;
            }
        }
    }

    /**
     * @notice Compute the payofff function for all positions owned by user
     * @dev We net payoffs per strike (and expiry but there is only one expiry)
     * @param user Address to compute IM for
     * @param onlyLoss Do not count unrealized profits from open positions
     * @return payoff The payoff summed for all positions (can be negative)
     */
    function getPayoff(address user, bool onlyLoss)
        internal
        view
        returns (int256) 
    {
        if (userRoundIxs[user].length == 0) {
            return 0;
        }

        // Store the netted payoffs here (there are 11 strike levels)
        int256[11] memory payoffPerStrike;

        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            // Fetch the order in the position
            Derivative.Order memory order = roundPositions[userRoundIxs[user][i]];

            // Get strike level & convert to integer index
            uint8 strikeLevel = uint8(order.option.strikeLevel);

            // Fetch the underlying token for the option
            uint256 spot = getSpot(order.option.underlying);

            // Compute the payoff at this price
            /// @dev `curPayoff` is a signed integer
            int256 curPayoff = MarginMath.getPayoff(user, spot, order);

            // Net the payoff at this strike level
            payoffPerStrike[strikeLevel] = payoffPerStrike[strikeLevel] + curPayoff;
        }

        int256 payoff;
        // Loop through strike levels and sum them, ignoring positive ones if `onlyLoss` is true
        for (uint256 i = 0; i < Derivative.NumStrikeLevel; i++) {
            // Ignore if positive payoff at strike and `onlyLoss` is on
            // If `onlyLoss` is on, then the returned value will be negative
            if ((payoffPerStrike[i] < 0) && onlyLoss) {
                continue;
            }
            payoff = payoff + payoffPerStrike[i];
        }

        return payoff;
    }

    /**
     * @notice Compute the maintainence margin for all positions owned by user
     * @dev The maintainence margin is equal to the sum of maintainence margins for all positions
     * @param user Address to compute MM for
     * @param useInitialMargin By default, computes MM; if true, compute IM
     * @return margin The maintainence margin summed for all positions
     */
    function getMargin(address user, bool useInitialMargin) internal view returns (uint256) {
        if (userRoundIxs[user].length == 0) {
            return 0;
        }

        // Track the total margin 
        uint256 margin;

        // Loop through open positions by user
        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            Derivative.Order memory order = roundPositions[userRoundIxs[user][i]];
            Derivative.Option memory option = order.option;
            bytes32 optionHash = Derivative.hashOption(option);

            // In the case of multiple positions for the same option, 
            // compute the total amount the user wishes to buy and sell
            uint256 nettedBuy = 0;
            uint256 nettedSell = 0;

            require(
                (user == order.buyer) || (user == order.seller),
                "getMargin: trader must be buyer or seller"
            );

            // Check if the user is a buyer or seller for `order`
            if (user == order.buyer) {
                nettedBuy += order.quantity;
            } else {
                nettedSell += order.quantity;
            }

            // Count the number of orders involved in netting (min 1)
            uint256 numNetted = 1;

            // Nested loop to find the total quantity of this option.
            // Consider case with multiple positions with same order
            for (uint256 j = 0; j < userRoundIxs[user].length; j++) {
                // Do not double count
                if (i == j) {
                    continue;
                }
                Derivative.Order memory order2 = roundPositions[userRoundIxs[user][j]];
                bytes32 optionHash2 = Derivative.hashOption(order2.option);

                if (optionHash == optionHash2) {
                    if (user == order2.buyer) {
                        nettedBuy += order2.quantity;
                    } else {
                        nettedSell += order2.quantity;
                    }
                    numNetted++;
                }
            }

            uint256 nettedQuantity;
            bool isBuyer;

            // Compute total buy - total sell
            if (nettedBuy >= nettedSell) {
                nettedQuantity = nettedBuy - nettedSell;
                isBuyer = true;
            } else {
                nettedQuantity = nettedSell - nettedBuy;
                isBuyer = false;
            }

            // If happens to equal 0, do nothing
            if (nettedQuantity > 0) {
                // Fetch spot price
                uint256 spot = getSpot(option.underlying);

                // Fetch mark price
                uint256 mark = getMark(option.underlying, option.isCall, option.strikeLevel);

                // Compute maintainence (or initial) margin for option
                uint256 curMargin;
                if (useInitialMargin) {
                    curMargin = MarginMath.getInitialMargin(spot, isBuyer, option, mark, minMarginPerc);
                } else {
                    curMargin = MarginMath.getMaintainenceMargin(spot, isBuyer, option, mark, minMarginPerc);
                }

                // Build margin using `nettedQuantity`
                /// @dev Divide by num netting to factor in double counting:
                /// Suppose i and j are matched, then the code above will net at both index i and j
                /// Suppose i, j, k are matched, then we will net at both i, j, and k
                margin += (nettedQuantity * curMargin / numNetted);
            }
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
     * @return diff AB - amount + UP - MM, a signed integer
     * @return satisfied True if non-negative, else false
     */
    function checkMarginOnWithdrawal(address user, uint256 amount) 
        internal
        view
        returns (int256, bool) 
    {
        require(amount > 0, "checkMarginOnWithdrawal: amount must be > 0");
        require(amount <= balances[user], "checkMarginOnWithdrawal: amount must be <= balance");

        // Perform standard margin check
        (int256 margin,) = checkMargin(user, false);

        // Subtract the withdraw
        int256 total = margin - int256(amount);

        // Satisfied if not negative
        bool satisfied = total > 0;

        return (total, satisfied);
    }

    /**
     * @notice Add a new underlying
     * @dev For code reuse
     * @param underlying Enum for the underlying token
     * @param spotOracle Address for an oracle for spot prices
     * @param markOracle Address for an oracle for mark prices
     */
    function newUnderlying(
        Derivative.Underlying underlying,
        address spotOracle,
        address markOracle
    ) internal {
        require(!isActiveUnderlying[underlying], "newUnderlying: underlying already active");

        // Set oracles for underlying
        spotOracles[underlying] = spotOracle;
        markOracles[underlying] = markOracle;

        // Compute strikes for underlying
        roundStrikes[underlying] = getStrikeMenu(underlying);

        // Mark as active
        isActiveUnderlying[underlying] = true;
    }

    /**
     * @notice Delete one of the user's position
     * @param user Address of the user
     * @param index Index to delete
     */
    function deleteUserPosition(address user, uint256 index) internal {
        uint256 size = userRoundIxs[user].length;
        if (size > 1) {
            userRoundIxs[user][index] = userRoundIxs[user][size - 1];
        }
        // Implicitly recovers gas from last element storage
        delete userRoundIxs[user][size - 1];
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
     * @notice Set the oracle for an underlying token
     * @dev This function can also be used to replace or delete spotOracles
     * @param underlying Enum for the underlying token
     * @param spotOracle Address for an oracle for spot prices
     * @param markOracle Address for an oracle for mark prices
     */
    function setOracle(Derivative.Underlying underlying, address spotOracle, address markOracle) 
        external
        onlyOwner 
    {
        if (spotOracles[underlying] == address(0) || markOracles[underlying] == address(0)) {
            // Brand new oracle
            newUnderlying(underlying, spotOracle, markOracle);
        } else {
            // Existing underlying, overwrite oracle
            spotOracles[underlying] = spotOracle;
            markOracles[underlying] = markOracle;
        }
    }

    /**
     * @notice Set the maximum amount to be insured
     */
    function setMaxInsuredPerc(uint256 perc) external onlyOwner {
        require(perc <= 10**4, "setMaxInsuredPerc: must be <= 10**4");
        maxInsuredPerc = perc;
        emit MaxInsuredPercEvent(msg.sender, perc);
    }

    /**
     * @notice Set the alternative minimum percent to be insured
     */
    function setMinMarginPerc(uint256 perc) external onlyOwner {
        require(perc <= 10**4, "setMinMarginPerc: must be <= 10**4");
        minMarginPerc = perc;
        emit MinMarginPercEvent(msg.sender, perc);
    }

    /**
     * @notice Allows owner to pause the contract in emergencies
     * @dev We may want to change this to keeper permissions
     */
    function togglePause() external onlyOwner {
        isPaused = !isPaused;

        // emit event
        emit TogglePauseEvent(msg.sender, isPaused);
    }

    /**
     * @notice Ends the current expiry and activates next expiry
     * @dev The keeper/owner is responsible for passing a list of users with 
     * positions in the current round to clear memory. This list must be 
     * maintained using a off-chain mechanism
     */
    function rollover(address[] calldata roundUsers) external nonReentrant onlyKeeper {
        require(!isPaused, "rollover: contract paused");
        require(activeExpiry < block.timestamp, "rollover: too early");
        require(roundSettled, "rollover: please settle last round first");

        // Update the active expiry
        uint256 lastExpiry = activeExpiry;
        activeExpiry = DateMath.getNextExpiry(lastExpiry);

        // Update round
        curRound += 1;

        // Update settled tracker
        roundSettled = false;

        // Loop through underlying tokens
        for (uint256 i = 0; i < Derivative.NumUnderlying; i++) {
            Derivative.Underlying underlying = Derivative.Underlying(i);

            // Some underlying may be planned but not active
            if (isActiveUnderlying[underlying]) {
                // Update strike menu
                roundStrikes[underlying] = getStrikeMenu(underlying);
            }
        }

        // Clear positions for the user. It is up to the caller to maintain and provide 
        // a correct list of user addresses, otherwise memory will not be freed properly
        for (uint256 i = 0; i < roundUsers.length; i++) {
            delete userRoundIxs[roundUsers[i]];
        }
    }

    /**
     * @notice Record a position (matched order) from off-chain orderbook
     * @dev Saves the order to storage variables. Only the keeper can call this function
     * @dev An oracle must exist for the underlying position for it to be added
     * @dev This function does not explicitly check that the same position is not added
     * twice. This is hard to do efficiently on-chain and will be done off-chain
     */
    function addPosition(
        address buyer,
        address seller,
        uint256 tradePrice,
        uint256 quantity,
        bool isCall,
        Derivative.StrikeLevel strikeLevel,
        Derivative.Underlying underlying
    ) 
        external
        nonReentrant
        onlyKeeper 
    {
        require(tradePrice > 0, "addPosition: tradePrice must be > 0");
        require(quantity > 0, "addPosition: quantity must be > 0");
        require(spotOracles[underlying] != address(0), "addPosition: no oracle for underlying");

        // USDC decimals will be used for spot/strike calculations
        uint8 decimals = IERC20Upgradeable(usdc).decimals();

        // Get strike at chosen level from current round strikes
        uint256 strike = roundStrikes[underlying][uint8(strikeLevel)];
        require(strike > 0, "addPosition: no strike for underlying");

        // Build an order object
        Derivative.Order memory order = Derivative.Order(
            buyer,
            seller,
            tradePrice,
            quantity,
            Derivative.Option(isCall, strikeLevel, strike, activeExpiry, underlying, decimals)
        );

        // Save position to mapping by expiry
        roundPositions.push(order);

        // Get the index for the newly added value
        uint16 orderIndex = uint16(roundPositions.length - 1);

        // Save that the buyer/seller have this position
        userRoundIxs[buyer].push(orderIndex);
        userRoundIxs[seller].push(orderIndex);

        // Check margin for buyer and seller
        (, bool checkBuyerMargin) = checkMargin(buyer, false);
        (, bool checkSellerMargin) = checkMargin(seller, false);

        require(checkBuyerMargin, "addPosition: buyer failed margin check");
        require(checkSellerMargin, "addPosition: seller failed margin check");

        // Emit event 
        emit RecordPositionEvent(
            tradePrice,
            quantity,
            isCall,
            underlying,
            strikeLevel,
            activeExpiry
        );
    }
}
