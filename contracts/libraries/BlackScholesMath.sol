// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./GaussianMath.sol";
import "./ABDKMath64x64.sol";
import "./Units.sol";
import "hardhat/console.sol";

/**
 * @notice Library for Black Scholes Math
 * @dev Used for computing mark price. Helpful tool for 64.64 numbers:
 * https://toolkit.abdk.consulting/math#convert-number
 * @dev All 64.64 integer logic must be contained in this file
 */
library BlackScholesMath {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for uint256;
    using GaussianMath for int128;
    using Units for int128;
    using Units for uint256;

    /************************************************
     * Constants
     ***********************************************/

    int128 internal constant ONE_INT = 0x10000000000000000;
    int128 internal constant TWO_INT = 0x20000000000000000;
    int128 internal constant ONE_EIGHTY_FIVE_INT = 0x1d99999999999999a;
    int128 internal constant PI_INT = 0x3243f6a8885a308d3;

    /************************************************
     * Computing Black Scholes Probabilities
     ***********************************************/

    /**
     * @notice Compute Black Scholes d1 parameter
     * @dev d1 = (log(S/K) + (r + sigma^2/2*tau)) / (sigma*sqrt(tau))
     * where tau = T - t = time to maturity, r = rate of return,
     * S = spot price, K = strike price, sigma = stdev of returns (volatility)
     * @param inputsX64 Black Scholes parameters in 64.64 numbers
     * @return d1 Probability factor one 
     * @return d2 Probability factor one 
     */
    function getProbabilityFactors(PriceCalculationX64 memory inputsX64)
        internal
        pure
        returns (int128 d1, int128 d2) 
    {
        int128 sqrtTauX64 = inputsX64.tauX64.sqrt();
        int128 sigmaSqrX64 = inputsX64.sigmaX64.pow(2);
        // log (S/K)
        int128 logRatioX64 = inputsX64.spotX64.div(inputsX64.strikeX64).ln();
        // rate + sigma^2/2*tau
        int128 crossTermX64 = inputsX64.rateX64
            .add(inputsX64.tauX64.mul(sigmaSqrX64).div(TWO_INT));
        // sigma * sqrt(tau)
        int128 volX64 = inputsX64.sigmaX64.mul(sqrtTauX64);
        d1 = logRatioX64.add(crossTermX64).div(volX64);
        d2 = d1.sub(volX64);
    }

    /************************************************
     * Computing Options Prices
     ***********************************************/

    /**
     * @notice Struct that groups together inputs for computing BS price
     * @param spot Spot price
     * @param strike Strike price of the asset 
     * @param sigma Stdev of returns (volatility), not a percentage
     * @param tau Time to expiry (in seconds), not in years
     * @param rate Risk-free rate
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     */
    struct PriceCalculationInput {
        uint256 spot;
        uint256 strike;
        uint256 sigma;
        uint256 tau;
        uint256 rate;
        uint256 scaleFactor;
    }

    /// @notice Convert `PriceCalculationInput` to 64.64 types
    struct PriceCalculationX64 {
        int128 spotX64;
        int128 strikeX64;
        int128 sigmaX64;
        int128 tauX64;
        int128 rateX64;
        uint256 scaleFactor;
    }

    /**
     * @notice Convert `PriceCalculationInput` to `PriceCalculationX64`
     * @param inputs PriceCalculationInput object
     * @param outputs PriceCalculationX64 object
     */
    function priceInputToX64(PriceCalculationInput memory inputs)
        internal
        pure
        returns (PriceCalculationX64 memory outputs) 
    {
        outputs = PriceCalculationX64(
            inputs.spot.scaleToX64(inputs.scaleFactor),
            inputs.strike.scaleToX64(inputs.scaleFactor),
            inputs.sigma.percentageToX64(),
            inputs.tau.toYears(),
            inputs.rate.scaleToX64(inputs.scaleFactor),
            inputs.scaleFactor
        );
    }

    /**
     * @notice Compute Black Scholes call price
     * @dev C = SN(d1)-Ke^{-rt}N(d2)
     * @param inputs Black Scholes model parameters
     * @return price Black Scholes price of call
     */
    function getCallPrice(PriceCalculationInput memory inputs) 
        external
        pure 
        returns (uint256 price)
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        // Compute probability factors
        (int128 d1, int128 d2) = getProbabilityFactors(inputsX64);
        // spot * N(d1)
        int128 spotProbX64 = inputsX64.spotX64
            .mul(GaussianMath.getCDF(d1));
        // exp{-rt}
        int128 discountX64 = 
            (inputsX64.rateX64.mul(inputsX64.tauX64)).neg().exp();
        // strike * termExp * N(d2)
        int128 discountStrikeProbX64 = inputsX64.strikeX64
            .mul(discountX64)
            .mul(GaussianMath.getCDF(d2));
        // Should be > 0
        int128 priceX64 = spotProbX64.sub(discountStrikeProbX64);
        require(priceX64 >= 0, "getCallPrice: Price is negative");
        // Convert back to uint256
        price = priceX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Compute Black Scholes put price
     * @dev P = Ke^{-rt}N(-d2)-SN(-d1)
     * @param inputs Black Scholes model parameters
     * @return price Black Scholes price of put
     */
    function getPutPrice(PriceCalculationInput memory inputs)
        external
        pure
        returns (uint256 price)
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        // Compute probability factors
        (int128 d1, int128 d2) = getProbabilityFactors(inputsX64);
        // exp{-rt}
        int128 discountX64 = 
            (inputsX64.rateX64.mul(inputsX64.tauX64)).neg().exp();
        // strike * exp{-rt} * N(-d2)
        int128 discountStrikeProbX64 = inputsX64.strikeX64
            .mul(discountX64)
            .mul(GaussianMath.getCDF(d2.neg()));
        // spot * N(-d1)
        int128 spotProbX64 = inputsX64.spotX64
            .mul(GaussianMath.getCDF(d1.neg()));
        // Should be > 0
        int128 priceX64 = discountStrikeProbX64.sub(spotProbX64);
        require(priceX64 >= 0, "getPutPrice: Price is negative");
        // Convert back to uint256
        price = priceX64.scaleFromX64(inputs.scaleFactor);
    }

    /************************************************
     * Backsolving for Volatility
     ***********************************************/

    /**
     * @notice Struct that groups together inputs for computing BS price
     * @param spot Spot price in stable asset
     * @param strike Strike price of the asset 
     * @param tau Time to expiry (in seconds), not in years
     * @param rate Risk-free rate
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     * @param tradePrice Actual price that the option was sold/bought
     */
    struct VolCalculationInput {
        uint256 spot;
        uint256 strike;
        uint256 tau;
        uint256 rate;
        uint256 tradePrice;
        uint256 scaleFactor;
    }

    /// @notice Convert `VolCalculationInput` to 64.64 types
    struct VolCalculationX64 {
        int128 spotX64;
        int128 strikeX64;
        int128 tauX64;
        int128 rateX64;
        int128 priceX64;
        uint256 scaleFactor;
    }

    /**
     * @notice Convert `VolCalculationInput` to `VolCalculationX64`
     * @param inputs VolCalculationInput object
     * @param outputs VolCalculationX64 object
     */
    function volInputToX64(VolCalculationInput memory inputs)
        internal
        pure
        returns (VolCalculationX64 memory outputs) 
    {
        outputs = VolCalculationX64(
            inputs.spot.scaleToX64(inputs.scaleFactor),
            inputs.strike.scaleToX64(inputs.scaleFactor),
            inputs.tau.toYears(),
            inputs.rate.scaleToX64(inputs.scaleFactor),
            inputs.tradePrice.scaleToX64(inputs.scaleFactor),
            inputs.scaleFactor
        );
    }

    /**
     * @notice Convert implied volatility to sigma by dividing by root tau
     * @param vol The implied volatility i.e., sigma * sqrt(tau)
     * @param tau The time to expiry in seconds
     * @return sigma Standard deviation of returns (volatility)
     */
    function volToSigma(uint256 vol, uint256 tau)
        internal
        pure
        returns (uint256 sigma) 
    {
        int128 volX64 = vol.percentageToX64();
        int128 sqrtTauX64 = tau.toYears().sqrt();
        int128 sigmaX64 = volX64.div(sqrtTauX64);
        sigma = sigmaX64.percentageFromX64();
    }

    /**
     * @notice Approximate volatility from trade price for a call option
     * @dev See "An Improved Estimator For Black-Scholes-Merton Implied Volatility" by Hallerbach (2004)
     * @param inputs Black Scholes model parameters
     * @return vol Implied volatility over the time to expiry: `sigma*sqrt(tau)`
     * @dev This does not return `sigma`
     * @dev Returns vol in decimals of the strike/spot price
     */
    function approxVolFromCallPrice(VolCalculationInput memory inputs)
        public
        pure
        returns (uint256 vol) 
    {
        VolCalculationX64 memory inputsX64 = volInputToX64(inputs);

        // Compute discounted strike price
        int128 discountStrikeX64 = inputsX64.strikeX64
            .mul((inputsX64.rateX64.mul(inputsX64.tauX64)).neg().exp());
        int128 TwoCXS = inputsX64.priceX64.mul(TWO_INT)
            .add(discountStrikeX64)
            .sub(inputsX64.spotX64);
        int128 SX = inputsX64.spotX64.add(discountStrikeX64);
        int128 piTerm = (TWO_INT.mul(PI_INT)).sqrt().div(SX.mul(TWO_INT));
        int128 sqrtTerm = (TwoCXS.pow(2).sub(
            ONE_EIGHTY_FIVE_INT
                .mul(SX)
                .mul((discountStrikeX64.sub(inputsX64.spotX64)).pow(2))
            .div(PI_INT.mul((discountStrikeX64.mul(inputsX64.spotX64)).sqrt()))
        )).sqrt();
        int128 volX64 = piTerm.mul(TwoCXS.add(sqrtTerm));
        vol = volX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Approximate volatility from trade price for a put option
     * @dev See https://quant.stackexchange.com/questions/35462/what-is-the-closed-form-implied-volatility-estimator-as-defined-by-hallerbach-2
     * @param inputs Black Scholes model parameters
     * @return vol Implied volatility over the time to expiry: sigma*sqrt(tau)
     * @dev This does not return `sigma`
     * @dev Returns vol in decimals of the strike/spot price
     */
    function approxVolFromPutPrice(VolCalculationInput memory inputs)
        public
        pure
        returns (uint256 vol)
    {
        // Same formula but reverse roles of spot and strike
        (inputs.strike, inputs.spot) = (inputs.spot, inputs.strike);
        vol = approxVolFromCallPrice(inputs);
    }

    /************************************************
     * Computing Vega
     ***********************************************/

    /**
     * @notice Compute vega of an option (change in option price given 1% change in IV)
     * @dev vega = e^{-r tau} * S * sqrt{tau} * N(d1)
     * @dev http://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf
     * @dev Vega of the call and the put on the same strike and expiration is the same
     * @return vega The greek vega
     */
    function getVega(PriceCalculationInput memory inputs) 
        external
        pure
        returns (uint256 vega) 
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        // Compute probability factors
        (int128 d1,) = getProbabilityFactors(inputsX64);
        // Compute S * sqrt(tau)
        int128 spotSqrtTau = inputsX64.spotX64.mul(inputsX64.tauX64.sqrt());
        int128 discountX64 = 
            (inputsX64.rateX64.mul(inputsX64.tauX64)).neg().exp();
        int128 vegaX64 = discountX64
            .mul(spotSqrtTau)
            .mul(GaussianMath.getCDF(d1));
        // vega is a delta in price so scale from price factor
        vega = vegaX64.scaleFromX64(inputs.scaleFactor);
    }
}