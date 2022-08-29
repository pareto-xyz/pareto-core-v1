// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IERC20.sol";
import "./interfaces/IOracle.sol";
import "./libraries/SafeERC20.sol";
import "./libraries/Derivative.sol";
import "./libraries/MarginMath.sol";
import "./libraries/DateMath.sol";
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

    /// @notice The current active expiry
    /// @dev This assumes all underlying has only one expiry.
    uint256 private activeExpiry;

    /// @notice If the contract is paused or not
    bool private isPaused;

    /// @notice Store a list of underlyings
    address[] private underlyings;

    /// @notice Stores addresses for oracles of each underlying
    mapping(address => address) private oracles;

    /// @notice List of keepers who can add positions
    mapping(address => bool) private keepers;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Store all positions for the current round in the map
    Derivative.Order[] private roundPositions;

    /// @notice Stores map from user address to index into the current round positions
    mapping(address => uint16[]) private userRoundIxs;

    /// @notice Store volatility smiles per hash(expiry,underlying)
    mapping(bytes32 => Derivative.VolatilitySmile) private volSmiles;

    /************************************************
     * Initialization and Upgradeability
     ***********************************************/

    /**
     * @param usdc_ Address for the USDC token (e.g. cash)
     * @param insurance_ Address for the insurance fund
     * @param underlying_ Address of underlying token to support at deployment
     * @param oracle_ Address of oracle for the underlying
     */
    function initialize(
        address usdc_,
        address insurance_,
        address underlying_,
        address oracle_
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

        // Initialize state variables
        curRound = 1;
        activeExpiry = DateMath.getNextExpiry(block.timestamp);
        newUnderlying(underlying_, oracle_);
        maxInsuredPerc = 10;
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
     * @param paused Is the contract paused?
     */
    event MaxInsuredPercEvent(address indexed owner, uint256 perc);

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
        IERC20(usdc).transferFrom(msg.sender, address(this), amount);

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
    function checkMargin(address user) public view returns (uint256, bool) {
        uint256 balance = balances[user];
        uint256 maintainence = getMaintainenceMargin(user);

        // Compute the unrealized PnL (actually this is only unrealized losses)
        (uint256 pnl, bool pnlIsNeg) = getPayoff(user, true);

        // Compute `balance + PnL`
        (uint256 bpnl, bool bpnlIsNeg) = NegativeMath.add(balance, false, pnl, pnlIsNeg);

        // Compute `balance + PnL - MM`
        (uint256 diff, bool diffIsNeg) = NegativeMath.add(bpnl, bpnlIsNeg, maintainence, true);

        // if diff > 0, then satisfied = true
        return (diff, !diffIsNeg);
    }

    /**
     * @notice Performs settlement for positions of the current round. Transfers amount paid by ower
     * to this contract. Adds amount owed to each user to their margin account
     * @dev Anyone can call this though the burden falls on keepers
     * @dev This must be called before `rollover` or else positions are lost
     */
    function settle() external nonReentrant {
        require(activeExpiry <= block.timestamp, "settle: expiry must be in the past");

        for (uint256 j = 0; j < roundPositions.length; j++) {
            Derivative.Order memory order = roundPositions[j];
            uint256 spot = getSpot(order.option.underlying);

            // Compute buyer payoff; seller payoff is exact opposite
            (uint256 buyerPayoff, bool buyerIsNeg) = MarginMath.getPayoff(order.buyer, spot, order);

            // Add together the payoff and the premium
            (uint256 netPayoff, bool netIsNeg) = NegativeMath.add(buyerPayoff, buyerIsNeg, order.tradePrice, true);

            address ower = netIsNeg ? order.buyer : order.seller;
            address owee = netIsNeg ? order.seller : order.buyer;

            if (balances[ower] >= netPayoff) {
                // If the ower has enough in the margin account, then make shift
                balances[ower] -= netPayoff;
                balances[owee] += netPayoff;
            } else {
                // TODO: can this be frontrun by a withdrawal?
                // Make up the difference in the insurance fund
                uint256 partialAmount = balances[ower];
                uint256 insuredAmount = netPayoff - partialAmount;
                uint256 maxInsuredAmount = netPayoff * maxInsuredPerc / 100;

                // We cannot payback for more than the max insured amount
                if (insuredAmount > maxInsuredAmount) {
                    insuredAmount = maxInsuredAmount;
                }

                if (balances[insurance] >= insuredAmount) {
                    balances[owee] += netPayoff;
                    balances[insurance] -= insuredAmount;
                    balances[ower] = 0;
                } else {
                    // Do the best we can
                    balances[owee] += partialAmount;
                    balances[ower] = 0;
                }
            }
        }

        // Free up memory for the round
        delete roundPositions;

        // Emit event
        emit SettlementEvent(msg.sender, curRound, roundPositions.length);
    }

    /**
     * @notice Performs partial liquidation on user. Liquidates the user's 
     * positions one by one until margin check succeeds. User is penalized with the 35% of MM
     * which are split between liquidator and insurance fund
     * @dev Any EOA can call this on any EOA
     * @param user Address of the user to liquidate
     * @return fullyLiquidated if true, user is fully liquidated
     */
    function liquidate(address user) external nonReentrant returns (bool fullyLiquidated) {
        (, bool satisfied) = checkMargin(user);
        require(!satisfied, "liquidate: user passes margin check");
        require(userRoundIxs[user].length > 0, "liquidate: user has no positions");

        address liquidator = msg.sender;

        // Default is to assume user can be fully liquidated
        fullyLiquidated = true;

        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            uint256 index = userRoundIxs[user][i];
            Derivative.Order storage order = roundPositions[index];

            // Compute mark price for option
            uint256 spot = getSpot(order.option.underlying);
            bytes32 smileHash = Derivative.hashForSmile(order.option.underlying, order.option.expiry);
            uint256 markPrice = MarginMath.getMarkPriceFromOption(spot, order.option, volSmiles[smileHash]);

            // Liquidator must pay user mark price
            if (balances[liquidator] < markPrice) {
                fullyLiquidated = false;
                break;
            }
            balances[liquidator] -= markPrice;
            balances[user] += markPrice;

            // Add order to new user's positions
            userRoundIxs[liquidator].push(uint16(index));

            // Check liquidator can handle the new position and the payment to liquidatee
            (, bool liquidatorOk) = checkMargin(liquidator);

            if (!liquidatorOk) {
                // If the liquidator is now below margin, undo changes
                /// @dev We don't just revert to allow liquidators to take one of many positions
                delete userRoundIxs[liquidator][userRoundIxs[liquidator].length - 1];

                // Undo adding the new position (last index)
                fullyLiquidated = false;

                // Undo changes to balances
                balances[liquidator] += markPrice;
                balances[user] -= markPrice;
                break;
            }

            // If we have reached here, then the liquidator is able to inherit position
            // Delete position, dropping it from current user
            deleteUserPosition(user, index);

            // Ovewrite user's position with liquidator
            bool isSeller;
            if (order.buyer == user) {
                order.buyer = liquidator;
            } else {
                isSeller = true;
                order.seller = liquidator;
            }

            // Now that user no longer owns position, we reward liquidator using MM from this 
            // position (which cannot push user back below margin even if 100% of MM is gone).
            // 25% of MM -> liquidator; 10% of MM -> insurance fund
            uint256 margin = MarginMath.getMaintainenceMargin(spot, !isSeller, order.option, volSmiles[smileHash]);
            balances[user] -= (margin * 35 / 100);
            balances[liquidator] += (margin * 25 / 100);
            balances[insurance] += (margin / 10);

            // Check if the user is no longer below margin, if so quit
            (, satisfied) = checkMargin(user);
            if (satisfied) {
                break;
            }
        }
        return fullyLiquidated;
    }

    /************************************************
     * Internal functions
     ***********************************************/

    /**
     * @notice Read latest oracle price data
     * @param underlying Address for the underlying token
     * @return answer Latest price for underlying
     */
    function getSpot(address underlying) internal view returns (uint256) {
        require(oracles[underlying] != address(0), "getSpot: missing oracle");
        (,int256 answer,,,) = IOracle(oracles[underlying]).latestRoundData();
        // TODO: check that this conversion is okay
        return uint256(answer);
    }

    /**
     * @notice Compute the initial margin for all positions owned by user
     * @dev The initial margin is equal to the sum of initial margins for all positions
     * @param user Address to compute IM for
     * @param onlyLoss Do not count unrealized profits from open positions
     * @return payoff The payoff summed for all positions
     * @return isNegative True if the payoff is less than 0, else false
     */
    function getPayoff(address user, bool onlyLoss)
        internal
        view
        returns (uint256, bool) 
    {
        if (userRoundIxs[user].length == 0) {
            return (0, false);
        }

        uint256 payoff;
        bool isNegative;

        for (uint256 i = 0; i < userRoundIxs[user].length; i++) {
            // Fetch the order in the position
            Derivative.Order memory order = roundPositions[userRoundIxs[user][i]];

            // Fetch the underlying token for the option
            uint256 spot = getSpot(order.option.underlying);

            // Compute the payoff at this price
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
     * @param user Address to compute MM for
     * @return margin The maintainence margin summed for all positions
     */
    function getMaintainenceMargin(address user) internal view returns (uint256) {
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
            bytes32 smileHash = Derivative.hashForSmile(option.underlying, option.expiry);

            // In the case of multiple positions for the same option, 
            // compute the total amount the user wishes to buy and sell
            uint256 nettedBuy = 0;
            uint256 nettedSell = 0;

            require(
                (user == order.buyer) || (user == order.seller),
                "getInitialMargin: trader must be buyer or seller"
            );

            // Check if the user is a buyer or seller for `order`
            if (user == order.buyer) {
                nettedBuy += order.quantity;
            } else {
                nettedSell += order.quantity;
            }

            // Nested loop to find the total quantity of this option.
            // Consider case with multiple positions with same order
            for (uint256 j = i + 1; j < userRoundIxs[user].length; j++) {
                Derivative.Order memory order2 = roundPositions[userRoundIxs[user][j]];
                bytes32 optionHash2 = Derivative.hashOption(order2.option);

                if (optionHash == optionHash2) {
                    if (user == order2.buyer) {
                        nettedBuy += order2.quantity;
                    } else {
                        nettedSell += order2.quantity;
                    }
                }
            }

            // Compute total buy - total sell
            (uint256 nettedQuantity, bool isSeller) = NegativeMath.add(nettedBuy, false, nettedSell, true);

            if (nettedQuantity > 0) {
                // Fetch smile and check it is valid
                Derivative.VolatilitySmile memory smile = volSmiles[smileHash];
                require(smile.exists_, "getMaintainenceMargin: found unknown option");

                // Fetch spot price
                uint256 spot = getSpot(option.underlying);

                // Compute maintainence margin for option
                uint256 maintainence = MarginMath.getMaintainenceMargin(spot, !isSeller, option, smile);

                // Build margin using `nettedQuantity`
                margin += (nettedQuantity * maintainence);
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
     * @return diff |AB - amount + UP - MM|, always positive
     * @return satisfied True if non-negative, else false
     */
    function checkMarginOnWithdrawal(address user, uint256 amount) 
        internal
        view
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

    /**
     * @notice Add a new underlying
     * @dev For code reuse
     * @param underlying Address for an underlying token
     * @param oracleFeed Address for an oracle price feed contract
     */
    function newUnderlying(address underlying, address oracleFeed) internal {
        underlyings.push(underlying);
        bytes32 smileHash = Derivative.hashForSmile(underlying, activeExpiry);
        volSmiles[smileHash] = Derivative.createSmile();
        oracles[underlying] = oracleFeed;
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
     * @dev This function can also be used to replace or delete oracles
     * @param underlying Address for an underlying token
     * @param oracleFeed Address for an oracle price feed contract
     */
    function setOracle(address underlying, address oracleFeed) external onlyOwner {
        if (oracles[underlying] == address(0)) {
            // Brand new oracle
            newUnderlying(underlying, oracleFeed);
        } else {
            // Existing underlying, overwrite oracle
            oracles[underlying] = oracleFeed;
        }
    }

    /**
     * @notice Set the maximum amount to be insured
     */
    function setMaxInsuredPerc(uint256 perc) external onlyOwner {
        require(perc <= 100, "setMaxInsuredPerc: must be < 100");
        maxInsuredPerc = perc;
        emit MaxInsuredPercEvent(msg.sender, perc);
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

        // Update the active expiry
        uint256 lastExpiry = activeExpiry;
        activeExpiry = DateMath.getNextExpiry(lastExpiry);

        // Update round
        curRound += 1;

        // Update smiles for each underlying token
        for (uint256 i = 0; i < underlyings.length; i++) {
            // Compute the new hash
            bytes32 smileHash = Derivative.hashForSmile(underlyings[i], activeExpiry);

            if (activeExpiry > 0) {
                // New round and options are being overwritten. In these cases, 
                // we initialize the smile from last round's smile
                bytes32 lastSmileHash = Derivative.hashForSmile(underlyings[i], lastExpiry);
                volSmiles[smileHash] = volSmiles[lastSmileHash];

                // No longer need last round's smile
                delete volSmiles[lastSmileHash];
            } else {
                // Either the first time ever or new underlying.
                // Here, create a new uniform (uninformed) smile 
                volSmiles[smileHash] = Derivative.createSmile();
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
        Derivative.OptionType optionType,
        uint256 strike,
        address underlying
    ) 
        external
        nonReentrant
        onlyKeeper 
    {
        require(tradePrice > 0, "addPosition: tradePrice must be > 0");
        require(quantity > 0, "addPosition: quantity must be > 0");
        require(underlying != address(0), "addPosition: underlying is empty");
        require(strike > 0, "addPosition: strike must be positive");
        require(oracles[underlying] != address(0), "addPosition: no oracle for underlying");

        uint8 decimals = IERC20(underlying).decimals();
        Derivative.Order memory order = Derivative.Order(
            buyer,
            seller,
            tradePrice,
            quantity,
            Derivative.Option(optionType, strike, activeExpiry, underlying, decimals)
        );

        // Hash together the underlying and expiry
        bytes32 smileHash = Derivative.hashForSmile(underlying, activeExpiry);
        require(volSmiles[smileHash].exists_, "addPosition: missing smile");

        // Update the smile with order information
        Derivative.updateSmile(getSpot(underlying), order, volSmiles[smileHash]);

        // Save position to mapping by expiry
        roundPositions.push(order);

        // Get the index for the newly added value
        uint16 orderIndex = uint16(roundPositions.length - 1);

        // Save that the buyer/seller have this position
        userRoundIxs[buyer].push(orderIndex);
        userRoundIxs[seller].push(orderIndex);

        // Check margin for buyer and seller
        (, bool checkBuyerMargin) = checkMargin(buyer);
        (, bool checkSellerMargin) = checkMargin(seller);

        require(checkBuyerMargin, "addPosition: buyer failed margin check");
        require(checkSellerMargin, "addPosition: seller failed margin check");

        // Emit event 
        emit RecordPositionEvent(
            tradePrice,
            quantity,
            optionType,
            underlying,
            strike,
            activeExpiry
        );
    }
}
