import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

dotenv.config();

const config: HardhatUserConfig = {
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts"
  },
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
      blockGasLimit: 18e6,
      gas: 12e6,
      allowUnlimitedContractSize: true
    },
    rinkeby: {
      url: process.env.RINKEBY_INFURA_URL || "",
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
