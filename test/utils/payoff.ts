/**
 * @notice Utility script to compute payoffs of options
 * @dev Implementation of `MarginMath.sol` in Typescript
 */

// payoff = max(spot - strike, 0) 
export function getPayoffLongCall(
  spot: number,
  strike: number,
  tradePrice: number,
  quantity: number,
): number {
  let payoffNoPremium = Math.max(spot - strike, 0);
  let payoff = payoffNoPremium - tradePrice;
  return payoff * quantity;
}

// payoff = -max(spot - strike, 0) 
export function getPayoffShortCall(
  spot: number,
  strike: number,
  tradePrice: number,
  quantity: number,
): number {
  return -getPayoffLongCall(spot, strike, tradePrice, quantity);
}

// payoff = max(strike - spot, 0) 
export function getPayoffLongPut(
  spot: number,
  strike: number,
  tradePrice: number,
  quantity: number,
): number {
  let payoffNoPremium = Math.max(strike - spot, 0);
  let payoff = payoffNoPremium - tradePrice;
  return payoff * quantity;
}

// payoff = -max(strike - spot, 0) 
export function getPayoffShortPut(
  spot: number,
  strike: number,
  tradePrice: number,
  quantity: number,
): number {
  return -getPayoffLongPut(spot, strike, tradePrice, quantity);
}
