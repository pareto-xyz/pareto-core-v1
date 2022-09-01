import * as dotenv from "dotenv";
import { ethers } from "hardhat";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const accountBalance = await deployer.getBalance();

  console.log("Deploying contract with account: ", deployer.address);
  console.log("Account balance: ", accountBalance.toString());

  const PriceFeedFactory = await ethers.getContractFactory("PriceFeed");

  const ethPriceFeed = await PriceFeedFactory.deploy("ETH spot", []);
  await ethPriceFeed.deployed();

  const btcPriceFeed = await PriceFeedFactory.deploy("BTC spot", []);
  await btcPriceFeed.deployed();

  const ethVolFeed = await PriceFeedFactory.deploy("ETH vol", []);
  await ethVolFeed.deployed();

  const btcVolFeed = await PriceFeedFactory.deploy("BTC vol", []);
  await btcVolFeed.deployed();

  console.log("ETH spot feed: ", ethPriceFeed.address);
  console.log("BTC spot feed: ", btcPriceFeed.address);
  console.log("ETH vol feed: ", ethVolFeed.address);
  console.log("BTC vol feed: ", btcVolFeed.address);
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