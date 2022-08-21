import hre from "hardhat";
import { expect } from "chai";
import { TestBasicMath } from "../../typechain-types";

let basicMath: TestBasicMath;

describe("BasicMath Library", () => {
  beforeEach(async () => {
    const BasicMathFactory = await hre.ethers.getContractFactory("TestBasicMath");
    basicMath = await BasicMathFactory.deploy();
  });
  describe("Test max function", () => {
    it("Returns correct max when a > b", async() => {
      expect(await basicMath.max(2, 1)).to.be.equal(2);
    });
    it("Returns correct max when a < b", async() => {
      expect(await basicMath.max(1, 2)).to.be.equal(2);
    });
    it("Returns correct max when a = b", async() => {
      expect(await basicMath.max(2, 2)).to.be.equal(2);
    });
  });
  describe("Test min function", () => {
    it("Returns correct min when a > b", async() => {
      expect(await basicMath.min(2, 1)).to.be.equal(1);
    });
    it("Returns correct min when a < b", async() => {
      expect(await basicMath.min(1, 2)).to.be.equal(1);
    });
    it("Returns correct min when a = b", async() => {
      expect(await basicMath.min(2, 2)).to.be.equal(2);
    });
  });
  describe("Test absdiff function", () => {
    it("Returns correct absdiff when a > b", async() => {
      const [diff, isNeg] = await basicMath.absdiff(2, 1);
      expect(diff).to.be.equal(1);
      expect(isNeg).to.be.equal(false);
    });
    it("Returns correct absdiff when a < b", async() => {
      const [diff, isNeg] = await basicMath.absdiff(1, 2);
      expect(diff).to.be.equal(1);
      expect(isNeg).to.be.equal(true);
    });
    it("Returns correct absdiff when a = b", async() => {
      const [diff, isNeg] = await basicMath.absdiff(2, 2);
      expect(diff).to.be.equal(0);
      expect(isNeg).to.be.equal(false);
    });
  });
});