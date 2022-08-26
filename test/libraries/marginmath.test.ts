import hre, { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
const ONE_WEEK: number = 604800;

let marginMath: Contract;

describe("MarginMath Library", () => {
  beforeEach(async () => {
    const BlackScholesMathLib = await ethers.getContractFactory("BlackScholesMath");
    const blackScholesMathLib = await BlackScholesMathLib.deploy();
    await blackScholesMathLib.deployed();

    const DerivativeLib = await ethers.getContractFactory(
      "Derivative",
      {
        libraries: {
          BlackScholesMath: blackScholesMathLib.address,
        }
      }
    );
    const derivativeLib = await DerivativeLib.deploy();
    await derivativeLib.deployed();

    const MarginMathLib = await ethers.getContractFactory(
      "MarginMath",
      {
        libraries: {
          Derivative: derivativeLib.address,
        }
      }
    );
    const marginMathLib = await MarginMathLib.deploy();
    await marginMathLib.deployed();

    const MarginMathFactory =  await ethers.getContractFactory(
      "TestMarginMath",
      {
        libraries: {
          MarginMath: marginMathLib.address,
        }
      }
    );
    marginMath = await MarginMathFactory.deploy();
  });

  describe("Fetching option type", () => {
    it("Identifies call", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const call = {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      }
      let answer = await marginMath.isCall(call);
      expect(answer).to.be.true;
    });
    it("Identifies put", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const put = {
        optionType: 1,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      }
      let answer = await marginMath.isCall(put);
      expect(answer).to.be.false;
    });
  });

  describe("Computing payoff", () => {
  });

  describe("Computing maintainence margin", () => {
  });
});