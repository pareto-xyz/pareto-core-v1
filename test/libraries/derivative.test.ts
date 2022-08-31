import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fromBn, toBn } from "evm-bn";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { checkInterpolate, checkClosestIndices } from "../utils/interpolate";
import { checkCallPrice, checkPutPrice } from "../utils/blackscholes";

/****************************************
 * Constants
 ****************************************/

 const ONE_ETH: BigNumber = ethers.utils.parseEther("1");
 const ONE_WEEK: number = 604800;

/****************************************
 * Tests
 ****************************************/

let derivative: Contract;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("Derivative Library", () => {
  beforeEach(async () => {
    // Create signers
    const wallets = await ethers.getSigners(); 
    [alice, bob] = wallets;

    // Deploy derivatives
    const DerivativeFactory = await ethers.getContractFactory("TestDerivative");
    derivative = await DerivativeFactory.deploy();
    await derivative.deployed();
  });

  /****************************************
   * Smile creation
   ****************************************/
  describe("Creating a smile", () => {
    it("Can create a smile", async () => {
      await derivative.createSmile(1, 5000);
    });
    it("Smile marked as existing", async () => {
      await derivative.createSmile(1, 5000);
      const smile = await derivative.fetchSmile(1);
      expect(smile.exists_).to.be.true;
    });
    it("Smile initalized to 50% everywhere", async () => {
      await derivative.createSmile(1, 5000);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
      }
    });
  });

  /****************************************
   * Smile querying
   ****************************************/
  describe("Querying a smile", () => {
    it("Can query smile at spot/strike=1, not updated", async () => {
      await derivative.createSmile(1, 5000);
      const sigma = await derivative.querySmile(ONE_ETH, ONE_ETH, 1);
      expect(fromBn(sigma, 4)).to.be.equal("0.5");
    });
    it("Can query smile at spot/strike=1/10, not updated", async () => {
      await derivative.createSmile(1, 5000);
      const sigma = await derivative.querySmile(ONE_ETH.div(10), ONE_ETH, 1);
      expect(fromBn(sigma, 4)).to.be.equal("0.5");
    });
    it("Can query smile at spot/strike=10, not updated", async () => {
      await derivative.createSmile(1, 5000);
      const sigma = await derivative.querySmile(ONE_ETH.mul(10), ONE_ETH, 1);
      expect(fromBn(sigma, 4)).to.be.equal("0.5");
    });
    it("Can query smile at spot/strike=1.3, not updated", async () => {
      await derivative.createSmile(1, 5000);
      const sigma = await derivative.querySmile(ONE_ETH.mul(13).div(10), ONE_ETH, 1);
      expect(fromBn(sigma, 4)).to.be.equal("0.5");
    });
    it("Can query smile at spot/strike=0.8, not updated", async () => {
      await derivative.createSmile(1, 5000);
      const sigma = await derivative.querySmile(ONE_ETH.mul(8).div(10), ONE_ETH, 1);
      expect(fromBn(sigma, 4)).to.be.equal("0.5");
    });
  });

  /****************************************
   * Smile updating
   ****************************************/
  describe("Updating a smile", () => {
    let order: any;

    beforeEach(async () => {
      // Function saves to storage
      await derivative.createSmile(1, 5000);
      const curTime = Math.floor(Date.now() / 1000);
      // Use black scholes to estimate a reasonable price
      const tradePrice = checkCallPrice(1, 1.1, 0.5, ONE_WEEK, 0);
      order = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: toBn(tradePrice.toString(), 18),
        quantity: 5,
        option: {
          optionType: 0,
          // Note moneyness is computed as spot/strike so spot/1.1
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18
        }
      };
    });
    it("Can update smile", async () => {
      await derivative.updateSmile(ONE_ETH.mul(11).div(10), order, 1, 10);
    });
    it("Changes after updating 3rd value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(11).div(10), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if (i == 2) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
    it("No change if spot = mark", async () => {
      await derivative.updateSmile(ONE_ETH, order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
      }
    });
    it("Changes after updating 1st value", async () => {
      await derivative.updateSmile(ONE_ETH.div(2), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if (i == 0) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
    it("Changes after updating 5th value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(2), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if (i == 4) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
    it("Changes after updating 2nd value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(75).div(100), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      expect(fromBn(smile.sigmaAtMoneyness[1], 4)).to.not.be.equal("0.5");
    });
    it("Changes after updating 4nd value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(125).div(100), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      expect(fromBn(smile.sigmaAtMoneyness[3], 4)).to.not.be.equal("0.5");
    });
    it("Changes after updating 1st and 2nd value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(65).div(100), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if ((i == 0) || (i == 1)) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
    it("Changes after updating 2nd and 3rd value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(85).div(100), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if ((i == 1) || (i == 2)) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
    it("Changes after updating 3rd and 4th value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(120).div(100), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if ((i == 2) || (i == 3)) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
    it("Changes after updating 4th and 5th value", async () => {
      await derivative.updateSmile(ONE_ETH.mul(145).div(100), order, 1, 10);
      const smile = await derivative.fetchSmile(1);
      for (var i = 0; i < 5; i++) {
        if ((i == 3) || (i == 4)) {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.not.be.equal("0.5");
        } else {
          expect(fromBn(smile.sigmaAtMoneyness[i], 4)).to.be.equal("0.5");
        }
      }
    });
  });

  /****************************************
   * Computing mark price
   ****************************************/
  describe("Computing mark price (1 week expiry)", () => {
    it("Can compute mark price", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option = {
        optionType: 0,
        strike: ONE_ETH.mul(11).div(10),  // 1.1 strike
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18
      }
      await derivative.getMarkPrice(option, ONE_ETH, 5000, ONE_WEEK);
    });
    // --
    it("Correct mark price for ITM call,sigma=0.5", async () => {});
    it("Correct mark price for ATM call,sigma=0.5", async () => {});
    it("Correct mark price for OTM call,sigma=0.5", async () => {});
    it("Correct mark price for ITM put,sigma=0.5", async () => {});
    it("Correct mark price for ATM put,sigma=0.5", async () => {});
    // --
    it("Correct mark price for ITM call,sigma=0.9", async () => {});
    it("Correct mark price for ATM call,sigma=0.9", async () => {});
    it("Correct mark price for OTM call,sigma=0.9", async () => {});
    it("Correct mark price for ITM put,sigma=0.9", async () => {});
    it("Correct mark price for ATM put,sigma=0.9", async () => {});
    it("Correct mark price for OTM put,sigma=0.9", async () => {});
    // --
    it("Correct mark price for ITM call,sigma=1.5", async () => {});
    it("Correct mark price for ATM call,sigma=1.5", async () => {});
    it("Correct mark price for OTM call,sigma=1.5", async () => {});
    it("Correct mark price for ITM put,sigma=1.5", async () => {});
    it("Correct mark price for ATM put,sigma=1.5", async () => {});
    it("Correct mark price for OTM put,sigma=1.5", async () => {});
  });

  /****************************************
   * Order fingerprint
   ****************************************/
  describe("Hashing an order", () => {
    it("can hash an order", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      await derivative.hashOrder(order);
    });
    it("identical orders hash the same", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order1 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const order2 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const hash1 = await derivative.hashOrder(order1);
      const hash2 = await derivative.hashOrder(order2);
      expect(hash1).to.be.equal(hash2);
    });
    it("two different orders hash different", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const order1 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const order2 = {
        buyer: alice.address,
        seller: bob.address,
        tradePrice: ONE_ETH.mul(11).div(100),
        quantity: 5,
        option: {
          optionType: 0,
          strike: ONE_ETH.mul(11).div(10),
          expiry: curTime + ONE_WEEK,
          underlying: "0x0000000000000000000000000000000000000000",
          decimals: 18,
        }
      };
      const hash1 = await derivative.hashOrder(order1);
      const hash2 = await derivative.hashOrder(order2);
      expect(hash1).to.be.not.equal(hash2);
    });
  });

  /****************************************
   * Option fingerprint
   ****************************************/
  describe("Hashing an option", () => {
    it("can hash an option", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      await derivative.hashOption(option);
    });
    it("identical options hash the same", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option1 =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const option2 =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const hash1 = await derivative.hashOption(option1);
      const hash2 = await derivative.hashOption(option2);
      expect(hash1).to.be.equal(hash2);
    });
    it("two different options hash different", async () => {
      const curTime = Math.floor(Date.now() / 1000);
      const option1 =  {
        optionType: 0,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const option2 =  {
        optionType: 1,
        strike: ONE_ETH,
        expiry: curTime + ONE_WEEK,
        underlying: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      };
      const hash1 = await derivative.hashOption(option1);
      const hash2 = await derivative.hashOption(option2);
      expect(hash1).to.be.not.equal(hash2);
    });
  });

  /****************************************
   * Interpolation
   ****************************************/
  describe("Interpolation", () => {
    it("can interpolate", async () => {
      await derivative.interpolate(
        [50,75,100,125,150],
        [ONE_ETH.mul(2),ONE_ETH.mul(4),ONE_ETH.mul(6),ONE_ETH.mul(8),ONE_ETH.mul(10)],
        100,
      );
    });
    it("query key in middle #1", async () => {
      const queryValue = await derivative.interpolate(
        [50,75,100,125,150],
        [ONE_ETH.mul(2),ONE_ETH.mul(4),ONE_ETH.mul(6),ONE_ETH.mul(8),ONE_ETH.mul(10)],
        110,
      );
      const queryValuets = checkInterpolate([50,75,100,125,150], [2,4,6,8,10], 110);
      expect(parseFloat(fromBn(queryValue, 18))).to.be.equal(queryValuets);
    });
    it("query key in middle #2", async () => {
      const queryValue = await derivative.interpolate(
        [50,75,100,125,150],
        [ONE_ETH.mul(2),ONE_ETH.mul(4),ONE_ETH.mul(6),ONE_ETH.mul(8),ONE_ETH.mul(10)],
        129,
      );
      const queryValuets = checkInterpolate([50,75,100,125,150], [2,4,6,8,10], 129);
      expect(parseFloat(fromBn(queryValue, 18))).to.be.equal(queryValuets);
      });
    it("query key less than lowest key", async () => {
      const queryValue = await derivative.interpolate(
        [50,75,100,125,150],
        [ONE_ETH.mul(2),ONE_ETH.mul(4),ONE_ETH.mul(6),ONE_ETH.mul(8),ONE_ETH.mul(10)],
        10,
      );
      expect(parseFloat(fromBn(queryValue, 18))).to.be.equal(2);
    });
    it("query key more than biggest key", async () => {
      const queryValue = await derivative.interpolate(
        [50,75,100,125,150],
        [ONE_ETH.mul(2),ONE_ETH.mul(4),ONE_ETH.mul(6),ONE_ETH.mul(8),ONE_ETH.mul(10)],
        1000,
      );
      expect(parseFloat(fromBn(queryValue, 18))).to.be.equal(10);
    });
  });

  /****************************************
   * Finding closest indices
   ****************************************/
  describe("Finding closest indices", () => {
    it("query key in middle #1", async () => {
      const [indexLeft, indexRight] = await derivative.findClosestIndices(
        [50,75,100,125,150], 110);
      const [indexLeftts, indexRightts] = checkClosestIndices(
        [50,75,100,125,150], 110);
      expect(indexLeft).to.be.equal(indexLeftts);
      expect(indexRight).to.be.equal(indexRightts);
    });
    it("query key in middle #2", async () => {
      const [indexLeft, indexRight] = await derivative.findClosestIndices(
        [50,75,100,125,150], 129);
      const [indexLeftts, indexRightts] = checkClosestIndices(
        [50,75,100,125,150], 129);
      expect(indexLeft).to.be.equal(indexLeftts);
      expect(indexRight).to.be.equal(indexRightts);
    });
    it("query key less than lowest key", async () => {
      const [indexLeft, indexRight] = await derivative.findClosestIndices(
        [50,75,100,125,150], 10);
      const [indexLeftts, indexRightts] = checkClosestIndices(
        [50,75,100,125,150], 10);
      expect(indexLeft).to.be.equal(indexLeftts);
      expect(indexRight).to.be.equal(indexRightts);
    });
    it("query key less than highest key", async () => {
      const [indexLeft, indexRight] = await derivative.findClosestIndices(
        [50,75,100,125,150], 190);
      const [indexLeftts, indexRightts] = checkClosestIndices(
        [50,75,100,125,150], 190);
      expect(indexLeft).to.be.equal(indexLeftts);
      expect(indexRight).to.be.equal(indexRightts);
    });
  });
});