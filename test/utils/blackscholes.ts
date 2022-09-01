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

export function normalInverseCDF(p: number): number {
  var a1 = -39.6968302866538, a2 = 220.946098424521, a3 = -275.928510446969;
  var a4 = 138.357751867269, a5 = -30.6647980661472, a6 = 2.50662827745924;
  var b1 = -54.4760987982241, b2 = 161.585836858041, b3 = -155.698979859887;
  var b4 = 66.8013118877197, b5 = -13.2806815528857, c1 = -7.78489400243029E-03;
  var c2 = -0.322396458041136, c3 = -2.40075827716184, c4 = -2.54973253934373;
  var c5 = 4.37466414146497, c6 = 2.93816398269878, d1 = 7.78469570904146E-03;
  var d2 = 0.32246712907004, d3 = 2.445134137143, d4 = 3.75440866190742;
  var p_low = 0.02425, p_high = 1 - p_low;
  var q, r;
  var retVal;

  if ((p < 0) || (p > 1)) {
    retVal = 0;
  }
  else if (p < p_low) {
    q = Math.sqrt(-2 * Math.log(p));
    retVal = (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  else if (p <= p_high) {
    q = p - 0.5;
    r = q * q;
    retVal = (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    retVal = -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  return retVal;
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

export function getSigmaByNewton(
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
    var vega = Math.max(checkVega(spot, strike, sigma, tau, rate), 0.01);
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

export function getStrikeFromDelta(
  delta: number,
  spot: number,
  sigma: number,
  tau: number,
  rate: number,
): number {
  let score = normalInverseCDF(delta);
  let tauInYears = tau / 31556952;
  let vol = sigma * Math.sqrt(tauInYears);
  let rtsigsqr = rate + tauInYears * Math.pow(sigma, 2);
  let logit = rtsigsqr / 2 - vol * score;
  let strike = spot * Math.exp(logit);
  return strike;
}
