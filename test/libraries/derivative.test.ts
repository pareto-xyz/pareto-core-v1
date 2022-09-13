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
   * Order fingerprint
   ****************************************/
  describe("Hashing an order", () => {
    it("can hash an order", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      await derivative.hashOrder(order);
    });
    it("identical orders hash the same", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order1 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const order2 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const hash1 = await derivative.hashOrder(order1);
      const hash2 = await derivative.hashOrder(order2);
      expect(hash1).to.be.equal(hash2);
    });
    it("different orders hash different", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order1 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const order2 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(10).div(100),
        quantity: 10,
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(12).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const hash1 = await derivative.hashOrder(order1);
      const hash2 = await derivative.hashOrder(order2);
      expect(hash1).to.not.be.equal(hash2);
    });
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