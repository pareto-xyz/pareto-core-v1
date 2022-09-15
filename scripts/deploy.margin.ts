import * as dotenv from "dotenv";
import { ethers, upgrades } from "hardhat";

dotenv.config();

async function main(
  insurance: string,
  feeRecipient: string,
  usdc: string,
  spotOracle: string,
  markOracle: string,
) {
  const [deployer] = await ethers.getSigners();
  const accountBalance = await deployer.getBalance();

  console.log("Deploying contract with account: ", deployer.address);
  console.log("Account balance: ", accountBalance.toString());

  // Deploy the pareto margin contract
  const MarginV1Factory = await ethers.getContractFactory("MarginV1", deployer);
  const marginV1 = await upgrades.deployProxy(
    MarginV1Factory,
    [
      usdc,
      insurance,
      feeRecipient,
      0,
      spotOracle,
      markOracle,
      5000,
    ]
  );
}

const runMain = async (
  insurance: string,
  feeRecipient: string,
  usdc: string,
  spotOracle: string,
  markOracle: string,
) => {
  try {
    await main(
      insurance,
      feeRecipient,
      usdc,
      spotOracle,
      markOracle,
    );
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

// TODO: fill me out once we have contracts deployed
const INSURANCE = "";
const FEERECIPIENT = "";
const USDC = "";
const SPOT = "";
const MARK = "";

runMain(INSURANCE, FEERECIPIENT, USDC, SPOT, MARK);
