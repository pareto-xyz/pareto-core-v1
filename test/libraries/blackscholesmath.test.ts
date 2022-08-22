import hre from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";

let blackScholesMath: Contract;

describe("BlackScholesMath Library", () => {
  beforeEach(async () => {
    const BlackScholesMathFactory = await hre.ethers.getContractFactory("TestBlackScholesMath");
    blackScholesMath = await BlackScholesMathFactory.deploy();
  });
  describe("Computing probability factors", () => {
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
    });
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 day,rate=0", async () => {
    });
    it("spot=2 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
    });
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0.1 ETH", async () => {
    });
  });
  describe("Computing call price", () => {
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
    });
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 day,rate=0", async () => {
    });
    it("spot=2 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
    });
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0.1 ETH", async () => {
    });
  });
  describe("Computing put price", () => {
    it("spot=2 ETH,strike=1 ETH,sigma=1,tau=1 week,rate=0", async () => {
    });
    it("spot=2 ETH,strike=1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
    });
    it("spot=2 ETH,strike=1 ETH,sigma=1,tau=1 day,rate=0", async () => {
    });
    it("spot=1 ETH,strike=1 ETH,sigma=1,tau=1 week,rate=0", async () => {
    });
    it("spot=2 ETH,strike=1 ETH,sigma=1,tau=1 week,rate=0.1 ETH", async () => {
    });
  });
  describe("Converting vol to sigma", () => {
    it("vol=0.1,tau=1 week", async () => {
    });
    it("vol=0.1,tau=1 day", async () => {
    });
    it("vol=1,tau=1 week", async () => {
    });
  });
  // describe("Approximating vol from call price", () => {
  // });
  // describe("Approximating vol from put price", () => {
  // });
  // describe("Computing vega", () => {
  // });
});