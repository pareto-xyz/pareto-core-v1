import hre, { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
import {
  checkCallPrice,
  checkPutPrice,
  checkProbabilityFactors,
  checkBacksolveSigma,
  checkVega,
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
      var priceBn = await blackScholesMath.getPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, true);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1, true);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.1, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1, true);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_DAY, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONEONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, true);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkCallPrice(1.1, 1.1, 0.5, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("Reverts if rate is too big", async () => {
      // Underflow error
      expect(blackScholesMath.getPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(10), 1, true)
      ).to.be.rejected;
      const pricets = checkCallPrice(1, 1.1, 0.5, ONE_WEEK, 0.1);
      expect(pricets).to.be.lessThan(0);
    });
    it("spot=1.1 ETH,strike=1.1 ETH,sigma=0.5,tau=1 week,rate=0.01", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1, true);
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
      var priceBn = await blackScholesMath.getPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, false);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.5, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1, false);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.1, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_DAY, 0, 1, false);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.1, ONE_DAY, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1, false);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1, 1, 0.1, ONE_WEEK, 0);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
    it("spot=1.1 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0.01 ETH", async () => {
      var priceBn = await blackScholesMath.getPrice(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1, false);
      var price = parseFloat(fromBn(priceBn, 18));
      const pricets = checkPutPrice(1.1, 1, 0.5, ONE_WEEK, 0.01);
      expect(price).to.be.closeTo(pricets, 1e-5);
    });
  });
  /****************************************
   * Volatility from calls
   ****************************************/
  describe("Approximating sigma from call price", () => {
    it("spot=1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const sigmaTrue = 0.5;
      const priceTrue = checkCallPrice(1, 1.1, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=1,strike=1.1,sigma=1.5,tau=1 week,rate=0", async () => {
      const sigmaTrue = 1.5;
      const priceTrue = checkCallPrice(1, 1.1, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=1,strike=1.1,sigma=0.9,tau=1 week,rate=0", async () => {
      const sigmaTrue = 0.9;
      const priceTrue = checkCallPrice(1, 1.1, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=1,strike=1.1,sigma=0.1,tau=1 week,rate=0", async () => {
      const sigmaTrue = 0.1;
      const priceTrue = checkCallPrice(1, 1.1, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      // Need much more iters to accurately solve
      const sigmats2 = checkBacksolveSigma(
        1, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-100, 100);
      expect(sigmats2).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=1,strike=1.1,sigma=0.5,tau=1 week,rate=0.05", async () => {
      const sigmaTrue = 0.5;
      const priceTrue = checkCallPrice(1, 1.1, sigmaTrue, ONE_WEEK, 0.05);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH, ONEONE_ETH, ONE_WEEK, 0.05, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1, 1.1, ONE_WEEK, 0.05, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=1.1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const sigmaTrue = 0.5;
      const priceTrue = checkCallPrice(1.1, 1.1, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONEONE_ETH, ONEONE_ETH, ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1.1, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=1.2,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const sigmaTrue = 0.5;
      const priceTrue = checkCallPrice(1.2, 1.1, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH.mul(12).div(10), ONEONE_ETH, ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        1.2, 1.1, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
    it("spot=100,strike=110,sigma=0.5,tau=1 week,rate=0", async () => {
      const sigmaTrue = 0.5;
      const priceTrue = checkCallPrice(100, 110, sigmaTrue, ONE_WEEK, 0);
      const priceTrueBn = toBn(priceTrue.toString(), 18);
      const sigmaBn = await blackScholesMath.backsolveSigma(
        ONE_ETH.mul(100), ONE_ETH.mul(110), ONE_WEEK, 0, priceTrueBn, 1, true);
      const sigma = parseFloat(fromBn(sigmaBn, 18));
      const sigmats = checkBacksolveSigma(
        100, 110, ONE_WEEK, 0, priceTrue, true, 1e-10, 10);
      expect(sigma).to.be.closeTo(sigmats, 1e-3);
      expect(sigma).to.be.closeTo(sigmaTrue, 1e-3);
    });
  });
  /****************************************
   * Volatility from puts
   ****************************************/
  describe("Approximating sigma from put price", () => {
  });
  /****************************************
   * Vega
   ****************************************/
  describe("Computing call vega", () => {
    it("call put parity", async () => {
      const vegaCallBn = await blackScholesMath.getVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, true);
      const vegaPutBn = await blackScholesMath.getVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, false);
      const vegaCall = parseFloat(fromBn(vegaCallBn, 18));
      const vegaPut = parseFloat(fromBn(vegaPutBn, 18));
      expect(vegaCall).to.be.equal(vegaPut);
    });
    // out-the-money
    it("spot=1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1, 1.1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1,strike=1.1,sigma=0.1,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.8), ONE_WEEK, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1, 1.1, 0.8, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1,strike=1.1,sigma=0.5,tau=1 day,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1, 1.1, 0.5, ONE_DAY, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1,strike=1.1,sigma=0.5,tau=1 week,rate=0.01", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1, 1.1, 0.5, ONE_WEEK, 0.01);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    // in-the-money
    it("spot=1.1,strike=1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1.1, 1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1,sigma=0.1,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.1), ONE_WEEK, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1.1, 1, 0.1, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1,sigma=0.5,tau=1 day,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_DAY, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1.1, 1, 0.5, ONE_DAY, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    it("spot=1.1,strike=1,sigma=0.5,tau=1 week,rate=0.01", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONEONE_ETH, ONE_ETH, sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(100), 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1.1, 1, 0.5, ONE_WEEK, 0.01);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
    // at-the-money
    it("spot=1.1,strike=1.1,sigma=0.5,tau=1 week,rate=0", async () => {
      const vegaBn = await blackScholesMath.getVega(
        ONEONE_ETH, ONEONE_ETH, sigmaToBn(0.5), ONE_WEEK, 0, 1, true);
      const vega = parseFloat(fromBn(vegaBn, 18));
      const vegats = checkVega(1.1, 1.1, 0.5, ONE_WEEK, 0);
      expect(vega).to.be.closeTo(vegats, 1e-5);
    });
  });
});