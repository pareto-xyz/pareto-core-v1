import hre from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";

let basicMath: Contract;

describe("BasicMath Library", () => {
  beforeEach(async () => {
    const BasicMathFactory = await hre.ethers.getContractFactory("TestBasicMath");
    basicMath = await BasicMathFactory.deploy();
  });
  describe("Test max function", () => {
    it("Correct max when a > b", async() => {
      expect(await basicMath.max(2, 1)).to.be.equal(2);
    });
    it("Correct max when a < b", async() => {
      expect(await basicMath.max(1, 2)).to.be.equal(2);
    });
    it("Correct max when a = b", async() => {
      expect(await basicMath.max(2, 2)).to.be.equal(2);
    });
  });
  describe("Test min function", () => {
    it("Correct min when a > b", async() => {
      expect(await basicMath.min(2, 1)).to.be.equal(1);
    });
    it("Correct min when a < b", async() => {
      expect(await basicMath.min(1, 2)).to.be.equal(1);
    });
    it("Correct min when a = b", async() => {
      expect(await basicMath.min(2, 2)).to.be.equal(2);
    });
  });
});
