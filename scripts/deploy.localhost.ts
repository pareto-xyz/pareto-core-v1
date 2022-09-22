/**
 * All in one deploy to local hardhat network.
 */

import * as dotenv from "dotenv";
import { ethers, upgrades } from "hardhat";
import { toBn } from "evm-bn";

dotenv.config();

const ONEUSDC = toBn("1", 18);

async function main() {
  const [deployer, keeper, buyer, seller, insurance, feeRecipient] = await ethers.getSigners();
  console.log("Deployer: ", deployer.address);
  console.log("Keeper: ", keeper.address);
  console.log("Buyer: ", buyer.address);
  console.log("Seller: ", seller.address);
  console.log("Insurance: ", insurance.address);
  console.log("Fee Recipient: ", feeRecipient.address);

  const MockUsdcFactory = await ethers.getContractFactory("MockERC20");
  const usdc = await MockUsdcFactory.deploy();
  await usdc.deployed();
  console.log("Deployed mock USDC: ", usdc.address);

  await usdc.mint(deployer.address, ONEUSDC.mul(1e6));
  await usdc.mint(keeper.address, ONEUSDC.mul(1e6));
  await usdc.mint(buyer.address, ONEUSDC.mul(1e6));
  await usdc.mint(seller.address, ONEUSDC.mul(1e6));
  await usdc.mint(insurance.address, ONEUSDC.mul(1e6));
  console.log("Minted 1M mock USDC for users");
  
  const OracleFactory = await ethers.getContractFactory("Oracle");
  const oracle = await OracleFactory.deploy([keeper.address]);
  await oracle.deployed();
  console.log("Deployed ETH oracle: ", oracle.address);

  let callMarks = [];
  let putMarks = [];
  for (var i = 0; i < 11; i++) {
    callMarks.push(ONEUSDC.mul(130))
    putMarks.push(ONEUSDC.mul(130))
  }

  // Important to set spot price. For others, we make up numbers
  // We expect this to be updated soon after deployment
  await oracle.connect(deployer).setLatestData(
    ONEUSDC.mul(1300),
    0,
    callMarks,
    putMarks,
  );

  const MarginV1Factory = await ethers.getContractFactory("MarginV1", deployer);
  const marginV1 = await upgrades.deployProxy(
    MarginV1Factory,
    [
      usdc.address,
      insurance.address,
      feeRecipient.address,
      0,
      oracle.address,
      toBn("0.5", 4),
    ]
  );
  await marginV1.deployed();
  console.log("Deployed ETH margin contract: ", marginV1.address);

  await marginV1.connect(deployer).addKeepers([keeper.address]);
  console.log("Added keeper to margin contract");

  await usdc.connect(deployer).approve(marginV1.address, ONEUSDC.mul(1e6));
  await usdc.connect(keeper).approve(marginV1.address, ONEUSDC.mul(1e6));
  await usdc.connect(buyer).approve(marginV1.address, ONEUSDC.mul(1e6));
  await usdc.connect(seller).approve(marginV1.address, ONEUSDC.mul(1e6));
  console.log("Raise approval limit for deployer, keeper, buyer, and seller");

  // Have deployer, keeper, buyer, seller all deposit 1000 USDC
  await marginV1.connect(deployer).deposit(toBn("1000", 18))
  await marginV1.connect(keeper).deposit(toBn("1000", 18))
  await marginV1.connect(buyer).deposit(toBn("1000", 18))
  await marginV1.connect(seller).deposit(toBn("1000", 18))
  console.log("Depositing 1k USDC deployer, keeper, buyer, and seller");
}

const runMain = async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

runMain();