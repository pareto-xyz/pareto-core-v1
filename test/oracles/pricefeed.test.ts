import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { expect } from "chai";
import { Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

let priceFeed: Contract;
let owner: SignerWithAddress;
let admin: SignerWithAddress;
let user: SignerWithAddress;

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");

describe("PriceFeed Library", () => {
  beforeEach(async () => {
    // Create signers
    const wallets = await ethers.getSigners(); 
    [owner, admin, user] = wallets;

    // Deploy price feed contract 
    const PriceFeedFactory =  await ethers.getContractFactory("PriceFeed")
    priceFeed = await PriceFeedFactory.deploy(owner.address, "test", [admin.address]);
  });
  it("can construct", async () => {
    // If it reaches here then we can construct
  })
  it("owner can set latest answer", async () => {
    await priceFeed.connect(owner).setLatestAnswer(ONE_ETH);
    expect(await priceFeed.latestRound()).to.be.equal(1);
    expect(await priceFeed.latestAnswer()).to.be.equal(ONE_ETH);
  });
  it("admin can set latest answer", async () => {
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH);
    expect(await priceFeed.latestRound()).to.be.equal(1);
    expect(await priceFeed.latestAnswer()).to.be.equal(ONE_ETH);
  });
  it("user cannot set latest answer", async () => {
    await expect(
        priceFeed.connect(user).setLatestAnswer(ONE_ETH)
    ).to.be.revertedWith("onlyAdmin: caller is not an admin");
  });
  it("owner can add admin", async () => {
    await priceFeed.connect(owner).setAdmin(user.address, true);
    expect(await priceFeed.isAdmin(user.address)).to.be.true;
  });
  it("owner can remove admin", async () => {
    await priceFeed.connect(owner).setAdmin(admin.address, false);
    expect(await priceFeed.isAdmin(admin.address)).to.be.false;
  });
  it("admin cannot add admin", async () => {
    await expect(
        priceFeed.connect(admin).setAdmin(user.address, true)
    ).to.be.reverted;
  });
  it("can get latest answer", async () => {
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH);
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH.mul(11).div(10));
    expect(await priceFeed.latestAnswer()).to.be.equal(ONE_ETH.mul(11).div(10));
  });
  it("can get latest round", async () => {
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH);
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH.mul(11).div(10));
    expect(await priceFeed.latestRound()).to.be.equal(2);
  });
  it("can get latest round data", async () => {
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH);
    await priceFeed.connect(admin).setLatestAnswer(ONE_ETH.mul(11).div(10));
    const [roundId, answer,,,] = await priceFeed.latestRoundData();
    expect(answer).to.be.equal(ONE_ETH.mul(11).div(10));
    expect(roundId).to.be.equal(2);
  });
});