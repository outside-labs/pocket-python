// Independent Python values. Native Number is used only inside explicit floats.
import {Cell, Environment, CodePool, ModuleValue, FunctionValue, CallArguments, BuiltinValue, AppendValue, ExceptionValue, ClassValue, InstanceValue, BoundMethodValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue, ProtocolIteratorValue, NotImplementedValue} from "./function-objects.mjs";
import {isPrintable} from "./string-printability.mjs";
import {divideIntegers, powerIntegers, powerReals, modularPower, roundInteger, roundReal, parseInteger, parseReal, parseComplex, complexArithmetic, complexPower} from "./numeric.mjs";
export const VALUE_LIMITS = Object.freeze({digits: 4096, text: 65536, items: 1024, depth: 32});

class FloatValue {
  constructor(bits) {
    const buffer = new ArrayBuffer(8), view = new DataView(buffer);
    view.setBigUint64(0, BigInt("0x" + bits));
    this.value = view.getFloat64(0); this.bits = bits; Object.freeze(this);
  }
}
class StringValue {
  constructor(points) { this.points = Object.freeze([...points]); Object.freeze(this); }
}
class ComplexValue {
  constructor(real, imag) { this.real = real; this.imag = imag; Object.freeze(this); }
}
class TupleValue {
  constructor(items) { this.items = Object.freeze([...items]); Object.freeze(this); }
}
class ListValue { constructor(items) { this.items = [...items]; } }
class SliceValue {
  constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; Object.freeze(this); }
}
class DictValue { constructor() { this.entries = []; this.version = 0; this.ownedKeys = false; } }
class RangeValue {
  constructor(start, stop, step, length) {
    this.start = start; this.stop = stop; this.step = step; this.length = length; Object.freeze(this);
  }
}
export class IteratorValue {
  constructor(value) {
    this.value = value; this.index = value instanceof RangeValue ? 0n : 0;
    if (value instanceof DictValue) { this.size = value.entries.length; this.version = value.version; }
  }
}

const numeric = value => typeof value === "bigint" || typeof value === "boolean" || value instanceof FloatValue;
const integer = value => typeof value === "boolean" ? BigInt(value) : value;
const sequence = value => value instanceof StringValue || value instanceof TupleValue || value instanceof ListValue;
const elements = value => value instanceof StringValue ? value.points : value.items;
const hashUnits = units => {
  let hash = 2166136261;
  for (const unit of units) hash = Math.imul(hash ^ unit, 16777619);
  return (hash >>> 0).toString(16);
};
const bitsOf = value => {
  if (Number.isNaN(value)) return "7ff8000000000000";
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
};

export class ValueRuntime {
  constructor({charge = () => {}, fail = null, memory = null, numeric = false} = {}) {
    if (typeof numeric !== "boolean") throw new TypeError("Invalid numeric profile.");
    this.numeric = numeric;
    this.memory = memory;
    this.charge = charge;
    this.fail = fail || ((name, message, code = "PYTHON") => {
      const error = new Error(message); error.name = name; error.code = code; throw error;
    });
    this.nanIds = new WeakMap(); this.nextNan = 1;
    this.identityIds = new WeakMap(); this.nextIdentity = 1n;
  }
  make(bytes, children, create) { return this.memory ? this.memory.allocate(bytes, children, create) : create(); }
  resize(value, bytes, children) { this.memory?.resize(value, bytes, children); }
  limit(condition, message) {
    if (!condition) this.fail("ExecutionLimitError", message, "BUDGET");
  }
  depth(depth) { this.limit(depth <= VALUE_LIMITS.depth, "Value nesting exceeds 32."); }
  int(value) {
    this.limit(value.toString().replace(/^-/, "").length <= VALUE_LIMITS.digits, "Integer digit budget exceeded.");
    return this.memory ? this.memory.primitive(value) : value;
  }
  float(value) { return this.make(64, [], () => new FloatValue(bitsOf(value))); }
  complex(real, imag) { return this.make(80, [], () => new ComplexValue(real, imag)); }
  isComplex(value) { return value instanceof ComplexValue; }
  isRange(value) { return value instanceof RangeValue; }
  range(args) {
    if (!args.length || args.length > 3 || args.some(value => !["bigint", "boolean"].includes(typeof value)))
      this.fail("TypeError", "range() requires one to three integer arguments");
    const parts = args.map(integer), start = parts.length === 1 ? 0n : parts[0],
      stop = parts.length === 1 ? parts[0] : parts[1], step = parts.length === 3 ? parts[2] : 1n;
    if (step === 0n) this.fail("ValueError", "range() arg 3 must not be zero");
    this.charge(parts.reduce((size, value) => size + value.toString().length, 1));
    const distance = step > 0n ? stop - start : start - stop, stride = step > 0n ? step : -step;
    this.charge(distance.toString().length * stride.toString().length);
    const length = this.int(distance <= 0n ? 0n : (distance - 1n) / stride + 1n);
    return this.make(112, [start, stop, step, length], () => new RangeValue(start, stop, step, length));
  }
  rangeAttribute(value, name) {
    this.charge(1);
    if (["start", "stop", "step"].includes(name)) return value[name];
    this.fail("UnsupportedOperationError", "This range attribute requires a later sequence stage.", "UNSUPPORTED");
  }
  complexAttribute(value, name) {
    if (["real", "imag"].includes(name)) return this.float(value[name]);
    this.fail("UnsupportedOperationError", "This complex attribute requires a later numeric stage.", "UNSUPPORTED");
  }
  complexConstructor(args) {
    if (!args.length) return this.complex(0, 0);
    const first = args[0];
    if (args.length === 1) {
      if (first instanceof ComplexValue) return first;
      if (first instanceof StringValue) return this.complex(...parseComplex(this.text(first), {charge:this.charge,fail:this.fail}));
      return this.complex(this.number(first), 0);
    }
    const second = args[1];
    if (first instanceof StringValue || second instanceof StringValue) this.fail("TypeError", "complex() with two arguments requires numbers");
    const real = first instanceof ComplexValue ? first.real : this.number(first);
    const imag = second instanceof ComplexValue ? second.real : this.number(second);
    return this.complex(second instanceof ComplexValue ? real - second.imag : real,
      first instanceof ComplexValue ? first.imag + imag : imag);
  }
  isPrimitive(value, name) {
    return name === "int" ? typeof value === "bigint" || typeof value === "boolean" :
      name === "bool" ? typeof value === "boolean" : name === "complex" ? value instanceof ComplexValue : name === "float" && value instanceof FloatValue;
  }
  realConstructor(name, args, explicitBase = false) {
    const value = args.length ? args[0] : 0n, controls = {charge:this.charge, fail:this.fail, digits:VALUE_LIMITS.digits};
    if (name === "int") {
      let base = 10n;
      if (explicitBase) {
        base = args[1];
        if (!["bigint", "boolean"].includes(typeof base)) this.fail("TypeError", "int() base must be an integer");
        base = integer(base);
        if (base !== 0n && (base < 2n || base > 36n)) this.fail("ValueError", "int() base must be 0 or 2-36");
        if (!(value instanceof StringValue)) this.fail("TypeError", "int() cannot convert a non-string with explicit base");
      }
      if (value instanceof StringValue) return this.int(parseInteger(this.text(value), Number(base), controls));
      if (value instanceof FloatValue) {
        if (Number.isNaN(value.value)) this.fail("ValueError", "cannot convert float NaN to integer");
        if (!Number.isFinite(value.value)) this.fail("OverflowError", "cannot convert float infinity to integer");
        this.charge(1075); return this.int(BigInt(Math.trunc(value.value)));
      }
      if (["bigint", "boolean"].includes(typeof value)) return this.int(integer(value));
    } else {
      if (value instanceof FloatValue) return value;
      if (value instanceof StringValue) return this.float(parseReal(this.text(value), controls));
      if (["bigint", "boolean"].includes(typeof value)) return this.float(this.number(value));
    }
    this.fail("TypeError", name + "() argument has an unsupported type");
  }
  string(points) {
    this.limit(points.length <= VALUE_LIMITS.text, "String length budget exceeded.");
    this.charge(points.length + 1); return this.make(64 + 4 * points.length, [], () => new StringValue(points));
  }
  text(value) {
    if (!(value instanceof StringValue)) return null;
    this.charge(value.points.length + 1);
    return value.points.map(point => String.fromCodePoint(point)).join("");
  }
  isString(value) { this.charge(1); return value instanceof StringValue; }
  repr(value) {
    if (value instanceof NotImplementedValue) return this.string(Array.from('NotImplemented', char => char.codePointAt(0)));
    if (value instanceof StringValue) {
      this.charge(2 * value.points.length + 1);
      const quote = value.points.includes(39) && !value.points.includes(34) ? 34 : 39, points = [];
      const append = (...items) => {
        this.limit(points.length + items.length <= VALUE_LIMITS.text, "String representation length budget exceeded.");
        this.charge(items.length); points.push(...items);
      };
      append(quote);
      for (const point of value.points) {
        if (point === quote || point === 92) append(92, point);
        else if ([9, 10, 13].includes(point)) append(92, {9: 116, 10: 110, 13: 114}[point]);
        else if (isPrintable(point, this.charge)) append(point);
        else {
          const width = point <= 255 ? 2 : point <= 65535 ? 4 : 8;
          const hex = point.toString(16).padStart(width, "0");
          append(92, width === 2 ? 120 : width === 4 ? 117 : 85, ...Array.from(hex, char => char.charCodeAt(0)));
        }
      }
      append(quote); return this.string(points);
    }
    const text = value === null ? "None" : typeof value === "boolean" ? value ? "True" : "False" :
      typeof value === "bigint" ? value.toString() : null;
    if (text === null) this.fail("UnsupportedOperationError", "Representation of this value is outside the adopted profile.", "UNSUPPORTED");
    return this.string(Array.from(text, char => char.codePointAt(0)));
  }
  isSlice(value) { return value instanceof SliceValue; }
  isSequence(value) { return sequence(value) || value instanceof RangeValue; }
  sliceKey(start, stop, step) { return this.make(88, [start, stop, step], () => new SliceValue(start, stop, step)); }
  sliceAttribute(value, name) {
    this.charge(1);
    if (["start", "stop", "step"].includes(name)) return value[name];
    this.fail("UnsupportedOperationError", "This slice attribute requires a later sequence stage.", "UNSUPPORTED");
  }
  isList(value) { this.charge(1); return value instanceof ListValue; }
  isSequenceType(value, name) {
    return name === "list" ? value instanceof ListValue : name === "tuple" ? value instanceof TupleValue :
      name === "range" && value instanceof RangeValue;
  }
  checkConstructionHint(value) {
    const range = value instanceof IteratorValue && value.value instanceof RangeValue ? value.value : value;
    if (!(range instanceof RangeValue)) return;
    const length = value instanceof IteratorValue ? value.exhausted ? 0n : range.length - value.index : range.length;
    if (length > 9223372036854775807n) this.fail("OverflowError", "Python int too large to convert to length hint");
  }
  isDict(value) { return value instanceof DictValue; }
  comparisonSequence(value) { return value instanceof ListValue || value instanceof TupleValue ? value.items : null; }
  sameSequenceKind(left, right) { return this.comparisonSequence(left) !== null && left.constructor === right?.constructor; }
  hasUserEquality(value) {
    const pending = [value], seen = new Set();
    while (pending.length) {
      const item = pending.pop();
      if (item instanceof InstanceValue) return true;
      if (item instanceof DictValue && item.ownedKeys) return true;
      if (!(item instanceof ListValue || item instanceof TupleValue || item instanceof DictValue) || seen.has(item)) continue;
      seen.add(item); this.charge(1);
      pending.push(...(item instanceof DictValue ? item.entries.flatMap(entry => [entry.key, entry.value]) : item.items));
    }
    return false;
  }
  inplace(operation, left, right) {
    this.charge(1);
    if (!(left instanceof ListValue)) return this.binary(operation, left, right);
    if (operation === "add") {
      let items;
      if (right instanceof ListValue || right instanceof TupleValue) items = right.items.slice();
      else if (right instanceof DictValue) items = right.entries.map(entry => entry.key);
      else if (right instanceof StringValue) {
        this.limit(left.items.length + right.points.length <= VALUE_LIMITS.items, "Container length budget exceeded.");
        for (const point of right.points) this.binary("append", left, this.string([point]));
        return left;
      } else if (right instanceof IteratorValue || right instanceof ProtocolIteratorValue) this.fail("UnsupportedOperationError", "List += with an iterator is outside the source profile.", "UNSUPPORTED");
      else { this.iterator(right); this.fail("UnsupportedOperationError", "This iterable extension is outside the source profile.", "UNSUPPORTED"); }
      this.limit(left.items.length + items.length <= VALUE_LIMITS.items, "Container length budget exceeded.");
      for (const item of items) this.binary("append", left, item);
      return left;
    }
    if (operation === "multiply") {
      if (!["bigint", "boolean"].includes(typeof right)) return this.binary(operation, left, right);
      const count = integer(right); this.charge(count.toString().length);
      this.limit(count >= -BigInt(VALUE_LIMITS.items) && count <= BigInt(VALUE_LIMITS.items), "In-place repeat factor budget exceeded.");
      const size = count < 0n ? 0 : left.items.length * Number(count);
      this.limit(size <= VALUE_LIMITS.items, "Container length budget exceeded.");
      this.charge(size + 1);
      const original = left.items, items = Array.from({length: size}, (_, index) => original[index % original.length]);
      this.resize(left, 64 + 8 * items.length, items); left.items = items; return left;
    }
    return this.binary(operation, left, right);
  }
  list(items) { this.limit(items.length <= VALUE_LIMITS.items, "Container length budget exceeded."); this.charge(items.length + 1); return this.make(64 + 8 * items.length, items, () => new ListValue(items)); }
  tuple(items) { this.limit(items.length <= VALUE_LIMITS.items, "Container length budget exceeded."); this.charge(items.length + 1); return this.make(64 + 8 * items.length, items, () => new TupleValue(items)); }
  dict(pairs) {
    const result = this.make(96, [], () => new DictValue()); this.charge(1);
    for (const [key, value] of pairs) this.set(result, key, value);
    return result;
  }
  decode(record, {immutable = false, depth = 0} = {}) {
    this.depth(depth); this.charge(1);
    if (!record || typeof record !== "object" || Array.isArray(record)) this.fail("TypeError", "Expected a tagged Python value.");
    const fields = {none: ["type"], bool: ["type", "value"], int: ["type", "value"],
      float: ["type", "bits"], complex: ["type", "real_bits", "imag_bits"], str: ["type", "codepoints"], tuple: ["type", "items"], list: ["type", "items"], dict: ["type", "entries"]};
    const keys = typeof record.type === "string" && Object.hasOwn(fields, record.type) ? fields[record.type] : null;
    if (!keys || Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) this.fail("TypeError", "Invalid tagged value fields.");
    if (record.type === "none") return null;
    if (record.type === "bool" && typeof record.value === "boolean") return record.value;
    if (record.type === "int" && typeof record.value === "string" &&
        record.value.length <= VALUE_LIMITS.digits + 1 && /^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(record.value)) {
      this.charge(record.value.length); return this.int(BigInt(record.value));
    }
    if (record.type === "float" && typeof record.bits === "string" && /^[0-9a-f]{16}$/.test(record.bits)) return this.make(64, [], () => new FloatValue(record.bits));
    if (record.type === "complex" && this.numeric && [record.real_bits, record.imag_bits].every(bits => typeof bits === "string" && /^[0-9a-f]{16}$/.test(bits))) {
      const number = bits => { const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0,BigInt('0x'+bits)); return view.getFloat64(0); };
      return this.complex(number(record.real_bits), number(record.imag_bits));
    }
    if (record.type === "str" && Array.isArray(record.codepoints) && record.codepoints.length <= VALUE_LIMITS.text &&
        Array.from(record.codepoints).every(point => Number.isInteger(point) && point >= 0 && point <= 0x10ffff)) return this.string(record.codepoints);
    if (["tuple", "list"].includes(record.type) && Array.isArray(record.items) && record.items.length <= VALUE_LIMITS.items) {
      if (immutable && record.type === "list") this.fail("TypeError", "Mutable constants require construction instructions.");
      const items = Array.from(record.items, item => this.decode(item, {immutable, depth: depth + 1}));
      return record.type === "tuple" ? this.tuple(items) : this.list(items);
    }
    if (record.type === "dict" && Array.isArray(record.entries) && record.entries.length <= VALUE_LIMITS.items) {
      if (immutable) this.fail("TypeError", "Mutable constants require construction instructions.");
      return this.dict(Array.from(record.entries, pair => {
        if (!Array.isArray(pair) || pair.length !== 2) this.fail("TypeError", "Dictionary entries require key/value pairs.");
        return pair.map(item => this.decode(item, {immutable, depth: depth + 1}));
      }));
    }
    this.fail("TypeError", "Invalid or unimplemented tagged value.");
  }
  encode(value, depth = 0, active = new Set()) {
    this.depth(depth); this.charge(1);
    if (value === null) return {type: "none"};
    if (typeof value === "boolean") return {type: "bool", value};
    if (typeof value === "bigint") { const text = value.toString(); this.charge(text.length); return {type: "int", value: text}; }
    if (value instanceof FloatValue) return {type: "float", bits: value.bits};
    if (value instanceof ComplexValue) return {type: "complex", real_bits: bitsOf(value.real), imag_bits: bitsOf(value.imag)};
    if (value instanceof StringValue) { this.charge(value.points.length); return {type: "str", codepoints: [...value.points]}; }
    if (active.has(value)) this.fail("ValueError", "Cyclic values require a handle transport.");
    active.add(value);
    try {
      if (value instanceof TupleValue || value instanceof ListValue) return {
        type: value instanceof TupleValue ? "tuple" : "list",
        items: value.items.map(item => this.encode(item, depth + 1, active))};
      if (value instanceof DictValue) return {type: "dict", entries: value.entries.map(entry => [
        this.encode(entry.key, depth + 1, active), this.encode(entry.value, depth + 1, active)])};
      this.fail("TypeError", "Value has no adopted by-value encoding.");
    } finally { active.delete(value); }
  }
  number(value) {
    if (!numeric(value)) this.fail("TypeError", "Float conversion requires an adopted number.");
    const result = value instanceof FloatValue ? value.value : Number(integer(value));
    if (!(value instanceof FloatValue) && !Number.isFinite(result)) this.fail("OverflowError", "int too large to convert to float");
    return result;
  }
  truth(value) {
    this.charge(1);
    if (value instanceof NotImplementedValue) this.fail("TypeError", "NotImplemented should not be used in a boolean context");
    if (value === null) return false;
    if (value instanceof RangeValue) return value.length !== 0n;
    if (value instanceof ComplexValue) return value.real !== 0 || value.imag !== 0;
    if (numeric(value)) return value instanceof FloatValue ? value.value !== 0 : integer(value) !== 0n;
    if (sequence(value)) return elements(value).length !== 0;
    if (value instanceof DictValue) return value.entries.length !== 0;
    if (value instanceof IteratorValue || value instanceof ProtocolIteratorValue || value instanceof SliceValue) return true;
    if (value instanceof FunctionValue || value instanceof BuiltinValue || value instanceof ExceptionValue || value instanceof ModuleValue ||
        value instanceof ClassValue || value instanceof InstanceValue || value instanceof BoundMethodValue || value instanceof PropertyValue || value instanceof MethodWrapperValue || value instanceof PropertyAccessorValue) return true;
    this.fail("TypeError", "Truthiness is outside the adopted values.");
  }
  equal(left, right, depth = 0) {
    this.depth(depth); this.charge(1);
    if (left instanceof RangeValue || right instanceof RangeValue) return left instanceof RangeValue && right instanceof RangeValue &&
      left.length === right.length && (left.length === 0n || left.start === right.start && (left.length === 1n || left.step === right.step));
    if (left instanceof ComplexValue || right instanceof ComplexValue) {
      if (left instanceof ComplexValue && right instanceof ComplexValue) return left.real === right.real && left.imag === right.imag;
      const value = left instanceof ComplexValue ? left : right, other = left instanceof ComplexValue ? right : left;
      if (value.imag !== 0 || !numeric(other)) return false;
      if (other instanceof FloatValue) return value.real === other.value;
      return Number.isFinite(value.real) && Number.isInteger(value.real) && BigInt(value.real) === integer(other);
    }
    if (left instanceof SliceValue || right instanceof SliceValue)
      this.fail("UnsupportedOperationError", "Slice comparisons require the later equality/sequence profile.", "UNSUPPORTED");
    if (numeric(left) && numeric(right)) {
      this.charge(Math.max(left instanceof FloatValue ? 16 : integer(left).toString().length,
                           right instanceof FloatValue ? 16 : integer(right).toString().length));
      if (left instanceof FloatValue && right instanceof FloatValue) return left.value === right.value;
      if (!(left instanceof FloatValue) && !(right instanceof FloatValue)) return integer(left) === integer(right);
      const floating = left instanceof FloatValue ? left.value : right.value;
      const integral = integer(left instanceof FloatValue ? right : left);
      return Number.isFinite(floating) && Number.isInteger(floating) && BigInt(floating) === integral;
    }
    if (left === right) return true;
    if (left instanceof BoundMethodValue && right instanceof BoundMethodValue)
      return left.callable === right.callable && left.receiver === right.receiver;
    if (left instanceof StringValue && right instanceof StringValue) {
      this.charge(Math.max(left.points.length, right.points.length));
      return left.points.length === right.points.length && left.points.every((point, i) => point === right.points[i]);
    }
    if ((left instanceof TupleValue && right instanceof TupleValue) || (left instanceof ListValue && right instanceof ListValue)) {
      this.charge(Math.min(left.items.length, right.items.length));
      return left.items.length === right.items.length && left.items.every((item, i) =>
        item === right.items[i] || this.equal(item, right.items[i], depth + 1));
    }
    if (left instanceof DictValue && right instanceof DictValue) {
      return left.entries.length === right.entries.length && left.entries.every(entry => {
        const found = this.find(right, entry.key);
        return found >= 0 && (entry.value === right.entries[found].value || this.equal(entry.value, right.entries[found].value, depth + 1));
      });
    }
    return false;
  }
  less(left, right, depth = 0) {
    this.depth(depth); this.charge(1);
    if (left instanceof SliceValue || right instanceof SliceValue)
      this.fail("UnsupportedOperationError", "Slice comparisons require the later equality/sequence profile.", "UNSUPPORTED");
    if (numeric(left) && numeric(right)) {
      this.charge(Math.max(left instanceof FloatValue ? 16 : integer(left).toString().length,
                           right instanceof FloatValue ? 16 : integer(right).toString().length));
      return (left instanceof FloatValue ? left.value : integer(left)) < (right instanceof FloatValue ? right.value : integer(right));
    }
    if ((left instanceof StringValue && right instanceof StringValue) ||
        (left instanceof TupleValue && right instanceof TupleValue) || (left instanceof ListValue && right instanceof ListValue)) {
      const a = elements(left), b = elements(right);
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        this.charge(1);
        if (left instanceof StringValue) { this.charge(1); if (a[i] !== b[i]) return a[i] < b[i]; }
        else if (!(a[i] === b[i] || this.equal(a[i], b[i], depth + 1))) return this.less(a[i], b[i], depth + 1);
      }
      return a.length < b.length;
    }
    this.fail("TypeError", "Ordering requires matching adopted sequences or numeric values.");
  }
  hash(value, depth = 0) {
    this.depth(depth); this.charge(1);
    if (value instanceof ClassValue || value instanceof InstanceValue || value instanceof BoundMethodValue || value instanceof PropertyValue || value instanceof MethodWrapperValue || value instanceof PropertyAccessorValue)
      this.fail("UnsupportedOperationError", "Object dictionary keys require the later identity-hash profile.", "UNSUPPORTED");
    if (value === null) return "none";
    if (value instanceof ComplexValue) {
      if (Number.isNaN(value.real) || Number.isNaN(value.imag)) {
        if (!this.nanIds.has(value)) this.nanIds.set(value, this.nextNan++);
        return 'nan:' + this.nanIds.get(value);
      }
      const part = number => Number.isFinite(number) && Number.isInteger(number) ? 'n:' + BigInt(number) % 2305843009213693951n : 'f:' + bitsOf(number);
      return value.imag === 0 ? part(value.real) : 'c:' + part(value.real) + ':' + part(value.imag);
    }
    if (typeof value === "bigint" || typeof value === "boolean") {
      const integral = integer(value); this.charge(integral.toString().length);
      return "n:" + integral % 2305843009213693951n;
    }
    if (value instanceof FloatValue) {
      if (Number.isNaN(value.value)) {
        if (!this.nanIds.has(value)) this.nanIds.set(value, this.nextNan++);
        return "nan:" + this.nanIds.get(value);
      }
      return Number.isFinite(value.value) && Number.isInteger(value.value) ? "n:" + BigInt(value.value) % 2305843009213693951n : "f:" + value.bits;
    }
    if (value instanceof StringValue) { this.charge(value.points.length); return "s:" + hashUnits(value.points); }
    if (value instanceof TupleValue) {
      const text = value.items.map(item => {
      const hash = this.hash(item, depth + 1); this.charge(hash.length); return hash.length + ":" + hash;
      }).join("");
      return "t:" + hashUnits(Array.from(text, character => character.charCodeAt(0)));
    }
    if (value instanceof ListValue || value instanceof DictValue) {
      const type = value instanceof ListValue ? "list" : "dict";
      this.fail("TypeError", "cannot use '" + type + "' as a dict key (unhashable type: '" + type + "')");
    }
    this.fail("UnsupportedOperationError", "Hashing this value is deferred.", "UNSUPPORTED");
  }
  identityHash(value) {
    this.charge(1);
    if (this.memory) return this.int(this.memory.identityHash(value));
    if (!this.identityIds.has(value)) this.identityIds.set(value, this.nextIdentity++);
    return this.int(this.identityIds.get(value));
  }
  hashResult(value) {
    if (typeof value !== "bigint" && typeof value !== "boolean") this.fail("TypeError", "__hash__ must return an integer");
    value = integer(value);
    if (value < -9223372036854775808n || value > 9223372036854775807n) value %= 2305843009213693951n;
    return this.int(value === -1n ? -2n : value);
  }
  pythonHash(value, depth = 0) {
    this.depth(depth); this.charge(1);
    if (value instanceof RangeValue) this.fail("UnsupportedOperationError", "Range hashing requires a later sequence stage.", "UNSUPPORTED");
    const modulus = 2305843009213693951n;
    if (value instanceof ComplexValue) {
      const part = number => {
        if (Number.isNaN(number)) return this.identityHash(value);
        if (!Number.isFinite(number)) return number < 0 ? -314159n : 314159n;
        const bits = BigInt('0x'+bitsOf(number)), exponent = Number((bits>>52n)&2047n);
        const mantissa = (bits&((1n<<52n)-1n)) | (exponent ? 1n<<52n : 0n), power = exponent ? exponent-1075 : -1074;
        let hash = (mantissa%modulus)*(1n<<BigInt((power%61+61)%61))%modulus;
        if (bits>>63n) hash = -hash;
        return hash === -1n ? -2n : hash;
      };
      return this.hashResult(BigInt.asIntN(64,part(value.real)+1000003n*part(value.imag)));
    }
    if (typeof value === "bigint" || typeof value === "boolean") {
      const number = integer(value); this.charge(number.toString().length);
      return this.hashResult(number % modulus);
    }
    if (value instanceof FloatValue) {
      if (Number.isNaN(value.value)) return this.identityHash(value);
      if (!Number.isFinite(value.value)) return this.int(value.value < 0 ? -314159n : 314159n);
      const bits = BigInt('0x' + value.bits), exponent = Number((bits >> 52n) & 2047n);
      const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
      const power = exponent ? exponent - 1075 : -1074;
      const shift = BigInt((power % 61 + 61) % 61);
      let hash = (mantissa % modulus) * (1n << shift) % modulus;
      if (bits >> 63n) hash = -hash;
      return this.hashResult(hash);
    }
    if (value === null) return this.hashResult(BigInt.asIntN(64, 0x9e3779b97f4a7c15n));
    if (value instanceof StringValue || value instanceof TupleValue) {
      let hash = 14695981039346656037n;
      const parts = value instanceof StringValue ? value.points : value.items;
      for (const part of parts) {
        this.charge(1);
        const item = value instanceof StringValue ? BigInt(part) : this.pythonHash(part, depth + 1);
        hash = BigInt.asUintN(64, (hash ^ BigInt.asUintN(64, item)) * 1099511628211n);
      }
      return this.hashResult(BigInt.asIntN(64, hash ^ BigInt(parts.length)));
    }
    if (value instanceof ListValue || value instanceof DictValue) this.fail("TypeError", "unhashable mutable value");
    if (value instanceof SliceValue || value instanceof InstanceValue || value instanceof BoundMethodValue ||
        value instanceof AppendValue || value instanceof PropertyAccessorValue)
      this.fail("UnsupportedOperationError", "This hash value family requires its separate protocol stage.", "UNSUPPORTED");
    return this.identityHash(value);
  }
  needsOwnedHash(value) {
    const pending = [value], seen = new Set();
    while (pending.length) {
      const item = pending.pop();
      if (item instanceof InstanceValue || item instanceof ClassValue || item instanceof FunctionValue || item instanceof BuiltinValue ||
          item instanceof BoundMethodValue || item instanceof PropertyValue || item instanceof MethodWrapperValue ||
          item instanceof NotImplementedValue || item instanceof ModuleValue || item instanceof ProtocolIteratorValue || item instanceof IteratorValue ||
          item instanceof ExceptionValue || item instanceof FloatValue && Number.isNaN(item.value) ||
          item instanceof ComplexValue && (Number.isNaN(item.real) || Number.isNaN(item.imag))) return true;
      if (item instanceof TupleValue && !seen.has(item)) { seen.add(item); this.charge(1); pending.push(...item.items); }
    }
    return false;
  }
  dictionaryNeedsProtocol(dict, key) { return dict instanceof DictValue && (dict.ownedKeys || this.needsOwnedHash(key)); }
  dictionaryEntryHash(entry) { return entry.hash.startsWith('p:') ? this.int(BigInt(entry.hash.slice(2))) : this.pythonHash(entry.key); }
  commitDictionary(dict, key, item, hash, position, remove = false) {
    this.charge(1);
    if (remove) {
      const entries = dict.entries.filter((_, index) => index !== position);
      const bytes = 96 + entries.reduce((sum, entry) => sum + 48 + 2 * entry.hash.length, 0);
      this.resize(dict, bytes, entries.flatMap(entry => [entry.key, entry.value]));
      dict.entries = entries; dict.version++; return null;
    }
    if (position >= 0) {
      this.resize(dict, valueLayout(dict).bytes, dict.entries.flatMap((entry, index) => [entry.key, index === position ? item : entry.value]));
      dict.entries[position].value = item;
    } else {
      this.limit(dict.entries.length < VALUE_LIMITS.items, "Container length budget exceeded.");
      const bucket = 'p:' + hash;
      this.resize(dict, valueLayout(dict).bytes + 48 + 2 * bucket.length,
        [...dict.entries.flatMap(entry => [entry.key, entry.value]), key, item]);
      dict.entries.push({hash: bucket, key, value: item}); dict.version++;
    }
    dict.ownedKeys = true; return null;
  }
  find(dict, key) {
    const hash = this.hash(key);
    for (let i = 0; i < dict.entries.length; i++) {
      this.charge(1); const entry = dict.entries[i];
      if (hash === entry.hash && (entry.key === key || this.equal(entry.key, key))) return i;
    }
    return -1;
  }
  index(value, index) {
    if (value instanceof DictValue) {
      const found = this.find(value, index);
      if (found < 0) this.fail("KeyError", "Dictionary key not found.");
      return value.entries[found].value;
    }
    if (!sequence(value) && !(value instanceof RangeValue)) this.fail("TypeError", "Value is not subscriptable in this stage.");
    index = integer(index);
    if (typeof index !== "bigint") this.fail("TypeError", "Sequence indices must be integers.");
    const items = value instanceof RangeValue ? null : elements(value), size = value instanceof RangeValue ? value.length : BigInt(items.length);
    if (index < 0n) index += size;
    if (index < 0n || index >= size) this.fail("IndexError", (value instanceof StringValue ? "string" : value instanceof ListValue ? "list" : "tuple") + " index out of range");
    this.charge(1);
    if (value instanceof RangeValue) {
      this.charge(value.start.toString().length + value.step.toString().length * index.toString().length);
      return this.int(value.start + value.step * index);
    }
    return value instanceof StringValue ? this.string([items[Number(index)]]) : items[Number(index)];
  }
  set(value, key, item) {
    if (value instanceof DictValue) {
      const hash = this.hash(key), found = this.find(value, key);
      if (found >= 0) {
        const children = value.entries.flatMap((entry, index) => [entry.key, index === found ? item : entry.value]);
        this.resize(value, valueLayout(value).bytes, children);
        value.entries[found].value = item;
      }
      else {
        this.limit(value.entries.length < VALUE_LIMITS.items, "Container length budget exceeded.");
        this.charge(1);
        this.resize(value, valueLayout(value).bytes + 48 + 2 * hash.length,
          [...value.entries.flatMap(entry => [entry.key, entry.value]), key, item]);
        value.entries.push({hash, key, value: item}); value.version++;
      }
      return null;
    }
    if (!(value instanceof ListValue)) this.fail("TypeError", "Item assignment requires a list or dict.");
    key = integer(key);
    if (typeof key !== "bigint") this.fail("TypeError", "List indices must be integers.");
    if (key < 0n) key += BigInt(value.items.length);
    if (key < 0n || key >= BigInt(value.items.length)) this.fail("IndexError", "list assignment index out of range");
    this.charge(1);
    this.resize(value, 64 + 8 * value.items.length, value.items.map((original, index) => index === Number(key) ? item : original));
    value.items[Number(key)] = item; return null;
  }
  append(value, item) {
    if (!(value instanceof ListValue)) this.fail("TypeError", "append requires a list.");
    this.limit(value.items.length < VALUE_LIMITS.items, "Container length budget exceeded.");
    this.charge(1);
    this.resize(value, 64 + 8 * (value.items.length + 1), [...value.items, item]);
    value.items.push(item); return null;
  }
  remove(value, key) {
    if (value instanceof ListValue) {
      key = integer(key);
      if (typeof key !== "bigint") this.fail("TypeError", "List indices must be integers.");
      if (key < 0n) key += BigInt(value.items.length);
      if (key < 0n || key >= BigInt(value.items.length)) this.fail("IndexError", "list assignment index out of range");
      this.charge(value.items.length);
      const items = value.items.filter((_, index) => index !== Number(key));
      this.resize(value, 64 + 8 * items.length, items); value.items = items; return null;
    }
    if (!(value instanceof DictValue)) this.fail("TypeError", "Dictionary deletion requires a dict.");
    const found = this.find(value, key);
    if (found < 0) this.fail("KeyError", "Dictionary key not found.");
    this.charge(value.entries.length); value.entries.splice(found, 1); value.version++; return null;
  }
  mutateSlice(value, start, stop, step, item, remove = false) {
    if (!(value instanceof ListValue)) this.fail("TypeError", "Slice mutation requires a list.");
    step = step === null ? 1n : integer(step);
    if (typeof step !== "bigint") this.fail("TypeError", "slice indices must be integers or None");
    if (step === 0n) this.fail("ValueError", "slice step cannot be zero");
    const length = BigInt(value.items.length), positive = step > 0n;
    const low = positive ? 0n : -1n, high = positive ? length : length - 1n;
    const normalize = (index, fallback) => {
      if (index === null) return fallback;
      index = integer(index);
      if (typeof index !== "bigint") this.fail("TypeError", "slice indices must be integers or None");
      if (index < 0n) index += length;
      return index < low ? low : index > high ? high : index;
    };
    start = normalize(start, positive ? 0n : length - 1n); stop = normalize(stop, positive ? length : -1n);
    const positions = [];
    for (let index = start; positive ? index < stop : index > stop; index += step) { this.charge(1); positions.push(Number(index)); }
    let replacement = [];
    if (!remove) {
      if (item instanceof ListValue || item instanceof TupleValue) { this.charge(item.items.length); replacement = item.items.slice(); }
      else if (sequence(item) || item instanceof DictValue || item instanceof IteratorValue || item instanceof InstanceValue)
        this.fail("UnsupportedOperationError", "This slice-assignment iterable requires a later iteration stage.", "UNSUPPORTED");
      else this.fail("TypeError", "can only assign an iterable");
      if (step !== 1n && replacement.length !== positions.length) this.fail("ValueError", "Extended slice assignment requires equal sizes.");
    }
    let items;
    if (!remove && step === 1n) items = [...value.items.slice(0, Number(start)), ...replacement, ...value.items.slice(Number(stop < start ? start : stop))];
    else {
      const selected = new Set(positions);
      items = remove ? value.items.filter((_, index) => !selected.has(index)) : value.items.slice();
      if (!remove) positions.forEach((index, offset) => { items[index] = replacement[offset]; });
    }
    this.limit(items.length <= VALUE_LIMITS.items, "Container length budget exceeded."); this.charge(value.items.length + items.length);
    this.resize(value, 64 + 8 * items.length, items); value.items = items; return null;
  }
  slice(value, start, stop, step) {
    if (!sequence(value) && !(value instanceof RangeValue)) this.fail("TypeError", "Slicing requires an adopted sequence.");
    const items = value instanceof RangeValue ? null : elements(value), length = value instanceof RangeValue ? value.length : BigInt(items.length);
    step = step === null ? 1n : integer(step);
    if (typeof step !== "bigint") this.fail("TypeError", "slice indices must be integers or None");
    if (step === 0n) this.fail("ValueError", "slice step cannot be zero");
    const positive = step > 0n, low = positive ? 0n : -1n, high = positive ? length : length - 1n;
    const normalize = (index, fallback) => {
      if (index === null) return fallback;
      index = integer(index);
      if (typeof index !== "bigint") this.fail("TypeError", "slice indices must be integers or None");
      if (index < 0n) index += length;
      return index < low ? low : index > high ? high : index;
    };
    start = normalize(start, positive ? 0n : length - 1n); stop = normalize(stop, positive ? length : -1n);
    if (value instanceof RangeValue) {
      this.charge((value.step.toString().length + 1) * (start.toString().length + stop.toString().length + step.toString().length));
      return this.range([this.int(value.start + value.step * start), this.int(value.start + value.step * stop), this.int(value.step * step)]);
    }
    const result = [];
    for (let index = start; positive ? index < stop : index > stop; index += step) { this.charge(1); result.push(items[Number(index)]); }
    return value instanceof StringValue ? this.string(result) : value instanceof TupleValue ? this.tuple(result) : this.list(result);
  }
  iterator(value) {
    if (value instanceof IteratorValue) return value;
    if (value instanceof RangeValue) { this.charge(1); return this.make(80, [value, 0n], () => new IteratorValue(value)); }
    if (!sequence(value) && !(value instanceof DictValue)) this.fail("TypeError", "Value is not iterable in this stage.");
    this.charge(1); return this.make(64, [value], () => new IteratorValue(value));
  }
  isIterator(value) { this.charge(1); return value instanceof IteratorValue || value instanceof ProtocolIteratorValue; }
  next(iterator) {
    if (!(iterator instanceof IteratorValue)) this.fail("TypeError", "next requires an iterator.");
    const value = iterator.value; this.charge(1);
    if (iterator.exhausted) this.fail("StopIteration", "");
    if (value instanceof RangeValue) {
      if (iterator.index >= value.length) { iterator.exhausted = true; this.fail("StopIteration", ""); }
      this.charge(value.start.toString().length + value.step.toString().length * iterator.index.toString().length);
      const item = value.start + value.step * iterator.index, index = this.int(iterator.index + 1n);
      this.resize(iterator, 80, [value, index]); iterator.index = index;
      return this.int(item);
    }
    if (value instanceof DictValue) {
      if (iterator.invalidated || iterator.size !== value.entries.length) {
        iterator.invalidated = true; this.fail("RuntimeError", "dictionary changed size during iteration");
      }
      if (iterator.version !== value.version) this.fail("UnsupportedOperationError", "Equal-size dictionary key mutation during iteration is deferred.", "UNSUPPORTED");
      if (iterator.index >= value.entries.length) { iterator.exhausted = true; this.fail("StopIteration", ""); }
      return value.entries[iterator.index++].key;
    }
    const items = elements(value);
    if (iterator.index >= items.length) { iterator.exhausted = true; this.fail("StopIteration", ""); }
    const item = items[iterator.index++];
    return value instanceof StringValue ? this.string([item]) : item;
  }
  contains(key, value) {
    if (value instanceof RangeValue) {
      if (key instanceof ComplexValue) { if (key.imag !== 0) return false; key = key.real; }
      else if (key instanceof FloatValue) key = key.value;
      if (typeof key === "number") { if (!Number.isFinite(key) || !Number.isInteger(key)) return false; key = BigInt(key); }
      key = integer(key);
      if (typeof key !== "bigint" || value.length === 0n) return false;
      this.charge(key.toString().length + value.start.toString().length + value.step.toString().length);
      const offset = key - value.start;
      return offset % value.step === 0n && offset / value.step >= 0n && offset / value.step < value.length;
    }
    if (value instanceof DictValue) return this.find(value, key) >= 0;
    if (value instanceof TupleValue || value instanceof ListValue) return value.items.some(item => {
      this.charge(1); return item === key || this.equal(item, key);
    });
    if (value instanceof StringValue) {
      if (!(key instanceof StringValue)) this.fail("TypeError", "String membership requires a str left operand.");
      const a = value.points, b = key.points; this.charge((a.length + 1) * (b.length + 1));
      for (let i = 0; i <= a.length - b.length; i++) if (b.every((point, j) => point === a[i + j])) return true;
      return false;
    }
    this.fail("TypeError", "Membership requires an adopted container.");
  }
  unary(operation, value) {
    this.charge(1);
    if (operation === "truth") return this.truth(value);
    if (operation === "not") return !this.truth(value);
    if (operation === "len") {
      if (value instanceof RangeValue) {
        if (value.length > 9223372036854775807n) this.fail("OverflowError", "Python int too large to convert to length");
        return value.length;
      }
      if (sequence(value)) return BigInt(elements(value).length);
      if (value instanceof DictValue) return BigInt(value.entries.length);
      this.fail("TypeError", "Value has no len() in this stage.");
    }
    if (operation === "iter") return this.iterator(value);
    if (operation === "next") return this.next(value);
    if (operation === "invert" && this.numeric) {
      if (!["bigint", "boolean"].includes(typeof value)) this.fail("TypeError", "Bitwise inversion requires an integer.");
      this.charge(integer(value).toString().length); return this.int(~integer(value));
    }
    if (!["negative", "positive"].includes(operation)) this.fail("UnsupportedOperationError", "Unknown unary operation.", "UNSUPPORTED");
    if (value instanceof ComplexValue) return operation === "positive" ? value : this.complex(-value.real, -value.imag);
    if (!numeric(value)) this.fail("TypeError", "Unary numeric operation requires a number.");
    return value instanceof FloatValue ? this.float(operation === "negative" ? -value.value : value.value) :
      this.int(operation === "negative" ? -integer(value) : integer(value));
  }
  binary(operation, left, right) {
    this.charge(1);
    if (operation === "equal") return this.equal(left, right);
    if (operation === "not-equal") return !this.equal(left, right);
    if (operation === "less") return this.less(left, right);
    if (operation === "greater") return this.less(right, left);
    if (operation === "less-equal") return this.less(left, right) || this.equal(left, right);
    if (operation === "greater-equal") return this.less(right, left) || this.equal(left, right);
    if (operation === "is") {
      if (typeof left === "bigint" || typeof right === "bigint") this.fail("UnsupportedOperationError", "Integer interning identity is outside this stage.", "UNSUPPORTED");
      return left === right;
    }
    if (operation === "contains") return this.contains(left, right);
    if (operation === "getitem") return this.index(left, right);
    if (operation === "append") return this.append(left, right);
    if (operation === "dict-delete") return this.remove(left, right);
    if (left instanceof ComplexValue || right instanceof ComplexValue) {
      if (!["add", "subtract", "multiply", "divide", "power"].includes(operation)) this.fail("TypeError", "This operator does not accept complex values");
      const parts = value => value instanceof ComplexValue ? [value.real,value.imag] : [this.number(value),0];
      const a = parts(left), b = parts(right), controls = {charge:this.charge,fail:this.fail};
      if (operation === "power") {
        if (b[1] !== 0) this.fail("UnsupportedOperationError", "Non-real complex exponents require a later numeric stage.", "UNSUPPORTED");
        return this.complex(...complexPower(a,b[0],controls));
      }
      if (!(left instanceof ComplexValue) || !(right instanceof ComplexValue)) {
        if (![...a,...b].every(Number.isFinite)) this.fail("UnsupportedOperationError", "Non-finite complex arithmetic requires a later numeric stage.", "UNSUPPORTED");
        if (operation === "add") return this.complex(a[0]+b[0],left instanceof ComplexValue ? a[1] : b[1]);
        if (operation === "subtract") return this.complex(a[0]-b[0],left instanceof ComplexValue ? a[1] : -b[1]);
        if (operation === "multiply") return this.complex(a[0]*b[0],left instanceof ComplexValue ? a[1]*b[0] : a[0]*b[1]);
        if (!(right instanceof ComplexValue)) {
          if (b[0] === 0) this.fail("ZeroDivisionError", "complex division by zero", "ZERO_DIVISION");
          return this.complex(a[0]/b[0],a[1]/b[0]);
        }
        if (b[0] === 0 && b[1] === 0) this.fail("ZeroDivisionError", "complex division by zero", "ZERO_DIVISION");
        if (Math.abs(b[0]) >= Math.abs(b[1])) {
          const ratio = b[1]/b[0], scale = b[0]+b[1]*ratio;
          return this.complex(a[0]/scale,-a[0]*ratio/scale);
        }
        const ratio = b[0]/b[1], scale = b[0]*ratio+b[1];
        return this.complex(a[0]*ratio/scale,-a[0]/scale);
      }
      return this.complex(...complexArithmetic(operation,a,b,controls));
    }
    if (this.numeric && ["bit-and", "bit-or", "bit-xor", "left-shift", "right-shift", "power"].includes(operation)) {
      if (!["bigint", "boolean"].includes(typeof left) || !["bigint", "boolean"].includes(typeof right)) {
        if (operation === "power" && numeric(left) && numeric(right))
          return this.float(powerReals(this.number(left), this.number(right), {fail: this.fail}));
        this.fail("TypeError", "This operator requires adopted integers.");
      }
      const a = integer(left), b = integer(right);
      this.charge(a.toString().length + b.toString().length);
      if (operation === "power") {
        const result = powerIntegers(a, b, {charge: this.charge, fail: this.fail, digits: VALUE_LIMITS.digits});
        return typeof result === "bigint" ? this.int(result) : this.float(result);
      }
      if (["left-shift", "right-shift"].includes(operation)) {
        if (b < 0n) this.fail("ValueError", "negative shift count");
        if (a === 0n) return this.int(0n);
        const bits = BigInt((a < 0n ? -a : a).toString(2).length);
        if (operation === "right-shift") return this.int(b >= bits ? a < 0n ? -1n : 0n : a >> b);
        if (b + bits > BigInt(Math.ceil(VALUE_LIMITS.digits * Math.log2(10))))
          this.fail("ExecutionLimitError", "Integer shift exceeds the digit budget.", "BUDGET");
        this.charge(Number(b) + Number(bits)); return this.int(a << b);
      }
      const result = operation === "bit-and" ? a & b : operation === "bit-or" ? a | b : a ^ b;
      return typeof left === "boolean" && typeof right === "boolean" ? result !== 0n : this.int(result);
    }
    if (operation === "add" && sequence(left) && left.constructor === right?.constructor) {
      const a = elements(left), b = elements(right);
      this.limit(a.length + b.length <= (left instanceof StringValue ? VALUE_LIMITS.text : VALUE_LIMITS.items), "Sequence length budget exceeded.");
      return left instanceof StringValue ? this.string([...a, ...b]) : left instanceof TupleValue ? this.tuple([...a, ...b]) : this.list([...a, ...b]);
    }
    if (!["add", "subtract", "multiply", "floor-divide", "modulo", "divide"].includes(operation)) this.fail("UnsupportedOperationError", "Unknown binary operation.", "UNSUPPORTED");
    if (operation === "multiply" && ((sequence(left) && ["bigint", "boolean"].includes(typeof right)) ||
        (sequence(right) && ["bigint", "boolean"].includes(typeof left)))) this.fail("UnsupportedOperationError", "Sequence repetition is deferred.", "UNSUPPORTED");
    if (!numeric(left) || !numeric(right)) this.fail("TypeError", "Numeric operation requires adopted numbers.");
    const cost = value => value instanceof FloatValue ? 16 : integer(value).toString().replace(/^-/, "").length;
    this.charge(["multiply", "floor-divide", "modulo", "divide"].includes(operation) ? cost(left) * cost(right) : Math.max(cost(left), cost(right)));
    if (!(left instanceof FloatValue) && !(right instanceof FloatValue)) {
      const a = integer(left), b = integer(right);
      if (operation === "add") return this.int(a + b);
      if (operation === "subtract") return this.int(a - b);
      if (operation === "multiply") return this.int(a * b);
      if (operation === "divide") {
        if (!this.numeric) this.fail("UnsupportedOperationError", "Integer true division is outside this bytecode profile.", "UNSUPPORTED");
        return this.float(divideIntegers(a, b, {charge: this.charge, fail: this.fail}));
      }
      if (b === 0n) this.fail("ZeroDivisionError", "division by zero", "ZERO_DIVISION");
      let quotient = a / b;
      if (a % b !== 0n && (a < 0n) !== (b < 0n)) quotient--;
      return this.int(operation === "floor-divide" ? quotient : a - quotient * b);
    }
    const a = this.number(left), b = this.number(right);
    if (operation === "add") return this.float(a + b);
    if (operation === "subtract") return this.float(a - b);
    if (operation === "multiply") return this.float(a * b);
    if (b === 0) this.fail("ZeroDivisionError", "division by zero", "ZERO_DIVISION");
    if (operation === "divide") return this.float(a / b);
    // Python divmod adjusts the remainder sign and rounds a near-integral quotient.
    let remainder = a % b, quotient = (a - remainder) / b;
    if (remainder !== 0) { if ((b < 0) !== (remainder < 0)) { remainder += b; quotient--; } }
    else remainder = b < 0 || Object.is(b, -0) ? -0 : 0;
    let floor;
    if (quotient !== 0) { floor = Math.floor(quotient); if (quotient - floor > 0.5) floor++; }
    else floor = (a / b < 0 || Object.is(a / b, -0)) ? -0 : 0;
    return this.float(operation === "floor-divide" ? floor : remainder);
  }
  numericCall(name, args) {
    const controls = {charge: this.charge, fail: this.fail};
    const whole = value => {
      if (!["bigint", "boolean"].includes(typeof value)) this.fail("TypeError", "An integer argument is required.");
      return integer(value);
    };
    const text = value => this.string(Array.from(value, character => character.codePointAt(0)));
    if (name === "abs") {
      if (args[0] instanceof ComplexValue) {
        const result = Math.hypot(args[0].real,args[0].imag);
        if (!Number.isFinite(result) && Number.isFinite(args[0].real) && Number.isFinite(args[0].imag)) this.fail("OverflowError", "absolute value too large");
        return this.float(result);
      }
      if (args[0] instanceof FloatValue) return this.float(Math.abs(args[0].value));
      const value = whole(args[0]); return this.int(value < 0n ? -value : value);
    }
    if (name === "pow") {
      if (args[2] === null) return this.binary("power", args[0], args[1]);
      return this.int(modularPower(whole(args[0]), whole(args[1]), whole(args[2]), controls));
    }
    if (name === "round") {
      const ndigits = args[1] === null ? null : whole(args[1]);
      const result = args[0] instanceof FloatValue ? roundReal(args[0].value, ndigits, controls) : roundInteger(whole(args[0]), ndigits, controls);
      return typeof result === "bigint" ? this.int(result) : this.float(result);
    }
    if (name === "ord") {
      if (!(args[0] instanceof StringValue) || args[0].points.length !== 1) this.fail("TypeError", "ord() requires a one-character string.");
      return this.int(BigInt(args[0].points[0]));
    }
    const value = whole(args[0]);
    if (name === "chr") {
      if (value < 0n || value > 0x10ffffn) this.fail("ValueError", "chr() argument is outside Unicode.");
      return this.string([Number(value)]);
    }
    const absolute = value < 0n ? -value : value, base = {bin: 2, oct: 8, hex: 16}[name];
    if (!base) this.fail("UnsupportedOperationError", "Unknown numeric builtin.", "UNSUPPORTED");
    this.charge(absolute.toString(2).length);
    return text((value < 0n ? "-" : "") + {bin: "0b", oct: "0o", hex: "0x"}[name] + absolute.toString(base));
  }
}

export function encodeValue(value) {
  let work = 0;
  return new ValueRuntime({charge: amount => {
    if ((work += amount) > 1_000_000) {
      const error = new Error("By-value encoding work budget exceeded."); error.name = "ExecutionLimitError"; error.code = "BUDGET"; throw error;
    }
  }}).encode(value);
}

// Logical byte costs and explicit edges for the lifetime/accounting layer.
// Primitive BigInts are conservatively counted per root/edge; object aliases once.
export function valueLayout(value) {
  if (value === null || typeof value === "boolean") return {bytes: 8, children: []};
  if (typeof value === "bigint") {
    const digits = value.toString().replace(/^-/, "").length;
    return {bytes: 24 + 2 * digits, children: [], work: digits};
  }
  if (value instanceof FloatValue) return {bytes: 64, children: []};
  if (value instanceof ComplexValue) return {bytes: 80, children: []};
  if (value instanceof RangeValue) return {bytes: 112, children: [value.start, value.stop, value.step, value.length]};
  if (value instanceof StringValue) return {bytes: 64 + 4 * value.points.length, children: []};
  if (value instanceof TupleValue || value instanceof ListValue) return {bytes: 64 + 8 * value.items.length, children: value.items};
  if (value instanceof DictValue) return {bytes: 96 + value.entries.reduce((bytes, entry) => bytes + 48 + 2 * entry.hash.length, 0),
    children: value.entries.flatMap(entry => [entry.key, entry.value])};
  if (value instanceof IteratorValue) return value.value instanceof RangeValue ? {bytes: 80, children: [value.value, value.index]} : {bytes: 64, children: [value.value]};
  if (value instanceof ProtocolIteratorValue) return {bytes: 88, children: [value.source, value.sentinel, value.index]};
  if (value instanceof NotImplementedValue) return {bytes: 48, children: []};
  if (value instanceof SliceValue) return {bytes: 88, children: [value.start, value.stop, value.step]};
  if (value instanceof Cell) return {bytes: 48, children: value.bound ? [value.value] : []};
  if (value instanceof Environment) return {bytes: 64 + [...value.cells.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0), children: [...value.cells.values()]};
  if (value instanceof CodePool) return {bytes: value.bytes, children: [...value.code.constants, ...(value.module ? [value.module] : [])]};
  if (value instanceof ModuleValue) return {bytes: 112 + 2 * value.name.length, children: [value.environment, value.pool]};
  if (value instanceof CallArguments) return {bytes: 80 + (value.keywordMap === null ? 0 : 8) + 8 * value.args.length + value.keywords.reduce((sum, key) => sum + 24 + 2 * key.length, 0),
    children: [value.callable, ...value.args, ...value.keywordValues, ...(value.keywordMap === null ? [] : [value.keywordMap])]};
  if (value instanceof FunctionValue) return {bytes: 80 + 8 * (value.closure.size + (value.defaults?.length ?? 0)), children: [value.pool, value.globals, ...value.closure.values(), ...(value.defaults ?? [])]};
  if (value instanceof ClassValue) return {bytes: 128 + 2 * (value.name.length + value.qualname.length + value.module.length) +
    8 * (value.bases.length + value.mro.length) + [...value.namespace.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0),
    children: [...value.bases, ...value.mro.slice(1), ...value.namespace.values()]};
  if (value instanceof InstanceValue) return {bytes: 80 + [...value.attributes.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0),
    children: [value.type, ...value.attributes.values()]};
  if (value instanceof BoundMethodValue) return {bytes: 64, children: [value.callable, value.receiver]};
  if (value instanceof PropertyValue) return {bytes: 80, children: [value.fget, value.fset, value.fdel]};
  if (value instanceof MethodWrapperValue) return {bytes: 64, children: [value.callable]};
  if (value instanceof PropertyAccessorValue) return {bytes: 64, children: [value.property]};
  if (value instanceof AppendValue) return {bytes: 64, children: [value.receiver]};
  if (value instanceof BuiltinValue) return {bytes: 48 + 2 * value.name.length, children: []};
  if (value instanceof ExceptionValue) return {bytes: 96 + 2 * (value.name.length + value.message.length) +
    value.traceback.reduce((sum, frame) => sum + 64 + 2 * (frame.function.length + (frame.location?.filename.length || 0)), 0),
    children: [...value.args, ...(value.context ? [value.context] : [])]};
  throw new TypeError("Only adopted VM values have an allocation layout.");
}
