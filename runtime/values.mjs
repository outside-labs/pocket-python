// Independent Python values. Native Number is used only inside explicit floats.
import {Cell, Environment, CodePool, ModuleValue, FunctionValue, BuiltinValue, AppendValue, ExceptionValue} from "./function-objects.mjs";
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
class TupleValue {
  constructor(items) { this.items = Object.freeze([...items]); Object.freeze(this); }
}
class ListValue { constructor(items) { this.items = [...items]; } }
class DictValue { constructor() { this.entries = []; this.version = 0; } }
class IteratorValue {
  constructor(value) {
    this.value = value; this.index = 0;
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
  constructor({charge = () => {}, fail = null, memory = null} = {}) {
    this.memory = memory;
    this.charge = charge;
    this.fail = fail || ((name, message, code = "PYTHON") => {
      const error = new Error(message); error.name = name; error.code = code; throw error;
    });
    this.nanIds = new WeakMap(); this.nextNan = 1;
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
  isList(value) { this.charge(1); return value instanceof ListValue; }
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
      } else if (right instanceof IteratorValue) this.fail("UnsupportedOperationError", "List += with an iterator is outside the source profile.", "UNSUPPORTED");
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
      float: ["type", "bits"], str: ["type", "codepoints"], tuple: ["type", "items"], list: ["type", "items"], dict: ["type", "entries"]};
    const keys = typeof record.type === "string" && Object.hasOwn(fields, record.type) ? fields[record.type] : null;
    if (!keys || Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) this.fail("TypeError", "Invalid tagged value fields.");
    if (record.type === "none") return null;
    if (record.type === "bool" && typeof record.value === "boolean") return record.value;
    if (record.type === "int" && typeof record.value === "string" &&
        record.value.length <= VALUE_LIMITS.digits + 1 && /^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(record.value)) {
      this.charge(record.value.length); return this.int(BigInt(record.value));
    }
    if (record.type === "float" && typeof record.bits === "string" && /^[0-9a-f]{16}$/.test(record.bits)) return this.make(64, [], () => new FloatValue(record.bits));
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
    if (value === null) return false;
    if (numeric(value)) return value instanceof FloatValue ? value.value !== 0 : integer(value) !== 0n;
    if (sequence(value)) return elements(value).length !== 0;
    if (value instanceof DictValue) return value.entries.length !== 0;
    if (value instanceof IteratorValue) return true;
    if (value instanceof FunctionValue || value instanceof BuiltinValue || value instanceof ExceptionValue || value instanceof ModuleValue) return true;
    this.fail("TypeError", "Truthiness is outside the adopted values.");
  }
  equal(left, right, depth = 0) {
    this.depth(depth); this.charge(1);
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
    if (value === null) return "none";
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
    if (!sequence(value)) this.fail("TypeError", "Value is not subscriptable in this stage.");
    index = integer(index);
    if (typeof index !== "bigint") this.fail("TypeError", "Sequence indices must be integers.");
    const items = elements(value), size = BigInt(items.length);
    if (index < 0n) index += size;
    if (index < 0n || index >= size) this.fail("IndexError", (value instanceof StringValue ? "string" : value instanceof ListValue ? "list" : "tuple") + " index out of range");
    this.charge(1);
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
    if (!(value instanceof DictValue)) this.fail("TypeError", "Dictionary deletion requires a dict.");
    const found = this.find(value, key);
    if (found < 0) this.fail("KeyError", "Dictionary key not found.");
    this.charge(value.entries.length); value.entries.splice(found, 1); value.version++; return null;
  }
  slice(value, start, stop, step) {
    if (!sequence(value)) this.fail("TypeError", "Slicing requires an adopted sequence.");
    const items = elements(value), length = BigInt(items.length);
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
    const result = [];
    for (let index = start; positive ? index < stop : index > stop; index += step) { this.charge(1); result.push(items[Number(index)]); }
    return value instanceof StringValue ? this.string(result) : value instanceof TupleValue ? this.tuple(result) : this.list(result);
  }
  iterator(value) {
    if (value instanceof IteratorValue) return value;
    if (!sequence(value) && !(value instanceof DictValue)) this.fail("TypeError", "Value is not iterable in this stage.");
    this.charge(1); return this.make(64, [value], () => new IteratorValue(value));
  }
  next(iterator) {
    if (!(iterator instanceof IteratorValue)) this.fail("TypeError", "next requires an iterator.");
    const value = iterator.value; this.charge(1);
    if (iterator.exhausted) this.fail("StopIteration", "");
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
      if (sequence(value)) return BigInt(elements(value).length);
      if (value instanceof DictValue) return BigInt(value.entries.length);
      this.fail("TypeError", "Value has no len() in this stage.");
    }
    if (operation === "iter") return this.iterator(value);
    if (operation === "next") return this.next(value);
    if (!["negative", "positive"].includes(operation)) this.fail("UnsupportedOperationError", "Unknown unary operation.", "UNSUPPORTED");
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
      if (operation === "divide") this.fail("UnsupportedOperationError", "Integer true division is deferred; no Number conversion is implicit.", "UNSUPPORTED");
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
  if (value instanceof StringValue) return {bytes: 64 + 4 * value.points.length, children: []};
  if (value instanceof TupleValue || value instanceof ListValue) return {bytes: 64 + 8 * value.items.length, children: value.items};
  if (value instanceof DictValue) return {bytes: 96 + value.entries.reduce((bytes, entry) => bytes + 48 + 2 * entry.hash.length, 0),
    children: value.entries.flatMap(entry => [entry.key, entry.value])};
  if (value instanceof IteratorValue) return {bytes: 64, children: [value.value]};
  if (value instanceof Cell) return {bytes: 48, children: value.bound ? [value.value] : []};
  if (value instanceof Environment) return {bytes: 64 + [...value.cells.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0), children: [...value.cells.values()]};
  if (value instanceof CodePool) return {bytes: value.bytes, children: [...value.code.constants, ...(value.module ? [value.module] : [])]};
  if (value instanceof ModuleValue) return {bytes: 112 + 2 * value.name.length, children: [value.environment, value.pool]};
  if (value instanceof FunctionValue) return {bytes: 80 + 8 * value.closure.size, children: [value.pool, value.globals, ...value.closure.values()]};
  if (value instanceof AppendValue) return {bytes: 64, children: [value.receiver]};
  if (value instanceof BuiltinValue) return {bytes: 48 + 2 * value.name.length, children: []};
  if (value instanceof ExceptionValue) return {bytes: 96 + 2 * (value.name.length + value.message.length) +
    value.traceback.reduce((sum, frame) => sum + 64 + 2 * (frame.function.length + (frame.location?.filename.length || 0)), 0),
    children: [...value.args, ...(value.context ? [value.context] : [])]};
  throw new TypeError("Only adopted VM values have an allocation layout.");
}
