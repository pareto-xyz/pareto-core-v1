import hre from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";

let negativeMath: Contract;

describe("NegativeMath Library", () => {
  beforeEach(async () => {
    const NegativeMathFactory = await hre.ethers.getContractFactory("TestNegativeMath");
    negativeMath = await NegativeMathFactory.deploy();
  });
  describe("Test add function", () => {
    it("Correct output when a > 0 and b > 0", async () => {
      const [result, isNeg] = await negativeMath.add(1, false, 1, false);
      expect(result).to.be.equal(2);
      expect(isNeg).to.be.false;
    });
    it("Correct output when a > 0 and b < 0", async () => {
      const [result, isNeg] = await negativeMath.add(1, false, 2, true);
      expect(result).to.be.equal(1);
      expect(isNeg).to.be.true;
    });
    it("Correct output when a < 0 and b > 0", async () => {
      const [result, isNeg] = await negativeMath.add(2, true, 2, false);
      expect(result).to.be.equal(0);
      expect(isNeg).to.be.false;
    });
    it("Correct output when a < 0 and b > 0 but |b| < |a|", async () => {
      const [result, isNeg] = await negativeMath.add(2, true, 1, false);
      expect(result).to.be.equal(1);
      expect(isNeg).to.be.true;
    });
    it("Correct output when a < 0 and b < 0", async () => {
      const [result, isNeg] = await negativeMath.add(2, true, 2, true);
      expect(result).to.be.equal(4);
      expect(isNeg).to.be.true;
    });
  });
});