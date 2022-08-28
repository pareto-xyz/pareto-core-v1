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
     * Constants and State
     ***********************************************/

    /// @notice Stores the address for USDC
    address public usdc;

    /// @notice Stores addresses for oracles of each underlying
    mapping(address => address) private oracles;

    /// @notice List of keepers who can add positions
    mapping(address => bool) private keepers;

    /// @notice Stores the amount of "cash" owned by users
    mapping(address => uint256) private balances;

    /// @notice Stores hashes of open positions for every user
    mapping(address => bytes32[]) private orderPositions;

    /// @notice Stores hash to derivative order
    mapping(bytes32 => Derivative.Order) private orderHashs;

    /// @notice Store volatility smiles per expiry & underlying
    mapping(bytes32 => Derivative.VolatilitySmile) private volSmiles;

    /// @notice Store the smile hash to expiry
    mapping(address => uint256) private orderExpiries;

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

        // Pull resources from sender to this contract
        IERC20(usdc).transferFrom(msg.sender, address(this), amount);

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
     * @notice Settles all expired positions using current block timestamp
     * @dev This will do netting to reduce the number of transactions
     * @dev Anyone can call this though the burden calls on keepers
     */
    function settleBulk() external nonReentrant {
        
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
        // NOTE: check that this conversion is okay
        return uint256(answer);
    }

    /**
     * @notice Compute the initial margin for all positions owned by user
     * @dev The initial margin is equal to the sum of initial margins for all positions
     * @dev TODO Support P&L netting
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
        bytes32[] memory positions = orderPositions[user];
        if (positions.length == 0) {
            return (0, false);
        }

        uint256 payoff;
        bool isNegative;

        for (uint256 i = 0; i < positions.length; i++) {
            // Fetch the order in the position
            Derivative.Order memory order = orderHashs[positions[i]];

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
     * @dev TODO Support P&L netting
     * @param user Address to compute MM for
     * @return margin The maintainence margin summed for all positions
     */
    function getMaintainenceMargin(address user) internal view returns (uint256) {
        bytes32[] memory positions = orderPositions[user];
        if (positions.length == 0) {
            return 0;
        }

        // Track the total margin 
        uint256 margin;

        // Loop through open positions by user
        for (uint256 i = 0; i < positions.length; i++) {
            Derivative.Order memory order = orderHashs[positions[i]];
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
            for (uint256 j = i + 1; j < positions.length; j++) {
                Derivative.Order memory order2 = orderHashs[positions[j]];
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
     * @notice Add oracle for an underlying
     * @param underlying Address for an underlying token
     * @param oracleFeed Address for an oracle price feed contract
     */
    function addOracle(address underlying, address oracleFeed) external onlyKeeper {
        oracles[underlying] = oracleFeed;
    }

    /**
     * @notice Remove oracle for an underlying
     * @param underlying Address for an underlying token
     */
    function removeOracle(address underlying) external onlyKeeper {
        delete oracles[underlying];
    }

    /**
     * @notice Record a position (matched order) from off-chain orderbook
     * @dev Saves the order to storage variables. Only the owner can call
     * this function
     * @dev An oracle must exist for the underlying position for it to be added
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
        require(oracles[underlying] != address(0), "addPosition: no oracle for underlying");
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
            Derivative.Option(optionType, strike, expiry, underlying, decimals)
        );
        bytes32 orderHash = Derivative.hashOrder(order);
        bytes32 smileHash = Derivative.hashForSmile(underlying, expiry);

        require(
            bytes(orderHashs[orderHash].orderId).length == 0,
            "addPosition: order already exists"
        );

        if (volSmiles[smileHash].exists_) {
            /**
             * Case 1: If this is an existing smile, then update it
             * @dev Smiles are unique to the option not the order
             */
            uint256 spot = getSpot(underlying);
            Derivative.updateSmile(spot, order, volSmiles[smileHash]);
        } else {
            uint256 lastExpiry = orderExpiries[underlying];

            // It must be that the last expiry is in the past
            require(lastExpiry <= block.timestamp);

            if (lastExpiry > 0) {
                /**
                 * Case 2: hash doesn't exist because it's a new round and options
                 * are being overwritten. In these cases, we initialize the smile
                 * from last round's smile!
                 */
                bytes32 lastSmileHash = Derivative.hashForSmile(underlying, lastExpiry);
                volSmiles[smileHash] = volSmiles[lastSmileHash];
            } else {
                /**
                 * Case 3: Either the first time ever or new underlying.
                 * Here, create a new uniform (uninformed) smile 
                 */
                volSmiles[smileHash] = Derivative.createSmile();
            }

            // Set underlying => expiry
            orderExpiries[underlying] = order.option.expiry;
        }

        // Save the order object
        orderHashs[orderHash] = order;

        // Save that the buyer/seller have this position
        orderPositions[buyer].push(orderHash);
        orderPositions[seller].push(orderHash);

        // Emit event 
        emit RecordPositionEvent(
            orderId,
            tradePrice,
            quantity,
            optionType,
            underlying,
            strike,
            expiry
        );
    }
}
