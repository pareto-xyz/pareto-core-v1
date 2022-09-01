import hre from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { currentTime, timeTravel } from "../utils/helpers";

let dateMath: Contract;

describe("DateMath Library", () => {
  beforeEach(async () => {
    const DateMathFactory = await hre.ethers.getContractFactory("TestDateMath");
    dateMath = await DateMathFactory.deploy();
  });
  it("Can compute next friday", async function () {
    const now = currentTime();
    await dateMath.getNextFriday(now);
  });
  it("Check next friday is past now", async function () {
    const now = currentTime();
    const friday8am = (await dateMath.getNextFriday(now)).toNumber();
    expect(now).to.be.lessThanOrEqual(friday8am);
  });
  it("Check next friday on next friday", async function () {
    const now = currentTime();
    const nextFriday = (await dateMath.getNextFriday(now)).toNumber();
    const nextFriday2 = (await dateMath.getNextFriday(nextFriday)).toNumber();
    expect(nextFriday).to.be.lessThanOrEqual(nextFriday2);
    // 604800 = one week in seconds
    expect(nextFriday2 - nextFriday).to.be.equal(604800);
  });
  it("Check next maturity is next friday", async function () {
    const now = currentTime();
    const expiry = (await dateMath.getNextExpiry(now)).toNumber();
    const friday = (await dateMath.getNextFriday(now)).toNumber();
    expect(expiry).to.be.equal(friday);
  });
  it("Check next maturity on next friday", async function () {
    const now = currentTime();
    const nextFriday = (await dateMath.getNextFriday(now)).toNumber();
    const nextFriday2 = (await dateMath.getNextFriday(nextFriday)).toNumber();
    const expiry = (await dateMath.getNextExpiry(nextFriday)).toNumber();
    expect(expiry).to.be.equal(nextFriday2);
  });
  it("Check next maturity on an old input", async function () {
    const now = currentTime();
    const expiry = (await dateMath.getNextExpiry(0)).toNumber();
    const friday = (await dateMath.getNextFriday(now)).toNumber();
    expect(expiry).to.be.equal(friday);
  });
});