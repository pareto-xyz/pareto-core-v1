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
let derivative: Contract;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("MarginMath Library", () => {
  beforeEach(async () => {
    // Deploy derivatives
    const DerivativeFactory = await ethers.getContractFactory("TestDerivative");
    derivative = await DerivativeFactory.deploy();

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
  /****************************************
   * Get initial margin
   ****************************************/
  describe("Computing initial margin for puts", () => {
    let option: any;
    let smile: any;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        optionType: 1,  // put option
        strike: ONE_ETH.mul(11).div(10),
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      await derivative.createSmile(1, 5000);
      smile = await derivative.fetchSmile(1);
    });
    it("can compute initial margin", async () => {
      await marginMath.getInitialMargin(ONE_ETH, true, option, smile, 0);
    });
    it("buyer,spot=1,min=0%", async () => {
      // Any buyer's margin is just the premium
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, smile, 0);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH, 5000);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const spot10 = 0.1 * 1;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, smile, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1 - 1.1, 0);
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      const margints = Math.max(spot20 - otmAmount, spot125);

      // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
      // max(0.2 * 1 - 0.1 * 1, 0.125 * 1) = 0.125
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(15).div(10), true, option, smile, 0);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH.mul(15).div(10), 5000);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const spot10 = 0.1 * 1.5;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(15).div(10), false, option, smile, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1.5 - 1.1, 0);
      const spot20 = 0.2 * 1.5;
      const spot125 = 0.125 * 1.5;
      const margints = Math.max(spot20 - otmAmount, spot125);

      // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
      // max(0.2 * 1.5 - 0.4 * 1.5, 0.125 * 1.5) = 0.1875
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=0.9,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(9).div(10), true, option, smile, 0);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH.mul(9).div(10), 5000);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const spot10 = 0.1 * 0.9;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=0.9,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(9).div(10), false, option, smile, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1.1, 0);
      const spot20 = 0.2 * 0.9;
      const spot125 = 0.125 * 0.9;
      const margints = Math.max(spot20 - otmAmount, spot125);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1,min=1%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, smile, 100);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH, 5000);
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      const spot10 = 0.1 * 1;  // 10% spot

      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const minMargin = parseFloat(fromBn(minMarginBn, 18));
      const margints = Math.max(Math.min(premium, spot10), minMargin);
      
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("seller,spot=1,min=1%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, smile, 100);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1- 1.1, 0);
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      var margints = Math.max(spot20 - otmAmount, spot125);

      // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
      // max(0.2 * 1 - (0) * 1, 0.125 * 1) = 0.2
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      const minMargin = parseFloat(fromBn(minMarginBn, 18));

      margints = Math.max(margints, minMargin);
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1,min=50%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, smile, 5000);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH, 5000);
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 5000);
      const spot10 = 0.1 * 1;  // 10% spot

      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const minMargin = parseFloat(fromBn(minMarginBn, 18));
      const margints = Math.max(Math.min(premium, spot10), minMargin);
      
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("seller,spot=1,min=50%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, smile, 5000);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1- 1.1, 0);
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      var margints = Math.max(spot20 - otmAmount, spot125);

      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 5000);
      const minMargin = parseFloat(fromBn(minMarginBn, 18));

      margints = Math.max(margints, minMargin);
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
  });

  describe("Computing initial margin for calls", () => {
    let option: any;
    let smile: any;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        optionType: 0,  // call option
        strike: ONE_ETH.mul(9).div(10),
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      await derivative.createSmile(1, 5000);
      smile = await derivative.fetchSmile(1);
    });
    it("can compute initial margin", async () => {
      await marginMath.getInitialMargin(ONE_ETH, true, option, smile, 0);
    });
    it("buyer,spot=1,min=0%", async () => {
      // Any buyer's margin is just the premium
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, smile, 0);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH, 5000);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const spot10 = 0.1 * 1;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, smile, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1, 0);
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      const margints = Math.max(spot20 - otmAmount, spot125);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1.2,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(12).div(10), true, option, smile, 0);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH.mul(12).div(10), 5000);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const spot10 = 0.1 * 1.2;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(12).div(10), false, option, smile, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1.2, 0);
      const spot20 = 0.2 * 1.2;
      const spot125 = 0.125 * 1.2;
      const margints = Math.max(spot20 - otmAmount, spot125);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=0.7,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(7).div(10), true, option, smile, 0);
      const premiumBn = await derivative.getMarkPrice(option, ONE_ETH.mul(7).div(10), 5000);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(premiumBn, 18));
      const spot10 = 0.1 * 0.7;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=0.7,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(7).div(10), false, option, smile, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 0.7, 0);
      const spot20 = 0.2 * 0.7;
      const spot125 = 0.125 * 0.7;
      const margints = Math.max(spot20 - otmAmount, spot125);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
  });

  /****************************************
   * Get maintainence margin
   ****************************************/
  describe("Computing maintainence margin", () => {
    let option: any;
    let smile: any;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        optionType: 0,  // call option
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      await derivative.createSmile(1, 5000);
      smile = await derivative.fetchSmile(1);
    });
  });
});