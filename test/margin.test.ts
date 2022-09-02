import { ethers, upgrades } from "hardhat";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getFixedGasSigners, timeTravelTo } from "./utils/helpers";
import { ERC1967UpgradeUpgradeable__factory } from "../typechain-types";

let usdc: Contract;
let derivative: Contract;
let paretoMargin: Contract;
let priceFeed: Contract;
let volFeed: Contract;
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

    // Deploy a price feed factory and create a spot and vol oracle
    const PriceFeedFactory = await ethers.getContractFactory("PriceFeed");

    // Create spot oracle, assign keeper as admin
    priceFeed = await PriceFeedFactory.deploy("ETH spot", [keeper.address]);
    await priceFeed.deployed();

    // Set spot price to 1500 USDC, with 18 decimals
    await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(1500));

    // Create vol oracle, assign keeper as admin
    volFeed = await PriceFeedFactory.deploy("ETH vol", [keeper.address]);
    await volFeed.deployed();

    // Set vol to 0.9 with 4 decimals
    await volFeed.connect(deployer).setLatestAnswer(toBn("0.9", 4));

    // Deploy upgradeable Pareto margin contract
    const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
    paretoMargin = await upgrades.deployProxy(
      ParetoMargin,
      [
        usdc.address,
        insurance.address,
        "ETH",
        priceFeed.address,
        volFeed.address
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
   * Fetching a smile
   ****************************************/  
  describe("Getting a smile", () => {
    it("Can fetch smile", async () => {
      const expiry = await paretoMargin.activeExpiry();
      const smile = await paretoMargin.getVolatilitySmile("ETH", expiry);
      expect(smile.exists_).to.be.true;
    });
    it("Empty smile does not exist", async () => {
      const expiry = await paretoMargin.activeExpiry();
      const smile = await paretoMargin.getVolatilitySmile("TEST", expiry);
      expect(smile.exists_).to.be.false;
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
        0,
        7,
        "ETH"
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
        0,
        7,
        "ETH"
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
          0,
          7,
          "ETH"
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
          0,
          7,
          "ETH"
        )
      )
        .to.emit(paretoMargin, "RecordPositionEvent")
        .withArgs(ONEUSDC, 1, 0, "ETH", 7, expiry);
    });
    it("Smile is updated on adding a new position", async () => {
      // Fetch smile before position
      const smilePre = await paretoMargin.getVolatilitySmile("ETH", expiry);

      // Add a position
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(keeper).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        0,
        7,
        "ETH"
      );

      // Fetch smile after position
      const smilePost = await paretoMargin.getVolatilitySmile("ETH", expiry);

      // Check the two smiles are not the same
      var isSame = true;
      for (var i = 0; i < 5; i++) {
        if (smilePre[i] != smilePost[i]) {
          isSame = false;
        }
      }

      expect(isSame).to.be.false;
    });
    it("Buyer passes margin check after position added", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        0,
        7,
        "ETH"
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
        0,
        7,
        "ETH"
      );
      const [, satisfied] = await paretoMargin.checkMargin(seller.address, false);
      expect(satisfied).to.be.true;
    });
    it("Can add position for brand new underlying", async () => {
      // Deploy new oracle contracts
      const PriceFeedFactory = await ethers.getContractFactory("PriceFeed");
      const newPriceFeed = await PriceFeedFactory.deploy("BTC spot", [keeper.address]);
      await newPriceFeed.deployed();
      const newVolFeed = await PriceFeedFactory.deploy("BTC vol", [keeper.address]);
      newVolFeed.deployed();

      // Set prices
      await newPriceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(1500));
      await newVolFeed.connect(deployer).setLatestAnswer(toBn("0.9", 4));
      
      // Add oracles to Pareto, making a new underlying
      await paretoMargin.connect(deployer).setOracle("BTC", newPriceFeed.address, newVolFeed.address);

      // Now make a new position for said underlying
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        0,
        7,
        "BTC"
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
          0,
          7,
          "ETH"
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
          0,
          7,
          "ETH"
        )
      ).to.be.revertedWith("addPosition: quantity must be > 0");
    });
    it("Cannot add position with empty underlying name", async () => {
      await paretoMargin.connect(buyer).deposit(ONEUSDC.mul(1000));
      await paretoMargin.connect(seller).deposit(ONEUSDC.mul(1000));
      await expect(
        paretoMargin.connect(deployer).addPosition(
          buyer.address,
          seller.address,
          ONEUSDC,
          1,
          0,
          7,
          ""
        )
      ).to.be.revertedWith("addPosition: underlying is empty");
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
          0,
          7,
          "ETH"
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
          0,
          7,
          "ETH"
        )
      ).to.be.revertedWith("addPosition: seller failed margin check");
    });
    it("Check opposite orders can cancelled", async () => {
      expect(true).to.be.false;  // TODO
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
          0,
          7,
          "ETH"
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
        0,
        5,
        "ETH"
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
        0,
        5,
        "ETH"
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
        0,
        7,
        "ETH"
      );
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await paretoMargin.connect(keeper).rollover([buyer.address, seller.address]);
    });
    it("Smiles are updated after rollover to last round", async () => {
      const lastExpiry = (await paretoMargin.activeExpiry()).toNumber();
      const lastSmile = paretoMargin.getVolatilitySmile("ETH", lastExpiry);
      const expiry = (await paretoMargin.activeExpiry()).toNumber();
      await ethers.provider.send("evm_mine", [expiry+1]);
      await paretoMargin.settle();
      await paretoMargin.connect(keeper).rollover([]);
      const currExpiry = (await paretoMargin.activeExpiry()).toNumber();
      const currSmile = paretoMargin.getVolatilitySmile("ETH", currExpiry);

      expect(lastExpiry).to.not.be.equal(currExpiry);
      for (var i = 0; i < 5; i++) {
        expect(lastSmile[i]).to.be.equal(currSmile[i]);
      }
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
        0,
        7,
        "ETH"
      );

      // Let the price rise a lot so buyer wins
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(2000));

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
        0,
        7,
        "ETH"
      );

      // Let the price drop a lot so seller wins
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(1000));

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
        0,
        3,
        "ETH"
      );
      
      // Let the price drop a lot so buyer wins
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(1000));

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
        0,
        3,
        "ETH"
      );
      
      // Let the price rise a lot so seller wins
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(2000));

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
        0,
        7,
        "ETH"
      );

      await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        0,
        6,
        "ETH"
      );

      // Let the price rise a lot so buyer wins
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(2000));

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
         "ETH"
       );
       await paretoMargin.connect(deployer).addPosition(
        buyer.address,
        seller.address,
        ONEUSDC,
        1,
        0,
        3,
        "ETH"
      );

      // Let the price rise a lot 
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(2000));

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
        0,
        7,
        "ETH"
      );

      // Let the price rise a lot so much that seller should get liquidated
      await priceFeed.connect(deployer).setLatestAnswer(ONEUSDC.mul(10000));

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
    // TODO
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
    let newPriceFeed: Contract;
    let newVolFeed: Contract;

    beforeEach(async () => {
      const PriceFeedFactory = await ethers.getContractFactory("PriceFeed");
      newPriceFeed = await PriceFeedFactory.deploy("BTC spot", [keeper.address]);
      await newPriceFeed.deployed();
      newVolFeed = await PriceFeedFactory.deploy("BTC vol", [keeper.address]);
      await newVolFeed.deployed();
    });
    it("Owner can set oracle for new underlying", async () => {
      await paretoMargin.connect(deployer).setOracle("BTC", newPriceFeed.address, newVolFeed.address);
      expect(await paretoMargin.underlyings(0)).to.be.not.equal(await paretoMargin.underlyings(1));
    });
    it("Keeper cannot set oracle for new underlying", async () => {
      await expect(
        paretoMargin.connect(keeper).setOracle("BTC", newPriceFeed.address, newVolFeed.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot set oracle for new underlying", async () => {
      await expect(
        paretoMargin.connect(buyer).setOracle("BTC", newPriceFeed.address, newVolFeed.address)
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
})