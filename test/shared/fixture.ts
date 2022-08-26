import { ethers } from "hardhat";
import { MockERC20 } from "../../typechain-types";

/**
 * @notice Prepares margin contract prior to running any tests. Future tests
 * will have access to the contracts.
 */
export async function setupFixture() {
  const wallets = await ethers.getSigners(); 
  const [deployer, alice, keeper] = wallets;

  // Deploy a MockERC20 contract to mimic USDC
  const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
  const usdc = (await MockERC20.deploy()) as MockERC20;

  // Deploy Pareto margin contract
  const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
  const paretoMargin = await ParetoMargin.deploy(usdc.address);

  // Mint USDC for deployer, keeper, and alice
  // Everyone starts with 100k 
  await usdc.mint(deployer.address, 100000);
  await usdc.mint(keeper.address, 100000);
  await usdc.mint(alice.address, 100000);

  return {
    paretoMargin: paretoMargin,
    usdc: usdc,
    deployer,
    keeper,
    alice,
  };
}