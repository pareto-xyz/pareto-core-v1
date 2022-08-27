import hre, { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
import {
  checkCallPrice,
  checkPutPrice,
  checkProbabilityFactors,
  checkSigmaFromCallPrice,
  checkSigmaFromPutPrice,
  checkCallVega,
  checkPutVega,
} from "../utils/blackscholes";

/****************************************
 * Constants
 ****************************************/

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
const ONEONE_ETH: BigNumber = ONE_ETH.mul(11).div(10);
const ONE_DAY: number = 86400;
const ONE_WEEK: number = 604800;

/****************************************
 * Helper Functions
 ****************************************/

function sigmaToBn(sigma: number): BigNumber {
  return toBn(sigma.toString(), 4);
}

function volToBn(vol: number): BigNumber {
  return toBn(vol.toString(), 4);
}

/****************************************
 * Tests
 ****************************************/

let blackScholesMath: Contract;

describe("BlackScholesMath Library", () => {
  beforeEach(async () => {
    const BlackScholesMathLib = await ethers.getContractFactory("BlackScholesMath");
    const blackScholesMathLib = await BlackScholesMathLib.deploy();
    await blackScholesMathLib.deployed();

    // Link the lib to the test contract
    const BlackScholesMathFactory = await hre.ethers.getContractFactory(
      "TestBlackScholesMath",
      {
        libraries: {
          BlackScholesMath: blackScholesMathLib.address,
        }
      }
    );
    blackScholesMath = await BlackScholesMathFactory.deploy();
  });

  /****************************************
   * Probability factors
   ****************************************/
  describe("Computing probability factors", () => {
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      // 10**(18-18) = 10**0 = 1
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 1.1, 0.5, ONE_WEEK, 0);
      expect(d1).to.be.closeTo(d1ts, 0.001);
      expect(d2).to.be.closeTo(d2ts, 0.001);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.9,tau=1 week,rate=0", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.9), ONE_WEEK, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 1.1, 0.9, ONE_WEEK, 0);
      expect(d1).to.be.closeTo(d1ts, 0.001);
      expect(d2).to.be.closeTo(d2ts, 0.001);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 1.1, 0.5, ONE_DAY, 0);
      expect(d1).to.be.closeTo(d1ts, 0.01);
      expect(d2).to.be.closeTo(d2ts, 0.01);
    });
    it("spot=2 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONEONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1.1, 1.1, 0.5, ONE_WEEK, 0);
      expect(d1).to.be.closeTo(d1ts, 0.001);
      expect(d2).to.be.closeTo(d2ts, 0.001);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0.1 ETH", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(10), 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 1.1, 0.5, ONE_WEEK, 0.1);
      expect(d1).to.be.closeTo(d1ts, 0.001);
      expect(d2).to.be.closeTo(d2ts, 0.001);
    });
  });
  /****************************************
   * Call prices
   ****************************************/
  describe("Computing call price", () => {
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getCallPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getCallPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.1, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      var priceBn = await blackScholesMath.getCallPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_DAY, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getCallPrice(
        ONEONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1.1, 1.1, 0.5, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("Reverts if rate is too big", async () => {
      // Underflow error
      expect(blackScholesMath.getCallPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(10), 1)
      ).to.be.rejected;
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_WEEK, 0.1);
      expect(pricets).to.be.lessThan(0);
    });
    it("spot=1.1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0.01", async () => {
      var priceBn = await blackScholesMath.getCallPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_WEEK, 0.01);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
  });
  /****************************************
   * Put prices
   ****************************************/
  describe("Computing put price", () => {
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPutPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.5, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPutPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.1, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      var priceBn = await blackScholesMath.getPutPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_DAY, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.1, ONE_DAY, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPutPrice(
        ONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1, 1, 0.1, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0.01 ETH", async () => {
      var priceBn = await blackScholesMath.getPutPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.5, ONE_WEEK, 0.01);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
  });
  /****************************************
   * Volatility from calls
   ****************************************/
  describe("Approximating vol from call price", () => {
    it("spot=1,strike=1.1,tau=1 week,rate=0,tradePrice=1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromCallPrice(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, ONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromCallPrice(1, 1.1, ONE_WEEK, 0, 1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1,strike=1.1,tau=1 day,rate=0,tradePrice=1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromCallPrice(
        ONE_ETH, ONEONE_ETH, ONE_DAY, 0, ONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromCallPrice(1, 1.1, ONE_DAY, 0, 1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1,strike=1.1,tau=1 week,rate=0,tradePrice=1.1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromCallPrice(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, ONEONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromCallPrice(1, 1.1, ONE_WEEK, 0, 1.1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1,strike=1.1,tau=1 week,rate=0,tradePrice=0.9", async () => {
      const volBn = await blackScholesMath.solveSigmaFromCallPrice(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, ONE_ETH.mul(9).div(10), 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromCallPrice(1, 1.1, ONE_WEEK, 0, 0.9);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1,strike=1.1,tau=1 week,rate=0,tradePrice=1.2", async () => {
      const volBn = await blackScholesMath.solveSigmaFromCallPrice(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, ONE_ETH.mul(12).div(10), 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromCallPrice(1, 1.1, ONE_WEEK, 0, 1.2);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1,strike=1.1,tau=1 week,rate=0.01,tradePrice=1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromCallPrice(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, ONE_ETH.div(100), ONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromCallPrice(1, 1.1, ONE_WEEK, 0, 1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
  });
  /****************************************
   * Volatility from puts
   ****************************************/
  describe("Approximating vol from put price", () => {
    it("spot=1.1,strike=1,tau=1 week,rate=0,tradePrice=1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromPutPrice(
        ONEONE_ETH, ONE_ETH, ONE_WEEK, 0, ONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromPutPrice(1.1, 1, ONE_WEEK, 0, 1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1.1,strike=1,tau=1 day,rate=0,tradePrice=1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromPutPrice(
        ONEONE_ETH, ONE_ETH, ONE_DAY, 0, ONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromPutPrice(1.1, 1, ONE_DAY, 0, 1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1.1,strike=1,tau=1 week,rate=0,tradePrice=1.1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromPutPrice(
        ONEONE_ETH, ONE_ETH, ONE_WEEK, 0, ONEONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromPutPrice(1.1, 1, ONE_WEEK, 0, 1.1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1.1,strike=1,tau=1 week,rate=0,tradePrice=0.9", async () => {
      const volBn = await blackScholesMath.solveSigmaFromPutPrice(
        ONEONE_ETH, ONE_ETH, ONE_WEEK, 0, ONE_ETH.mul(9).div(10), 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromPutPrice(1.1, 1, ONE_WEEK, 0, 0.9);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1.1,strike=1,tau=1 week,rate=0,tradePrice=1.2", async () => {
      const volBn = await blackScholesMath.solveSigmaFromPutPrice(
        ONEONE_ETH, ONE_ETH, ONE_WEEK, 0, ONE_ETH.mul(12).div(10), 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromPutPrice(1.1, 1, ONE_WEEK, 0, 1.2);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
    it("spot=1.1,strike=1,tau=1 week,rate=0.01,tradePrice=1", async () => {
      const volBn = await blackScholesMath.solveSigmaFromPutPrice(
        ONEONE_ETH, ONE_ETH, ONE_WEEK, ONE_ETH.div(100), ONE_ETH, 1);
      const vol = parseFloat(fromBn(volBn, 18));
      const volts = checkSigmaFromPutPrice(1.1, 1, ONE_WEEK, 0, 1);
      expect(vol).to.be.closeTo(volts, 1e-5);
    });
  });
  /****************************************
   * Vega
   ****************************************/
  describe("Computing call vega", () => {
    it("spot=1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getCallVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkCallVega(1, 1.1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getCallVega(
        ONEONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkCallVega(1.1, 1.1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1,strike=1.1,sigma=0.1,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getCallVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.8), ONE_WEEK, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkCallVega(1, 1.1, 0.8, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1,strike=1.1,sigma=0.5,tau=1 day,rate=0", async () => {
      const vegaBn = await blackScholesMath.getCallVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkCallVega(1, 1.1, 0.5, ONE_DAY, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1,strike=1.1,sigma=0.5,tau=1 week,rate=0.01", async () => {
      const vegaBn = await blackScholesMath.getCallVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkCallVega(1, 1.1, 0.5, ONE_WEEK, 0.01);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
  });

  describe("Computing put vega", () => {
    it("spot=1.1,strike=1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getPutVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkPutVega(1.1, 1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getPutVega(
        ONEONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkPutVega(1.1, 1.1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1,sigma=0.1,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getPutVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkPutVega(1.1, 1, 0.1, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1,sigma=0.5,tau=1 day,rate=0", async () => {
      const vegaBn = await blackScholesMath.getPutVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkPutVega(1.1, 1, 0.5, ONE_DAY, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1,sigma=0.5,tau=1 week,rate=0.01", async () => {
      const vegaBn = await blackScholesMath.getPutVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkPutVega(1.1, 1, 0.5, ONE_WEEK, 0.01);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
  });
});