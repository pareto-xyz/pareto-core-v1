import * as dotenv from "dotenv";
import { ethers, upgrades } from "hardhat";

dotenv.config();

async function main(
  insuranceAddress: string,
  usdcAddress: string,
  ethSpotOracleAddress: string,
  ethVolOracleAddress: string,
  btcSpotOracleAddress: string,
  btcVolOracleAddress: string,
) {
  const [deployer] = await ethers.getSigners();
  const accountBalance = await deployer.getBalance();

  console.log("Deploying contract with account: ", deployer.address);
  console.log("Account balance: ", accountBalance.toString());

  // Deploy the pareto margin contract
  const ParetoMargin = await ethers.getContractFactory("ParetoV1Margin", deployer);
  const paretoMargin = await upgrades.deployProxy(
    ParetoMargin,
    [
      usdcAddress,
      insuranceAddress,
      "ETH",
      ethSpotOracleAddress,
      ethVolOracleAddress
    ]
  );

  // Create the BTC stuff
  await paretoMargin.connect(deployer).setOracle(
    "BTC",
    btcSpotOracleAddress,
    btcVolOracleAddress,
  );
}

const runMain = async (
  insuranceAddress: string,
  usdcAddress: string,
  ethSpotOracleAddress: string,
  ethVolOracleAddress: string,
  btcSpotOracleAddress: string,
  btcVolOracleAddress: string,
) => {
  try {
    await main(
      insuranceAddress,
      usdcAddress,
      ethSpotOracleAddress,
      ethVolOracleAddress,
      btcSpotOracleAddress,
      btcVolOracleAddress,
    );
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

// TODO: fill me out once we have contracts deployed
const INSURANCE = "";
const USDC = "";
const ETHSPOT = "";
const ETHVOL = "";
const BTCSPOT = "";
const BTCVOL = "";

runMain(INSURANCE, USDC, ETHSPOT, ETHVOL, BTCSPOT, BTCVOL);
