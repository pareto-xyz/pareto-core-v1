/**
 * @notice Utility script to compute black scholes in typescript
 * @dev Implementation of `BlackScholesMath.sol` in Typescript
 */

import { erf } from "mathjs";

export function normalCDF(
  x: number,
  mean: number,
  sigma: number
): number {
  return (1 - erf((mean - x) / (Math.sqrt(2) * sigma))) / 2;
}

// 1/sqrt(2pi) * e^{-1/2*x^2}
export function normalPDF(x: number): number {
  return 1 / Math.sqrt(2 * Math.PI) * Math.exp(-0.5 * Math.pow(x, 2));
}

// d1 = (log(S/K) + (r + sigma^2/2*tau)) / (sigma*sqrt(tau))
// d2 = d1 - sigma*sqrt(tau)
export function checkProbabilityFactors(
  spot: number,
  strike: number,
  sigma: number,
  tau: number,
  rate: number,
): [number, number] {
  let tauInYears = tau / 31556952;
  let logTerm = Math.log(spot / strike);
  let rateTerm = (rate + Math.pow(sigma, 2) / 2 * tauInYears);
  let vol = sigma * Math.sqrt(tauInYears);
  let d1 = (logTerm + rateTerm) / vol;
  let d2 = d1 - vol;
  return [d1, d2];
}

// C = SN(d1)-Ke^{-rt}N(d2)
export function checkCallPrice(
  spot: number,
  strike: number,
  sigma: number,
  tau: number,
  rate: number,
): number {
  const [d1, d2] = checkProbabilityFactors(spot, strike, sigma, tau, rate);
  let tauInYears = tau / 31556952;
  let spotProb = spot * normalCDF(d1, 0, 1);
  let discount = Math.exp(-rate * tauInYears);
  let discountStrikeProb = strike * discount * normalCDF(d2, 0, 1);
  let price = spotProb - discountStrikeProb;
  return price;
}

// P = Ke^{-rt}N(-d2)-SN(-d1)
export function checkPutPrice(
  spot: number,
  strike: number,
  sigma: number,
  tau: number,
  rate: number,
): number {
  const [d1, d2] = checkProbabilityFactors(spot, strike, sigma, tau, rate);
  let tauInYears = tau / 31556952;
  let discount = Math.exp(-rate * tauInYears);
  let discountStrikeProb = strike * discount * normalCDF(-d2, 0, 1);
  let spotProb = spot * normalCDF(-d1, 0, 1);
  let price = discountStrikeProb - spotProb;
  return price;
}

export function checkBacksolveSigma(
  spot: number,
  strike: number,
  tau: number,
  rate: number,
  tradePrice: number,
  isCall: boolean,
  tolerance: number,
  maxIter: number,
): number {
  var sigma = 1
  for (var i = 0; i < maxIter; i++) {
    var markPrice;
    if (isCall) {
        markPrice = checkCallPrice(spot, strike, sigma, tau, rate);
    } else {
        markPrice = checkPutPrice(spot, strike, sigma, tau, rate);
    }
    var diff = markPrice - tradePrice;
    if (Math.abs(diff) < tolerance) {
      break;
    }
    var vega = checkVega(spot, strike, sigma, tau, rate);
    sigma = sigma - (diff / vega);
  }
  return sigma;
}

export function checkVega(
  spot: number,
  strike: number,
  sigma: number,
  tau: number,
  rate: number,
): number {
  let [d1, _] = checkProbabilityFactors(spot, strike, sigma, tau, rate);
  let tauInYears = tau / 31556952;
  let spotSqrtTau = spot * Math.sqrt(tauInYears);
  let vega = spotSqrtTau * normalPDF(d1);
  return vega;
}
