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
import { getFixedGasSigners } from "../utils/helpers";

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
   * Payoff computation
   ****************************************/
  describe("Computing payoff", () => {
    beforeEach(async () => {
      // Create signers
      const wallets = await getFixedGasSigners(10000000);
      [alice, bob] = wallets;
    });

    it("Payoff for buying a call: OTM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongCall(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for selling a call: OTM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: true,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortCall(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for buying a put: OTM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: false,
          strikeLevel: 4,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongPut(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for selling a put: OTM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: false,
          strikeLevel: 4,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortPut(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });

    it("Payoff for buying a call: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: true,
          strikeLevel: 4,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongCall(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for selling a call: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(9).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: true,
          strikeLevel: 4,
          strike: ONE_ETH.mul(9).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortCall(1, 0.9, 0.09, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for buying a put: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: false,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongPut(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for selling a put: ITM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: toBn("5", 4),
        option: {
          isCall: false,
          strikeLevel: 6,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortPut(1, 1.1, 0.11, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for buying a call: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: toBn("5", 4),
        option: {
          isCall: true,
          strikeLevel: 5,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(alice.address, ONE_ETH, order); 
      const payoffts = getPayoffLongCall(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for selling a call: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: toBn("5", 4),
        option: {
          isCall: true,
          strikeLevel: 5,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortCall(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for buying a put: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: toBn("5", 4),
        option: {
          isCall: false,
          strikeLevel: 5,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(alice.address, ONE_ETH, order);
      const payoffts = getPayoffLongPut(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
    });
    it("Payoff for selling a put: ATM", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        id: "test",
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.div(10),
        quantity: toBn("5", 4),
        option: {
          isCall: false,
          strikeLevel: 5,
          strike: ONE_ETH,
          expiry: curTime + ONE_WEEK,
          underlying: 0,
          decimals: 18,
        }
      };
      const payoff = await marginMath.getPayoff(bob.address, ONE_ETH, order);
      const payoffts = getPayoffShortPut(1, 1, 0.1, 5);

      expect(parseFloat(fromBn(payoff, 18))).to.be.closeTo(payoffts, 1e-5);
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
    let mark: BigNumber;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        isCall: false,  // put option
        strikeLevel: 6,
        strike: ONE_ETH.mul(11).div(10),
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      // Set a random mark price
      mark = ONE_ETH.div(10); 
    });
    it("can compute initial margin", async () => {
      await marginMath.getInitialMargin(ONE_ETH, true, option, mark, 0);
    });
    it("buyer,spot=1,min=0%", async () => {
      // Any buyer's margin is just the premium
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot10 = 0.1 * 1;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1 - 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      const margints = Math.min(Math.max(spot20 - otmAmount, spot125), strike50);

      // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
      // max(0.2 * 1 - 0.1 * 1, 0.125 * 1) = 0.125
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(15).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot10 = 0.1 * 1.5;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(15).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1.5 - 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot20 = 0.2 * 1.5;
      const spot125 = 0.125 * 1.5;
      const margints = Math.min(Math.max(spot20 - otmAmount, spot125), strike50);

      // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
      // max(0.2 * 1.5 - 0.4 * 1.5, 0.125 * 1.5) = 0.1875
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=0.9,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(9).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot10 = 0.1 * 0.9;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=0.9,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(9).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot20 = 0.2 * 0.9;
      const spot125 = 0.125 * 0.9;
      const margints = Math.min(Math.max(spot20 - otmAmount, spot125), strike50);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1,min=1%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, mark, 100);
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      const spot10 = 0.1 * 1;  // 10% spot

      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const minMargin = parseFloat(fromBn(minMarginBn, 18));
      const margints = Math.max(Math.min(premium, spot10), minMargin);
      
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("seller,spot=1,min=1%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, mark, 100);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1- 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      var margints = Math.max(spot20 - otmAmount, spot125);

      // max((20% - OTM Amount/spot)*spot, 12.5% * spot)
      // max(0.2 * 1 - (0) * 1, 0.125 * 1) = 0.2
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      const minMargin = parseFloat(fromBn(minMarginBn, 18));

      margints = Math.min(Math.max(margints, minMargin), strike50);
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1,min=50%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, mark, 5000);
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 5000);
      const spot10 = 0.1 * 1;  // 10% spot

      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const minMargin = parseFloat(fromBn(minMarginBn, 18));
      const margints = Math.max(Math.min(premium, spot10), minMargin);
      
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("seller,spot=1,min=50%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, mark, 5000);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1- 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      var margints = Math.max(spot20 - otmAmount, spot125);

      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 5000);
      const minMargin = parseFloat(fromBn(minMarginBn, 18));

      margints = Math.min(Math.max(margints, minMargin), strike50);
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
  });

  describe("Computing initial margin for calls", () => {
    let option: any;
    let mark: BigNumber;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        isCall: true,  // call option
        strikeLevel: 4,
        strike: ONE_ETH.mul(9).div(10),
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      mark = ONE_ETH.div(10);
    });
    it("can compute initial margin", async () => {
      await marginMath.getInitialMargin(ONE_ETH, true, option, mark, 0);
    });
    it("buyer,spot=1,min=0%", async () => {
      // Any buyer's margin is just the premium
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot10 = 0.1 * 1;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH, false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1, 0);
      const spot20 = 0.2 * 1;
      const spot125 = 0.125 * 1;
      const margints = Math.max(spot20 - otmAmount, spot125);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1.2,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(12).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot10 = 0.1 * 1.2;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(12).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1.2, 0);
      const spot20 = 0.2 * 1.2;
      const spot125 = 0.125 * 1.2;
      const margints = Math.max(spot20 - otmAmount, spot125);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=0.7,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(7).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot10 = 0.1 * 0.7;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot10), 1e-6);
    });
    it("seller,spot=0.7,min=0%", async () => {
      const marginBn = await marginMath.getInitialMargin(ONE_ETH.mul(7).div(10), false, option, mark, 0);
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
  describe("Computing maintainence margin for puts", () => {
    let option: any;
    let mark: BigNumber;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        isCall: false,  // put option
        strikeLevel: 6,
        strike: ONE_ETH.mul(11).div(10),
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      mark = ONE_ETH.div(10);
    });
    it("can compute initial margin", async () => {
      await marginMath.getMaintainenceMargin(ONE_ETH, true, option, mark, 0);
    });
    it("buyer,spot=1,min=0%", async () => {
      // Any buyer's margin is just the premium
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot065 = 0.065 * 1;
      expect(margin).to.be.closeTo(Math.min(premium, spot065), 1e-6);
    });
    it("seller,spot=1,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1 - 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot10 = 0.1 * 1;
      const spot8 = 0.08 * 1;
      const margints = Math.min(Math.max(spot10 - otmAmount, spot8), strike50);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(15).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot065 = 0.065 * 1.5;
      expect(margin).to.be.closeTo(Math.min(premium, spot065), 1e-6);
    });
    it("seller,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(15).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1.5 - 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot10 = 0.1 * 1.5;
      const spot8 = 0.08 * 1.5;
      const margints = Math.min(Math.max(spot10 - otmAmount, spot8), strike50);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=0.9,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(9).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot065 = 0.065 * 0.9;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot065), 1e-6);
    });
    it("seller,spot=0.9,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(9).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot10 = 0.1 * 0.9;
      const spot8 = 0.08 * 0.9;
      const margints = Math.min(Math.max(spot10 - otmAmount, spot8), strike50);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1,min=1%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, true, option, mark, 100);
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      const spot065 = 0.065 * 1;

      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const minMargin = parseFloat(fromBn(minMarginBn, 18));
      const margints = Math.max(Math.min(premium, spot065), minMargin);
      
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("seller,spot=1,min=1%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, false, option, mark, 100);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1- 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot10 = 0.1 * 1;
      const spot8 = 0.08 * 1;
      var margints = Math.max(spot10 - otmAmount, spot8);

      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 100);
      const minMargin = parseFloat(fromBn(minMarginBn, 18));

      margints = Math.min(Math.max(margints, minMargin), strike50);
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1,min=50%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, true, option, mark, 5000);
      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 5000);
      const spot065 = 0.065 * 1;

      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const minMargin = parseFloat(fromBn(minMarginBn, 18));
      const margints = Math.max(Math.min(premium, spot065), minMargin);
      
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("seller,spot=1,min=50%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, false, option, mark, 5000);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(1- 1.1, 0);
      const strike50 = 0.5 * 1.1;
      const spot10 = 0.1 * 1;
      const spot8 = 0.08 * 1;
      var margints = Math.max(spot10 - otmAmount, spot8);

      const minMarginBn = await marginMath.getAlternativeMinimum(ONE_ETH, 5000);
      const minMargin = parseFloat(fromBn(minMarginBn, 18));

      margints = Math.min(Math.max(margints, minMargin), strike50);
      expect(margin).to.be.closeTo(margints, 1e-6);
    });
  });

  describe("Computing maintainence margin for calls", () => {
    let option: any;
    let mark: BigNumber;
    beforeEach(async () => {
      const curTime = Math.floor(Date.now() / 1000);
      option = {
        isCall: true,  // call option
        strikeLevel: 4,
        strike: ONE_ETH.mul(9).div(10),
        expiry: curTime + ONE_WEEK,
        underlying: 0,
        decimals: 18,
      };
      mark = ONE_ETH.div(10);
    });
    it("can compute initial margin", async () => {
      await marginMath.getMaintainenceMargin(ONE_ETH, true, option, mark, 0);
    });
    it("buyer,spot=1,min=0%", async () => {
      // Any buyer's margin is just the premium
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot65 = 0.065 * 1;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot65), 1e-6);
    });
    it("seller,spot=1,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH, false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1, 0);
      const spot10 = 0.1 * 1;
      const spot8 = 0.08 * 1;
      const margints = Math.max(spot10 - otmAmount, spot8);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=1.2,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(12).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot65 = 0.065 * 1.2;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot65), 1e-6);
    });
    it("seller,spot=1.5,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(12).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 1.2, 0);
      const spot10 = 0.1 * 1.2;
      const spot8 = 0.08 * 1.2;
      const margints = Math.max(spot10 - otmAmount, spot8);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
    it("buyer,spot=0.7,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(7).div(10), true, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));
      const premium = parseFloat(fromBn(mark, 18));
      const spot65 = 0.065 * 0.7;  // 10% spot
      expect(margin).to.be.closeTo(Math.min(premium, spot65), 1e-6);
    });
    it("seller,spot=0.7,min=0%", async () => {
      const marginBn = await marginMath.getMaintainenceMargin(ONE_ETH.mul(7).div(10), false, option, mark, 0);
      const margin = parseFloat(fromBn(marginBn, 18));

      const otmAmount = Math.max(0.9 - 0.7, 0);
      const spot10 = 0.1 * 0.7;
      const spot8 = 0.08 * 0.7;
      const margints = Math.max(spot10 - otmAmount, spot8);

      expect(margin).to.be.closeTo(margints, 1e-6);
    });
  });

});