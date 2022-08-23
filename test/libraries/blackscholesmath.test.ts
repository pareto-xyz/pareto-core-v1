import hre, { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";
import {
  checkProbabilityFactors,
} from "../utils/BlackScholes";

/****************************************
 * Constants
 ****************************************/

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
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
let units: Contract;

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
  describe("Computing probability factors", () => {
    it("spot=1 ETH,strike=2 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      // 10**(18-18) = 10**0 = 1
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONE_ETH.mul(2), sigmaToBn(0.5), ONE_WEEK, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 2, 0.5, ONE_WEEK, 0);
      expect(d1).to.be.closeTo(d1ts, 0.01);
      expect(d2).to.be.closeTo(d2ts, 0.01);
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.9,tau=1 week,rate=0", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONE_ETH.mul(2), sigmaToBn(0.9), ONE_WEEK, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 2, 0.9, ONE_WEEK, 0);
      expect(d1).to.be.closeTo(d1ts, 0.01);
      expect(d2).to.be.closeTo(d2ts, 0.01);
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONE_ETH.mul(2), sigmaToBn(0.5), ONE_DAY, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 2, 0.5, ONE_DAY, 0);
      expect(d1).to.be.closeTo(d1ts, 0.01);
      expect(d2).to.be.closeTo(d2ts, 0.01);
    });
    it("spot=2 ETH,strike=2 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH.mul(2), ONE_ETH.mul(2), sigmaToBn(0.5), ONE_WEEK, 0, 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(2, 2, 0.5, ONE_WEEK, 0);
      expect(d1).to.be.closeTo(d1ts, 0.01);
      expect(d2).to.be.closeTo(d2ts, 0.01);
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.5,tau=1 week,rate=0.1 ETH", async () => {
      var [d1abs, d2abs, d1IsNeg, d2IsNeg] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH, ONE_ETH.mul(2), sigmaToBn(0.5), ONE_WEEK, ONE_ETH.div(10), 1);
      d1abs = parseFloat(fromBn(d1abs, 18));
      d2abs = parseFloat(fromBn(d2abs, 18));
      let d1 = d1IsNeg ? -d1abs : d1abs;
      let d2 = d2IsNeg ? -d2abs : d2abs;
      const [d1ts, d2ts] = checkProbabilityFactors(1, 2, 0.5, ONE_WEEK, 0.1);
      expect(d1).to.be.closeTo(d1ts, 0.01);
      expect(d2).to.be.closeTo(d2ts, 0.01);
    });
  });
  describe("Computing call price", () => {
    it("spot=1 ETH,strike=2 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=2 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.5,tau=1 week,rate=0.1 ETH", async () => {
      expect(true).to.be.false;
    });
  });
  describe("Computing put price", () => {
    it("spot=2 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=1 ETH,sigma=0.5,tau=1 day,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=1 ETH,sigma=0.5,tau=1 week,rate=0.1 ETH", async () => {
      expect(true).to.be.false;
    });
  });
  describe("Converting vol to sigma", () => {
    it("vol=0.1,tau=1 week", async () => {
      expect(true).to.be.false;
    });
    it("vol=0.1,tau=1 day", async () => {
      expect(true).to.be.false;
    });
    it("vol=1,tau=1 week", async () => {
      expect(true).to.be.false;
    });
  });
  // describe("Approximating vol from call price", () => {
  // });
  // describe("Approximating vol from put price", () => {
  // });
  // describe("Computing vega", () => {
  // });
});