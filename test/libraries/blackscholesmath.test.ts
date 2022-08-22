import hre from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";

let blackScholesMath: Contract;

describe("BlackScholesMath Library", () => {
  beforeEach(async () => {
    const BlackScholesMathFactory = await hre.ethers.getContractFactory("TestBlackScholesMath");
    blackScholesMath = await BlackScholesMathFactory.deploy();
  });
  describe("Computing call price", () => {
    
  });
  describe("Computing put price", () => {
  });
  describe("Converting vol to sigma", () => {
  });
  describe("Approximating vol from call price", () => {
  });
  describe("Approximating vol from put price", () => {
  });
  describe("Computing vega", () => {
  });
});