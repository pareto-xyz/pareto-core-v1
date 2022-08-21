import hre, { ethers } from "hardhat";
import { Wallet } from "ethers";
import { createFixtureLoader, MockProvider } from "ethereum-waffle";
import { MockERC20 } from "../../typechain-types";

/**
 * @notice Prepares margin contract prior to running any tests. Future tests
 * will have access to the contracts.
 * @param description is a description of the test
 * @param runTests is a callback to run other tests
 */
export function runTest(description: string, runTests: Function): void {
  describe(description, function () {
    beforeEach(async function() {
      const wallets = await hre.ethers.getSigners(); 
      const [deployer, alice, keeper] = wallets;
      const loadFixture = createFixtureLoader(wallets as unknown as Wallet[]);
      const loadedFixture = await loadFixture(fixture);

      this.contracts = {
        paretoMargin: loadedFixture.margin,
        usdc: loadedFixture.usdc,
      };

      this.wallets = {
        deployer,
        keeper,
        alice,
      };
    });
    
    runTests(); 
  });
}

export async function fixture(
  [deployer, keeper, alice]: Wallet[],
  provider: MockProvider
) {
  // Deploy a MockERC20 contract to mimic USDC
  const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
  const usdc = (await MockERC20.deploy()) as MockERC20;

  // Deploy Pareto margin contract
  const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
  const paretoMargin = await ParetoMargin.deploy(usdc.address);

  // Mint USDC for deployer, keeper, and alice
  await usdc.mint(deployer.address);
  await usdc.mint(keeper.address);
  await usdc.mint(alice.address);

  return {
    usdc, 
    paretoMargin,
    deployer,
    keeper,
    alice
  };
}