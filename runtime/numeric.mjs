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

// Decimal zero points from the pinned Unicode 16.0.0 database (CPython 3.14.7).
const decimalZeros = [48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472, 43504, 43600, 44016, 65296, 66720, 68912, 68928, 69734, 69872, 69942, 70096, 70384, 70736, 70864, 71248, 71360, 71376, 71386, 71472, 71904, 72016, 72688, 72784, 73040, 73120, 73552, 90416, 92768, 92864, 93008, 93552, 118000, 120782, 120792, 120802, 120812, 120822, 123200, 123632, 124144, 124401, 125264, 130032];
const numericSpaces = new Set([133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288]);
export function numericText(text, {charge}) {
  let result = "";
  for (const character of text) {
    charge(1); const point = character.codePointAt(0);
    if (point < 128) { result += character; continue; }
    const zero = decimalZeros.find(start => point >= start && point < start + 10);
    result += zero !== undefined ? String(point - zero) : numericSpaces.has(point) ? " " : character;
  }
  return result.replace(/^[\x09-\x0d ]+|[\x09-\x0d ]+$/g, "");
}

export function parseInteger(text, base, {charge, fail, digits}) {
  let input = numericText(text, {charge}).replace(/[A-Z]/g, character => character.toLowerCase()), negative = false;
  if (input[0] === "+" || input[0] === "-") { negative = input[0] === "-"; input = input.slice(1); }
  const automatic = base === 0, prefix = /^0([box])/.exec(input), prefixBase = prefix ? {b:2,o:8,x:16}[prefix[1]] : 0;
  if (base === 0) base = prefixBase || 10;
  const prefixed = prefixBase === base;
  if (prefixed) { input = input.slice(2); if (input[0] === "_") input = input.slice(1); }
  const invalid = () => fail("ValueError", "invalid literal for int()");
  if (!/^[0-9a-z](?:_?[0-9a-z])*$/.test(input)) invalid();
  const clean = input.replaceAll("_", "");
  const units = Array.from(clean, character => {
    charge(1); const code = character.charCodeAt(0), value = code <= 57 ? code - 48 : code - 87;
    if (value >= base) invalid(); return value;
  });
  if (automatic && !prefixed && clean[0] === "0" && units.some(value => value !== 0)) invalid();
  const significant = clean.replace(/^0+/, "").length;
  if (significant * Math.log10(base) > digits + 1) fail("ExecutionLimitError", "Integer conversion exceeds the digit budget.", "BUDGET");
  let result = 0n;
  for (const unit of units) { charge(result.toString().length + 1); result = result * BigInt(base) + BigInt(unit); }
  return negative ? -result : result;
}

export function parseReal(text, controls) {
  const input = numericText(text, controls), digit = "[0-9](?:_?[0-9])*";
  const finite = new RegExp("^[+-]?(?:"+digit+"(?:\\.(?:"+digit+")?)?|\\."+digit+")(?:[eE][+-]?"+digit+")?$");
  if (/^[+-]?(?:inf(?:inity)?|nan)$/i.test(input)) {
    return /nan/i.test(input) ? NaN : input[0] === "-" ? -Infinity : Infinity;
  }
  if (!finite.test(input)) controls.fail("ValueError", "could not convert string to float");
  controls.charge(input.length + 1); return Number(input.replaceAll("_", ""));
}
