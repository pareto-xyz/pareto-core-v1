import { ethers, upgrades } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

let usdc: Contract;
let weth: Contract;
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

    // Deploy a MockERC20 contract to mimic WETH
    weth = await MockERC20.deploy();

    // Mint 100k WETH for deployer, keeper, buyer and seller
    await usdc.mint(insurance.address, 100000);
    await weth.mint(deployer.address, 100000);
    await weth.mint(keeper.address, 100000);
    await weth.mint(buyer.address, 100000);
    await weth.mint(seller.address, 100000);
    await weth.mint(insurance.address, 100000);

    // Deploy a price feed factory and create a spot and vol oracle
    const PriceFeedFactory = await ethers.getContractFactory("PriceFeedFactory", deployer);
    const priceFeedFactory = await PriceFeedFactory.deploy();
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
  });

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
    it("Deposit reflected in balance", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await paretoMargin.connect(buyer).deposit(1);
      expect(await paretoMargin.connect(buyer).getBalance()).to.be.equal("1");
    });
    it("Cannot deposit 0 USDC", async () => {
      await usdc.connect(buyer).approve(paretoMargin.address, 1);
      await expect(paretoMargin.connect(buyer).deposit(0))
        .to.be.revertedWith("deposit: `amount` must be > 0");
    });
  });

  describe("Withdrawing USDC", () => {
    it("Depositor can withdraw", async () => {});
    it("Depositor can withdraw all", async () => {});
    it("USDC is properly transferred", async () => {});
    it("Emits an event", async () => {});
    it("Cannot withdraw 0 amount", async () => {});
    it("Cannot withdraw more than balance", async () => {});
    it("Cannot withdraw if failing margin check", async () => {});
    it("Cannot withdraw all if failing margin check", async () => {});
  });
})