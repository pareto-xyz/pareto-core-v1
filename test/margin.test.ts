import { ethers, upgrades } from "hardhat";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getFixedGasSigners } from "./utils/helpers";

let usdc: Contract;
let derivative: Contract;
let paretoMargin: Contract;
let spotFeed: Contract;
let markFeed: Contract;
let deployer: SignerWithAddress;
let keeper: SignerWithAddress;
let buyer: SignerWithAddress;
let seller: SignerWithAddress;
let insurance: SignerWithAddress;
let feeRecipient: SignerWithAddress;

const ONEUSDC = toBn("1", 18);

/**
 * Function to compute fees from order information
 * @param quantity Number of units in contract
 * @param tradePrice Price of the contract
 * @returns Array of length two: the taker and maker fees in BigNumbers
 */
async function getFees(
  quantity: number,
  tradePrice: number,
): Promise<[BigNumber, BigNumber]> {
  const [,spotBn,] = await spotFeed.latestRoundData();
  const spot = parseFloat(fromBn(spotBn, 18));
  const makerFee = Math.min(0.0003 * spot * quantity, 0.1 * tradePrice);
  const takerFee = Math.min(0.0006 * spot * quantity, 0.1 * tradePrice);
  const makerFeeBn = toBn(makerFee.toString(), 18);
  const takerFeeBn = toBn(takerFee.toString(), 18);
  return [takerFeeBn, makerFeeBn];
}

describe("ParetoMargin Contract", () => {
  beforeEach(async () => {
    const wallets = await getFixedGasSigners(10000000);
    [deployer, keeper, buyer, seller, insurance, feeRecipient] = wallets;
  
    // Deploy a MockERC20 contract to mimic USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    usdc = await MockERC20.deploy();

    // Mint 1M USDC for deployer, keeper, buyer and seller
    await usdc.mint(deployer.address, ONEUSDC.mul(1e6));
    await usdc.mint(keeper.address, ONEUSDC.mul(1e6));
    await usdc.mint(buyer.address, ONEUSDC.mul(1e6));
    await usdc.mint(seller.address, ONEUSDC.mul(1e6));
    await usdc.mint(insurance.address, ONEUSDC.mul(1e6));

    // Deploy a spot feed
    const SpotFeedFactory = await ethers.getContractFactory("SpotFeed");

    // Create spot oracle, assign keeper as admin
    spotFeed = await SpotFeedFactory.deploy("ETH spot", [keeper.address]);
    await spotFeed.deployed();

    // Set spot price to 1500 USDC, with 18 decimals
    await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(1500));

    // Create mark price oracle, assign keeper as admin
    const MarkFeedFactory = await ethers.getContractFactory("MarkFeed");
    markFeed = await MarkFeedFactory.deploy("ETH mark", [keeper.address]);
    await markFeed.deployed();

    // Set mark price to (spot / 10) all around
    var callPrices = [];
    var putPrices = [];
    for (var i = 0; i < 11; i++) {
      callPrices.push(ONEUSDC.mul(150));
      putPrices.push(ONEUSDC.mul(150));
    }
    await markFeed.connect(deployer).setLatestPrices(callPrices, putPrices);

    // Deploy upgradeable Pareto margin contract
    const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
    paretoMargin = await upgrades.deployProxy(
      ParetoMargin,
      [
        usdc.address,
        insurance.address,
        feeRecipient.address,
        0,
        spotFeed.address,
        markFeed.address,
        toBn("0.5", 4),
      ]
    );
    await paretoMargin.deployed();

    // Add keeper as a keeper
    await paretoMargin.connect(deployer).addKeepers([keeper.address]);

    // Insurance will deposit all their USDC into contract
    await usdc.connect(insurance).approve(paretoMargin.address, ONEUSDC.mul(1e6));
    await paretoMargin.connect(insurance).deposit(ONEUSDC.mul(1e6));

    // Useful for functions & objects
    const DerivativeFactory = await ethers.getContractFactory("TestDerivative");
    derivative = await DerivativeFactory.deploy();
    await derivative.deployed();
  });

  /****************************************
   * Contract construction
   ****************************************/  
  describe("Test construction", () => {
    it("Can construct", async () => {
      expect(paretoMargin.address).to.not.be.equal("");
    });
    it("Correct usdc address", async () => {
      expect(await paretoMargin.usdc()).to.be.equal(usdc.address);
    });
    it("Correct insurance address", async () => {
      expect(await paretoMargin.insurance()).to.be.equal(insurance.address);
    });
    it("Correct fee recipient address", async () => {
      expect(await paretoMargin.feeRecipient()).to.be.equal(feeRecipient.address);
    });
    it("Correct max balance cap", async () => {
      expect(await paretoMargin.maxBalanceCap()).to.be.equal(toBn("2000", 18));
    });
    it("Correct max insured percentage", async () => {
      expect(await paretoMargin.maxInsuredPerc()).to.be.equal(toBn("0.5", 4));
    });
    it("Correct min margin percentage", async () => {
      expect(await paretoMargin.minMarginPerc()).to.be.equal(toBn("0.01", 4));
    });
    it("Correct default round counter", async () => {
      expect(await paretoMargin.curRound()).to.be.equal(1);
    });
    it("Correct default max % for insurance", async () => {
      expect(fromBn(await paretoMargin.maxInsuredPerc(), 4)).to.be.equal("0.5");
    });
    it("Correct default min % for margin", async () => {
      expect(fromBn(await paretoMargin.minMarginPerc(), 4)).to.be.equal("0.01");
    });
  });

  /****************************************
   * Upgradeability
   ****************************************/  
  describe("Upgradeability", () => {
    it("Can upgrade", async () => {
      const ParetoMarginV2 = await ethers.getContractFactory("ParetoV1Margin", deployer);
      await upgrades.upgradeProxy(paretoMargin.address, ParetoMarginV2);
    });
    it("Non-owner cannot upgrade", async () => {
      const ParetoMarginV2 = await ethers.getContractFactory("ParetoV1Margin", keeper);
      await expect(upgrades.upgradeProxy(paretoMargin.address, ParetoMarginV2))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  /****************************************
   * Depositing
   ****************************************/  
  describe("Depositing USDC", () => {
    it("Owner can deposit", async () => {
      await usdc.connect(deployer).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(deployer).deposit(ONEUSDC);
    });
    it("Keeper can deposit", async () => {
      await usdc.connect(keeper).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(keeper).deposit(ONEUSDC);
    });
    it("User can deposit", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(buyer).deposit(ONEUSDC);
    });
    it("Emits an event", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await expect(paretoMargin.connect(buyer).deposit(ONEUSDC))
        .to.emit(paretoMargin, "DepositEvent")
        .withArgs(buyer.address, ONEUSDC);
    });
    it("USDC is properly transferred", async () => {
      const marginPre = await usdc.balanceOf(paretoMargin.address);
      const userPre = await usdc.balanceOf(buyer.address);
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(buyer).deposit(ONEUSDC);
      const marginPost = await usdc.balanceOf(paretoMargin.address);
      const userPost = await usdc.balanceOf(buyer.address);
      expect(marginPost.sub(marginPre)).to.be.equal(ONEUSDC);
      expect(userPre.sub(userPost)).to.be.equal(ONEUSDC);
    });
    it("Cannot deposit 0 USDC", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await expect(paretoMargin.connect(buyer).deposit(0))
        .to.be.revertedWith("deposit: `amount` must be > 0");
    });
    it("Cannot deposit more than max cap", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(2500));
      await expect(paretoMargin.connect(buyer).deposit(ONEUSDC.mul(2500)))
        .to.be.revertedWith("deposit: exceeds maximum");
    })
    it("Cannot deposit twice to exceed max cap", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(2500));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1500));
      await expect(paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000)))
        .to.be.revertedWith("deposit: exceeds maximum");
    });
  });

  /****************************************
   * Checking balance
   ****************************************/  
  describe("Checking balance", () => {
    it("Default balance for user is 0", async () => {
      expect(await paretoMargin.connect(buyer).getBalance()).to.be.equal("0");
    });
    it("Default balance for insurance is 1M", async () => {
      expect(await paretoMargin.connect(insurance).getBalance()).to.be.equal(toBn("1000000", 18));
    });
    it("Deposit reflected in balance", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
      expect(await paretoMargin.connect(buyer).getBalance()).to.be.equal("1");
    });
    it("Owner can check balance for anyone", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
      expect(await paretoMargin.connect(deployer).getBalanceOf(buyer.address)).to.be.equal("1");
    });
    it("EOA cannot check balance for another EOA", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
      await expect(paretoMargin.connect(seller).getBalanceOf(buyer.address))
        .to.be.revertedWith("Ownable: caller is not the owner")
    });
  });

  /****************************************
   * Adding a new position
   ****************************************/  
  describe("Adding a position", () => {
    let expiry: Number; 
    beforeEach(async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      expiry = await paretoMargin.activeExpiry();
    });
    it("Owner can add a new position", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
    });
    it("Keeper can add a new position", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(keeper).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
    });
    it("User cannot add a new position", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(buyer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          toBn("1", 4),
          true,
          7,
          0,
        )
      ).to.be.revertedWith("onlyKeeper: caller is not a keeper");
    });
    it("Emits event when adding a position", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(keeper).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          toBn("1", 4),
          true,
          7,
          0,
        )
      )
        .to.emit(paretoMargin, "RecordPositionEvent")
        .withArgs(ONEUSDC, toBn("1", 4), true, 0, 7, expiry);
    });
    it("Buyer passes margin check after position added", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      const [, satisfied] = await paretoMargin.checkMargin(buyer.address, false);
      expect(satisfied).to.be.true;
    });
    it("Seller passes margin check after position added", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      const [, satisfied] = await paretoMargin.checkMargin(seller.address, false);
      expect(satisfied).to.be.true;
    });
    it("Can add position for brand new underlying", async () => {
      // Deploy new oracle contracts
      const SpotFeedFactory = await ethers.getContractFactory("SpotFeed");
      const newSpotFeed = await SpotFeedFactory.deploy("BTC spot", [keeper.address]);
      await newSpotFeed.deployed();

      const MarkFeedFactory = await ethers.getContractFactory("MarkFeed");
      const newMarkFeed = await MarkFeedFactory.deploy("BTC mark", [keeper.address]);
      newMarkFeed.deployed();

      // Set spot price
      await newSpotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(1500));

      // Set mark price
      var callPrices = [];
      var putPrices = [];
      for (var i = 0; i < 11; i++) {
        callPrices.push(ONEUSDC.mul(150));
        putPrices.push(ONEUSDC.mul(150));
      }
      await newMarkFeed.connect(deployer).setLatestPrices(callPrices, putPrices);
      
      // Making a new underlying
      await paretoMargin.connect(deployer).activateUnderlying(
        1, 
        newSpotFeed.address, 
        newMarkFeed.address,
        toBn("1", 3),
      );

      // Now make a new position for said underlying
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        1,
      );
    });
    it("Cannot add position under the minimum quantity", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          toBn("0.1", 4),
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: below min quantity");
    });
    it("Cannot add position with trade price 0", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          0,
          toBn("1", 4),
          true,
          7,
          0
        )
      ).to.be.revertedWith("addPosition: tradePrice must be > 0");
    });
    it("Cannot add position with quantity 0", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          0,
          true,
          7,
          0
        )
      ).to.be.revertedWith("addPosition: quantity must be > 0");
    });
    it("Cannot add position if buyer below margin", async () => {
      // seller puts in 1k usdc into margin account but buyer does not
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      // buyer needs to put in minimum amount for fees
      const [takerFee,] = await getFees(1, 1);
      await paretoMargin.connect(buyer).deposit(takerFee);

      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          toBn("1", 4),
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: buyer failed margin check");
    });
    it("Cannot add position if seller below margin", async () => {
      // buyer puts in 1k usdc into margin account but seller does not
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      const [,makerFee] = await getFees(1, 1);
      await paretoMargin.connect(seller).deposit(makerFee);
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          toBn("1", 4),
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: seller failed margin check");
    });
    it("Check opposite orders cancel", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Buy a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      // Sell the call position
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      const [buyerMargin,] = await paretoMargin.checkMargin(buyer.address, false);
      const [sellerMargin,] = await paretoMargin.checkMargin(seller.address, false);

      // Get balance for the two individuals
      const buyerBalance = await paretoMargin.connect(buyer).getBalance();
      const sellerBalance = await paretoMargin.connect(seller).getBalance();

      // Both should be netted to be zero since orders cancel
      expect(buyerMargin).to.be.equal(buyerBalance);
      expect(sellerMargin).to.be.equal(sellerBalance);
    });
    it("Check opposite orders of different strikes do not cancel", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Buy a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      // Sell the call position
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        6,
        0,
      );
      const [buyerMargin,] = await paretoMargin.checkMargin(buyer.address, false);
      const [sellerMargin,] = await paretoMargin.checkMargin(seller.address, false);
      
      // Get balance for the two individuals
      const buyerBalance = await paretoMargin.connect(buyer).getBalance();
      const sellerBalance = await paretoMargin.connect(seller).getBalance();

      // Margin should be less for both
      expect(buyerMargin).to.be.lessThan(buyerBalance);
      expect(sellerMargin).to.be.lessThan(sellerBalance);
    });
    it("Check opposite orders of put & call do not cancel", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));      

      // Buy a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      // Sell the put position
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        toBn("1", 4),
        false,
        7,
        0,
      );
      const [buyerMargin,] = await paretoMargin.checkMargin(buyer.address, false);
      const [sellerMargin,] = await paretoMargin.checkMargin(seller.address, false);
      
      // Get balance for the two individuals
      const buyerBalance = await paretoMargin.connect(buyer).getBalance();
      const sellerBalance = await paretoMargin.connect(seller).getBalance();

      // Margin should be less for both
      expect(buyerMargin).to.be.lessThan(buyerBalance);
      expect(sellerMargin).to.be.lessThan(sellerBalance);
    });
    it("Check opposite orders of different quantities partially cancel", async () => {
      await paretoMargin.connect(deployer).setMaxBalanceCap(ONEUSDC.mul(5000));

      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(5000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(5000));

      // Use deployer and keeper as two other actors
      await usdc.connect(deployer).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await usdc.connect(keeper).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await paretoMargin.connect(deployer).deposit(ONEUSDC.mul(5000));
      await paretoMargin.connect(keeper).deposit(ONEUSDC.mul(5000));

      const [takerFees5, makerFees5] = await getFees(5, 1);
      const [takerFees2, makerFees2] = await getFees(2, 1);
      const [takerFees7, makerFees7] = await getFees(7, 1);

      // Buy five call positions
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("5", 4),
        true,
        7,
        0,
      );
      // Sell two call positions
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        toBn("2", 4),
        true,
        7,
        0,
      );

      const buyerFees = takerFees5.add(makerFees2);
      const sellerFees = makerFees5.add(takerFees2);
      
      // Separately deployer buys 3 call positions
      await paretoMargin.connect(deployer).addPosition(
        deployer.address,
        keeper.address,
        ONEUSDC,
        toBn("3", 4),
        true,
        7,
        0,
      );

      const deployerFees = takerFees7;
      const keeperFees = makerFees7;

      const [buyerMargin,] = await paretoMargin.checkMargin(buyer.address, false);
      const [sellerMargin,] = await paretoMargin.checkMargin(seller.address, false);
      const [deployerMargin,] = await paretoMargin.checkMargin(deployer.address, false);
      const [keeperMargin,] = await paretoMargin.checkMargin(keeper.address, false);

      expect(buyerMargin.add(buyerFees)).to.be.equal(deployerMargin.add(deployerFees));
      expect(sellerMargin.add(sellerFees)).to.be.equal(keeperMargin.add(keeperFees));
    });
    it("Check opposite orders of lots of quantities partially cancel", async () => {
      await paretoMargin.connect(deployer).setMaxBalanceCap(ONEUSDC.mul(5000));

      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(5000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(5000));

      // Use deployer and keeper as two other actors
      await usdc.connect(deployer).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await usdc.connect(keeper).approve(paretoMargin.address, ONEUSDC.mul(5000));
      await paretoMargin.connect(deployer).deposit(ONEUSDC.mul(5000));
      await paretoMargin.connect(keeper).deposit(ONEUSDC.mul(5000));

      const [takerFees3, makerFees3] = await getFees(3, 1);
      const [takerFees2, makerFees2] = await getFees(2, 1);
      const [takerFees1, makerFees1] = await getFees(1, 1);

      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("3", 4),
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("2", 4),
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      const buyerFees = takerFees3.add(takerFees2).add(makerFees1).add(makerFees1);
      const sellerFees = makerFees3.add(makerFees2).add(takerFees1).add(takerFees1);

      await paretoMargin.connect(deployer).addPosition(
        deployer.address,
        keeper.address,
        ONEUSDC,
        toBn("2", 4),
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        deployer.address,
        keeper.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      const deployerFees = takerFees2.add(takerFees1);
      const keeperFees = makerFees2.add(makerFees1);

      const [buyerMargin,] = await paretoMargin.checkMargin(buyer.address, false);
      const [sellerMargin,] = await paretoMargin.checkMargin(seller.address, false);
      const [deployerMargin,] = await paretoMargin.checkMargin(deployer.address, false);
      const [keeperMargin,] = await paretoMargin.checkMargin(keeper.address, false);

      expect(buyerMargin.add(buyerFees)).to.be.equal(deployerMargin.add(deployerFees));
      expect(sellerMargin.add(sellerFees)).to.be.equal(keeperMargin.add(keeperFees));
    });
    it("Seller who is whitelisted takes no fees", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      const sellerBalancePre = await paretoMargin.connect(seller).getBalance();
      const buyerBalancePre = await paretoMargin.connect(buyer).getBalance();

      // Add seller to white so no fees
      await paretoMargin.connect(deployer).addToWhitelist([seller.address]);
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      const sellerBalancePost = await paretoMargin.connect(seller).getBalance();
      const buyerBalancePost = await paretoMargin.connect(buyer).getBalance();

      expect(buyerBalancePre).to.be.greaterThan(buyerBalancePost);
      expect(sellerBalancePre).to.be.equal(sellerBalancePost);
    });
  });

  /****************************************
   * Fetching positions
   ****************************************/  
  describe("Checking positions", () => {
    beforeEach(async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
    });
    it("User can check empty positions", async () => {
      const positions = await paretoMargin.connect(buyer).getPositions();
      expect(positions.length).to.be.equal(0);
    });
    it("User can check one position", async () => {
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      const positions = await paretoMargin.connect(buyer).getPositions();
      expect(positions.length).to.be.equal(1);
      expect(positions[0].buyer).to.be.equal(buyer.address);
      expect(positions[0].seller).to.be.equal(seller.address);
      expect(positions[0].tradePrice).to.be.equal(ONEUSDC);
      expect(positions[0].quantity).to.be.equal(toBn("1", 4));
      expect(positions[0].option.strikeLevel).to.be.equal(7);
      expect(positions[0].option.isCall).to.be.equal(true);
      expect(positions[0].option.underlying).to.be.equal(0);
    });
    it("User can check multiple positions", async () => {
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        false,
        3,
        0,
      );
      const positions = await paretoMargin.connect(buyer).getPositions();
      expect(positions.length).to.be.equal(2);
      expect(positions[0].option.strikeLevel).to.be.equal(7);
      expect(positions[0].option.isCall).to.be.equal(true);
      expect(positions[1].option.strikeLevel).to.be.equal(3);
      expect(positions[1].option.isCall).to.be.equal(false);
    });
  });

  /****************************************
   * Margin check
   ****************************************/  
  describe("Performing a margin check", () => {
    it("Can check margin of yourself", async () => {
      await paretoMargin.connect(buyer).checkMargin(buyer.address, false);
    });
    it("Can check margin of someone else", async () => {
      await paretoMargin.connect(buyer).checkMargin(seller.address, false);
    });
    it("Person with no balance and no positions passes margin check", async () => {
      const [, satisfied] = await paretoMargin.connect(buyer).checkMargin(buyer.address, false);
      expect(satisfied).to.be.true;
    });
    it("Person with lots of liquidity and no positions passes margin check", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      const [, satisfied] = await paretoMargin.connect(buyer).checkMargin(buyer.address, false);
      expect(satisfied).to.be.true;
    });
    it("Person can fail margin check after entering a position", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(10));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(10));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(10));
      const [,makerFee] = await getFees(1, 1);
      await paretoMargin.connect(seller).deposit(makerFee);
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          toBn("1", 4),
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: buyer failed margin check");
    });
  });

  /***********************************toBn("*****", 4)
   * Withdrawal
   ****************************************/  
  describe("Withdrawing USDC", () => {
    beforeEach(async () => {
      // Depositor
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(buyer).deposit(ONEUSDC);
    });
    it("Depositor can withdraw", async () => {
      await paretoMargin.connect(buyer).withdraw(ONEUSDC);
    });
    it("Depositor can withdraw all", async () => {
      await paretoMargin.connect(buyer).withdrawAll();
    });
    it("USDC is properly transferred", async () => {
      const marginPre = await usdc.balanceOf(paretoMargin.address);
      const userPre = await usdc.balanceOf(buyer.address);
      await paretoMargin.connect(buyer).withdraw(ONEUSDC);
      const marginPost = await usdc.balanceOf(paretoMargin.address);
      const userPost = await usdc.balanceOf(buyer.address);
      expect(marginPre.sub(marginPost)).to.be.equal(ONEUSDC);
      expect(userPost.sub(userPre)).to.be.equal(ONEUSDC);
    });
    it("Emits an event on withdrawal", async () => {
      await expect(paretoMargin.connect(buyer).withdraw(ONEUSDC))
        .to.emit(paretoMargin, "WithdrawEvent")
        .withArgs(buyer.address, ONEUSDC);
    });
    it("Can withdraw all after two deposits", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(buyer).deposit(ONEUSDC);

      const marginPre = await usdc.balanceOf(paretoMargin.address);
      const userPre = await usdc.balanceOf(buyer.address);
      await paretoMargin.connect(buyer).withdrawAll();
      const marginPost = await usdc.balanceOf(paretoMargin.address);
      const userPost = await usdc.balanceOf(buyer.address);

      expect(marginPre.sub(marginPost)).to.be.equal(ONEUSDC.mul(2));
      expect(userPost.sub(userPre)).to.be.equal(ONEUSDC.mul(2));
    });
    it("Emits an event on withdrawal all", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC);
      await paretoMargin.connect(buyer).deposit(ONEUSDC);
      await expect(paretoMargin.connect(buyer).withdrawAll())
        .to.emit(paretoMargin, "WithdrawEvent")
        .withArgs(buyer.address, ONEUSDC.mul(2));
    });
    it("Cannot withdraw 0 amount", async () => {
      await expect(
        paretoMargin.connect(buyer).withdraw(0)
      ).to.be.revertedWith("withdraw: amount must be > 0");
    });
    it("Cannot withdraw more than balance", async () => {
      await expect(
        paretoMargin.connect(buyer).withdraw(ONEUSDC.mul(2))
      ).to.be.revertedWith("withdraw: amount > balance");
    });
    it("Cannot withdraw if failing margin check", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        5,
        0,
      );
      await expect(
        paretoMargin.connect(buyer).withdraw(ONEUSDC.mul(1000))
      ).to.be.revertedWith("withdraw: margin check failed");
    });
    it("Cannot withdraw all if failing margin check", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        5,
        0,
      );
      await expect(
        paretoMargin.connect(buyer).withdrawAll()
      ).to.be.revertedWith("withdraw: margin check failed");
    });
  });

  /****************************************
   * Rollover
   ****************************************/  
  describe("Rollover", () => {
    it("Owner can rollover", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await paretoMargin.connect(deployer).rollover([]);
    });
    it("Keeper can rollover", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await paretoMargin.connect(keeper).rollover([]);
    });
    it("User cannot rollover", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await expect(
        paretoMargin.connect(buyer).rollover([])
      ).to.be.revertedWith("onlyKeeper: caller is not a keeper");
    });
    it("Cannot rollover if paused", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await paretoMargin.connect(deployer).togglePause();
      await expect(paretoMargin.rollover([buyer.address]))
        .to.be.revertedWith("rollover: contract paused");
    });
    it("Cannot rollover before expiry, even as owner", async () => {
      await expect(
        paretoMargin.connect(deployer).rollover([])
      ).to.be.revertedWith("rollover: too early");
    });
    it("Cannot rollover without settling", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await expect(
        paretoMargin.connect(deployer).rollover([])
      ).to.be.revertedWith("rollover: please settle last round first");
    });
    it("Can delete users in rollover", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(keeper).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await paretoMargin.connect(keeper).rollover([buyer.address, seller.address]);
    });
  }); 

  /****************************************
   * Settlement
   ****************************************/  
  describe("Settlement", () => {
    it("owner can settle", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();
    });
    it("user can settle", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(buyer).settle();
    });
    it("cannot settle before expiry", async () => {
      await expect(
        paretoMargin.connect(deployer).settle()
      ).to.be.revertedWith("settle: expiry must be in the past");
    });
    it("emits event on settlement", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(buyer).settle();
      await expect(
        paretoMargin.connect(buyer).settle()
      ).to.be.revertedWith("settle: already settled this round");
    });
    it("balances remain if no position", async () => {
      const buyerPre = await paretoMargin.connect(buyer).getBalance();
      const sellerPre = await paretoMargin.connect(seller).getBalance();

      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.equal(buyerPost);
      expect(sellerPre).to.be.equal(sellerPost);
    });
    it("balances change for one call position, buyer wins", async () => {
      // Buyer purchases a call
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Compute positions pre
      const buyerPre = await paretoMargin.connect(buyer).getBalance();
      const sellerPre = await paretoMargin.connect(seller).getBalance();

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      // Let the price rise a lot so buyer wins
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(2000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      // Compute positions post
      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.lessThan(buyerPost);
      expect(sellerPre).to.be.greaterThan(sellerPost);
    });
    it("balances change for one call position, seller wins", async () => {
      // Buyer purchases a call
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Compute positions pre
      const buyerPre = await paretoMargin.connect(buyer).getBalance();
      const sellerPre = await paretoMargin.connect(seller).getBalance();

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      // Let the price drop a lot so seller wins
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(1000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      // Compute positions post
      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.greaterThan(buyerPost);
      expect(sellerPre).to.be.lessThan(sellerPost);
    });
    it("balances change for one put position, buyer wins", async () => {
      // Buyer purchases a put
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Compute positions pre
      const buyerPre = await paretoMargin.connect(buyer).getBalance();
      const sellerPre = await paretoMargin.connect(seller).getBalance();

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        3,
        0,
      );
      
      // Let the price drop a lot so buyer wins
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(1000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      // Compute positions post
      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.greaterThan(buyerPost);
      expect(sellerPre).to.be.lessThan(sellerPost);
    });
    it("balances change for one put position, seller wins", async () => { 
      // Buyer purchases a put
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Compute positions pre
      const buyerPre = await paretoMargin.connect(buyer).getBalance();
      const sellerPre = await paretoMargin.connect(seller).getBalance();

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        3,
        0,
      );
      
      // Let the price rise a lot so seller wins
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(2000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      // Compute positions post
      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.lessThan(buyerPost);
      expect(sellerPre).to.be.greaterThan(sellerPost);
    });
    it("balances change for two call positions, buyer wins both", async () => {
      // Buyer purchases a call
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Compute positions pre
      const buyerPre = await paretoMargin.connect(buyer).getBalance();
      const sellerPre = await paretoMargin.connect(seller).getBalance();

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        6,
        0,
      );

      // Let the price rise a lot so buyer wins
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(2000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      // Compute positions post
      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.lessThan(buyerPost);
      expect(sellerPre).to.be.greaterThan(sellerPost);
    });
    it("balances change for five call, one put; buyer wins calls, loses put, wins overall", async () => {
        await paretoMargin.connect(deployer).setMaxBalanceCap(ONEUSDC.mul(10000));

       // Buyer purchases a call
       await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(10000));
       await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(10000));
       await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(10000));
       await paretoMargin.connect(seller).deposit(ONEUSDC.mul(10000));
 
       // Compute positions pre
       const buyerPre = await paretoMargin.connect(buyer).getBalance();
       const sellerPre = await paretoMargin.connect(seller).getBalance();
 
       // Enter the position
       await paretoMargin.connect(deployer).addPosition(
         buyer.address,
         seller.address,
         ONEUSDC,
         toBn("5", 4),
         0,
         7,
         0,
       );
       await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        3,
        0,
      );

      // Let the price rise a lot 
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(2000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      // Compute positions post
      const buyerPost = await paretoMargin.connect(buyer).getBalance();
      const sellerPost = await paretoMargin.connect(seller).getBalance();

      expect(buyerPre).to.be.lessThan(buyerPost);
      expect(sellerPre).to.be.greaterThan(sellerPost);
    });
    it("insurance fund kicks in if not enough liq", async () => {
      // Buyer purchases a call
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(500));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(500));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(500));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(500));

      const insurancePre = parseFloat(fromBn(await paretoMargin.connect(insurance).getBalance(), 18));
      const buyerPre = parseFloat(fromBn(await paretoMargin.connect(buyer).getBalance(), 18));
      const sellerPre = parseFloat(fromBn(await paretoMargin.connect(seller).getBalance(), 18));

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("1", 4),
        true,
        7,
        0,
      );

      // Let the price rise a lot so much that seller should get liquidated
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(10000));

      // Settle positions
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).settle();

      const insurancePost = parseFloat(fromBn(await paretoMargin.connect(insurance).getBalance()));
      const buyerPost = parseFloat(fromBn(await paretoMargin.connect(buyer).getBalance()));
      const sellerPost = parseFloat(fromBn(await paretoMargin.connect(seller).getBalance()));

      // Insurance has to help pay the fine
      expect(insurancePost).to.be.lessThan(insurancePre);
      expect(buyerPost).to.be.greaterThan(buyerPre);
      expect(sellerPost).to.be.lessThan(sellerPre);
      expect(sellerPost).to.be.equal(0);

      // Insurance is capped though, check it cannot pay the whole fine
      expect(insurancePre - insurancePost + sellerPre).lessThan(buyerPost - buyerPre);
    });
    it("can settle even if paused", async () => {
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.connect(deployer).togglePause();
      await paretoMargin.connect(buyer).settle();
    });
  });

  /****************************************
   * Liquidation
   ****************************************/  
  describe("Liquidation", () => {
    beforeEach(async () => {
      // Add a position that makes the seller below
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));

      // Enter the position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        toBn("2", 4),
        false,
        7,
        0,
      );

      // Let the price rise a lot so much that seller should get liquidated
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(10000));
    });
    it("Owner can liquidate", async () => {
      await paretoMargin.connect(deployer).liquidate(seller.address);
    });
    it("Random EOA can liquidate", async () => {
        await paretoMargin.connect(keeper).liquidate(seller.address);
      });
    it("Buyer can liquidate", async () => {
      await paretoMargin.connect(buyer).liquidate(seller.address);
    });
    it("Seller cannot liquidate", async () => {
      await expect(
        paretoMargin.connect(seller).liquidate(seller.address)
      ).to.be.revertedWith("liquidate: cannot liquidate yourself");
    });
    it("Cannot liquidate user with no positions", async () => {
      await expect(
        paretoMargin.connect(deployer).liquidate(keeper.address)
      ).to.be.revertedWith("liquidate: user has no positions");
    });
    it("Cannot liquidate if pass margin check", async () => {
      await expect(
        paretoMargin.connect(deployer).liquidate(buyer.address)
      ).to.be.revertedWith("liquidate: user passes margin check");
    });
    it("Cannot add another position", async () => {
      await expect(
        paretoMargin.connect(deployer).addPosition(
          seller.address,
          buyer.address,
          ONEUSDC,
          toBn("2", 4),
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: seller failed margin check");
    });
  });

  describe("Liquidation: Edge Cases", () => {
    beforeEach(async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(1000));
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
    })
    it("Liquidates short positions before long positions", async () => {
      // raise max balance so deployer can handle the liquidation of a bad position
      await paretoMargin.connect(deployer).setMaxBalanceCap(ONEUSDC.mul(100000));
      await usdc.connect(deployer).approve(paretoMargin.address, ONEUSDC.mul(100000));
      await paretoMargin.connect(deployer).deposit(ONEUSDC.mul(100000));

      // Add a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC.mul(100),
        toBn("0.5", 4),  // small position
        true,
        6,
        0,
      );
      // Add another call at a different strike, switch buyer and seller rolls
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC.mul(100),
        toBn("10", 4),  // much larger position
        true,
        7,
        0,
      );  
      // Let the price rise a lot: now the buyer who sold the second strike 
      // will be liquidated
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(10000));

      // Call liquidate
      await paretoMargin.connect(deployer).liquidate(buyer.address);

      // Get positions
      const buyerPositions = await paretoMargin.connect(buyer).getPositions();
      expect(buyerPositions.length).to.be.equal(1); 
      // Check that this position is the long position
      expect(buyerPositions[0].buyer).to.be.equal(buyer.address);
      expect(buyerPositions[0].seller).to.be.equal(seller.address);

      const sellerPositions = await paretoMargin.connect(seller).getPositions();
      // Seller is still in two positions
      expect(sellerPositions.length).to.be.equal(2); 
      
      const liquidatorPositions = await paretoMargin.connect(deployer).getPositions();
      // Check liquidator is now in a position
      expect(liquidatorPositions.length).to.be.equal(1); 
    });
    it("If counterparty liquidates, order is netted", async () => {
      // raise max balance so seller can handle the liquidation of a bad position
      await paretoMargin.connect(deployer).setMaxBalanceCap(ONEUSDC.mul(200000));
      await usdc.connect(seller).approve(paretoMargin.address, ONEUSDC.mul(100000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(100000));

      // Add a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC.mul(100),
        toBn("0.5", 4),  // small position
        true,
        6,
        0,
      );
      // Add another call at a different strike, switch buyer and seller rolls
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC.mul(100),
        toBn("10", 4),  // much larger position
        true,
        7,
        0,
      );  
      // Let the price rise a lot: now the buyer who sold the second strike 
      // will be liquidated
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(10000));

      // Call liquidate from the seller
      await paretoMargin.connect(seller).liquidate(buyer.address);

      const buyerPositions = await paretoMargin.connect(buyer).getPositions();
      const sellerPositions = await paretoMargin.connect(seller).getPositions();
      const deployerPositions = await paretoMargin.connect(deployer).getPositions();

      // Both buyer and seller have only one position b/c netted
      expect(buyerPositions.length).to.be.equal(1); 
      expect(sellerPositions.length).to.be.equal(1); 

      // deployer has nothing to do with this so no positions
      expect(deployerPositions.length).to.be.equal(0);
    });
    it("If liquidator falls below margin, everything is reset", async () => {
      // Add a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC.mul(100),
        toBn("0.5", 4),  // small position
        true,
        6,
        0,
      );
      // Add another call at a different strike, switch buyer and seller rolls
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC.mul(100),
        toBn("10", 4),  // much larger position
        true,
        7,
        0,
      );  
      // Let the price rise a lot: now the buyer who sold the second strike 
      // will be liquidated
      await spotFeed.connect(deployer).setLatestPrice(ONEUSDC.mul(10000));

      // Check margin of liquidator (deployer) and buyer
      const [liquidatorMarginPre, liquidatorSatisfiedPre] = await paretoMargin.checkMargin(deployer.address, false);
      const [buyerMarginPre, buyerSatisfiedPre] = await paretoMargin.checkMargin(buyer.address, false);

      expect(liquidatorSatisfiedPre).to.be.true;
      expect(buyerSatisfiedPre).to.be.false;

      // This will fail though not return anythng
      await paretoMargin.connect(deployer).liquidate(buyer.address);

      // Check buyer still has both positions
      const positions = await paretoMargin.connect(buyer).getPositions();
      expect(positions.length).to.be.equal(2); 

      // Check margin and it should be the same (this implicitly checks balance)
      const [liquidatorMarginPost, liquidatorSatisfiedPost] = await paretoMargin.checkMargin(deployer.address, false);
      const [buyerMarginPost, buyerSatisfiedPost] = await paretoMargin.checkMargin(buyer.address, false);
      expect(liquidatorMarginPost).to.be.equal(liquidatorMarginPre);
      expect(buyerMarginPost).to.be.equal(buyerMarginPre);

      // Buyer should still be under margin
      expect(liquidatorSatisfiedPost).to.be.true;
      expect(buyerSatisfiedPost).to.be.false;
    });
  });

  /****************************************
   * Keeper management
   ****************************************/  
  describe("Managing keepers", () => {
    it("Owner can add keeper", async () => {
      await paretoMargin.connect(deployer).addKeepers([buyer.address]);
    });
    it("Cannot add keeper twice", async () => {
      await paretoMargin.connect(deployer).addKeepers([buyer.address]);
      await expect(
        paretoMargin.connect(deployer).addKeepers([buyer.address])
      ).to.be.revertedWith("addKeeper: already a keeper");
    });
    it("Owner can add multiple keepers at once", async () => {
      await paretoMargin.connect(deployer).addKeepers([buyer.address, seller.address]);
    });
    it("Owner can remove keeper", async () => {
      await paretoMargin.connect(deployer).removeKeepers([keeper.address]);
    });
    it("Keeper cannot add keeper", async () => {
      await expect(
        paretoMargin.connect(keeper).addKeepers([buyer.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Keeper cannot remove keeper", async () => {
      await expect(
        paretoMargin.connect(keeper).removeKeepers([keeper.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot add keeper", async () => {
      await expect(
        paretoMargin.connect(buyer).addKeepers([seller.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot remove keeper", async () => {
      await expect(
        paretoMargin.connect(buyer).removeKeepers([keeper.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  /****************************************
   * Whitelist management
   ****************************************/  
  describe("Managing whitelist", () => {
    it("Owner can add to whitelist", async () => {
      await paretoMargin.connect(deployer).addToWhitelist([buyer.address]);
    });
    it("Cannot add whitelist twice", async () => {
      await paretoMargin.connect(deployer).addToWhitelist([buyer.address]);
      await expect(
        paretoMargin.connect(deployer).addToWhitelist([buyer.address])
      ).to.be.revertedWith("addToWhitelist: already in whitelist");
    });
    it("Owner can add multiple addresses to whitelist at once", async () => {
      await paretoMargin.connect(deployer).addToWhitelist([buyer.address, seller.address]);
    });
    it("Owner can remove whitelist", async () => {
      await paretoMargin.connect(deployer).removeKeepers([keeper.address]);
    });
    it("Keeper cannot add whitelist", async () => {
      await expect(
        paretoMargin.connect(keeper).addToWhitelist([buyer.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Keeper cannot remove whitelist", async () => {
      await expect(
        paretoMargin.connect(keeper).removeKeepers([keeper.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot add whitelist", async () => {
      await expect(
        paretoMargin.connect(buyer).addToWhitelist([seller.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot remove whitelist", async () => {
      await expect(
        paretoMargin.connect(buyer).removeKeepers([keeper.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  /****************************************
   * Oracle management
   ****************************************/  
  describe("Managing oracles", () => {
    let newSpotFeed: Contract;
    let newMarkFeed: Contract;

    beforeEach(async () => {
      const SpotFeedFactory = await ethers.getContractFactory("SpotFeed");
      newSpotFeed = await SpotFeedFactory.deploy("BTC spot", [keeper.address]);
      await newSpotFeed.deployed();

      const MarkFeedFactory = await ethers.getContractFactory("MarkFeed");
      newMarkFeed = await MarkFeedFactory.deploy("BTC mark", [keeper.address]);
      await newMarkFeed.deployed();
    });
    it("Owner can set oracle for new underlying", async () => {
      // Initialize the spot feed
      await newSpotFeed.setLatestPrice(toBn("1", 18));

      // Initialize the mark feed
      var callPrices = [];
      var putPrices = [];
      for (var i = 0; i < 11; i++) {
        callPrices.push(ONEUSDC.mul(150));
        putPrices.push(ONEUSDC.mul(150));
      }
      await newMarkFeed.setLatestPrices(callPrices, putPrices);

      expect(await paretoMargin.isActiveUnderlying(0)).to.be.true;
      expect(await paretoMargin.isActiveUnderlying(1)).to.be.false;
      await paretoMargin.connect(deployer).activateUnderlying(
        1,
        newSpotFeed.address,
        newMarkFeed.address,
        toBn("1", 3),
      );
      expect(await paretoMargin.isActiveUnderlying(1)).to.be.true;
    });
    it("Keeper cannot set oracle for existing underlying", async () => {
      await expect(
        paretoMargin.connect(keeper).setOracle(0, newSpotFeed.address, newMarkFeed.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot set oracle for existing underlying", async () => {
      await expect(
        paretoMargin.connect(buyer).setOracle(0, newSpotFeed.address, newMarkFeed.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  /****************************************
   * Other keeper functions
   ****************************************/  
  describe("Other keeper jobs", () => {
    it("Owner can pause contract", async () => {
      await paretoMargin.connect(deployer).togglePause();
    });
    it("Pausing emits an event", async () => {
      expect(await paretoMargin.connect(deployer).togglePause())
        .to.emit(paretoMargin, "TogglePauseEvent")
        .withArgs(deployer.address, true);
    });
    it("Owner can unpause contract", async () => {
      await paretoMargin.connect(deployer).togglePause();
      await paretoMargin.connect(deployer).togglePause();
    });
    it("Unpausing emits an event", async () => {
      await paretoMargin.connect(deployer).togglePause();
      expect(await paretoMargin.connect(deployer).togglePause())
        .to.emit(paretoMargin, "TogglePauseEvent")
        .withArgs(deployer.address, false);
    });
    it("Keeper cannot pause contract", async () => {
      await expect(paretoMargin.connect(keeper).togglePause())
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Keeper cannot unpause contract", async () => {
      await paretoMargin.connect(deployer).togglePause();
      await expect(paretoMargin.connect(keeper).togglePause())
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot pause contract", async () => {
      await expect(paretoMargin.connect(buyer).togglePause())
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot unpause contract", async () => {
      await paretoMargin.connect(deployer).togglePause();
      await expect(paretoMargin.connect(buyer).togglePause())
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Owner can set max insured percent", async () => {
      expect(await paretoMargin.maxInsuredPerc()).to.be.equal("5000");
      await paretoMargin.connect(deployer).setMaxInsuredPerc(8000);
      expect(await paretoMargin.maxInsuredPerc()).to.be.equal("8000");
    });
    it("Setting max insured % emits event", async () => {
      await expect(paretoMargin.connect(deployer).setMaxInsuredPerc(8000))
        .to.emit(paretoMargin, "MaxInsuredPercEvent")
        .withArgs(deployer.address, 8000);
    });
    it("Cannot set max insured percent to be > 10**4", async () => {
      await expect(paretoMargin.connect(deployer).setMaxInsuredPerc(10001))
        .to.be.revertedWith("setMaxInsuredPerc: must be <= 10**4");
    });
    it("Keeper cannot set max insured percent", async () => {
      await expect(paretoMargin.connect(keeper).setMaxInsuredPerc(8000))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot set max insured percent", async () => {
      await expect(paretoMargin.connect(buyer).setMaxInsuredPerc(8000))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Owner can set min margin percent", async () => {
      expect(await paretoMargin.minMarginPerc()).to.be.equal("100");
      await paretoMargin.connect(deployer).setMinMarginPerc(500);
      expect(await paretoMargin.minMarginPerc()).to.be.equal("500");
    });
    it("Setting min margin % emits event", async () => {
      await expect(paretoMargin.connect(deployer).setMinMarginPerc(500))
        .to.emit(paretoMargin, "MinMarginPercEvent")
        .withArgs(deployer.address, 500);
    });
    it("Cannot set min margin percent to be > 10**4", async () => {
      await expect(paretoMargin.connect(deployer).setMinMarginPerc(10001))
        .to.be.revertedWith("setMinMarginPerc: must be <= 10**4");
    });
    it("Keeper cannot set min margin percent", async () => {
      await expect(paretoMargin.connect(keeper).setMinMarginPerc(500))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot set min margin percent", async () => {
      await expect(paretoMargin.connect(buyer).setMinMarginPerc(500))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Owner can set max balance cap", async () => {
      expect(await paretoMargin.maxBalanceCap()).to.be.equal(toBn("2000", 18));
      await paretoMargin.connect(deployer).setMaxBalanceCap(toBn("3000", 18));
      expect(await paretoMargin.maxBalanceCap()).to.be.equal(toBn("3000", 18));
    });
    it("Setting max balance cap % emits event", async () => {
      await expect(paretoMargin.connect(deployer).setMaxBalanceCap(toBn("3000", 18)))
        .to.emit(paretoMargin, "MaxBalanceCapEvent")
        .withArgs(deployer.address, toBn("3000", 18));
    });
    it("Keeper cannot set max balance cap", async () => {
      await expect(paretoMargin.connect(keeper).setMaxBalanceCap(toBn("3000", 18)))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot set max balance cap", async () => {
      await expect(paretoMargin.connect(buyer).setMaxBalanceCap(toBn("3000", 18)))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});