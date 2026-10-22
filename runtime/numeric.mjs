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

export function powerReals(base, exponent, {fail}) {
  if (exponent === 0) return 1;
  if (Number.isNaN(base)) return NaN;
  if (Number.isNaN(exponent)) return base === 1 ? 1 : NaN;
  const absolute = Math.abs(base), odd = Number.isInteger(exponent) && Math.abs(exponent) % 2 === 1;
  if (!Number.isFinite(exponent)) return absolute === 1 ? 1 :
    (absolute > 1) === (exponent > 0) ? Infinity : 0;
  if (!Number.isFinite(base)) { const value = exponent > 0 ? Infinity : 0; return base < 0 && odd ? -value : value; }
  if (base === 0) {
    if (exponent < 0) fail("ZeroDivisionError", "zero cannot be raised to a negative power", "ZERO_DIVISION");
    return Object.is(base, -0) && odd ? -0 : 0;
  }
  if (base < 0 && !Number.isInteger(exponent)) fail("UnsupportedOperationError", "Non-real powers require the complex numeric stage.", "UNSUPPORTED");
  const value = Math.pow(absolute, exponent);
  if (!Number.isFinite(value)) fail("OverflowError", "numerical result out of range");
  return base < 0 && odd ? -value : value;
}

export function modularPower(base, exponent, modulus, {charge, fail}) {
  if (modulus === 0n) fail("ValueError", "pow() modulus cannot be zero");
  const positive = modulus < 0n ? -modulus : modulus;
  if (positive === 1n) return 0n;
  const reduce = value => { const remainder = value % positive; return remainder < 0n ? remainder + positive : remainder; };
  const cost = value => value.toString().replace(/^-/, "").length;
  const multiply = (left, right) => { charge(cost(left) * cost(right)); return reduce(left * right); };
  charge(cost(base) * cost(positive));
  let factor = reduce(base), remaining = exponent;
  if (remaining < 0n) {
    let previous = factor, current = positive, coefficient = 1n, next = 0n;
    while (current) {
      charge(cost(previous) * cost(current) + cost(coefficient) + cost(next));
      const quotient = previous / current;
      [previous, current] = [current, previous - quotient * current];
      [coefficient, next] = [next, coefficient - quotient * next];
    }
    if (previous !== 1n) fail("ValueError", "base is not invertible for the given modulus");
    factor = reduce(coefficient); remaining = -remaining;
  }
  let result = 1n;
  while (remaining) {
    charge(1);
    if (remaining & 1n) result = multiply(result, factor);
    remaining >>= 1n;
    if (remaining) factor = multiply(factor, factor);
  }
  return modulus < 0n && result !== 0n ? result - positive : result;
}

export function roundInteger(value, ndigits, {charge}) {
  if (ndigits === null || ndigits >= 0n || value === 0n) return value;
  const negative = value < 0n, absolute = negative ? -value : value, digits = absolute.toString().length;
  if (-ndigits > BigInt(digits)) return 0n;
  const count = Number(-ndigits); charge(digits * count + count * count);
  const scale = 10n ** BigInt(count), result = roundQuotient(absolute, scale) * scale;
  return negative ? -result : result;
}

export function floatRatio(value) {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n), fraction = bits & ((1n << 52n) - 1n);
  let numerator = exponent ? fraction + (1n << 52n) : fraction, denominator = 1n;
  const shift = exponent ? exponent - 1023 - 52 : -1074;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  return {numerator, denominator};
}

export function roundReal(value, ndigits, controls) {
  const {charge, fail} = controls, negative = value < 0 || Object.is(value, -0);
  if (ndigits === null) {
    if (Number.isNaN(value)) fail("ValueError", "cannot convert float NaN to integer");
    if (!Number.isFinite(value)) fail("OverflowError", "cannot convert float infinity to integer");
    const {numerator, denominator} = floatRatio(value); charge(denominator.toString(2).length + 53);
    const result = roundQuotient(numerator, denominator); return negative ? -result : result;
  }
  if (!Number.isFinite(value) || ndigits > 323n) return value;
  if (ndigits < -308n) return negative ? -0 : 0;
  const digits = Number(ndigits), scale = 10n ** BigInt(Math.abs(digits));
  charge(digits * digits + 1075);
  let {numerator, denominator} = floatRatio(value);
  if (digits >= 0) numerator *= scale; else denominator *= scale;
  const rounded = roundQuotient(numerator, denominator);
  const result = digits >= 0 ? divideIntegers(rounded, scale, controls) : divideIntegers(rounded * scale, 1n, controls);
  return negative ? -result : result;
}
