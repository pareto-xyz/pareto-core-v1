import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        runs: 200,
        enabled: true
      },
    },
  },
  networks: {
    hardhat: {
      accounts: {
        count: 10,
        accountsBalance: "1000000000000000000000000",
      },
      blockGasLimit: 1000000000000000,
      gas: "auto",
      allowUnlimitedContractSize: true
    },
  },
};

export default config;
