// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IERC20Upgradeable.sol";
import "./interfaces/IOracle.sol";
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
contract MarginV1 is
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

    /// @notice Address to send fees
    address public feeRecipient;

    /// @notice Current round
    uint8 public curRound;

    /// @notice Maximum amount allowed in margin account
    uint256 public maxBalanceCap; 

    /// @notice Maximum notional value allowed in order
    mapping(Derivative.Underlying => uint256) minQuantityPerUnderlying;

    /// @notice Maximum percentage the insurance fund can payoff for a single position in USDC
    uint256 public maxInsuredPerc;

    /// @notice Percentage multiplier used to decide alternative minimums
    /// Four decimals so 100 => 1% (0.01), 1000 => 10% (0.1)
    uint256 public minMarginPerc;

    /// @notice The current active expiry
    /// @dev This assumes all underlying has only one expiry.
    uint256 public activeExpiry;

    /// @notice Whitelist for market maker accounts
    mapping(address => bool) whitelist;

    /// @notice If the contract is paused or not
    bool private isPaused;

    /// @notice Tracks if the last round has been settled
    bool private roundSettled;

    /// @notice Stores addresses for oracles of each underlying
    mapping(Derivative.Underlying => address) private oracles;

    /// @notice Stores active underlyings
    mapping(Derivative.Underlying => bool) public isActiveUnderlying;

    /// @notice List of keepers who can add positions
    mapping(address => bool) private keepers;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Store all positions for the current round in the map
    Derivative.Order[] private roundPositions;

    /// @notice Stores map from user address to index into the current round positions
    mapping(address => uint16[]) private userRoundIxs;

    /// @notice Rather than deleting indices, which can be expensive, we will track if a user round ix is active
    mapping(address => bool[]) private userRoundIxsIsActive;

    /// @notice Stores the number of positions a user has in the current round
    mapping(address => uint16) private userRoundCount;

    /// @notice Stores strike prices for the current round per underlying
    mapping(Derivative.Underlying => uint256[11]) public roundStrikes;

    /************************************************
     * Initialization and Upgradeability
     ***********************************************/

    /**
     * @param usdc_ Address for the USDC token (e.g. cash)
     * @param insurance_ Address for the insurance fund
     * @param feeRecipient_ Address to receive fees
     * @param underlying_ Name of underlying token to support at deployment
     * @param oracle_ Address of oracle for the underlying
     * @param minQuantity_ Minimum quantity in option for underlying
     */
    function initialize(
        address usdc_,
        address insurance_,
        address feeRecipient_,
        Derivative.Underlying underlying_,
        address oracle_,
        uint256 minQuantity_
    )
        public
        initializer 
    {
        usdc = usdc_;
        insurance = insurance_;
        feeRecipient = feeRecipient_;

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

        // The spot of the underlying will be in terms of decimals
        // Users cannot deposit more than 2000 USDC
        maxBalanceCap = 2000 * 10**getCollateralDecimals();
    
        // Set the expiry to the next friday
        activeExpiry = DateMath.getNextExpiry(block.timestamp);

        // Create a new underlying (handles strike and smile creation)
        newUnderlying(underlying_, oracle_, minQuantity_);
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

    /**
     * @notice Event when the maximum balance cap is updated
     * @param owner Address who called the max balance cap
     * @param maxBalance Cap on balance allowed
     */
    event MaxBalanceCapEvent(address indexed owner, uint256 maxBalance);

    /**
     * @notice Event when the maximum balance cap is updated
     * @param owner Address who called the activate underlying function
     * @param underlying Underlying enum
     * @param oracle Address for oracle    
     * @param minQuantity Minimum quantity for order allowed for underlying
     */
    event NewUnderlyingEvent(
        address indexed owner,
        Derivative.Underlying underlying,
        address oracle,
        uint256 minQuantity
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

        // In the beginning we set a maximum cap. Insurance fund needs to break cap
        if (msg.sender != insurance) {
            require(balances[msg.sender] <= maxBalanceCap, "deposit: exceeds maximum");
        }

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

        // if diff >= 0, then satisfied = true
        bool satisfied = (diff >= 0);

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

            // In `liquidatePosition`, we set quantity to zero as a shorthand for having settled 
            if (order.quantity == 0) {
                continue; 
            }

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
    }

    /**
     * @notice Liquidates a single position
     * @dev Used internally by `liquidate` function
     * @param liquidator Address performing the lqiuidation
     * @param user Address being liquidated
     * @param ix Index of the order in user's round positions
     * @return success True if the position was successfully liquidated, otherwise false
     */
    function liquidatePosition(address liquidator, address user, uint256 ix)
        internal
        returns (bool success)
    {
        // Store order memory since we are only reading
        Derivative.Order storage order = roundPositions[userRoundIxs[user][ix]];

        // Track if the the user is the buyer or seller
        bool userIsBuyer = (order.buyer == user) ? true : false;

        // Compute mark price for option: this is the amount the liquidator must pay to obtain the position
        uint256 spot = getSpot(order.option.underlying);
        uint256 mark = getMark(order.option.underlying, order.option.isCall, order.option.strikeLevel);

        // Compute user payoff: if it is non-negative, skip as liquidating would not help
        int256 buyerPayoff = MarginMath.getPayoff(order.buyer, spot, order);
        int256 userPayoff = (userIsBuyer) ? buyerPayoff : (-buyerPayoff);
        if (userPayoff >= 0) {
            return false;
        }

        // Find the other address in the order
        address counterparty = (userIsBuyer) ? order.seller : order.buyer;

        if (liquidator == counterparty) {
            /** 
             * @dev If the liquidator is the other side to the user, then we can settle this position 
             * since this is effectively the liquidator taking both sides, and netting out the order
             */

            // The liquidator's payoff is the reverse of the user's payoff
            // Mark is the amount owed to the user by liquidator
            int256 liquidatorNet = (-userPayoff) - int256(mark);

            if (liquidatorNet < 0) {
                uint256 liquidatorAbsNet = (liquidatorNet < 0) ? uint256(-liquidatorNet) : uint256(liquidatorNet);
                // Liquidator still owes user some money though less than mark due to payoff obtained
                bool liquidatorOk = attemptLiquidation(liquidator, user, liquidatorAbsNet, ix);
                if (!liquidatorOk) {
                    return false;
                }
            } else {
                // Liquidator does not need to pay the user and accepts a smaller payoff. But liquidator now 
                // owns both sides of the position, so this results in no change to balances
                /// @dev A cheap way to mark this order as canceled is setting the quantity to 0
                order.quantity = 0;
                // Decrement the round count to signify the netting has occured
                userRoundCount[liquidator]--;
                userRoundCount[user]--;
            }
        } else {
            /**
             * @dev If the liquidator is not the other side, this is a third party.
             * Here, we must perform a transfer of position from user to liquidator
             */
            bool liquidatorOk = attemptLiquidation(liquidator, user, mark, ix);
            if (!liquidatorOk) {
                return false;
            }
        }

        // Now that user no longer owns position, we reward liquidator using MM from this 
        // position (which cannot push user back below margin even if 100% of MM is gone).
        // 25% of MM -> liquidator; 10% of MM -> insurance fund
        /// @dev Liquidators must pass margin check BEFORE receiving reward
        uint256 margin = MarginMath.getMaintainenceMargin(
            spot, 
            userIsBuyer,
            order.option,
            mark, 
            minMarginPerc
        );
        // This require statement should never fire
        require(balances[user] >= (margin * 35 / 100), "liquidate: user cannot pay reward");
        balances[user] -= (margin * 35 / 100);
        balances[liquidator] += (margin * 25 / 100);
        balances[insurance] += (margin / 10);

        return true;
    }

    /**
     * @notice Steps for liquidation by liquidator of user's position
     * @param liquidator Address of the account doing the liquidation
     * @param user Address of the account being liquidated
     * @param payment The amount the liquidator will pay the user for the position
     * @param ix The index of the order in the user's round positions
     * @return liquidatorOk True if the liquidation was reverted due to liquidator falling below margin
     */
    function attemptLiquidation(
        address liquidator,
        address user,
        uint256 payment,
        uint256 ix
    ) 
        internal 
        returns (bool liquidatorOk) 
    {
        // Fetch the order in storage as we will be doing edits
        uint16 index = userRoundIxs[user][ix];
        Derivative.Order storage order = roundPositions[index];

        // Check if user is buyer or seller
        bool userIsBuyer = (order.buyer == user) ? true : false;

        // If liquidator doesnt have enough, return immediately
        if (balances[liquidator] < payment) {
            return false;
        }

        // Transfer payment from liquidator to user for inheriting position
        balances[liquidator] -= payment;
        balances[user] += payment;

        // Add order to liquidator's positions
        userRoundIxs[liquidator].push(index);
        userRoundIxsIsActive[liquidator].push(true);
        userRoundCount[liquidator]++;

        // Remove position from user
        userRoundIxsIsActive[user][ix] = false;
        userRoundCount[user]--;

        // Ovewrite user's position with liquidator
        if (userIsBuyer) {
            order.buyer = liquidator;
        } else {
            order.seller = liquidator;
        }

        // Check liquidator can handle the new position and the payment to liquidatee
        (, liquidatorOk) = checkMargin(liquidator, false);

        if (!liquidatorOk) {
            /**
             * @dev If the liquidator is now below margin, undo changes.
             * We don't just revert to allow liquidators to take one of many positions
             */
            userRoundIxs[liquidator].pop();
            userRoundIxsIsActive[liquidator].pop();
            userRoundCount[liquidator]--;

            userRoundIxsIsActive[user][ix] = true;
            userRoundCount[user]++;

            // Reset the original buyer
            if (userIsBuyer) {
                order.buyer = user;
            } else {
                order.seller = user;
            }

            // Undo changes to balances
            balances[liquidator] += payment;
            balances[user] -= payment;
        }
    }

    /**
     * @notice Performs partial liquidation on user. Liquidates the user's 
     * positions one by one until margin check succeeds. User is penalized with 35% of MM being reallocated,
     * split between liquidator and insurance fund
     * @dev Any EOA can call this on any EOA
     * @dev A liquidator need not inherit all positions of liquidatee. We allow some positions to be liquidated and others not
     * @param user Address of the user to liquidate
     */
    function liquidate(address user) external nonReentrant {
        require(userRoundCount[user] > 0, "liquidate: user has no positions");
        (,bool satisfied) = checkMargin(user, false);
        require(!satisfied, "liquidate: user passes margin check");

        // Cannot liquidate yourself since you are already under margin
        require(msg.sender != user, "liquidate: cannot liquidate yourself");

        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            // Check that the order has not been marked inactive already
            // If so, nothing to liquidate
            if (!userRoundIxsIsActive[user][i]) {
                continue;
            }
            
            // Ignore long positions
            if (roundPositions[userRoundIxs[user][i]].buyer == user) {
                continue;
            }

            // Perform liquidation and check if success
            bool success = liquidatePosition(msg.sender, user, i);

            // Ignore positions we could not liquidate
            if (!success) {
                continue;
            }

            // Check if the user is no longer below margin, if so quit to avoid over-liquidation
            (, satisfied) = checkMargin(user, false);
            if (satisfied) {
                break;
            }
        }

        // If we reach here, then liquidating all short positions (if any) was not enough.
        // Perform a second loop to liquidate long positions
        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            if (!userRoundIxsIsActive[user][i]) {
                continue;
            }
            
            // Ignore short positions
            if (roundPositions[userRoundIxs[user][i]].seller == user) {
                continue;
            }

            // Perform liquidation and check if success
            bool success = liquidatePosition(msg.sender, user, i);

            // Ignore positions we could not liquidate
            if (!success) {
                continue;
            }

            // Check if the user is no longer below margin, if so quit to avoid over-liquidation
            (, satisfied) = checkMargin(user, false);
            if (satisfied) {
                break;
            }
        }
    }

    /**
     * @notice Get balance for user
     * @dev Intended so callers can only get their own balance
     * @return balance Amount of USDC
     */
    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    /**
     * @notice Get all positions that the user is participating in
     */
    function getPositions() external view returns (Derivative.Order[] memory) {
        Derivative.Order[] memory orders = new Derivative.Order[](userRoundCount[msg.sender]);
        uint256 count = 0;
        for (uint256 i = 0; i < userRoundIxs[msg.sender].length; i++) {
            // Ignore contracts marked as inactive
            if (!userRoundIxsIsActive[msg.sender][i]) {
                continue;
            }
            Derivative.Order storage order = roundPositions[userRoundIxs[msg.sender][i]];
            // Ignore orders that have already been netted
            if (order.quantity == 0) {
              continue;
            }
            orders[count] = order;
            count++;
        }
        return orders;
    }

    /**
     * @notice Get strikes for the current round
     * @param underlying Enum for the underlying token
     * @return strikes 11 strikes for the current round
     */
    function getStrikes(Derivative.Underlying underlying) external view returns (uint256[11] memory) {
        return roundStrikes[underlying];
    }

    /**
     * @notice Get decimals for the underlying derivative
     * @return decimals Unsigned integer with 8 bits
     */
    function getCollateralDecimals() public view returns (uint8) {
        return IERC20Upgradeable(usdc).decimals();
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
        require(oracles[underlying] != address(0), "getSpot: missing oracle");
        (,uint256 answer,) = IOracle(oracles[underlying]).latestRoundSpot();
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
        require(oracles[underlying] != address(0), "getMark: missing oracle");
        (,answer,) = IOracle(oracles[underlying]).latestRoundMark(isCall, uint8(strikeLevel));
        return answer;
    }

    /**
     * @notice Compute notional value of option
     * @dev Notional = quantity * spot
     * @dev We return the notional in the same decimals as the spot
     * @param order Derivative.Order object
     * @return value Notional value in decimals of underlying
     */
    function getNotional(Derivative.Order memory order) internal view returns (uint256) {
        return order.quantity * getSpot(order.option.underlying) / 10**Derivative.QUANTITY_DECIMALS;
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
        uint8 decimals = getCollateralDecimals();

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
                for (uint256 j = 0; j < Derivative.NUM_STRIKE_LEVEL; j++) {
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
        public
        view
        returns (int256) 
    {
        if (userRoundCount[user] == 0) {
            return 0;
        }

        // Store the netted payoffs here (there are 11 strike levels)
        int256[11] memory payoffPerStrike;

        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            // Ignore order if has been turned inactive for user 
            if (!userRoundIxsIsActive[user][i]) {
                continue;
            }
            // Fetch the order in the position
            Derivative.Order memory order = roundPositions[userRoundIxs[user][i]];

            // If already netted, we know payoff 0
            if (order.quantity == 0) {
              continue;
            }

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
        for (uint256 i = 0; i < Derivative.NUM_STRIKE_LEVEL; i++) {
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
    function getMargin(address user, bool useInitialMargin)
        public
        view
        returns (uint256) 
    {
        if (userRoundIxs[user].length == 0) {
            return 0;
        }

        // Track the total margin 
        uint256 margin;

        // Loop through open positions by user
        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            // Ignore order if has been turned inactive for user 
            if (!userRoundIxsIsActive[user][i]) {
                continue;
            }

            // Fetch order
            Derivative.Order memory order = roundPositions[userRoundIxs[user][i]];
            Derivative.Option memory option = order.option;
            bytes32 optionHash = Derivative.hashOption(option);

            // If netted order, then has no impact on margin
            if (order.quantity == 0) {
                continue;
            }

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
                // Do not double count & ignore inactive positions
                if ((i == j) || (!userRoundIxsIsActive[user][j])) {
                    continue;
                }
                Derivative.Order memory order2 = roundPositions[userRoundIxs[user][j]];
                bytes32 optionHash2 = Derivative.hashOption(order2.option);

                if (order2.quantity == 0) {
                    continue;
                }

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
                /// @dev `nettedQuantity` is in quantity decimals 
                margin += (nettedQuantity * curMargin / (numNetted * 10**Derivative.QUANTITY_DECIMALS));
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
        bool satisfied = total >= 0;

        return (total, satisfied);
    }

    /**
     * @notice Add a new underlying
     * @dev For code reuse
     * @param underlying Enum for the underlying token
     * @param oracle Address for an oracle for an underlying
     * @param minQuantity Maximum notional for underlying
     */
    function newUnderlying(
        Derivative.Underlying underlying,
        address oracle,
        uint256 minQuantity
    ) internal {
        require(!isActiveUnderlying[underlying], "newUnderlying: underlying already active");
        require(minQuantity > 0, "newUnderlying: max notional must be > 0");

        // Set oracles for underlying
        oracles[underlying] = oracle;
        
        // Set maximum notional values
        minQuantityPerUnderlying[underlying] = minQuantity;

        // Compute strikes for underlying
        roundStrikes[underlying] = getStrikeMenu(underlying);

        // Mark as active
        isActiveUnderlying[underlying] = true;
    }

    /**
     * @notice Get maker and take fees
     * @dev Taker fees: min(0.06% of notional, 10% options prices)
     * @dev Maker fees: min(0.03% of notional, 10% of the options price)
     * @param order Object representing an order
     * @param isBuyerMaker True if buyer placed a limit order, else false if market order
     * @param isSellerMaker True if seller placed a limit orde,r else false if market order
     * @return buyerFee Fees for buyers
     * @return sellerFee Fees for sellers
     */
    function getFees(Derivative.Order memory order, bool isBuyerMaker, bool isSellerMaker) 
        internal
        view
        returns (uint256 buyerFee, uint256 sellerFee)
    {
        uint256 notional = getNotional(order);
        uint256 price = order.tradePrice;
        // min(0.06% of notional, 10% options prices)
        // min(0.0006 * notional, 0.1 * price)
        // min(6 * notional, 1000 * price) / 10000
        uint256 takerFee = BasicMath.min(6 * notional, 1000 * price) / 10**4;
        // min(0.03% of notional, 10% options prices)
        // min(0.0003 * notional, 0.1 * price)
        // min(3 * notional, 1000 * price) / 10000
        uint256 makerFee = BasicMath.min(3 * notional, 1000 * price) / 10**4;

        if (isBuyerMaker) {
            buyerFee = whitelist[order.buyer] ? 0 : makerFee;
        } else {
            buyerFee = takerFee;
        }
        if (isSellerMaker) {
            sellerFee = whitelist[order.seller] ? 0 : makerFee;
        } else {
            sellerFee = takerFee;
        }
    }

    /************************************************
     * Admin functions
     ***********************************************/

    /**
     * @notice Get balance for user as an admin
     * @dev Intended so callers can only get their own balance
     * @return balance Amount of USDC
     */
    function getBalanceOf(address user) external view onlyOwner returns (uint256) {
        return balances[user];
    }

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
    }

    /**
     * @notice Add an address to the whitelist
     * @dev Add as a list for gas efficiency
     * @param accounts Addresses to add as keepers
     */
    function addToWhitelist(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            require(!whitelist[accounts[i]], "addToWhitelist: already in whitelist");
            whitelist[accounts[i]] = true;
        }
    }

    /**
     * @notice Remove an address from the whitelist
     * @dev Add as a list for gas efficiency
     * @param accounts Addresses to remove as keepers
     */
    function removeFromWhitelist(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            require(whitelist[accounts[i]], "removeFromWhitelist: not in whitelist");
            whitelist[accounts[i]] = false;
        }
    }

    /**
     * @notice Sets insurance fund address
     */
    function setInsurance(address newInsurance) external onlyOwner {
        require(insurance != newInsurance, "setInsuranceFund: must be new address");
        insurance = newInsurance;
    }

    /**
     * @notice Sets fee recipient address
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(feeRecipient != newFeeRecipient, "setFeeRecipient: must be new fee recipient");
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Active an underlying so users can make trades on it
     * @param underlying Enum for the underlying token
     * @param oracle Address for an oracle for spot/mark/rate prices
     * @param minQuantity Minimum order quantity for underlying
     */
    function activateUnderlying(
        Derivative.Underlying underlying,
        address oracle,
        uint256 minQuantity
    ) 
        external
        onlyOwner
    {
        require(
            !isActiveUnderlying[underlying], 
            "activateUnderlying: underlying must not yet be active"
        );
        newUnderlying(underlying, oracle, minQuantity);

        // Emit event 
        emit NewUnderlyingEvent(msg.sender, underlying, oracle, minQuantity);
    }

    /**
     * @notice Set the oracle for an underlying token
     * @dev This function can also be used to replace or delete spotOracles
     * @param underlying Enum for the underlying token
     * @param oracle Address for an oracle for spot/mark/rate prices
     */
    function setOracle(Derivative.Underlying underlying, address oracle) 
        external
        onlyOwner 
    {
        require(isActiveUnderlying[underlying], "setOracle: underlying must already be active");
        // Existing underlying, overwrite oracle
        oracles[underlying] = oracle;
    }

    /**
     * @notice Set the maximum notional for an underlying token
     * @param underlying Enum for the underlying token
     * @param minQuantity Minimum order quantity for underlying
     */
    function setMinQuantity(Derivative.Underlying underlying, uint256 minQuantity) 
        external
        onlyOwner
    {
        require(isActiveUnderlying[underlying], "setMinQuantity: underlying must already be active");
        require(minQuantity > 0, "setMinQuantity: min quantity must be > 0");
        minQuantityPerUnderlying[underlying] = minQuantity;
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
     * @notice Set the maximum balance cap allowed in margin accounts
     */
    function setMaxBalanceCap(uint256 maxBalance) external onlyOwner {
        require(maxBalance > 0, "setMaxBalanceCap: must be > 0");
        maxBalanceCap = maxBalance;
        emit MaxBalanceCapEvent(msg.sender, maxBalance);
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
        for (uint256 i = 0; i < Derivative.NUM_UNDERLYING; i++) {
            Derivative.Underlying underlying = Derivative.Underlying(i);

            // Some underlying may be planned but not active
            if (isActiveUnderlying[underlying]) {
                // Update strike menu
                roundStrikes[underlying] = getStrikeMenu(underlying);
            }
        }
        
        // Free up memory for the round options
        delete roundPositions;

        // Clear positions for the user. It is up to the caller to maintain and provide 
        // a correct list of user addresses, otherwise memory will not be freed properly
        for (uint256 i = 0; i < roundUsers.length; i++) {
            delete userRoundIxs[roundUsers[i]];
            delete userRoundIxsIsActive[roundUsers[i]];
            userRoundCount[roundUsers[i]] = 0;
        }
    }

    /**
     * @notice Record a position (matched order) from off-chain orderbook
     * @dev Saves the order to storage variables. Only the keeper can call this function
     * @dev An oracle must exist for the underlying position for it to be added
     * @dev This function does not explicitly check that the same position is not added
     * twice. This is hard to do efficiently on-chain and will be done off-chain
     */
    function addPosition(Derivative.PositionParams calldata params)
        external
        nonReentrant
        onlyKeeper 
    {
        require(params.tradePrice > 0, "addPosition: tradePrice must be > 0");
        require(params.quantity > 0, "addPosition: quantity must be > 0");
        require(oracles[params.underlying] != address(0), "addPosition: no oracle for underlying");
        require(params.buyer != params.seller, "addPosition: cannot enter a position with yourself");

        // USDC decimals will be used for spot/strike calculations
        uint8 decimals = getCollateralDecimals();

        // Get strike at chosen level from current round strikes
        uint256 strike = roundStrikes[params.underlying][uint8(params.strikeLevel)];
        require(strike > 0, "addPosition: no strike for underlying");

        // Build an order object
        Derivative.Order memory order = Derivative.Order(
            params.buyer,
            params.seller,
            params.tradePrice,
            params.quantity,
            Derivative.Option(
                params.isCall,
                params.strikeLevel,
                strike,
                activeExpiry,
                params.underlying,
                decimals
            )
        );

        // Check we are not below minimum notional
        require(
            order.quantity >= minQuantityPerUnderlying[params.underlying],
            "addPosition: below min quantity"
        );

        // Charge fees
        (uint256 buyerFee, uint256 sellerFee) = getFees(
            order,
            params.isBuyerMaker,
            params.isSellerMaker
        );

        // Check that buyers and sellers have enough to pay fees
        require(balances[order.buyer] >= buyerFee, "addPosition: buyer cannot pay fees");
        require(balances[order.seller] >= sellerFee, "addPosition: seller cannot pay fees");

        // Make fee transfers
        balances[order.buyer] -= buyerFee;
        balances[order.seller] -= sellerFee;
        balances[feeRecipient] += (buyerFee + sellerFee);

        // Save position to mapping by expiry
        roundPositions.push(order);

        // Get the index for the newly added value
        uint16 orderIndex = uint16(roundPositions.length - 1);

        // Sanity checks for buyer/seller positions
        require(userRoundIxs[order.buyer].length == userRoundIxsIsActive[order.buyer].length);
        require(userRoundIxs[order.seller].length == userRoundIxsIsActive[order.seller].length);
        require(userRoundIxs[order.buyer].length >= userRoundCount[order.buyer]);
        require(userRoundIxs[order.seller].length >= userRoundCount[order.seller]);

        // Save that the buyer/seller have this position
        userRoundIxs[order.buyer].push(orderIndex);
        userRoundIxs[order.seller].push(orderIndex);
        userRoundIxsIsActive[order.buyer].push(true);
        userRoundIxsIsActive[order.seller].push(true);
        userRoundCount[order.buyer]++;
        userRoundCount[order.seller]++;

        // Check margin for buyer and seller
        (, bool checkBuyerMargin) = checkMargin(order.buyer, false);
        (, bool checkSellerMargin) = checkMargin(order.seller, false);

        require(checkBuyerMargin, "addPosition: buyer failed margin check");
        require(checkSellerMargin, "addPosition: seller failed margin check");

        // Emit event 
        emit RecordPositionEvent(
            params.tradePrice,
            params.quantity,
            params.isCall,
            params.underlying,
            params.strikeLevel,
            activeExpiry
        );
    }
}
