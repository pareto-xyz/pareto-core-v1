// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./GaussianMath.sol";
import "./ABDKMath64x64.sol";
import "./Units.sol";

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
    
    /// @notice Minimum vega when solving for sigma
    int128 internal constant MIN_VEGA = 0x28f5c28f5c28f5c;
    int128 internal constant SIGMA_GUESS = ONE_INT;

    /// @notice Bounds for bisection method
    int128 internal constant MIN_SIGMA = 0x4189374bc6a7f0;
    int128 internal constant MAX_SIGMA = 0xa0000000000000000;

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
     * @notice Struct that groups together inputs for computing IV
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
     * @notice Struct that groups together inputs for computing strike
     * @param delta Desired delta for the strike. Written as a percentage with 4 decimals
     * @param spot Spot price in stable asset
     * @param tau Time to expiry (in seconds), not in years
     * @param rate Risk-free rate
     * @param scaleFactor Unsigned 256-bit integer scaling factor
     */
    struct StrikeCalculationInput {
        uint256 delta;
        uint256 spot;
        uint256 sigma;
        uint256 tau;
        uint256 rate;
        uint256 scaleFactor;
    }

    /// @notice Convert `StrikeCalculationInput` to 64.64 types
    struct StrikeCalculationX64 {
        int128 deltaX64;
        int128 spotX64;
        int128 sigmaX64;
        int128 tauX64;
        int128 rateX64;
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

    /**
     * @notice Convert `StrikeCalculationInput` to `StrikeCalculationX64`
     * @param inputs StrikeCalculationInput object
     * @param outputs StrikeCalculationX64 object
     */
    function strikeInputToX64(StrikeCalculationInput memory inputs)
        internal
        pure
        returns (StrikeCalculationX64 memory outputs) 
    {
        outputs = StrikeCalculationX64(
            inputs.delta.percentageToX64(),
            inputs.spot.scaleToX64(inputs.scaleFactor),
            inputs.sigma.percentageToX64(),
            inputs.tau.toYears(),
            inputs.rate.scaleToX64(inputs.scaleFactor)
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
    function getSigmaByNewton(
        VolCalculationInput memory inputs,
        uint256 maxIter
    ) 
        external
        pure
        returns (uint256 sigma) 
    {
        require(
            inputs.tradePrice < inputs.strike, 
            "getSigmaByNewton: will not converge"
        );
        VolCalculationX64 memory inputsX64 = volInputToX64(inputs);

        // Very simple initial guess
        /// @notice Tried Brenner and Subrahmanyam (1988) but worked poorly for low tau
        int128 sigmaX64 = SIGMA_GUESS;

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

            // vega can be very small when spot is very far from strike
            // Bound it so we don't have numerical issues
            if (vegaX64 < MIN_VEGA) {
              vegaX64 = MIN_VEGA;
            }

            // Newton Raphson to update estimate
            sigmaX64 = sigmaX64.sub(diffX64.div(vegaX64));

            // Update `dataX64`
            dataX64.sigmaX64 = sigmaX64;
        }

        // Return the best approximation
        require(sigmaX64 >= 0, "getSigmaByNewton: sigma is negative");
        sigma = sigmaX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Solve for volatility from call price iteratively using Bisection method
     * @dev https://en.wikipedia.org/wiki/Bisection_method
     * @param inputs Black Scholes model parameters 
     * @param maxIter To be gas efficient, we should limit the computation
     * @return sigma Implied volatility estimate (annual)
     */
    function getSigmaByBisection(
        VolCalculationInput memory inputs,
        uint256 maxIter
    ) 
        external
        pure
        returns (uint256 sigma) 
    {
        require(
            inputs.tradePrice < inputs.strike, 
            "getSigmaByBisection: will not converge"
        );
        VolCalculationX64 memory inputsX64 = volInputToX64(inputs);

        // Initialize left and right bound
        int128 leftX64 = MIN_SIGMA;
        int128 rightX64 = MAX_SIGMA;
        int128 midX64 = leftX64.add(rightX64).div(TWO_INT);

        // Create data objects for left and mid
        PriceCalculationX64 memory dataLeftX64 = PriceCalculationX64(
            inputsX64.spotX64,
            inputsX64.strikeX64,
            leftX64,
            inputsX64.tauX64,
            inputsX64.rateX64
        );
        PriceCalculationX64 memory dataMidX64 = PriceCalculationX64(
            inputsX64.spotX64,
            inputsX64.strikeX64,
            midX64,
            inputsX64.tauX64,
            inputsX64.rateX64
        );

        for (uint256 i = 0; i < maxIter; i++) {
            // Get prices of options
            int128 diffMidX64;
            int128 diffLeftX64;
            // diff = option price - market price
            if (inputs.isCall) {
                diffLeftX64 = getCallPriceX64(dataLeftX64).sub(inputsX64.priceX64);
                diffMidX64 = getCallPriceX64(dataMidX64).sub(inputsX64.priceX64);
            } else {
                diffLeftX64 = getPutPriceX64(dataLeftX64).sub(inputsX64.priceX64);
                diffMidX64 = getPutPriceX64(dataMidX64).sub(inputsX64.priceX64);
            }

            if (diffMidX64.abs() < OPT_TOL) {
                break;
            }

            // Check if the signs are the same
            if ((diffMidX64 >= 0) == (diffLeftX64 >= 0)) {
                leftX64 = midX64;
            } else {
                rightX64 = midX64;
            }

            // mid = (left + right) / 2 
            midX64 = leftX64.add(rightX64).div(TWO_INT);

            // Update the data objects
            dataLeftX64.sigmaX64 = leftX64;
            dataMidX64.sigmaX64 = midX64;
        }

        // Return final mid point
        require(midX64 >= 0, "getSigmaByBisection: sigma is negative");
        sigma = midX64.scaleFromX64(inputs.scaleFactor);
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
    
    /************************************************
     * Solving for strike given delta
     ***********************************************/

    /**
     * @notice Compute strike price under Black-Scholes model given a chosen delta,
     * implied volatility, and spot price
     */
    function getStrikeFromDelta(StrikeCalculationInput memory inputs) 
        internal
        pure
        returns (uint256 strike)
    {
        StrikeCalculationX64 memory inputsX64 = strikeInputToX64(inputs);
        int128 strikeX64 = getStrikeFromDeltaX64(inputsX64);
        strike = strikeX64.scaleFromX64(inputs.scaleFactor);
    }

    /**
     * @notice Derivate strike from delta
     * @dev K = S exp { (r + tau * sigma^2) / 2 - sigma * sqrt(tau) * CDF^{-1}(Delta) }
     */
    function getStrikeFromDeltaX64(StrikeCalculationX64 memory inputsX64)
        internal
        pure
        returns (int128 strikeX64)
    {
        // CDF^{-1}(Delta)
        int128 scoreX64 = inputsX64.deltaX64.getInverseCDF();
        // sigma * sqrt(tau)
        int128 volX64 = inputsX64.sigmaX64.mul(inputsX64.tauX64.sqrt());
        // rate + tau * sigma^2
        int128 rtsigsqrX64 = inputsX64.rateX64.add(inputsX64.tauX64.mul(inputsX64.sigmaX64.pow(2)));
        // (rtsigsqrX64) / 2 - volX64 * scoreX64
        int128 logitX64 = (rtsigsqrX64.div(TWO_INT).sub(volX64.mul(scoreX64)));
        // spot * exp { logitX64 }
        strikeX64 = inputsX64.spotX64.mul(logitX64.exp());
    }
}