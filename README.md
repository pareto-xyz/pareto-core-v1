[![Tests](https://github.com/pareto-xyz/pareto-core-v1/actions/workflows/ci.yaml/badge.svg)](https://github.com/pareto-xyz/pareto-core-v1/actions/workflows/ci.yaml)

# Pareto Order Book Smart Contracts V1

**[Disclaimer: This repository is no longer maintained and is meant for primarily educational purposes.]**

Core smart contracts of Pareto's Options Platform V1. Part of the series detailed in this [whitepaper](https://github.com/pareto-xyz/pareto-order-book-whitepaper/blob/main/how_to_orderbook.pdf). 

## Contracts

Pareto is a decentralized protocol for an options orderbook on Arbitrum. For speed reasons, the orderbook and matching algorithm are performed in an off-chain server. This repo contains contracts for settlement, margining, and liquidation.

## Instructions

For those interested in local development. 

### Installation

`npm install`

### Compile Contracts

`npx hardhat compile`

### Run Tests

`npx hardhat test`

### Run Coverage

`npx hardhat coverage`

### Local Deployment

Intended for testing with other Pareto infrastructure. To start a local network with Hardhat, run `npx hardhat node`. Keep this terminal instance open. In a second, separate, terminal instance, run:
```
npx hardhat run ./scripts/deploy.localhost.ts --network localhost
```
This will deploy a Mock USDC token contract, the spot and mark price oracle contracts, as well as the main margin contract. 
The underlying is ETH.
Spot prices are initialized to 1600 USDC for 1 ETH.
Mark prices are uninitialized (set to zero for all call and put strikes). The owner will need to update these values post deployment.

## Security

The disclosure of security vulnerabilities helps us ensure the security of our users. If you have found a security vulnerability, please send it to us at [team@paretolabs.xyz](mailto:team@paretolabs.xyz). Please include a detailed description and steps to reproduce the vulnerability. 

