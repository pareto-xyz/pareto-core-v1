import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

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
        count: 35,
        accountsBalance: "1000000000000000000000000",
      }
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