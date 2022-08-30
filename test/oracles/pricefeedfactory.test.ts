import { ethers } from "hardhat";
import { Contract } from "ethers";
import { expect } from "chai";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

let priceFeedFactory: Contract;
let owner: SignerWithAddress;
let admin: SignerWithAddress;
let user: SignerWithAddress;

describe("PriceFeedFactory Library", () => {
  beforeEach(async () => {
    // Create signers
    const wallets = await ethers.getSigners(); 
    [owner, admin, user] = wallets;

    // Deploy price feed contract 
    const PriceFeedFactory =  await ethers.getContractFactory("PriceFeedFactory")
    priceFeedFactory = await PriceFeedFactory.deploy();
  });
  it("can construct", async () => {
    // If you reach here, then life is good
  });
  it("initial number feeds is zero", async () => {
    expect(await priceFeedFactory.numPricefeeds()).to.be.equal(0);
  });
  it("can create new feed", async () => {
    await priceFeedFactory.create("test1", []);
  });
  it("new feed has address", async () => {
    const txReceiptUnresolved = await priceFeedFactory.create("test1", []);
    const txReceipt = await txReceiptUnresolved.wait();
    const feedAddress = txReceipt.events![2].args![0];
    expect(feedAddress).to.not.be.equal("0x0000000000000000000000000000000000000000");
  });
  it("stored new feeds owner", async () => {
    const txReceiptUnresolved = await priceFeedFactory.connect(owner).create("test1", []);
    const txReceipt = await txReceiptUnresolved.wait();
    const feedAddress = txReceipt.events![2].args![0];
    expect(await priceFeedFactory.pricefeedOwners(feedAddress)).to.be.equal(owner.address);
  })
  it("emits event when creating feed", async () => {
    await expect(
      priceFeedFactory.create("test1", [])
    ).to.emit(priceFeedFactory, "PriceFeedCreated");
  });
  it("feed counter increases", async () => {
    await priceFeedFactory.create("test1", []);
    expect(await priceFeedFactory.numPricefeeds()).to.be.equal(1);
  });
  it("can create multiple feeds", async () => {
    const txReceiptUnresolved1 = await priceFeedFactory.connect(owner).create("test1", []);
    const txReceipt1 = await txReceiptUnresolved1.wait();
    const feedAddress1 = txReceipt1.events![2].args![0];

    const txReceiptUnresolved2 = await priceFeedFactory.connect(owner).create("test2", []);
    const txReceipt2 = await txReceiptUnresolved2.wait();
    const feedAddress2 = txReceipt2.events![2].args![0];

    expect(feedAddress1).to.not.be.equal(feedAddress2);
  });
});