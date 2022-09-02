
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Helpful conversions
export const toBytes32 = ethers.utils.formatBytes32String;
export const fromBytes32 = ethers.utils.parseBytes32String;

// Bump the timestamp by a specific amount of seconds
export const timeTravel = async (seconds: number) => {
  await time.increase(seconds);
};

// Or, set the time to be a specific amount (in seconds past epoch time)
export const timeTravelTo = async (seconds: number) => {
  await time.increaseTo(seconds);
};

export const currentTime = () => {
  var seconds = new Date().getTime() / 1000;
  return Math.round(seconds);
};

/**
 * @notice Fixed gas 
 * @dev https://github.com/NomicFoundation/hardhat/issues/1721
 */
export const getFixedGasSigners = async function(gasLimit: number) {
  const signers : SignerWithAddress[] = await ethers.getSigners();
  signers.forEach(signer => {
    let orig = signer.sendTransaction;
    signer.sendTransaction = function(transaction) {
      transaction.gasLimit = BigNumber.from(gasLimit.toString());
      return orig.apply(signer, [transaction]);
    }
  });
  return signers;
};