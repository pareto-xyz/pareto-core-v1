import hre, { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import { expect } from "chai";
import { Contract } from "ethers";

/****************************************
 * Constants
 ****************************************/

const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
const ONE_DAY: number = 86400;
const ONE_WEEK: number = 604800;

/****************************************
 * Helper Functions
 ****************************************/

function sigmaToBn(sigma: number): BigNumber {
  return toBn(sigma.toString(), 4);
}

/****************************************
 * Tests
 ****************************************/

let blackScholesMath: Contract;

describe("BlackScholesMath Library", () => {
  beforeEach(async () => {
    const BlackScholesMathLib = await ethers.getContractFactory("BlackScholesMath");
    const blackScholesMathLib = await BlackScholesMathLib.deploy();
    await blackScholesMathLib.deployed();

    // Link the lib to the test contract
    const BlackScholesMathFactory = await hre.ethers.getContractFactory(
      "TestBlackScholesMath",
      {
        libraries: {
          BlackScholesMath: blackScholesMathLib.address,
        }
      }
    );
    blackScholesMath = await BlackScholesMathFactory.deploy();
  });
  describe("Computing probability factors", () => {
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
      const [d1, d2] = await blackScholesMath.getProbabilityFactors(
        ONE_ETH,
        ONE_ETH.mul(2),
        sigmaToBn(0.1),
        ONE_WEEK,
        0,
        1  // 10**(18-18) = 10**0 = 1
      )
      console.log(d1, d2);
    });
    // it("spot=1 ETH,strike=2 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
    //   expect(true).to.be.false;
    // });
    // it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 day,rate=0", async () => {
    //   expect(true).to.be.false;
    // });
    // it("spot=2 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
    //   expect(true).to.be.false;
    // });
    // it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0.1 ETH", async () => {
    //   expect(true).to.be.false;
    // });
  });
  describe("Computing call price", () => {
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=2 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 day,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=2 ETH,sigma=1,tau=1 week,rate=0.1 ETH", async () => {
      expect(true).to.be.false;
    });
  });
  describe("Computing put price", () => {
    it("spot=2 ETH,strike=1 ETH,sigma=1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=1 ETH,sigma=0.1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=1 ETH,sigma=1,tau=1 day,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=1 ETH,strike=1 ETH,sigma=1,tau=1 week,rate=0", async () => {
      expect(true).to.be.false;
    });
    it("spot=2 ETH,strike=1 ETH,sigma=1,tau=1 week,rate=0.1 ETH", async () => {
      expect(true).to.be.false;
    });
  });
  describe("Converting vol to sigma", () => {
    it("vol=0.1,tau=1 week", async () => {
      expect(true).to.be.false;
    });
    it("vol=0.1,tau=1 day", async () => {
      expect(true).to.be.false;
    });
    it("vol=1,tau=1 week", async () => {
      expect(true).to.be.false;
    });
  });
  // describe("Approximating vol from call price", () => {
  // });
  // describe("Approximating vol from put price", () => {
  // });
  // describe("Computing vega", () => {
  // });
});