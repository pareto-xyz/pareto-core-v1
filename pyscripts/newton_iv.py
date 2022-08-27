import math
import numpy as np
from scipy.stats import norm

def tauToYears(tau):
  return tau / 31556952

def get_prob_factors(spot, strike, rate, sigma, tau):
  tauInYears = tauToYears(tau)
  d1 = (math.log(spot / strike) + (rate + sigma**2/2) * tauInYears) / (sigma * math.sqrt(tauInYears))
  d2 = d1 - (sigma * math.sqrt(tauInYears))
  return d1, d2

def get_vega(spot, strike, rate, sigma, tau):
  d1, _ = get_prob_factors(spot, strike, rate, sigma, tau)
  tauInYears = tauToYears(tau)
  vega = spot * norm.pdf(d1) * math.sqrt(tauInYears)
  return vega

def get_call_price(spot, strike, rate, sigma, tau):
  d1, d2 = get_prob_factors(spot, strike, rate, sigma, tau)
  tauInYears = tauToYears(tau);
  price = spot * norm.cdf(d1) - strike * math.exp(-rate * tauInYears) * norm.cdf(d2)
  return price

def get_put_price(spot, strike, rate, sigma, tau):
  d1, d2 = get_prob_factors(spot, strike, rate, sigma, tau)
  tauInYears = tauToYears(tau);
  price = strike * math.exp(-rate * tauInYears) * norm.cdf(-d2) - spot * norm.cdf(-d1)
  return price

def brute_force_iv(spot, strike, rate, tau, market, is_call=True):
  candidates = np.arange(0.0001,4,0.001)
  diffs = np.zeros_like(candidates)

  for i in range(len(candidates)):
    candidate = candidates[i]
    if is_call:
      diff = get_call_price(spot, strike, rate, candidate, tau) - market
    else:
      diff = get_put_price(spot, strike, rate, candidate, tau) - market
    diffs[i] = abs(diff)
  
  best_i = np.argmin(diffs)
  return candidates[best_i], diffs[best_i]

def newton_raphson_iv(spot, strike, rate, tau, market, is_call=True, guess=1, tol=1e-6, maxIter=5, debug=False):
  sigma = guess
  for _ in range(maxIter):
    if is_call:
      diff = get_call_price(spot, strike, rate, sigma, tau) - market
    else:
      diff = get_put_price(spot, strike, rate, sigma, tau) - market
    if abs(diff) < tol:
      break
    # IMPORTANT TO PUT THIS
    vega = max(get_vega(spot, strike, rate, sigma, tau), 0.01)
    sigma = sigma - diff / vega

  return sigma

def bisection_method_iv(spot, strike, rate, tau, market, is_call=True, left=0, right=10, tol=1e-6, maxIter=5):
  for _ in range(maxIter):
    mid = (left + right) / 2
    if is_call:
      diff_mid = get_call_price(spot, strike, rate, mid, tau) - market
      diff_left = get_call_price(spot, strike, rate, left, tau) - market
    else:
      diff_mid = get_put_price(spot, strike, rate, mid, tau) - market
      diff_left = get_put_price(spot, strike, rate, left, tau) - market
    if abs(diff_mid) < tol:
      break
    if (diff_mid >= 0) == (diff_left >= 0):
      left = mid
    else:
      right = mid
  return mid


if __name__ == "__main__":
  tol = 1e-6
  iv = newton_raphson_iv(100, 115, 0.05, 31556952, 18, is_call=True, tol=tol)
  assert math.isclose(iv, 0.5428424065162359, abs_tol=tol)

  iv = newton_raphson_iv(100, 115, 0.05, 31556952, 18, is_call=False, tol=tol)
  assert math.isclose(iv, 0.3068596305125857, abs_tol=tol)

  price = get_call_price(1, 1.1, 0, 0.5, 604800)
  iv = newton_raphson_iv(1, 1.1, 0, 604800, price, is_call=True, tol=tol)
  assert math.isclose(iv, 0.5, abs_tol=tol)

  price = get_call_price(1, 1.1, 0, 0.5, 604800)
  print("original price", price)
  for x in [0.5, 0.75, 1, 1.25, 1.5]:
    is_call = x <= 1
    iv, _ = brute_force_iv(1.1*x, 1.1, 0, 604800, price, is_call=is_call)
    print("brute force", x, iv)
    iv = newton_raphson_iv(1.1*x, 1.1, 0, 604800, price, is_call=is_call, tol=tol,
                           guess=1, maxIter=10, debug=True)
    print("newton raphson", x, iv)
    iv = bisection_method_iv(1.1*x, 1.1, 0, 604800, price, is_call=is_call, tol=tol,
                             left=0.001, right=10.00, maxIter=10)
    print("bisection method", x, iv)