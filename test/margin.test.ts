import { ethers, upgrades } from "hardhat";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
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

const ONEUSDC = toBn("1", 18);

describe("ParetoMargin Contract", () => {
  beforeEach(async () => {
    const wallets = await getFixedGasSigners(10000000);
    [deployer, keeper, buyer, seller, insurance] = wallets;
  
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
        0,
        spotFeed.address,
        markFeed.address,
        ONEUSDC.mul(1500).div(10),  // spot/10
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
        1,
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
        1,
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
          1,
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
          1,
          true,
          7,
          0,
        )
      )
        .to.emit(paretoMargin, "RecordPositionEvent")
        .withArgs(ONEUSDC, 1, true, 0, 7, expiry);
    });
    it("Buyer passes margin check after position added", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
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
        1,
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
        ONEUSDC.mul(1500).div(10),  // spot/10
      );

      // Now make a new position for said underlying
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        true,
        7,
        1,
      );
    });
    it("Cannot add position with trade price 0", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          0,
          1,
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
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          1,
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: buyer failed margin check");
    });
    it("Cannot add position if seller below margin", async () => {
      // buyer puts in 1k usdc into margin account but seller does not
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          1,
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
        1,
        true,
        7,
        0,
      );
      // Sell the call position
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        1,
        true,
        7,
        0,
      );
      const [marginA,] = await paretoMargin.checkMargin(buyer.address, false);
      const [marginB,] = await paretoMargin.checkMargin(seller.address, false);

      // Get balance for the two individuals
      const buyerBalance = await paretoMargin.connect(buyer).getBalance();
      const sellerBalance = await paretoMargin.connect(seller).getBalance();

      // Both should be netted to be zero since orders cancel
      expect(marginA).to.be.equal(buyerBalance);
      expect(marginB).to.be.equal(sellerBalance);
    });
    it("Check opposite orders of different strikes do not cancel", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));      

      // Buy a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        true,
        7,
        0,
      );
      // Sell the call position
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        1,
        true,
        6,
        0,
      );
      const [marginA,] = await paretoMargin.checkMargin(buyer.address, false);
      const [marginB,] = await paretoMargin.checkMargin(seller.address, false);
      
      // Get balance for the two individuals
      const buyerBalance = await paretoMargin.connect(buyer).getBalance();
      const sellerBalance = await paretoMargin.connect(seller).getBalance();

      // Margin should be less for both
      expect(marginA).to.be.lessThan(buyerBalance);
      expect(marginB).to.be.lessThan(sellerBalance);
    });
    it("Check opposite orders of put & call do not cancel", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));      

      // Buy a call position
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        true,
        7,
        0,
      );
      // Sell the put position
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        1,
        false,
        7,
        0,
      );
      const [marginA,] = await paretoMargin.checkMargin(buyer.address, false);
      const [marginB,] = await paretoMargin.checkMargin(seller.address, false);
      
      // Get balance for the two individuals
      const buyerBalance = await paretoMargin.connect(buyer).getBalance();
      const sellerBalance = await paretoMargin.connect(seller).getBalance();

      // Margin should be less for both
      expect(marginA).to.be.lessThan(buyerBalance);
      expect(marginB).to.be.lessThan(sellerBalance);
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

      // Buy five call positions
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        5,
        true,
        7,
        0,
      );
      // Sell two call positions
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        2,
        true,
        7,
        0,
      );
      
      // Separately deployer buys 3 call positions
      await paretoMargin.connect(deployer).addPosition(
        deployer.address,
        keeper.address,
        ONEUSDC,
        3,
        true,
        7,
        0,
      );

      const [marginA,] = await paretoMargin.checkMargin(buyer.address, false);
      const [marginB,] = await paretoMargin.checkMargin(seller.address, false);
      const [marginC,] = await paretoMargin.checkMargin(deployer.address, false);
      const [marginD,] = await paretoMargin.checkMargin(keeper.address, false);

      expect(marginA).to.be.equal(marginC);
      expect(marginB).to.be.equal(marginD);
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

      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        3,
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        2,
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        1,
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        seller.address,
        buyer.address,
        ONEUSDC,
        1,
        true,
        7,
        0,
      );

      await paretoMargin.connect(deployer).addPosition(
        deployer.address,
        keeper.address,
        ONEUSDC,
        2,
        true,
        7,
        0,
      );
      await paretoMargin.connect(deployer).addPosition(
        deployer.address,
        keeper.address,
        ONEUSDC,
        1,
        true,
        7,
        0,
      );

      const [marginA,] = await paretoMargin.checkMargin(buyer.address, false);
      const [marginB,] = await paretoMargin.checkMargin(seller.address, false);
      const [marginC,] = await paretoMargin.checkMargin(deployer.address, false);
      const [marginD,] = await paretoMargin.checkMargin(keeper.address, false);

      expect(marginA).to.be.equal(marginC);
      expect(marginB).to.be.equal(marginD);
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
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(10));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          1,
          true,
          7,
          0,
        )
      ).to.be.revertedWith("addPosition: buyer failed margin check");
    });
  });

  /****************************************
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
        1,
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
        1,
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
        1,
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
        1,
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
        1,
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
        1,
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
        1,
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
        1,
        true,
        7,
        0,
      );

      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
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
         5,
         0,
         7,
         0,
       );
       await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
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
        1,
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
        2,
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
        ONEUSDC.mul(1500).div(10),  // spot/10
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
  });
});