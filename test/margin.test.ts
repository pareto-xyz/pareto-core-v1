import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ParetoV1Margin } from "../typechain-types";
import { setupFixture } from "./shared/fixture";

let margin: ParetoV1Margin;
let deployer: SignerWithAddress;
let keeper: SignerWithAddress;
let alice: SignerWithAddress

describe("Pareto V1 Contract", () => {
  beforeEach(async () => {
    const {
      paretoMargin: margin_,
      usdc: usdc_,
      deployer: deployer_,
      keeper: keeper_,
      alice: alice_,
    } = await loadFixture(setupFixture);
    margin = margin_;
    deployer = deployer_;
    keeper = keeper_;
    alice = alice_;
  });
});
