/**
 * @notice Utility script to interpolate.
 * @dev Implementation of `Derivative.sol` in Typescript
 */

export function checkInterpolate(
  sortedKeys: number[],
  values: number[],
  queryKey: number
): number {
  const [indexLower, indexUpper] = checkClosestIndices(sortedKeys, queryKey);
  if (indexLower == indexUpper) {
    return values[indexLower];
  } else {
    let yDiff = values[indexUpper] - values[indexLower];
    let xDiff = sortedKeys[indexUpper] - sortedKeys[indexLower];
    let slope = (queryKey - sortedKeys[indexLower]) * yDiff / xDiff;
    return values[indexLower] + slope;
  }
}

export function checkClosestIndices(
  sortedKeys: number[],
  queryKey: number,
): [number, number] {
  const indexLower = findClosestLower(queryKey, sortedKeys);
  const indexUpper = findClosestUpper(queryKey, sortedKeys);
  return [indexLower, indexUpper];
}

function findClosestLower(num: number, sortedArr: number[]): number {
  var index = 0;
  for (var i = 0; i < sortedArr.length; i++) {
    if (num >= sortedArr[i]) {
      index = i;
    }
  }
  return index;
}

function findClosestUpper(num: number, sortedArr: number[]): number {
  var index = sortedArr.length - 1;
  for (var i = 0; i < sortedArr.length; i++) {
    if (num <= sortedArr[i]) {
      index = i;
      break;
    }
  }
  return index;
}