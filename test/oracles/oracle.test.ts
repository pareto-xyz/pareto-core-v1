import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { expect } from "chai";
import { Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getFixedGasSigners } from "../utils/helpers";

let oracle: Contract;
let owner: SignerWithAddress;
let admin: SignerWithAddress;
let user: SignerWithAddress;

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");

describe("Oracle Library", () => {
  beforeEach(async () => {
    // Create signers
    const wallets = await getFixedGasSigners(10000000);
    [owner, admin, user] = wallets;

    // Deploy spot feed contract 
    const OracleFactory =  await ethers.getContractFactory("Oracle")
    oracle = await OracleFactory.deploy([admin.address]);
  });
  it("can construct", async () => {
    // If it reaches here then we can construct
  })
  it("owner can set latest data", async () => {
    let callMarks = [];
    let putMarks = [];
    for (var i = 0; i < 11; i++) {
        callMarks.push(ONE_ETH);
        putMarks.push(ONE_ETH);
    }
    await oracle.connect(owner).setLatestData(ONE_ETH, ONE_ETH, callMarks, putMarks);
    const [roundId, spot,,] = await oracle.latestRoundSpot();
    expect(roundId).to.be.equal(1);
    expect(spot).to.be.equal(ONE_ETH);
  });
  it("admin can set latest data", async () => {
    let callMarks = [];
    let putMarks = [];
    for (var i = 0; i < 11; i++) {
        callMarks.push(ONE_ETH);
        putMarks.push(ONE_ETH);
    }
    await oracle.connect(admin).setLatestData(ONE_ETH, ONE_ETH, callMarks, putMarks);
    const [roundId, spot,,] = await oracle.latestRoundSpot();
    expect(roundId).to.be.equal(1);
    expect(spot).to.be.equal(ONE_ETH);
  });
  it("user cannot set latest data", async () => {
    let callMarks = [];
    let putMarks = [];
    for (var i = 0; i < 11; i++) {
        callMarks.push(ONE_ETH);
        putMarks.push(ONE_ETH);
    }
    await expect(
      oracle.connect(user).setLatestData(ONE_ETH, ONE_ETH, callMarks, putMarks)
    ).to.be.revertedWith("onlyAdmin: caller is not an admin");
  });
  it("owner can add admin", async () => {
    await oracle.connect(owner).setAdmin(user.address, true);
    expect(await oracle.isAdmin(user.address)).to.be.true;
  });
  it("owner can remove admin", async () => {
    await oracle.connect(owner).setAdmin(admin.address, false);
    expect(await oracle.isAdmin(admin.address)).to.be.false;
  });
  it("admin cannot add admin", async () => {
    await expect(
      oracle.connect(admin).setAdmin(user.address, true)
    ).to.be.reverted;
  });
  it("can get latest spots", async () => {
    let callMarks = [];
    let putMarks = [];
    for (var i = 0; i < 11; i++) {
        callMarks.push(ONE_ETH);
        putMarks.push(ONE_ETH);
    }
    await oracle.connect(admin).setLatestData(
        ONE_ETH.mul(11).div(10), ONE_ETH, callMarks, putMarks);
    const [,spot,,] = await oracle.latestRoundSpot();
    expect(spot).to.be.equal(ONE_ETH.mul(11).div(10));
  });
  it("can get latest round", async () => {
    let callMarks = [];
    let putMarks = [];
    for (var i = 0; i < 11; i++) {
        callMarks.push(ONE_ETH);
        putMarks.push(ONE_ETH);
    }
    await oracle.connect(admin).setLatestData(
        ONE_ETH.mul(11).div(10), ONE_ETH, callMarks, putMarks);
    await oracle.connect(admin).setLatestData(
        ONE_ETH.mul(11).div(10), ONE_ETH, callMarks, putMarks);
    const [roundId,,,] = await oracle.latestRoundSpot();
    expect(roundId).to.be.equal(2);
  });
});