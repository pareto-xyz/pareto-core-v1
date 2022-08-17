// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./CumulativeNormalDistribution.sol";
import "./ABDKMath64x64.sol";
import "./Units.sol";

/**
 * @notice Library for Black Scholes Math
 * @dev Used for computing mark price. Helpful tool for 64.64 numbers:
 * https://toolkit.abdk.consulting/math#convert-number
 */
library BlackScholesMath {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for uint256;
    using CumulativeNormalDistribution for int128;
    using Units for int128;
    using Units for uint256;

    int128 internal constant ONE_INT = 0x10000000000000000;
    int128 internal constant TWO_INT = 0x20000000000000000;
    int128 internal constant ONE_EIGHTY_FIVE_INT = 0x1d99999999999999a;
    int128 internal constant PI_INT = 0x3243f6a8885a308d3;

    /**
     * @notice Compute Black Scholes d1 parameter
     * @dev d1 = (log(S/K) + (r + sigma^2/2*tau)) / (sigma*sqrt(tau))
     * where tau = T - t = time to maturity, r = rate of return,
     * S = spot price, K = strike price, sigma = implied volatility
     * @param spotX64 Spot price of the asset as 64x64 number
     * @param strikeX64 Strike price of the asset as 64x64 number
     * @param sigmaX64 Normalized volatility of returns (annualized) as 64x64 number
     * @param tauX64 Time to expiry (in years) as 64x64 number. Expiry time T minus the current time t
     * @param rateX64 Risk-free rate as 64x64 number
     * @return d1 Probability factor one 
     * @return d2 Probability factor one 
     */
    function getProbabilityFactors(
        int128 spotX64,
        int128 strikeX64,
        int128 sigmaX64,
        int128 tauX64,
        int128 rateX64
    ) internal pure returns (int128 d1, int128 d2) {
        int128 sqrtTauX64 = tauX64.sqrt();
        int128 sigmaSqrX64 = sigmaX64.pow(2);
        // log (S/K)
        int128 logRatioX64 = spotX64.div(strikeX64).ln();
        // rate + sigma^2/2*tau
        int128 crossTermX64 = rateX64.add(tauX64.mul(sigmaSqrX64).div(TWO_INT));
        // sigma * sqrt(tau)
        int128 volX64 = sigmaX64.mul(sqrtTauX64);

        d1 = logRatioX64.add(crossTermX64).div(volX64);
        d2 = d1.sub(volX64);
    }

    /**
     * @notice Compute Black Scholes call price
     * @dev C = SN(d1)-Ke^{-rt}N(d2)
     * @param spot Spot price of the asset 
     * @param strike Strike price of the asset 
     * @param sigma Volatility of returns (annualized), not a percentage
     * @param tau Time to expiry (in seconds), not in years
     * @param rate Risk-free rate
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     * @return price Black Scholes price of call
     */
    function getCallPrice(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
    ) external pure returns (uint256 price) {
        int128 spotX64 = spot.scaleToX64(scaleFactor);
        int128 strikeX64 = strike.scaleToX64(scaleFactor);
        int128 rateX64 = rate.scaleToX64(scaleFactor);
        /// Convert time to expiry to years
        int128 tauX64 = tau.toYears();
        // Normalize sigma to percentage
        int128 sigmaX64 = sigma.percentageToX64();
        // Compute probability factors
        (int128 d1, int128 d2) = getProbabilityFactors(
            spotX64, strikeX64, sigmaX64, tauX64, rateX64
        );
        // spot * N(d1)
        int128 term1X64 = spotX64.mul(
            CumulativeNormalDistribution.getCDF(d1)
        );
        // exp{-rt}
        int128 termExpX64 = (rateX64.mul(tauX64)).neg().exp();
        // strike * termExp * N(d2)
        int128 term2X64 = strikeX64.mul(termExpX64).mul(
            CumulativeNormalDistribution.getCDF(d2)
        );
        // Should be > 0
        int128 priceX64 = term1X64.sub(term2X64);
        // Convert back to uint256
        price = priceX64.scaleFromX64(scaleFactor);
    }

    /**
     * @notice Compute Black Scholes put price
     * @dev P = Ke^{-rt}N(-d2)-SN(-d1)
     * @param spot Spot price of the asset 
     * @param strike Strike price of the asset 
     * @param sigma Volatility of returns (annualized), not a percentage
     * @param tau Time to expiry (in seconds), not in years
     * @param rate Risk-free rate
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     * @return price Black Scholes price of put
     */
    function getPutPrice(
        uint256 spot,
        uint256 strike,
        uint256 sigma,
        uint256 tau,
        uint256 rate,
        uint256 scaleFactor
    ) external pure returns (uint256 price) {
        int128 spotX64 = spot.scaleToX64(scaleFactor);
        int128 strikeX64 = strike.scaleToX64(scaleFactor);
        int128 rateX64 = rate.scaleToX64(scaleFactor);
        /// Convert time to expiry to years
        int128 tauX64 = tau.toYears();
        // Normalize sigma to percentage
        int128 sigmaX64 = sigma.percentageToX64();
        // Compute probability factors
        (int128 d1, int128 d2) = getProbabilityFactors(
            spotX64, strikeX64, sigmaX64, tauX64, rateX64
        );
        // exp{-rt}
        int128 termExpX64 = (rateX64.mul(tauX64)).neg().exp();
        // strike * exp{-rt} * N(-d2)
        int128 term1X64 = strikeX64.mul(termExpX64).mul(
            CumulativeNormalDistribution.getCDF(d2.neg())
        );
        // spot * N(-d1)
        int128 term2X64 = spotX64.mul(
            CumulativeNormalDistribution.getCDF(d1.neg())
        );
        // Should be > 0
        int128 priceX64 = term1X64.sub(term2X64);
        // Convert back to uint256
        price = priceX64.scaleFromX64(scaleFactor);
    }

    /**
     * @notice Approximate volatility from trade price for a call option
     * @dev See "An Improved Estimator For Black-Scholes-Merton Implied Volatility" by Hallerbach (2004)
     * @param spot Spot price in stable asset
     * @param strike Strike price in stable asset
     * @param tau Time to expiry (in seconds), not in years
     * @param tradePrice Actual price that the option was sold/bought
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     */
    function approxIVFromCallPrice(
        uint256 spot,
        uint256 strike,
        uint256 tau,
        uint256 tradePrice,
        uint256 scaleFactor
    ) public pure returns (uint256 sigma) {
        int128 spotX64 = spot.scaleToX64(scaleFactor);
        int128 strikeX64 = strike.scaleToX64(scaleFactor);
        int128 tauX64 = tau.toYears();
        int128 priceX64 = tradePrice.scaleToX64(scaleFactor);

        int128 termA = priceX64.mul(TWO_INT).add(strikeX64).sub(spotX64);
        int128 termB = spotX64.add(strikeX64);

        int128 termC = termA.add(
            (termA.pow(2).sub(
                ONE_EIGHTY_FIVE_INT.mul(termB).mul((strikeX64.sub(spotX64)).pow(2))
                .div(PI_INT.mul((strikeX64.mul(spotX64)).sqrt()))
            )).sqrt()
        );
        int128 termD = (TWO_INT.mul(PI_INT)).sqrt().div(termB.add(TWO_INT));
        int128 sigmaX64 = termD.mul(termC).div(tauX64.sqrt());

        sigma = sigmaX64.scaleFromX64(scaleFactor);
    }

    /**
     * @notice Approximate volatility from trade price for a put option
     * @dev See https://quant.stackexchange.com/questions/35462/what-is-the-closed-form-implied-volatility-estimator-as-defined-by-hallerbach-2
     * @param spot Spot price in stable asset
     * @param strike Strike price in stable asset
     * @param tau Time to expiry (in seconds), not in years
     * @param tradePrice Actual price that the option was sold/bought
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     */
    function approxIVFromPutPrice(
        uint256 spot,
        uint256 strike,
        uint256 tau,
        uint256 tradePrice,
        uint256 scaleFactor
    ) public pure returns (uint256 sigma) {
        // Same formula but reverse roles of spot and strike
        sigma = approxIVFromCallPrice(strike, spot, tau, tradePrice, scaleFactor);
    }
}