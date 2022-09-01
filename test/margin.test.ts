import { ethers } from "hardhat";
import { BigNumber } from "ethers";
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

    // Deploy Pareto margin contract
    const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
    paretoMargin = await ParetoMargin.deploy();
    await paretoMargin.deployed();

    // Initialize Pareto margin account
    paretoMargin.initialize(
      usdc.address,
      insurance.address,
      weth.address,
      spotOracleAddress,
      volOracleAddress,
      []
    );
  });
})