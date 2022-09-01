import { ethers, upgrades } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";

let usdc: Contract;
let weth: Contract;
let priceFeedFactory: Contract;
let paretoMargin: Contract;
let deployer: SignerWithAddress;
let keeper: SignerWithAddress;
let buyer: SignerWithAddress;
let seller: SignerWithAddress;
let insurance: SignerWithAddress;

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
const ONE_WEEK: number = 604800;

describe("ParetoMargin Contract", () => {
  beforeEach(async () => {
    const wallets = await ethers.getSigners(); 
    [deployer, keeper, buyer, seller, insurance] = wallets;
  
    // Deploy a MockERC20 contract to mimic USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    usdc = await MockERC20.deploy();

    // Mint 100k USDC for deployer, keeper, buyer and seller
    await usdc.mint(deployer.address, 100000);
    await usdc.mint(keeper.address, 100000);
    await usdc.mint(buyer.address, 100000);
    await usdc.mint(seller.address, 100000);
    await usdc.mint(insurance.address, 100000);

    // Deploy a MockERC20 contract to mimic WETH
    weth = await MockERC20.deploy();

    // Deploy a price feed factory and create a spot and vol oracle
    const PriceFeedFactory = await ethers.getContractFactory("PriceFeedFactory", deployer);
    priceFeedFactory = await PriceFeedFactory.deploy();
    await priceFeedFactory.deployed();

    // Create spot oracle, assign keeper as admin
    const txReceiptUnresolvedSpot = await priceFeedFactory.create("weth spot oracle", [keeper.address]);
    const txReceiptSpot = await txReceiptUnresolvedSpot.wait();
    const spotOracleAddress = txReceiptSpot.events![2].args![0];

    // Create vol oracle, assign keeper as admin
    const txReceiptUnresolvedVol = await priceFeedFactory.create("weth vol oracle", [keeper.address]);
    const txReceiptVol = await txReceiptUnresolvedVol.wait();
    const volOracleAddress = txReceiptVol.events![2].args![0];

    // Deploy upgradeable Pareto margin contract
    const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
    paretoMargin = await upgrades.deployProxy(
      ParetoMargin,
      [
        usdc.address,
        insurance.address,
        weth.address,
        spotOracleAddress,
        volOracleAddress
      ]
    );
    await paretoMargin.deployed();

    // Insurance will deposit all their USDC into contract
    await usdc.connect(insurance).approve(paretoMargin.address, 100000);
    await paretoMargin.connect(insurance).deposit(100000);
  });

  /****************************************
   * Contract construction
   ****************************************/  
  describe("Test construction", () => {
    it("Can construct construct", async () => {
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
      await usdc.connect(deployer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(deployer).deposit(1);
    });
    it("Keeper can deposit", async () => {
      await usdc.connect(keeper).approve(paretoMargin.address, 1);
      await paretoMargin.connect(keeper).deposit(1);
    });
    it("User can deposit", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
    });
    it("Emits an event", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await expect(paretoMargin.connect(buyer).deposit(1))
        .to.emit(paretoMargin, "DepositEvent")
        .withArgs(buyer.address, 1);
    });
    it("USDC is properly transferred", async () => {
      const marginPre = await usdc.balanceOf(paretoMargin.address);
      const userPre = await usdc.balanceOf(buyer.address);
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
      const marginPost = await usdc.balanceOf(paretoMargin.address);
      const userPost = await usdc.balanceOf(buyer.address);
      expect(marginPost.sub(marginPre)).to.be.equal("1");
      expect(userPre.sub(userPost)).to.be.equal("1");
    });
    it("Cannot deposit 0 USDC", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
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
    it("Default balance for insurance is 10k", async () => {
      expect(await paretoMargin.connect(insurance).getBalance()).to.be.equal("100000");
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
  });

  /****************************************
   * Withdrawal
   ****************************************/  
  describe("Withdrawing USDC", () => {
    beforeEach(async () => {
      // Depositor
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
    });
    it("Depositor can withdraw", async () => {
      await paretoMargin.connect(buyer).withdraw(1);
    });
    it("Depositor can withdraw all", async () => {
      await paretoMargin.connect(buyer).withdrawAll();
    });
    it("USDC is properly transferred", async () => {
      const marginPre = await usdc.balanceOf(paretoMargin.address);
      const userPre = await usdc.balanceOf(buyer.address);
      await paretoMargin.connect(buyer).withdraw(1);
      const marginPost = await usdc.balanceOf(paretoMargin.address);
      const userPost = await usdc.balanceOf(buyer.address);
      expect(marginPre.sub(marginPost)).to.be.equal("1");
      expect(userPost.sub(userPre)).to.be.equal("1");
    });
    it("Emits an event on withdrawal", async () => {
      await expect(paretoMargin.connect(buyer).withdraw(1))
        .to.emit(paretoMargin, "WithdrawEvent")
        .withArgs(buyer.address, 1);
    });
    it("Can withdraw all after two deposits", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);

      const marginPre = await usdc.balanceOf(paretoMargin.address);
      const userPre = await usdc.balanceOf(buyer.address);
      await paretoMargin.connect(buyer).withdrawAll();
      const marginPost = await usdc.balanceOf(paretoMargin.address);
      const userPost = await usdc.balanceOf(buyer.address);

      expect(marginPre.sub(marginPost)).to.be.equal("2");
      expect(userPost.sub(userPre)).to.be.equal("2");
    });
    it("Emits an event on withdrawal all", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
      await expect(paretoMargin.connect(buyer).withdrawAll())
        .to.emit(paretoMargin, "WithdrawEvent")
        .withArgs(buyer.address, 2);
    });
    it("Cannot withdraw 0 amount", async () => {
      await expect(
        paretoMargin.connect(buyer).withdraw(0)
      ).to.be.revertedWith("withdraw: amount must be > 0");
    });
    it("Cannot withdraw more than balance", async () => {
      await expect(
        paretoMargin.connect(buyer).withdraw(2)
      ).to.be.revertedWith("withdraw: amount > balance");
    });
    it("Cannot withdraw if failing margin check", async () => {
      // TODO
      expect(true).to.be.false;
    });
    it("Cannot withdraw all if failing margin check", async () => {
      // TODO
      expect(true).to.be.false;
    });
  });

  /****************************************
   * Rollover
   ****************************************/  
  describe("Rollover", () => {
    it("Cannot rollover if paused", async () => {
      await paretoMargin.connect(deployer).togglePause();
      await expect(paretoMargin.rollover([buyer.address]))
        .to.be.revertedWith("rollover: contract paused");
    });
  }); 

  /****************************************
   * Keeper management
   ****************************************/  
  describe("Managing keepers", () => {
    it("Owner can add keeper", async () => {
      await paretoMargin.connect(deployer).addKeepers([buyer.address]);
    });
    it("Owner can add multiple keepers at once", async () => {
      await paretoMargin.connect(deployer).addKeepers([buyer.address, seller.address]);
    });
    it("Owner can remove keeper", async () => {
      await paretoMargin.connect(deployer).addKeepers([keeper.address]);
      await paretoMargin.connect(deployer).removeKeepers([keeper.address]);
    });
    it("Keeper cannot add keeper", async () => {
      await expect(
        paretoMargin.connect(keeper).addKeepers([buyer.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Keeper cannot remove keeper", async () => {
      await paretoMargin.connect(deployer).addKeepers([keeper.address]);
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
      await paretoMargin.connect(deployer).addKeepers([keeper.address]);
      await expect(
        paretoMargin.connect(buyer).removeKeepers([keeper.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  /****************************************
   * Oracle management
   ****************************************/  
  describe("Managing oracles", () => {
    let newToken: Contract;
    let newSpotOracle: string;
    let newVolOracle: string;

    beforeEach(async () => {
      const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
      newToken = await MockERC20.deploy();

      const txReceiptUnresolvedSpot = await priceFeedFactory.create("newToken spot oracle", [keeper.address]);
      const txReceiptSpot = await txReceiptUnresolvedSpot.wait();
      newSpotOracle = txReceiptSpot.events![2].args![0];

      const txReceiptUnresolvedVol = await priceFeedFactory.create("newToken vol oracle", [keeper.address]);
      const txReceiptVol = await txReceiptUnresolvedVol.wait();
      newVolOracle = txReceiptVol.events![2].args![0];
    });
    it("Owner can set oracle for new underlying", async () => {
      await paretoMargin.connect(deployer).setOracle(newToken.address, newVolOracle, newVolOracle);
      expect(await paretoMargin.underlyings(0)).to.be.not.equal(await paretoMargin.underlyings(1));
    });
    it("Keeper cannot set oracle for new underlying", async () => {
      await expect(
        paretoMargin.connect(keeper).setOracle(newToken.address, newVolOracle, newVolOracle)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("User cannot set oracle for new underlying", async () => {
      await expect(
        paretoMargin.connect(buyer).setOracle(newToken.address, newVolOracle, newVolOracle)
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
    it("Keeper cannot pause contract", async () => {});
    it("User cannot unpause contract", async () => {});
    it("Owner can set max insured percent", async () => {});
    it("Owner can set min margin percent", async () => {});
    it("Keeper cannot set max insured percent", async () => {});
    it("Keeper cannot set min margin percent", async () => {});
    it("User cannot set max insured percent", async () => {});
    it("User cannot set min margin percent", async () => {});
  });
})