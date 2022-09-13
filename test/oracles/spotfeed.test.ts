import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { expect } from "chai";
import { Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getFixedGasSigners } from "../utils/helpers";

let spotFeed: Contract;
let owner: SignerWithAddress;
let admin: SignerWithAddress;
let user: SignerWithAddress;

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");

describe("SpotFeed Library", () => {
  beforeEach(async () => {
    // Create signers
    const wallets = await getFixedGasSigners(10000000);
    [owner, admin, user] = wallets;

    // Deploy spot feed contract 
    const SpotFeedFactory =  await ethers.getContractFactory("SpotFeed")
    spotFeed = await SpotFeedFactory.deploy("test", [admin.address]);
  });
  it("can construct", async () => {
    // If it reaches here then we can construct
  })
  it("owner can set latest answer", async () => {
    await spotFeed.connect(owner).setLatestPrice(ONE_ETH);
    const [roundId, spot,] = await spotFeed.latestRoundData();
    expect(roundId).to.be.equal(1);
    expect(spot).to.be.equal(ONE_ETH);
  });
  it("admin can set latest answer", async () => {
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH);
    const [roundId, spot,] = await spotFeed.latestRoundData();
    expect(roundId).to.be.equal(1);
    expect(spot).to.be.equal(ONE_ETH);
  });
  it("user cannot set latest answer", async () => {
    await expect(
      spotFeed.connect(user).setLatestPrice(ONE_ETH)
    ).to.be.revertedWith("onlyAdmin: caller is not an admin");
  });
  it("owner can add admin", async () => {
    await spotFeed.connect(owner).setAdmin(user.address, true);
    expect(await spotFeed.isAdmin(user.address)).to.be.true;
  });
  it("owner can remove admin", async () => {
    await spotFeed.connect(owner).setAdmin(admin.address, false);
    expect(await spotFeed.isAdmin(admin.address)).to.be.false;
  });
  it("admin cannot add admin", async () => {
    await expect(
      spotFeed.connect(admin).setAdmin(user.address, true)
    ).to.be.reverted;
  });
  it("can get latest answer", async () => {
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH);
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH.mul(11).div(10));
    const [,spot,] = await spotFeed.latestRoundData();
    expect(spot).to.be.equal(ONE_ETH.mul(11).div(10));
  });
  it("can get latest round", async () => {
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH);
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH.mul(11).div(10));
    const [roundId,,] = await spotFeed.latestRoundData();
    expect(roundId).to.be.equal(2);
  });
  it("can get latest round data", async () => {
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH);
    await spotFeed.connect(admin).setLatestPrice(ONE_ETH.mul(11).div(10));
    const [roundId, spot,] = await spotFeed.latestRoundData();
    expect(spot).to.be.equal(ONE_ETH.mul(11).div(10));
    expect(roundId).to.be.equal(2);
  });
});