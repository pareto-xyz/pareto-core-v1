import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { getFixedGasSigners, toBytes32 } from "../utils/helpers";

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
const ONE_WEEK: number = 604800;

let derivative: Contract;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("Derivative Library", () => {
  beforeEach(async () => {
    // Create signers
    const wallets = await getFixedGasSigners(10000000);
    [alice, bob] = wallets;

    // Deploy derivatives
    const DerivativeFactory = await ethers.getContractFactory("TestDerivative");
    derivative = await DerivativeFactory.deploy();
    await derivative.deployed();
  });

  /****************************************
   * Option fingerprint
   ****************************************/
  describe("Hashing an option", () => {
    it("can hash an option", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option =  {
        isCall: true,
        strikeLevel: 5,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      await derivative.hashOption(option);
    });
    it("identical options hash the same", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option1 =  {
        isCall: true,
        strikeLevel: 5,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      const option2 =  {
        isCall: true,
        strikeLevel: 5,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      const hash1 = await derivative.hashOption(option1);
      const hash2 = await derivative.hashOption(option2);
      expect(hash1).to.be.equal(hash2);
    });
    it("two different options hash different", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option1 =  {
        isCall: true,
        strikeLevel: 5,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      const option2 =  {
        isCall: false,
        strikeLevel: 5,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      const hash1 = await derivative.hashOption(option1);
      const hash2 = await derivative.hashOption(option2);
      expect(hash1).to.be.not.equal(hash2);
    });
  });
});