import * as dotenv from "dotenv";
import { ethers } from "hardhat";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const accountBalance = await deployer.getBalance();

  console.log("Deploying contract with account: ", deployer.address);
  console.log("Account balance: ", accountBalance.toString());

  const PriceFeedFactory = await ethers.getContractFactory("PriceFeedFactory");
  const priceFeedFactory = await PriceFeedFactory.deploy();
  await priceFeedFactory.deployed();

  // Deploy ETH spot oracle
  const txReceiptUnresolved1 = await priceFeedFactory.create("ETH spot", []);
  const txReceipt1 = await txReceiptUnresolved1.wait();
  const feedAddress1 = txReceipt1.events![2].args![0];
  console.log("ETH spot feed: ", feedAddress1);

  // Deploy BTC spot oracle
  const txReceiptUnresolved2 = await priceFeedFactory.create("BTC spot", []);
  const txReceipt2 = await txReceiptUnresolved2.wait();
  const feedAddress2 = txReceipt2.events![2].args![0];
  console.log("BTC spot feed: ", feedAddress2);

  // Deploy ETH vol oracle
  const txReceiptUnresolved3 = await priceFeedFactory.create("ETH vol", []);
  const txReceipt3 = await txReceiptUnresolved3.wait();
  const feedAddress3 = txReceipt3.events![2].args![0];
  console.log("ETH vol feed: ", feedAddress3);

  // Deploy BTC vol oracle
  const txReceiptUnresolved4 = await priceFeedFactory.create("BTC vol", []);
  const txReceipt4 = await txReceiptUnresolved4.wait();
  const feedAddress4 = txReceipt4.events![2].args![0];
  console.log("BTC vol feed: ", feedAddress4);
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