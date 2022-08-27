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

    /// @notice Tolerance for Newton Raphson optimization (1e-10)
    int128 internal constant OPT_TOL = 0x6df37f67;

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
     * @param isCall true if option is a call else false if a put
     */
    struct PriceCalculationInput {
        uint256 spot;
        uint256 strike;
        uint256 sigma;
        uint256 tau;
        uint256 rate;
        uint256 scaleFactor;
        bool isCall;
    }

    /// @notice Convert `PriceCalculationInput` to 64.64 types
    struct PriceCalculationX64 {
        int128 spotX64;
        int128 strikeX64;
        int128 sigmaX64;
        int128 tauX64;
        int128 rateX64;
    }

    /**
     * @notice Struct that groups together inputs for computing BS price
     * @param spot Spot price in stable asset
     * @param strike Strike price of the asset 
     * @param tau Time to expiry (in seconds), not in years
     * @param rate Risk-free rate
     * @param tradePrice Actual price that the option was sold/bought
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     * @param isCall true if option is a call else false if a put
     */
    struct VolCalculationInput {
        uint256 spot;
        uint256 strike;
        uint256 tau;
        uint256 rate;
        uint256 tradePrice;
        uint256 scaleFactor;
        bool isCall;
    }

    /// @notice Convert `VolCalculationInput` to 64.64 types
    struct VolCalculationX64 {
        int128 spotX64;
        int128 strikeX64;
        int128 tauX64;
        int128 rateX64;
        int128 priceX64;
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
            inputs.rate.scaleToX64(inputs.scaleFactor)
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
            inputs.tradePrice.scaleToX64(inputs.scaleFactor)
        );
    }

    /************************************************
     * Computing Options Prices
     ***********************************************/

    /**
     * @notice Compute Black Scholes price of call or put
     * @param inputs Black Scholes model parameters
     * @return price Black Scholes price of call
     */
    function getPrice(PriceCalculationInput memory inputs) 
        external
        pure 
        returns (uint256 price)
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);

        int128 priceX64;
        if (inputs.isCall) {
            priceX64 = getCallPriceX64(inputsX64);
        } else {
            priceX64 = getPutPriceX64(inputsX64);
        }
        
        require(priceX64 >= 0, "getPrice: Price is negative");
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
     * @notice Solve for volatility from call price iteratively using Newton-Raphson
     * @dev Tompkinks (1994, pp. 143)
     * @dev https://www.codearmo.com/blog/implied-volatility-european-call-python
     * @dev We have an error tolerance of 0.01 (generous to reduce gas cost)
     * @param inputs Black Scholes model parameters 
     * @param maxIter To be gas efficient, we should limit the computation
     * @return sigma Implied volatility estimate (annual)
     */
    function backsolveSigma(
        VolCalculationInput memory inputs,
        uint256 maxIter
    ) 
        external
        pure
        returns (uint256 sigma) 
    {
        require(
            inputs.tradePrice < inputs.strike, 
            "backsolveSigma: will not converge"
        );
        VolCalculationX64 memory inputsX64 = volInputToX64(inputs);

        // Very simple initial guess
        /// @notice Tried Brenner and Subrahmanyam (1988) but worked poorly for low tau
        int128 sigmaX64 = ONE_INT;

        // Build a struct for computing BS price
        PriceCalculationX64 memory dataX64 = PriceCalculationX64(
            inputsX64.spotX64,
            inputsX64.strikeX64,
            sigmaX64,
            inputsX64.tauX64,
            inputsX64.rateX64
        );

        // Iteratively solve for sigma
        for (uint256 i = 0; i < maxIter; i++) {
            // Compute black scholes price
            int128 priceX64;
            if (inputs.isCall) {
                priceX64 = getCallPriceX64(dataX64);
            } else {
                priceX64 = getPutPriceX64(dataX64);
            }

            // Calculate difference between BS price and market price 
            int128 diffX64 = priceX64.sub(inputsX64.priceX64);

            if (diffX64.abs() < OPT_TOL) {
                break;
            }

            // Calculate vega of call option
            int128 vegaX64 = getVegaX64(dataX64);

            // Newton Raphson to update estimate
            sigmaX64 = sigmaX64.sub(diffX64.div(vegaX64));

            // Update `dataX64`
            dataX64.sigmaX64 = sigmaX64;
        }

        // Return the best approximation
        require(sigmaX64 >= 0, "solveSigmaFromCallPrice: sigma is negative");
        sigma = sigmaX64.scaleFromX64(inputs.scaleFactor);
    }

    /************************************************
     * Computing Vega
     ***********************************************/

    /**
     * @notice Compute vega of an option (change in option price given 1% change in IV)
     * @return vega The greek vega
     */
    function getVega(PriceCalculationInput memory inputs) 
        external
        pure
        returns (uint256 vega) 
    {
        PriceCalculationX64 memory inputsX64 = priceInputToX64(inputs);
        int128 vegaX64 = getVegaX64(inputsX64);
        // vega is a delta in price so scale from price factor
        vega = vegaX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Internal function for vega of an option. Given put/call duality
     * the formula for vega in both is the same
     * @dev vega = S * sqrt{tau} * N'(d1)
     * @dev http://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf
     * @dev https://en.wikipedia.org/wiki/Greeks_(finance)#Vega
     */
    function getVegaX64(PriceCalculationX64 memory inputsX64)
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
}