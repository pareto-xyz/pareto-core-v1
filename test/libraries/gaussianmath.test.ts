import hre, { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";

import { normalCDF, normalPDF, normalInverseCDF } from "../utils/blackscholes";

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");

let gaussianMath: Contract;

describe("GaussianMath Library", () => {
  beforeEach(async () => {
    const GaussianMathFactory = await hre.ethers.getContractFactory("TestGaussianMath");
    gaussianMath = await GaussianMathFactory.deploy();
  });

  describe("Probability Distribution Function", () => {
    it("pdf(x=0,mu=0,sigma=1)", async () => {
      const prob = parseFloat(fromBn(await gaussianMath.getPDF(0, false, 18), 18));
      const probts = normalPDF(0);
      expect(prob).to.be.closeTo(probts, 1e-5);
    });
    it("pdf(x=1,mu=0,sigma=1)", async () => {
      const prob = parseFloat(fromBn(await gaussianMath.getPDF(ONE_ETH, false, 18), 18));
      const probts = normalPDF(1);
      expect(prob).to.be.closeTo(probts, 1e-5);
    });
    it("pdf(x=-1,mu=0,sigma=1)", async () => {
      const prob = parseFloat(fromBn(await gaussianMath.getPDF(ONE_ETH, true, 18), 18));
      const probts = normalPDF(-1);
      expect(prob).to.be.closeTo(probts, 1e-5);
    });
  });

  describe("Cumulative Distribution Function", () => {
    it("cdf(x=0,mu=0,sigma=1)", async () => {
      const prob = parseFloat(fromBn(await gaussianMath.getCDF(0, false, 18), 18));
      const probts = normalCDF(0, 0, 1);
      expect(prob).to.be.closeTo(probts, 1e-5);
    });
    it("cdf(x=1,mu=0,sigma=1)", async () => {
      const prob = parseFloat(fromBn(await gaussianMath.getCDF(ONE_ETH, false, 18), 18));
      const probts = normalCDF(1, 0, 1);
      expect(prob).to.be.closeTo(probts, 1e-5);
    });
    it("cdf(x=-1,mu=0,sigma=1)", async () => {
      const prob = parseFloat(fromBn(await gaussianMath.getCDF(ONE_ETH, true, 18), 18));
      const probts = normalCDF(-1, 0, 1);
      expect(prob).to.be.closeTo(probts, 1e-5);
    });
  });

  describe("Inverse Cumulative Distribution Function", () => {
    it("icdf(p=0.5,mu=0,sigma=1)", async () => {
      const [xRaw, isNeg] = await gaussianMath.getInverseCDF(5000, 4, 18);
      const x = parseFloat(fromBn(xRaw, 18));
      expect(isNeg).to.be.false;
      expect(x).to.be.closeTo(normalInverseCDF(0.5), 1e-3);
    });
    it("icdf(p=0.1,mu=0,sigma=1)", async () => {
      const [xRaw, isNeg] = await gaussianMath.getInverseCDF(1000, 4, 18);
      const x = parseFloat(fromBn(xRaw, 18));
      expect(isNeg).to.be.true;
      expect(x).to.be.closeTo(Math.abs(normalInverseCDF(0.1)), 1e-3);
    });
    it("icdf(p=0.9,mu=0,sigma=1)", async () => {
      const [xRaw, isNeg] = await gaussianMath.getInverseCDF(9000, 4, 18);
      const x = parseFloat(fromBn(xRaw, 18));
      expect(isNeg).to.be.false;
      expect(x).to.be.closeTo(normalInverseCDF(0.9), 1e-3);
    });
    it("icdf(p=0.01,mu=0,sigma=1)", async () => {
      const [xRaw, isNeg] = await gaussianMath.getInverseCDF(100, 4, 18);
      const x = parseFloat(fromBn(xRaw, 18));
      expect(isNeg).to.be.true;
      expect(x).to.be.closeTo(Math.abs(normalInverseCDF(0.01)), 1e-3);
    });
    it("icdf(p=0.99,mu=0,sigma=1)", async () => {
      const [xRaw, isNeg] = await gaussianMath.getInverseCDF(9900, 4, 18);
      const x = parseFloat(fromBn(xRaw, 18));
      expect(isNeg).to.be.false;
      expect(x).to.be.closeTo(normalInverseCDF(0.99), 1e-3);
    });
  });
});