// Bounded integer helpers; arbitrary Python integers remain BigInts.
export function roundQuotient(numerator, denominator) {
  let quotient = numerator / denominator;
  const twice = 2n * (numerator % denominator);
  if (twice > denominator || twice === denominator && (quotient & 1n)) quotient++;
  return quotient;
}

export function divideIntegers(left, right, {charge, fail}) {
  if (right === 0n) fail("ZeroDivisionError", "division by zero", "ZERO_DIVISION");
  const negative = (left < 0n) !== (right < 0n);
  let numerator = left < 0n ? -left : left, denominator = right < 0n ? -right : right;
  if (numerator === 0n) return negative ? -0 : 0;
  const numeratorBits = numerator.toString(2).length, denominatorBits = denominator.toString(2).length;
  charge(numeratorBits + denominatorBits);
  let exponent = numeratorBits - denominatorBits;
  if (exponent >= 0 ? numerator < (denominator << BigInt(exponent)) :
      (numerator << BigInt(-exponent)) < denominator) exponent--;
  if (exponent > 1023) fail("OverflowError", "integer division result too large for a float");
  // Subnormals use a fixed 2**-1074 quantum; normal values keep 53 bits.
  const shift = 52 - Math.max(exponent, -1022);
  if (shift >= 0) numerator <<= BigInt(shift);
  else denominator <<= BigInt(-shift);
  let significand = roundQuotient(numerator, denominator);
  if (exponent >= -1022 && significand === (1n << 53n)) { significand >>= 1n; exponent++; }
  if (exponent > 1023) fail("OverflowError", "integer division result too large for a float");
  const result = Number(significand) * 2 ** (exponent >= -1022 ? exponent - 52 : -1074);
  return negative ? -result : result;
}

export function powerIntegers(base, exponent, controls) {
  const {charge, fail, digits} = controls;
  if (exponent === 0n) return 1n;
  if (exponent < 0n) {
    // Python routes negative integer powers through real coercion, including
    // its overflow boundary and the rounded exponent's parity.
    charge(base.toString().length + exponent.toString().length);
    const realBase = Number(base), realExponent = Number(exponent);
    if (!Number.isFinite(realBase) || !Number.isFinite(realExponent)) fail("OverflowError", "int too large to convert to float");
    if (realBase === 0) fail("ZeroDivisionError", "zero cannot be raised to a negative power", "ZERO_DIVISION");
    return Math.pow(realBase, realExponent);
  }
  if (base === 0n) {
    return 0n;
  }
  if (base === 1n || base === -1n) {
    const result = base === -1n && (exponent & 1n) ? -1n : 1n;
    return result;
  }
  const count = exponent;
  if (count > BigInt(Math.ceil(digits * Math.log2(10))))
    fail("ExecutionLimitError", "Integer power exceeds the digit budget.", "BUDGET");
  const size = value => value.toString().replace(/^-/, "").length;
  const multiply = (left, right) => {
    charge(size(left) * size(right));
    const value = left * right;
    if (size(value) > digits) fail("ExecutionLimitError", "Integer power exceeds the digit budget.", "BUDGET");
    return value;
  };
  let remaining = count, result = 1n, factor = base;
  while (remaining) {
    charge(1);
    if (remaining & 1n) result = multiply(result, factor);
    remaining >>= 1n;
    if (remaining) factor = multiply(factor, factor);
  }
  return result;
}
