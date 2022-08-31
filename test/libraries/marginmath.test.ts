import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import {
  getPayoffLongCall,
  getPayoffShortCall,
  getPayoffLongPut,
  getPayoffShortPut,
} from "../utils/payoff";

/****************************************
 * Constants
 ****************************************/

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
const ONE_WEEK: number = 604800;

/****************************************
 * Tests
 ****************************************/

let marginMath: Contract;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("MarginMath Library", () => {
  beforeEach(async () => {
    const MarginMathFactory =  await ethers.getContractFactory("TestMarginMath");
    marginMath = await MarginMathFactory.deploy();
  });

  /****************************************
   * Check if a call or put
   ****************************************/
  describe("Fetching option type", () => {
    it("Identifies call", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const call = {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
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
      };
      let answer = await marginMath.isCall(put);
      expect(answer).to.be.false;
    });
  });

  /****************************************
   * Payoff computation
   ****************************************/
  describe("Computing payoff", () => {
    beforeEach(async () => {
      // Create signers
      const wallets = await ethers.getSigners(); 
      [alice, bob] = wallets;
    });

    it("Payoff for buying a call: OTM", async () => {
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
      const [payoff, isNegative] = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongCall(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for selling a call: OTM", async () => {
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
      const [payoff, isNegative] = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortCall(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for buying a put: OTM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: 5,
        option: {
          optionType: 1,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongPut(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for selling a put: OTM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: 5,
        option: {
          optionType: 1,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortPut(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });

    it("Payoff for buying a call: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongCall(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for selling a call: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortCall(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for buying a put: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 1,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongPut(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for selling a put: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 1,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortPut(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for buying a call: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(alice.address, ONE_ETH, order); 
      const payoffts = getPayoffLongCall(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for selling a call: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortCall(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for buying a put: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: 5,
        option: {
          optionType: 1,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongPut(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
    it("Payoff for selling a put: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        orderId: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: 5,
        option: {
          optionType: 1,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const [payoff, isNegative] = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortPut(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(Math.abs(payoffts), 1e-5);
      expect(isNegative).to.be.equal(payoffts < 0);
    });
  });
  /****************************************
   * Alternative minimum calculation
   ****************************************/
  describe("Computing alternative minimums", () => {
    it("can compute alternative minimums", async () => {
      await marginMath.getAlternativeMinimum(ONE_ETH, 100);
    });
    it("correct alternative min with 1%", async () => {
      const minMargin = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      expect(fromBn(minMargin, 18)).to.be.equal("0.01");
    });
    it("correct alternative min with 5%", async () => {
      const minMargin = await marginMath.getAlternativeMinimum(ONE_ETH, 500);
      expect(fromBn(minMargin, 18)).to.be.equal("0.05");
    });
    it("correct alternative min with 0.5%", async () => {
      const minMargin = await marginMath.getAlternativeMinimum(ONE_ETH, 50);
      expect(fromBn(minMargin, 18)).to.be.equal("0.005");
    });
    it("correct alternative min with spot 2 ETH", async () => {
      const minMargin = await marginMath.getAlternativeMinimum(ONE_ETH.mul(2), 100);
      expect(fromBn(minMargin, 18)).to.be.equal("0.02");
    });
    it("correct alternative min with spot 5 ETH", async () => {
      const minMargin = await marginMath.getAlternativeMinimum(ONE_ETH.mul(5), 100);
      expect(fromBn(minMargin, 18)).to.be.equal("0.05");
    });
  });
});