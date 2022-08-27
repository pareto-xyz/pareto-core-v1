import math
from scipy.stats import norm

def tauToYears(tau):
  return tau / 31556952

def get_prob_factors(spot, strike, rate, sigma, tau):
  tauInYears = tauToYears(tau);
  d1 = (math.log(spot / strike) + (rate + sigma**2/2) * tauInYears) / (sigma * math.sqrt(tauInYears))
  d2 = d1 - (sigma * math.sqrt(tauInYears))
  return d1, d2

def get_vega(spot, strike, rate, sigma, tau):
  d1, _ = get_prob_factors(spot, strike, rate, sigma, tau)
  tauInYears = tauToYears(tau);
  vega = spot * norm.pdf(d1) * math.sqrt(tauInYears)
  return vega

def get_call_price(spot, strike, rate, sigma, tau):
  d1, d2 = get_prob_factors(spot, strike, rate, sigma, tau)
  tauInYears = tauToYears(tau);
  price = spot * norm.cdf(d1) - strike * math.exp(-rate * tauInYears) * norm.cdf(d2)
  return price

def get_imp_vol(spot, strike, rate, tau, market, tol=1e-6, maxIter=5):
  sigma = 1
  for _ in range(maxIter):
    diff = get_call_price(spot, strike, rate, sigma, tau) - market
    if abs(diff) < tol:
      break
    vega = get_vega(spot, strike, rate, sigma, tau)
    sigma = sigma - diff / vega
    print("sigma", sigma)
  return sigma


if __name__ == "__main__":
  iv = get_imp_vol(100, 115, 0.05, 31556952, 1pp)