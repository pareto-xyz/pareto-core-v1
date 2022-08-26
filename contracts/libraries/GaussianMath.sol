// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./ABDKMath64x64.sol";

/**
 * @title Collection of math functions for Gaussian distributions
 */
library GaussianMath {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for uint256;

    // Constants for approximations
    int128 public constant ONE_INT = 0x10000000000000000;
    int128 public constant TWO_INT = 0x20000000000000000;
    int128 public constant HALF_INT = 0x8000000000000000;
    int128 public constant SQRT_TWO_INT = 0x16a09e667f3bcc908;
    int128 public constant SQRT_TWO_PI_INT = 0x281b263fec4e09d00;
    int128 public constant CONST_P = 0x53dd02a4f5ee2e46;
    int128 public constant CONST_A1 = 0x413c831bb169f874;
    int128 public constant CONST_A2 = -0x48d4c730f051a5fe;
    int128 public constant CONST_A3 = 0x16be1c55bae156b66;
    int128 public constant CONST_A4 = -0x17401c57014c38f14;
    int128 public constant CONST_A5 = 0x10fb844255a12d72e;

    /**
     * @dev 1/sqrt(2pi) * e^{-1/2*x^2}
     * @return result Normal Probability Distribution Function of `x`
     */
    function getPDF(int128 x) internal pure returns (int128 result) {
        int128 expTerm = (((x.mul(x)).neg()).mul(HALF_INT)).exp();
        int128 piTerm = ONE_INT.div(SQRT_TWO_PI_INT);
        return piTerm.mul(expTerm);
    }

    /**
     * @notice Uses Abramowitz and Stegun approximation:
     * https://en.wikipedia.org/wiki/Abramowitz_and_Stegun
     * @return result Normal Cumulative Distribution Function of `x`
     */
    function getCDF(int128 x) internal pure returns (int128 result) {
        // z=|x|/sqrt(2)
        int128 z = x.abs().div(SQRT_TWO_INT);
        // t=1/(1+p*z)
        int128 t = ONE_INT.div(ONE_INT.add(CONST_P.mul(z)));
        // Approximate erf(z)
        int128 erf = getErrorFunction(z, t);
        // Handle case that x<0. Notice that z=|x|=-x in this case
        if (x < 0) {
            // erf(x)=-erf(-x)
            erf = erf.neg();
        }
        // cdf(x)=0.5*(1+erf(z))
        result = (HALF_INT).mul(ONE_INT.add(erf));
    }

    /**
     * @notice Uses Abramowitz and Stegun approximation:
     * https://en.wikipedia.org/wiki/Error_function
     * @dev Maximum error: 1.5×10−7
     * @return result Approximation of the error function
     */
    function getErrorFunction(int128 z, int128 t) 
        internal
        pure
        returns (int128 result)
    {
        // t(a1+t(a2+t(a3+t(a4+t(a5))))) = t*a1+t^2*a2+t^3*a3+t^4*a4+t^5*a5
        int128 factor = t.mul(CONST_A1.add(t.mul(CONST_A2.add(
            t.mul(CONST_A3.add(t.mul(CONST_A4.add(t.mul(CONST_A5)))))))));
        // e^{-z^2}
        int128 expTerm = (z.mul(z).neg()).exp();
        // 1 - factor*expTerm
        result = ONE_INT.sub(factor.mul(expTerm));
    }
}