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
    int128 internal constant TWO_PI_INT = 0x6487ed5110b45ef48;

    /// @notice Tolerance for Newton Raphson optimization (0.01)
    int128 internal constant OPT_TOL = 0x28f5c28f5c28f5c;

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
     * Structs and Formatting
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

    /************************************************
     * Computing Options Prices
     ***********************************************/

    /**
     * @notice Compute Black Scholes call price
     * @param inputs Black Scholes model parameters
     * @return price Black Scholes price of call
     */
    function getCallPrice(PriceCalculationInput memory inputs) 
        external
        pure 
        returns (uint256 price)
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        int128 priceX64 = getCallPriceX64(inputsX64);
        require(priceX64 >= 0, "getCallPrice: Price is negative");
        price = priceX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Internal function for `getCallPrice` exclusively in 64.64
     * @dev C = SN(d1)-Ke^{-rt}N(d2)
     */
    function getCallPriceX64(PriceCalculationX64 memory inputsX64)
        internal
        pure 
        returns (int128 priceX64)
    {
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
        priceX64 = spotProbX64.sub(discountStrikeProbX64);
    }

    /**
     * @notice Compute Black Scholes put price
     * @param inputs Black Scholes model parameters
     * @return price Black Scholes price of put
     */
    function getPutPrice(PriceCalculationInput memory inputs)
        external
        pure
        returns (uint256 price)
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        int128 priceX64 = getPutPriceX64(inputsX64);
        require(priceX64 >= 0, "getPutPrice: Price is negative");
        price = priceX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Internal function for `getPutPrice` exclusively in 64.64
     * @dev P = Ke^{-rt}N(-d2)-SN(-d1)
     */
    function getPutPriceX64(PriceCalculationX64 memory inputsX64)
        internal
        pure 
        returns (int128 priceX64)
    {
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
        priceX64 = discountStrikeProbX64.sub(spotProbX64);
    }

    /************************************************
     * Backsolving for Volatility
     ***********************************************/

    /**
     * @notice Iterative methods like Newton Raphson require an initial guess
     * @dev The same formula is used for calls and puts
     * @dev sqrt(2*pi / tau) * C / S
     * @dev Brenner and Subrahmanyam (1988)
     * @dev https://quant.stackexchange.com/questions/7761/a-simple-formula-for-calculating-implied-volatility
     * @dev https://www.codearmo.com/blog/implied-volatility-european-call-python
     */
    function guessSigmaX64(VolCalculationX64 memory inputsX64)
        internal
        pure
        returns (int128 sigmaX64)
    {
        // sqrt(2*pi / tau)
        int128 piTerm = (TWO_PI_INT.div(inputsX64.tauX64)).sqrt();
        // C / S
        int128 priceTerm = inputsX64.priceX64.div(inputsX64.spotX64);
        sigmaX64 = piTerm.mul(priceTerm);
    }

    /**
     * @notice Solve for volatility from call price iteratively using Newton-Raphson
     * @dev Tompkinks (1994, pp. 143)
     * @dev https://www.codearmo.com/blog/implied-volatility-european-call-python
     * @dev We have an error tolerance of 0.01 (generous to reduce gas cost)
     * @param inputs Black Scholes model parameters 
     * @param maxIter To be gas efficient, we should limit the computation
     * @return sigma Implied volatility estimate (annual)
     */
    function solveSigmaFromCallPrice(
        VolCalculationInput memory inputs,
        uint256 maxIter
    ) 
        external
        pure
        returns (uint256 sigma) 
    {
        VolCalculationX64 memory inputsX64 = volInputToX64(inputs);

        // Use heuristic to make initial guess for Sigma
        int128 sigmaX64 = guessSigmaX64(inputsX64);

        // Build a struct for computing BS price
        PriceCalculationX64 memory dataX64 = PriceCalculationX64(
            inputsX64.spotX64,
            inputsX64.strikeX64,
            sigmaX64,
            inputsX64.tauX64,
            inputsX64.rateX64,
            inputs.scaleFactor
        );

        // Iteratively solve for sigma
        for (uint256 i = 0; i < maxIter; i++) {
            // Calculate difference between BS price and market price 
            int128 diffX64 = getCallPriceX64(dataX64).sub(inputsX64.priceX64);

            if (diffX64.abs() < OPT_TOL) {
                break;
            }

            // Calculate vega of call option
            int128 vegaX64 = getCallVegaX64(dataX64);

            // Newton Raphson to update estimate
            sigmaX64 = sigmaX64.sub(diffX64.div(vegaX64));

            // Update `dataX64`
            dataX64.sigmaX64 = sigmaX64;
        }

        // Return the best approximation
        require(sigmaX64 >= 0, "solveSigmaFromCallPrice: sigma is negative");
        sigma = sigmaX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Solve for volatility from put price iteratively using Newton-Raphson
     * @dev Tompkinks (1994, pp. 143)
     * @dev https://www.codearmo.com/blog/implied-volatility-european-call-python
     * @param inputs Black Scholes model parameters 
     * @param maxIter To be gas efficient, we should limit the computation
     * @return sigma Implied volatility estimate (annual)
     */
    function solveSigmaFromPutPrice(
        VolCalculationInput memory inputs,
        uint256 maxIter
    ) 
        external
        pure
        returns (uint256 sigma) 
    {
        VolCalculationX64 memory inputsX64 = volInputToX64(inputs);

        // Use heuristic to make initial guess for Sigma
        int128 sigmaX64 = guessSigmaX64(inputsX64);

        // Build a struct for computing BS price
        PriceCalculationX64 memory dataX64 = PriceCalculationX64(
            inputsX64.spotX64,
            inputsX64.strikeX64,
            sigmaX64,
            inputsX64.tauX64,
            inputsX64.rateX64,
            inputs.scaleFactor
        );

        // Iteratively solve for sigma
        for (uint256 i = 0; i < maxIter; i++) {
            // Calculate difference between BS price and market price 
            int128 diffX64 = getPutPriceX64(dataX64).sub(inputsX64.priceX64);

            // If the difference is small enough, break
            if (diffX64.abs() < OPT_TOL) {
                break;
            }

            // Calculate vega of put option
            int128 vegaX64 = getPutVegaX64(dataX64);

            // Newton Raphson to update estimate
            sigmaX64 = sigmaX64.sub(diffX64.div(vegaX64));

            // Update `dataX64`
            dataX64.sigmaX64 = sigmaX64;
        }

        // Return the best approximation
        require(sigmaX64 >= 0, "solveSigmaFromPutPrice: sigma is negative");
        sigma = sigmaX64.scaleFromX64(inputs.scaleFactor);
    }

    /************************************************
     * Computing Vega
     ***********************************************/

    /**
     * @notice Compute vega of a call option (change in option price given 1% change in IV)
     * @return vega The greek vega
     */
    function getCallVega(PriceCalculationInput memory inputs) 
        external
        pure
        returns (uint256 vega) 
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        int128 vegaX64 = getCallVegaX64(inputsX64);
        // vega is a delta in price so scale from price factor
        vega = vegaX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Internal function for vega of a call option
     * @dev vega = S * sqrt{tau} * N'(d1)
     * @dev http://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf
     * @dev https://en.wikipedia.org/wiki/Greeks_(finance)#Vega
     */
    function getCallVegaX64(PriceCalculationX64 memory inputsX64)
        internal
        pure
        returns (int128 vegaX64)
    {
        // Compute probability factors
        (int128 d1,) = getProbabilityFactors(inputsX64);
        // Compute S * sqrt(tau) * PDF(d1)
        int128 spotSqrtTauX64 = inputsX64.spotX64.mul(inputsX64.tauX64.sqrt());
        vegaX64 = spotSqrtTauX64.mul(GaussianMath.getPDF(d1));
    }

    /**
     * @notice Compute vega of a put option (change in option price given 1% change in IV)
     * @dev vega = K * sqrt(tau) * e^{-rate * tau} * N'(d2)
     * @dev http://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf
     * @dev https://en.wikipedia.org/wiki/Greeks_(finance)#Vega
     * @return vega The greek vega
     */
    function getPutVega(PriceCalculationInput memory inputs)
        external
        pure
        returns (uint256 vega)
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        int128 vegaX64 = getPutPriceX64(inputsX64);
        // vega is a delta in price so scale from price factor
        vega = vegaX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Internal function for vega of a put option
     * @dev vega = K * sqrt(tau) * e^{-rate * tau} * N'(d2)
     * @dev http://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf
     * @dev https://en.wikipedia.org/wiki/Greeks_(finance)#Vega
     */
    function getPutVegaX64(PriceCalculationX64 memory inputsX64)
        internal
        pure
        returns (int128 vegaX64)
    {
        // Compute probability factors
        (,int128 d2) = getProbabilityFactors(inputsX64);
        // K * sqrt(tau) * e^{-rate * tau} * PDF(d2)
        int128 strikeSqrtTauX64 = inputsX64.strikeX64.mul(inputsX64.tauX64.sqrt());
        // exp{-rt}
        int128 discountX64 = (inputsX64.rateX64.mul(inputsX64.tauX64)).neg().exp();
        vegaX64 = (strikeSqrtTauX64.mul(discountX64)).mul(GaussianMath.getPDF(d2));
    }
}