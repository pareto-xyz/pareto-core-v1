import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";

/****************************************
 * Constants
 ****************************************/

 const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
 const ONE_WEEK: number = 604800;

/****************************************
 * Tests
 ****************************************/

let derivative: Contract;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("Derivative Library", () => {
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

    const DerivativeFactory = await ethers.getContractFactory(
      "TestDerivative",
      {
        libraries: {
          Derivative: derivativeLib.address,
        }
      }
    );
    derivative = await DerivativeFactory.deploy();
    await derivative.deployed();

    // Create signers
    const wallets = await ethers.getSigners(); 
    [alice, bob] = wallets;
  });

  /****************************************
   * Smile creation
   ****************************************/
  describe("Creating a smile", () => {

  });

  /****************************************
   * Order fingerprint
   ****************************************/
  describe("Hashing an order", () => {
    it("can hash an order", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      await derivative.hashOrder(order);
    });
    it("identical orders hash the same", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order1 = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const order2 = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const hash1 = await derivative.hashOrder(order1);
      const hash2 = await derivative.hashOrder(order2);
      expect(hash1).to.be.equal(hash2);
    });
    it("two different orders hash different", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order1 = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const order2 = {
        orderId: "test2",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const hash1 = await derivative.hashOrder(order1);
      const hash2 = await derivative.hashOrder(order2);
      expect(hash1).to.be.not.equal(hash2);
    });
  });

  /****************************************
   * Option fingerprint
   ****************************************/
  describe("Hashing an option", () => {
    it("can hash an option", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      await derivative.hashOption(option);
    });
    it("identical options hash the same", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option1 =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const option2 =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const hash1 = await derivative.hashOption(option1);
      const hash2 = await derivative.hashOption(option2);
      expect(hash1).to.be.equal(hash2);
    });
    it("two different options hash different", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option1 =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const option2 =  {
        optionType: 1,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const hash1 = await derivative.hashOption(option1);
      const hash2 = await derivative.hashOption(option2);
      expect(hash1).to.be.not.equal(hash2);
    });
  });

  /****************************************
   * Interpolation
   ****************************************/
  describe("Interpolation", () => {
  });

  /****************************************
   * Finding closest indices
   ****************************************/
  describe("Finding closest indices", () => {
  });
});