// Independent Python values. Native Number is used only inside explicit floats.
import {GeneratorValue, FrameValue, FrameLocalsValue, generatorRoots, Cell, Environment, CodePool, CodeValue, ModuleValue, FunctionValue, CallArguments, BuiltinValue, AppendValue, ValueMethod, ExceptionValue, ClassValue, HierarchyTransaction, ClassNamespaceValue, DictionaryViewValue, NamespaceLookupCache, InstanceValue, BoundMethodValue, SuperValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue, ProtocolIteratorValue, NotImplementedValue, IntegerIdentityRecord} from "./function-objects.mjs";
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
class DictValue {
  constructor(size = 0) {
    this.entries = []; this.version = 0; this.ownedKeys = false;
    this.capacity = 8;
    while (Math.floor(this.capacity * 2 / 3) < size) this.capacity *= 2;
    this.slots = 0; this.usable = Math.floor(this.capacity * 2 / 3);
  }
}
class SetValue {
  constructor(storage, frozen) { this.storage = storage; this.frozen = frozen; Object.freeze(this); }
}
class BinaryValue {
  constructor(items, mutable) { this.items = mutable ? [...items] : Object.freeze([...items]); this.mutable = mutable; }
}
class MemoryViewValue {
  constructor(owner, offset, stride, length, readonly) {
    this.owner = owner; this.offset = offset; this.stride = stride; this.length = length;
    this.readonly = readonly; this.released = false; this.cachedHash = null;
  }
}
class RangeValue {
  constructor(start, stop, step, length) {
    this.start = start; this.stop = stop; this.step = step; this.length = length; Object.freeze(this);
  }
}
export class IteratorValue {
  constructor(value, dictionaryKind = null, reverse = false) {
    this.value = value; this.index = value instanceof RangeValue ? 0n : reverse ? value.slots - 1 : 0;
    if (dictionaryKind !== null) { this.dictionaryKind = dictionaryKind; this.reverse = reverse; }
    if (value instanceof DictValue || value instanceof SetValue) {
      const storage = value instanceof SetValue ? value.storage : value;
      this.remaining = storage.entries.length;
      if (storage.namespace) { this.serial = reverse ? storage.namespace.serial - 1 : 0; }
      this.size = storage.entries.length; this.version = storage.version;
    }
  }
}

const numeric = value => typeof value === "bigint" || typeof value === "boolean" || value instanceof FloatValue;
const integer = value => typeof value === "boolean" ? BigInt(value) : value;
const sequence = value => value instanceof StringValue || value instanceof TupleValue || value instanceof ListValue || value instanceof BinaryValue;
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
    this.integerIdentityIds = new Map();
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
  isFloat(value) { return value instanceof FloatValue; }
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
  isBinary(value) { return value instanceof BinaryValue; }
  isView(value) { return value instanceof MemoryViewValue; }
  liveView(value) { if (value.released) this.fail("ValueError", "operation forbidden on released memoryview object"); }
  checkBufferResize(owner) {
    if (this.memory?.liveValues(MemoryViewValue).some(view => !view.released && view.owner === owner)) this.fail("BufferError", "Existing exports of data: object cannot be re-sized");
  }
  view(owner, readonly = null) {
    if (owner instanceof InstanceValue && owner.nativePayload instanceof BinaryValue) {
      const payload = owner.nativePayload;
      return this.viewValue(payload, 0n, 1n, payload.items.length, readonly ?? !payload.mutable, owner);
    }
    if (owner instanceof MemoryViewValue) {
      this.liveView(owner); return this.viewValue(owner.owner, owner.offset, owner.stride, owner.length, readonly ?? owner.readonly, owner.sourceObject);
    }
    if (!(owner instanceof BinaryValue)) this.fail("TypeError", "memoryview requires an adopted bytes-like object");
    return this.viewValue(owner, 0n, 1n, owner.items.length, readonly ?? !owner.mutable);
  }
  viewValue(owner, offset, stride, length, readonly, sourceObject = null) {
    this.charge(1); return this.make(112 + (sourceObject ? 8 : 0), [owner, ...(sourceObject ? [sourceObject] : [])], () => {
      const view = new MemoryViewValue(owner, offset, stride, length, readonly); if (sourceObject) view.sourceObject = sourceObject; return view;
    });
  }
  viewItems(value) {
    this.liveView(value); const items = [];
    for (let index = 0; index < value.length; index++) { this.charge(1); items.push(value.owner.items[Number(value.offset + value.stride * BigInt(index))]); }
    return items;
  }
  viewMethod(name) {
    if (["release", "tobytes", "tolist", "toreadonly"].includes(name)) return true;
    if (["cast", "hex", "count", "index", "__enter__", "__exit__"].includes(name))
      this.fail("UnsupportedOperationError", "This buffer-view API requires a later value stage.", "UNSUPPORTED");
    return false;
  }
  viewAttribute(value, name) {
    this.liveView(value); this.charge(1);
    if (name === "obj") return value.sourceObject ?? value.owner;
    if (name === "readonly") return value.readonly;
    if (name === "format") return this.string([66]);
    if (["itemsize", "ndim"].includes(name)) return 1n;
    if (name === "nbytes") return this.int(BigInt(value.length));
    if (name === "shape") return this.tuple([this.int(BigInt(value.length))]);
    if (name === "strides") return this.tuple([this.int(value.stride)]);
    if (name === "suboffsets") return this.tuple([]);
    if (["contiguous", "c_contiguous", "f_contiguous"].includes(name)) return value.length === 1 || value.stride === 1n;
    this.fail("AttributeError", "memoryview has no attribute '" + name + "'");
  }
  releaseView(value) {
    if (value.released) return null;
    this.charge(1); this.resize(value, 112, []); value.owner = null; if (value.sourceObject) value.sourceObject = null; value.released = true; return null;
  }
  binaryValue(items, mutable = false) {
    this.limit(items.length <= VALUE_LIMITS.text, "Binary length budget exceeded."); this.charge(items.length + 1);
    return this.make(64 + items.length, [], () => new BinaryValue(items, mutable));
  }
  binaryCount(count, mutable = false) {
    count = integer(count);
    if (typeof count !== "bigint") this.fail("TypeError", "Binary length requires an integer");
    if (count < -9223372036854775808n || count > 9223372036854775807n) this.fail("OverflowError", "cannot fit count into an index-sized integer");
    if (count < 0n) this.fail("ValueError", "negative count");
    this.limit(count <= BigInt(VALUE_LIMITS.text), "Binary length budget exceeded.");
    return this.binaryValue(new Array(Number(count)).fill(0), mutable);
  }
  byte(value) {
    value = integer(value);
    if (typeof value !== "bigint") this.fail("TypeError", "A byte value requires an integer");
    if (value < 0n || value > 255n) this.fail("ValueError", "byte must be in range(0, 256)");
    return Number(value);
  }
  appendByte(value, item) {
    const byte = this.byte(item);
    this.limit(value.items.length < VALUE_LIMITS.text, "Binary length budget exceeded."); this.charge(1);
    this.resize(value, 65 + value.items.length, []); value.items.push(byte); return null;
  }
  binaryMethod(value, name) {
    if (name === "decode") return;
    if (value.mutable && ["append", "extend", "insert", "pop", "remove", "clear", "reverse", "resize"].includes(name) ||
        ["hex", "fromhex", "join", "split", "replace", "strip", "find", "count", "index", "startswith", "endswith"].includes(name))
      this.fail("UnsupportedOperationError", "This binary method requires a later value stage.", "UNSUPPORTED");
    this.fail("AttributeError", "Binary value has no attribute '" + name + "'");
  }
  codecName(encoding, errors) {
    if (errors !== undefined) {
      const policy = this.text(errors);
      if (policy === null) this.fail("TypeError", "errors must be a string");
      if (policy !== "strict") this.fail("UnsupportedOperationError", "This codec error policy requires a later value stage.", "UNSUPPORTED");
    }
    const name = encoding === undefined ? "utf8" : this.text(encoding);
    if (name === null) this.fail("TypeError", "encoding must be a string");
    this.charge(name.length + 1);
    const normalized = name.toLowerCase().replace(/[-_ ]/g, "");
    if (["utf8", "utf", "u8"].includes(normalized)) return "utf8";
    if (["ascii", "usascii", "646"].includes(normalized)) return "ascii";
    if (["latin1", "latin", "l1", "iso88591", "isoir100", "cp819", "8859"].includes(normalized)) return "latin1";
    if (/^(utf|cp|iso|unicode|rawunicode|koi8|shift|euc|gb|big5|hz|mac|rot13|punycode|idna)/.test(normalized))
      this.fail("UnsupportedOperationError", "This encoding requires a later codec profile.", "UNSUPPORTED");
    this.fail("LookupError", "unknown encoding: " + name);
  }
  encodeText(value, encoding, errors, mutable = false) {
    const codec = this.codecName(encoding, errors), result = [];
    if (!(value instanceof StringValue)) this.fail("TypeError", "Encoding requires a string");
    for (const point of value.points) {
      this.charge(1);
      if (point >= 0xd800 && point <= 0xdfff || codec === "ascii" && point > 127 || codec === "latin1" && point > 255)
        this.fail("UnicodeEncodeError", "Character cannot be encoded by the selected strict codec");
      const bytes = codec !== "utf8" || point < 128 ? [point] : point < 2048 ? [192 | point >> 6, 128 | point & 63] :
        point < 65536 ? [224 | point >> 12, 128 | point >> 6 & 63, 128 | point & 63] :
        [240 | point >> 18, 128 | point >> 12 & 63, 128 | point >> 6 & 63, 128 | point & 63];
      this.limit(result.length + bytes.length <= VALUE_LIMITS.text, "Binary length budget exceeded."); result.push(...bytes);
    }
    return this.binaryValue(result, mutable);
  }
  decodeBinary(value, encoding, errors) {
    const codec = this.codecName(encoding, errors), points = [], bytes = value.items;
    const invalid = () => this.fail("UnicodeDecodeError", "Invalid input for the selected strict codec");
    for (let index = 0; index < bytes.length;) {
      this.charge(1); const byte = bytes[index++];
      if (codec === "latin1" || byte < 128) { points.push(byte); continue; }
      if (codec === "ascii") invalid();
      const count = byte >= 194 && byte <= 223 ? 1 : byte >= 224 && byte <= 239 ? 2 : byte >= 240 && byte <= 244 ? 3 : 0;
      if (!count || index + count > bytes.length) invalid();
      let point = byte & (count === 1 ? 31 : count === 2 ? 15 : 7);
      for (let offset = 0; offset < count; offset++) {
        this.charge(1); const next = bytes[index++]; if (next < 128 || next > 191) invalid(); point = point * 64 + (next & 63);
      }
      if (point < [0, 128, 2048, 65536][count] || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) invalid();
      points.push(point);
    }
    return this.string(points);
  }
  repr(value) {
    if (value instanceof BinaryValue) {
      const quote = value.items.includes(39) && !value.items.includes(34) ? "\"" : "'", parts = [value.mutable ? "bytearray(b" : "b", quote];
      this.charge(value.items.length + 1);
      for (const byte of value.items) {
        parts.push(byte === 92 || byte === quote.charCodeAt(0) ? "\\" + String.fromCharCode(byte) :
          [9, 10, 13].includes(byte) ? "\\" + {9: "t", 10: "n", 13: "r"}[byte] :
          byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\\x" + byte.toString(16).padStart(2, "0"));
      }
      parts.push(quote, value.mutable ? ")" : ""); return this.string(Array.from(parts.join(""), char => char.charCodeAt(0)));
    }
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
  isSequence(value) { return sequence(value) || value instanceof RangeValue || value instanceof MemoryViewValue; }
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
  containerDirectoryType(value) {
    if (value instanceof StringValue) return "str";
    if (value instanceof ListValue) return "list";
    if (value instanceof TupleValue) return "tuple";
    if (value instanceof DictValue) return "dict";
    if (value instanceof SetValue) return value.frozen ? "frozenset" : "set";
    if (value instanceof BinaryValue) return value.mutable ? "bytearray" : "bytes";
    if (value instanceof MemoryViewValue) return "memoryview";
    return null;
  }
  typeName(value) {
    this.charge(1);
    if (value === null) return "NoneType";
    if (typeof value === "boolean") return "bool";
    if (typeof value === "bigint") return "int";
    if (value instanceof FloatValue) return "float";
    if (value instanceof ComplexValue) return "complex";
    if (value instanceof StringValue) return "str";
    if (value instanceof ListValue) return "list";
    if (value instanceof TupleValue) return "tuple";
    if (value instanceof FrameLocalsValue) return "FrameLocalsProxy";
    if (value instanceof ClassNamespaceValue) return "mappingproxy";
    if (value instanceof DictionaryViewValue) return ['dict_keys', 'dict_values', 'dict_items'][value.kind];
    if (value instanceof DictValue) return "dict";
    if (value instanceof RangeValue) return "range";
    if (value instanceof SliceValue) return "slice";
    if (value instanceof SetValue) return value.frozen ? "frozenset" : "set";
    if (value instanceof BinaryValue) return value.mutable ? "bytearray" : "bytes";
    if (value instanceof MemoryViewValue) return "memoryview";
    if (value instanceof IteratorValue) {
      if (value.dictionaryKind !== undefined) return 'dict_' + (value.reverse ? 'reverse' : '') + ['key', 'value', 'item'][value.dictionaryKind] + 'iterator';
      if (value.value instanceof StringValue) {
        this.charge(value.value.points.length);
        return value.value.points.every(point => point < 128) ? "str_ascii_iterator" : "str_iterator";
      }
      if (value.value instanceof RangeValue) {
        const {start, stop, step, length} = value.value, minimum = -9223372036854775808n, maximum = 9223372036854775807n;
        // Canonical native layouts follow the pinned 64-bit C-long oracle.
        this.charge(1);
        return [start, stop, step].some(item => item < minimum || item > maximum) || length > maximum ||
          length > 0n && (step > 0n ? stop > maximum - (step - 1n) : stop < minimum + (-1n - step)) ? "longrange_iterator" : "range_iterator";
      }
      if (value.value instanceof DictValue) return 'dict_' + (value.reverse ? 'reverse' : '') + ['key', 'value', 'item'][value.dictionaryKind ?? 0] + 'iterator';
      return {list: "list_iterator", tuple: "tuple_iterator", dict: "dict_keyiterator",
        set: "set_iterator", frozenset: "set_iterator", bytes: "bytes_iterator", bytearray: "bytearray_iterator", memoryview: "memory_iterator"}[this.typeName(value.value)];
    }
    return null;
  }
  checkConstructionHint(value) {
    const range = value instanceof IteratorValue && value.value instanceof RangeValue ? value.value : value;
    if (!(range instanceof RangeValue)) return;
    const length = value instanceof IteratorValue ? value.exhausted ? 0n : range.length - value.index : range.length;
    if (length > 9223372036854775807n) this.fail("OverflowError", "Python int too large to convert to length hint");
  }
  isDict(value) { return value instanceof DictValue; }
  isSet(value) { return value instanceof SetValue; }
  newSet(frozen = false, storage = null) {
    storage ??= this.dict([]);
    return this.make(64, [storage], () => new SetValue(storage, frozen));
  }
  setLookupKey(value) { return value instanceof SetValue && !value.frozen ? this.newSet(true, value.storage) : value; }
  setMethod(value, name) {
    if (name === "copy" || !value.frozen && ["add", "discard", "remove", "clear"].includes(name)) return;
    if (["update", "union", "intersection", "difference", "symmetric_difference", "intersection_update", "difference_update",
        "symmetric_difference_update", "issubset", "issuperset", "isdisjoint", "pop"].includes(name))
      this.fail("UnsupportedOperationError", "This set method requires a later value stage.", "UNSUPPORTED");
    this.fail("AttributeError", "Set value has no attribute '" + name + "'");
  }
  copySet(value, frozen = value.frozen) {
    if (value.frozen && frozen) return value;
    const result = this.newSet(frozen);
    for (const entry of value.storage.entries) {
      this.charge(1); this.commitDictionary(result.storage, entry.key, null, this.dictionaryEntryHash(entry), -1);
    }
    return result;
  }
  clearSet(value) {
    if (!value.storage.entries.length) return null;
    this.charge(value.storage.entries.length + 1); this.resize(value.storage, 96, []);
    value.storage.entries = []; value.storage.version++; return null;
  }
  primitiveSet(value) {
    if (this.hasUserEquality(value)) this.fail("UnsupportedOperationError", "Set algebra and frozen hashing with user keys require a later value stage.", "UNSUPPORTED");
  }
  findSet(value, key) {
    key = this.setLookupKey(key);
    const hash = this.pythonHash(key);
    for (let index = 0; index < value.storage.entries.length; index++) {
      this.charge(1); const entry = value.storage.entries[index];
      if (hash === this.dictionaryEntryHash(entry) && (entry.key === key || this.equal(entry.key, key))) return index;
    }
    return -1;
  }
  setAlgebra(operation, left, right, inplace = false) {
    if (!(left instanceof SetValue && right instanceof SetValue)) this.fail("TypeError", "Set operators require set operands");
    this.primitiveSet(left); this.primitiveSet(right);
    const result = this.newSet(inplace ? false : left.frozen);
    const add = entry => { if (this.findSet(result, entry.key) < 0) this.commitDictionary(result.storage, entry.key, null, this.dictionaryEntryHash(entry), -1); };
    for (const entry of left.storage.entries) {
      const present = this.findSet(right, entry.key) >= 0;
      if (operation === "bit-or" || (operation === "bit-and" ? present : !present)) add(entry);
    }
    if (["bit-or", "bit-xor"].includes(operation)) for (const entry of right.storage.entries)
      if (operation === "bit-or" || this.findSet(left, entry.key) < 0) add(entry);
    if (!inplace || left.frozen) return result;
    this.resize(left.storage, valueLayout(result.storage).bytes, valueLayout(result.storage).children);
    left.storage.entries = result.storage.entries; left.storage.version++; left.storage.ownedKeys = true; return left;
  }
  comparisonSequence(value) {
    if (value instanceof SliceValue) return [value.start, value.stop, value.step];
    return value instanceof ListValue || value instanceof TupleValue ? value.items : null;
  }
  sameSequenceKind(left, right) { return this.comparisonSequence(left) !== null && left.constructor === right?.constructor; }
  hasUserEquality(value) {
    const pending = [value], seen = new Set();
    while (pending.length) {
      const item = pending.pop();
      if (item instanceof FrameLocalsValue || item instanceof InstanceValue || item instanceof ModuleValue && item.type instanceof ClassValue || item instanceof ClassValue && item.metaclass !== null || item instanceof SliceValue || item instanceof ClassNamespaceValue || item instanceof DictionaryViewValue) return true;
      if (item instanceof SetValue) { pending.push(...item.storage.entries.map(entry => entry.key)); continue; }
      if (item instanceof DictValue && item.ownedKeys) return true;
      if (item instanceof BoundMethodValue && item.pythonMethod && !seen.has(item)) {
        if (item.callable instanceof BoundMethodValue || item.callable instanceof AppendValue || item.callable instanceof ValueMethod) return true;
        seen.add(item); pending.push(item.callable); continue;
      }
      if (!(item instanceof ListValue || item instanceof TupleValue || item instanceof DictValue) || seen.has(item)) continue;
      seen.add(item); this.charge(1);
      pending.push(...(item instanceof DictValue ? item.entries.flatMap(entry => [entry.key, entry.value]) : item.items));
    }
    return false;
  }
  inplace(operation, left, right) {
    this.charge(1);
    if (left instanceof BinaryValue && left.mutable && ["add", "multiply"].includes(operation))
      this.fail("UnsupportedOperationError", "Bytearray resizing requires a later value stage.", "UNSUPPORTED");
    if (left instanceof SetValue && ["bit-or", "bit-and", "bit-xor", "subtract"].includes(operation))
      return this.setAlgebra(operation, left, right, !left.frozen);
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
  repeat(value, count) {
    count = integer(count);
    if (count < -9223372036854775808n || count > 9223372036854775807n)
      this.fail("OverflowError", "cannot fit repetition into an index-sized integer");
    this.charge(count.toString().length);
    const text = value instanceof StringValue, source = text ? value.points : value.items;
    const size = BigInt(source.length) * (count < 0n ? 0n : count);
    this.limit(size <= BigInt(text ? VALUE_LIMITS.text : VALUE_LIMITS.items), "Sequence length budget exceeded.");
    this.charge(Number(size) + 1);
    if ((text || value instanceof TupleValue) && (count === 1n || source.length === 0)) return value;
    const items = Array.from({length: Number(size)}, (_, index) => source[index % source.length]);
    return text ? this.string(items) : value instanceof TupleValue ? this.tuple(items) : this.list(items);
  }
  list(items) { this.limit(items.length <= VALUE_LIMITS.items, "Container length budget exceeded."); this.charge(items.length + 1); return this.make(64 + 8 * items.length, items, () => new ListValue(items)); }
  tuple(items) { this.limit(items.length <= VALUE_LIMITS.items, "Container length budget exceeded."); this.charge(items.length + 1); return this.make(64 + 8 * items.length, items, () => new TupleValue(items)); }
  dict(pairs) {
    const result = this.make(96, [], () => new DictValue(pairs.length)); this.charge(1);
    for (const [key, value] of pairs) this.set(result, key, value);
    return result;
  }
  decode(record, options = {}) {
    const value = this.decodeRecord(record, options);
    options.retain?.(value);
    return value;
  }
  decodeRecord(record, {immutable = false, depth = 0, retain = null} = {}) {
    this.depth(depth); this.charge(1);
    if (!record || typeof record !== "object" || Array.isArray(record)) this.fail("TypeError", "Expected a tagged Python value.");
    const fields = {none: ["type"], bool: ["type", "value"], int: ["type", "value"],
      float: ["type", "bits"], complex: ["type", "real_bits", "imag_bits"], str: ["type", "codepoints"], bytes: ["type", "bytes"], bytearray: ["type", "bytes"], tuple: ["type", "items"], list: ["type", "items"], dict: ["type", "entries"]};
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
    if (["bytes", "bytearray"].includes(record.type) && this.numeric && Array.isArray(record.bytes) && record.bytes.length <= VALUE_LIMITS.text &&
        Array.from(record.bytes).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      if (immutable && record.type === "bytearray") this.fail("TypeError", "Mutable constants require construction instructions.");
      return this.binaryValue(record.bytes, record.type === "bytearray");
    }
    if (["tuple", "list"].includes(record.type) && Array.isArray(record.items) && record.items.length <= VALUE_LIMITS.items) {
      if (immutable && record.type === "list") this.fail("TypeError", "Mutable constants require construction instructions.");
      const items = Array.from(record.items, item => this.decode(item, {immutable, depth: depth + 1, retain}));
      return record.type === "tuple" ? this.tuple(items) : this.list(items);
    }
    if (record.type === "dict" && Array.isArray(record.entries) && record.entries.length <= VALUE_LIMITS.items) {
      if (immutable) this.fail("TypeError", "Mutable constants require construction instructions.");
      return this.dict(Array.from(record.entries, pair => {
        if (!Array.isArray(pair) || pair.length !== 2) this.fail("TypeError", "Dictionary entries require key/value pairs.");
        return pair.map(item => this.decode(item, {immutable, depth: depth + 1, retain}));
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
    if (value instanceof BinaryValue) { this.charge(value.items.length); return {type: value.mutable ? "bytearray" : "bytes", bytes: [...value.items]}; }
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
    if (value instanceof MemoryViewValue) { this.liveView(value); return value.length !== 0; }
    if (value instanceof NotImplementedValue) this.fail("TypeError", "NotImplemented should not be used in a boolean context");
    if (value === null) return false;
    if (value instanceof RangeValue) return value.length !== 0n;
    if (value instanceof ComplexValue) return value.real !== 0 || value.imag !== 0;
    if (numeric(value)) return value instanceof FloatValue ? value.value !== 0 : integer(value) !== 0n;
    if (sequence(value)) return elements(value).length !== 0;
    if (value instanceof DictValue) return value.entries.length !== 0;
    if (value instanceof SetValue) return value.storage.entries.length !== 0;
    if (value instanceof ClassNamespaceValue) return this.classNamespaceDictionary(value).entries.length !== 0;
    if (value instanceof DictionaryViewValue) return value.dictionary.entries.length !== 0;
    if (value instanceof GeneratorValue || value instanceof IteratorValue || value instanceof ProtocolIteratorValue || value instanceof SliceValue) return true;
    if (value instanceof FunctionValue || value instanceof BuiltinValue || value instanceof ExceptionValue || value instanceof ModuleValue ||
        value instanceof ClassValue || value instanceof InstanceValue || value instanceof BoundMethodValue || value instanceof SuperValue || value instanceof PropertyValue || value instanceof MethodWrapperValue || value instanceof PropertyAccessorValue || value instanceof FrameValue || value instanceof FrameLocalsValue || value instanceof Cell || value instanceof CodeValue) return true;
    this.fail("TypeError", "Truthiness is outside the adopted values.");
  }
  nativeMethodIdentity(value) {
    if (value instanceof BoundMethodValue && !value.pythonMethod && value.callable instanceof BuiltinValue)
      return [value.receiver, value.callable.name];
    if (value instanceof AppendValue || value instanceof ValueMethod) {
      const owner = value.receiver instanceof GeneratorValue ? "generator" : this.typeName(value.receiver);
      return [value.receiver, owner + "." + value.name];
    }
    return null;
  }
  equal(left, right, depth = 0) {
    this.depth(depth); this.charge(1);
    const nativeLeft = this.nativeMethodIdentity(left), nativeRight = this.nativeMethodIdentity(right);
    if (nativeLeft && nativeRight) return nativeLeft[0] === nativeRight[0] && nativeLeft[1] === nativeRight[1];
    if (left instanceof ClassNamespaceValue || right instanceof ClassNamespaceValue)
      return this.equal(left instanceof ClassNamespaceValue ? this.classNamespaceDictionary(left) : left,
        right instanceof ClassNamespaceValue ? this.classNamespaceDictionary(right) : right, depth + 1);
    if (left instanceof DictionaryViewValue || right instanceof DictionaryViewValue) {
      if (left instanceof DictionaryViewValue && left.kind !== 1 || right instanceof DictionaryViewValue && right.kind !== 1)
        this.fail("UnsupportedOperationError", "Dictionary view set comparison is owned by #116/#117.", "UNSUPPORTED");
      return left === right;
    }
    if (left instanceof MemoryViewValue || right instanceof MemoryViewValue) {
      if (left === right) return true;
      if (left instanceof MemoryViewValue && left.released || right instanceof MemoryViewValue && right.released) return false;
      if (!(left instanceof MemoryViewValue || left instanceof BinaryValue) || !(right instanceof MemoryViewValue || right instanceof BinaryValue)) return false;
      const a = left instanceof MemoryViewValue ? this.viewItems(left) : left.items, b = right instanceof MemoryViewValue ? this.viewItems(right) : right.items;
      this.charge(Math.min(a.length, b.length) + 1); return a.length === b.length && a.every((byte, index) => byte === b[index]);
    }
    if (left instanceof BinaryValue || right instanceof BinaryValue) {
      if (!(left instanceof BinaryValue && right instanceof BinaryValue)) return false;
      this.charge(Math.min(left.items.length, right.items.length) + 1);
      return left.items.length === right.items.length && left.items.every((byte, index) => byte === right.items[index]);
    }
    if (left instanceof SetValue || right instanceof SetValue) {
      if (!(left instanceof SetValue && right instanceof SetValue)) return false;
      this.primitiveSet(left); this.primitiveSet(right);
      return left.storage.entries.length === right.storage.entries.length && left.storage.entries.every(entry => this.findSet(right, entry.key) >= 0);
    }
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
      return left.callable === right.callable && left.receiver === right.receiver &&
        Boolean(left.callable instanceof BuiltinValue && !left.pythonMethod) === Boolean(right.callable instanceof BuiltinValue && !right.pythonMethod);
    if (left instanceof AppendValue && right instanceof AppendValue || left instanceof ValueMethod && right instanceof ValueMethod)
      return left.receiver === right.receiver && left.name === right.name;
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
    if (left instanceof MemoryViewValue || right instanceof MemoryViewValue) this.fail("TypeError", "memoryview does not support ordering");
    if (left instanceof BinaryValue || right instanceof BinaryValue) {
      if (!(left instanceof BinaryValue && right instanceof BinaryValue)) this.fail("TypeError", "Binary ordering requires binary operands");
      for (let index = 0; index < Math.min(left.items.length, right.items.length); index++) {
        this.charge(1); if (left.items[index] !== right.items[index]) return left.items[index] < right.items[index];
      }
      return left.items.length < right.items.length;
    }
    if (left instanceof SetValue || right instanceof SetValue) {
      if (!(left instanceof SetValue && right instanceof SetValue)) this.fail("TypeError", "Set ordering requires sets");
      this.primitiveSet(left); this.primitiveSet(right);
      return left.storage.entries.length < right.storage.entries.length && left.storage.entries.every(entry => this.findSet(right, entry.key) >= 0);
    }
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
    if (value instanceof FrameLocalsValue) this.fail("TypeError", "unhashable type: 'FrameLocalsProxy'");
    if (value instanceof ClassNamespaceValue) this.fail("TypeError", "unhashable type: 'mappingproxy'");
    if (value instanceof DictionaryViewValue) return 'p:' + this.pythonHash(value, depth);
    if (value instanceof MemoryViewValue) return 'p:' + this.pythonHash(value, depth);
    if (value instanceof BinaryValue) return 'p:' + this.pythonHash(value, depth);
    if (value instanceof SetValue) return 'p:' + this.pythonHash(value, depth);
    if (value instanceof ClassValue || value instanceof InstanceValue || value instanceof BoundMethodValue || value instanceof SuperValue || value instanceof PropertyValue || value instanceof MethodWrapperValue || value instanceof PropertyAccessorValue)
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
  objectId(value) {
    this.charge(1);
    if (value === null) return this.int(1n);
    if (typeof value === "boolean") return this.int(value ? 2n : 3n);
    if (typeof value === "bigint") {
      let identity;
      if (this.memory) identity = this.memory.integerIdentity(value);
      else {
        if (!this.integerIdentityIds.has(value)) this.integerIdentityIds.set(value, this.nextIdentity++);
        identity = this.integerIdentityIds.get(value);
      }
      return this.int(identity + 3n);
    }
    return this.int(this.identityHash(value) + 3n);
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
  hashParts(value) {
    return value instanceof SliceValue ? [value.start, value.stop, value.step] : value instanceof TupleValue ? value.items : null;
  }
  combineHash(hash, item) { return BigInt.asUintN(64, (hash ^ BigInt.asUintN(64, item)) * 1099511628211n); }
  nameHash(name) {
    this.charge(1);
    let hash = 14695981039346656037n, length = 0;
    for (const char of name) { this.charge(1); length++; hash = this.combineHash(hash, BigInt(char.codePointAt(0))); }
    return this.hashResult(BigInt.asIntN(64, hash ^ BigInt(length)));
  }
  callbackKeyMayMatch(dictionary, name) {
    if (!dictionary.ownedKeys) return false;
    const hash = this.nameHash(name);
    return dictionary.entries.some(entry => this.needsOwnedHash(entry.key) && this.dictionaryEntryHash(entry) === hash);
  }
  pythonHash(value, depth = 0) {
    this.depth(depth); this.charge(1);
    if (value instanceof FrameLocalsValue) this.fail("TypeError", "unhashable type: 'FrameLocalsProxy'");
    if (value instanceof ClassNamespaceValue) this.fail("TypeError", "unhashable type: 'mappingproxy'");
    if (value instanceof DictionaryViewValue && value.kind !== 1) this.fail("TypeError", "unhashable dictionary view");
    const receiverHash = receiver => receiver === null ? this.pythonHash(null) : typeof receiver === "boolean" || typeof receiver === "bigint" ? this.objectId(receiver) : this.identityHash(receiver);
    const native = this.nativeMethodIdentity(value);
    if (native) return this.hashResult(receiverHash(native[0]) ^ (this.nativeCallableDescriptor ? this.identityHash(this.nativeCallableDescriptor(native[1])) :
      BigInt('0x' + hashUnits(Array.from(native[1], char => char.codePointAt(0))))));
    if (value instanceof BoundMethodValue)
      return this.hashResult(this.identityHash(value.callable) ^ receiverHash(value.receiver));
    if (value instanceof MemoryViewValue) {
      if (value.cachedHash !== null) return value.cachedHash;
      this.liveView(value);
      if (!value.readonly) this.fail("ValueError", "cannot hash writable memoryview object");
      if (value.owner.mutable) this.fail("TypeError", "unhashable type: 'bytearray'");
      const hash = this.pythonHash(this.binaryValue(this.viewItems(value)), depth + 1);
      value.cachedHash = hash; return hash;
    }
    if (value instanceof BinaryValue && value.mutable) this.fail("TypeError", "unhashable type: 'bytearray'");
    if (value instanceof SetValue) {
      if (!value.frozen) this.fail("TypeError", "unhashable type: 'set'");
      this.primitiveSet(value);
      let hash = 1927868237n;
      for (const entry of value.storage.entries) {
        this.charge(1); const part = BigInt.asUintN(64, this.dictionaryEntryHash(entry));
        hash ^= BigInt.asUintN(64, (part ^ (part << 16n) ^ 89869747n) * 3644798167n);
      }
      return this.hashResult(BigInt.asIntN(64, hash ^ BigInt(value.storage.entries.length) * 69069n));
    }
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
    if (value instanceof StringValue || value instanceof TupleValue || value instanceof BinaryValue || value instanceof SliceValue) {
      let hash = 14695981039346656037n;
      const parts = value instanceof StringValue ? value.points : this.hashParts(value) || value.items;
      for (const part of parts) {
        this.charge(1);
        const item = value instanceof StringValue || value instanceof BinaryValue ? BigInt(part) : this.pythonHash(part, depth + 1);
        hash = this.combineHash(hash, item);
      }
      return this.hashResult(BigInt.asIntN(64, hash ^ BigInt(parts.length)));
    }
    if (value instanceof ListValue || value instanceof DictValue) this.fail("TypeError", "unhashable mutable value");
    if (value instanceof InstanceValue || value instanceof PropertyAccessorValue)
      this.fail("UnsupportedOperationError", "This hash value family requires its separate protocol stage.", "UNSUPPORTED");
    return this.identityHash(value);
  }
  needsOwnedHash(value) {
    const pending = [value], seen = new Set();
    while (pending.length) {
      const item = pending.pop();
      if (item instanceof SliceValue || item instanceof GeneratorValue || item instanceof InstanceValue || item instanceof ClassValue || item instanceof FunctionValue || item instanceof BuiltinValue ||
          item instanceof BoundMethodValue || item instanceof SuperValue || item instanceof PropertyValue || item instanceof MethodWrapperValue ||
          item instanceof DictionaryViewValue || item instanceof NotImplementedValue || item instanceof ModuleValue || item instanceof ProtocolIteratorValue || item instanceof IteratorValue ||
          item instanceof ExceptionValue || item instanceof FloatValue && Number.isNaN(item.value) ||
          item instanceof ComplexValue && (Number.isNaN(item.real) || Number.isNaN(item.imag))) return true;
      if (item instanceof TupleValue && !seen.has(item)) { seen.add(item); this.charge(1); pending.push(...item.items); }
    }
    return false;
  }
  dictionaryNeedsProtocol(dict, key) { return dict instanceof DictValue && (dict.ownedKeys || this.needsOwnedHash(key)); }
  dictionaryEntryHash(entry) { return entry.hash.startsWith('p:') ? this.int(BigInt(entry.hash.slice(2))) : this.pythonHash(entry.key); }
  dictionarySlotPlan(dictionary) {
    if (dictionary.usable > 0) return {capacity: dictionary.capacity, slots: dictionary.slots, usable: dictionary.usable, compact: false};
    let capacity = 8;
    while (capacity < dictionary.entries.length * 3) capacity *= 2;
    this.charge(dictionary.entries.length + 1);
    return {capacity, slots: dictionary.entries.length, usable: Math.floor(capacity * 2 / 3) - dictionary.entries.length, compact: true};
  }
  commitDictionarySlot(dictionary, plan) {
    if (plan.compact) dictionary.entries.forEach((entry, position) => { entry.position = position; });
    dictionary.capacity = plan.capacity; dictionary.slots = plan.slots + 1; dictionary.usable = plan.usable - 1;
    return plan.slots;
  }
  prepareDictionarySlot(dictionary) { return this.commitDictionarySlot(dictionary, this.dictionarySlotPlan(dictionary)); }
  commitDictionary(dict, key, item, hash, position, remove = false) {
    this.charge(1);
    if (remove) {
      const entries = dict.entries.filter((_, index) => index !== position);
      const bytes = 96 + (dict.namespace ? 16 : 0) + entries.reduce((sum, entry) => sum + (dict.namespace ? 56 : 48) + 2 * entry.hash.length, 0);
      this.resize(dict, bytes, entries.flatMap(entry => [entry.key, entry.value]));
      dict.entries = entries; dict.version++; return null;
    }
    if (position >= 0) {
      this.resize(dict, valueLayout(dict).bytes, dict.entries.flatMap((entry, index) => [entry.key, index === position ? item : entry.value]));
      dict.entries[position].value = item;
    } else {
      this.limit(dict.entries.length < VALUE_LIMITS.items, "Container length budget exceeded.");
      const bucket = 'p:' + hash, plan = this.dictionarySlotPlan(dict);
      this.resize(dict, valueLayout(dict).bytes + (dict.namespace ? 56 : 48) + 2 * bucket.length,
        [...dict.entries.flatMap(entry => [entry.key, entry.value]), key, item]);
      dict.entries.push({hash: bucket, key, value: item, position: this.commitDictionarySlot(dict, plan), ...(dict.namespace ? {serial: dict.namespace.serial++} : {})}); dict.version++;
    }
    dict.ownedKeys = true; return null;
  }
  copyDictionary(dictionary) {
    if (!(dictionary instanceof DictValue)) this.fail("TypeError", "Dictionary copy requires a dict.");
    this.memory?.primitive(dictionary); this.charge(dictionary.entries.length + 1);
    const result = new DictValue();
    result.entries = dictionary.entries.map(entry => ({...entry}));
    if (dictionary.entries.length >= Math.floor(dictionary.slots * 2 / 3)) {
      result.capacity = dictionary.capacity; result.slots = dictionary.slots; result.usable = dictionary.usable;
    } else {
      while (Math.floor(result.capacity * 2 / 3) < result.entries.length) result.capacity *= 2;
      result.slots = result.entries.length; result.usable = Math.floor(result.capacity * 2 / 3) - result.entries.length;
      result.entries.forEach((entry, position) => { entry.position = position; });
    }
    result.ownedKeys = dictionary.ownedKeys;
    if (dictionary.namespace) { result.namespace = {serial: result.entries.length}; result.entries.forEach((entry, serial) => { entry.serial = serial; }); }
    const layout = valueLayout(result);
    return this.make(layout.bytes, layout.children, () => result);
  }
  environmentDictionary(environment) {
    if (environment.dictionary !== null) return environment.dictionaryIdentity ?? environment.dictionary;
    const roots = [environment], leave = this.memory?.enter(() => roots);
    try {
      const dictionary = this.dict([]); roots.push(dictionary);
      for (const name of environment.order) {
        this.charge(name.length + 1);
        const cell = environment.cells.get(name);
        if (!cell?.bound || name.startsWith("@source:")) continue;
        const key = this.string(Array.from(name, char => char.codePointAt(0))); roots.push(key);
        this.set(dictionary, key, cell.value);
      }
      // Publish only after all allocations succeed. Cells cease to own stale
      // values; every subsequent source access uses this dictionary.
      dictionary.namespace = {serial: dictionary.entries.length};
      dictionary.entries.forEach((entry, serial) => { entry.serial = serial; });
      const layout = valueLayout(dictionary); this.resize(dictionary, layout.bytes, layout.children);
      const internal = [...environment.cells].filter(([name]) => name.startsWith("@source:"));
      this.resize(environment, 72 + internal.reduce((size, [name]) => size + 32 + 2 * name.length, 0), [dictionary, ...internal.map(([,cell]) => cell)]);
      environment.dictionary = dictionary; environment.cells.clear();
      for (const [name, cell] of internal) environment.cells.set(name, cell);
      return dictionary;
    } finally { leave?.(); }
  }
  find(dict, key) {
    const hash = this.hash(key);
    for (let i = 0; i < dict.entries.length; i++) {
      this.charge(1); const entry = dict.entries[i];
      if ((hash === entry.hash || entry.hash.startsWith("p:") && this.pythonHash(key) === this.dictionaryEntryHash(entry)) && (entry.key === key || this.equal(entry.key, key))) return i;
    }
    return -1;
  }
  classNamespaceEntry(receiver, key) {
    this.charge(1); this.memory?.primitive(receiver);
    const name = this.text(key), owner = receiver.owner;
    if (owner instanceof ClassNamespaceValue || owner instanceof DictValue || owner.namespaceDictionary) {
      const dictionary = this.classNamespaceDictionary(receiver), position = this.find(dictionary, key);
      return {found: position >= 0, value: position >= 0 ? dictionary.entries[position].value : null};
    }
    if (name === null) {
      // Validate primitive hashability without invoking unadopted key callbacks.
      if (this.needsOwnedHash(key))
        this.fail("UnsupportedOperationError", "Callback-bearing namespace keys require their own stage.", "UNSUPPORTED");
      this.hash(key);
      for (const [stored, value] of owner.namespace) if (typeof stored !== "string" && this.equal(stored, key)) return {found: true, value};
      return {found: false, value: null};
    }
    this.charge(name.length + 1);
    if (name === "__qualname__" || name === "__classcell__") return {found: false, value: null};
    if (owner.namespace.has(name)) return {found: true, value: owner.namespace.get(name)};
    if (name === "__doc__") return {found: true, value: null};
    if (name === "__module__") return {found: true, value: this.string(Array.from(owner.module, char => char.codePointAt(0)))};
    if (["__dict__", "__weakref__", "__firstlineno__", "__static_attributes__"].includes(name))
      this.fail("UnsupportedOperationError", "Native namespace entries require their own layout contract.", "UNSUPPORTED");
    return {found: false, value: null};
  }
  index(value, index) {
    if (value instanceof ClassNamespaceValue) {
      const entry = this.classNamespaceEntry(value, index);
      if (!entry.found) this.fail("KeyError", "Class namespace key not found");
      return entry.value;
    }
    if (value instanceof MemoryViewValue) {
      this.liveView(value); index = integer(index);
      if (typeof index !== "bigint") this.fail("TypeError", "memoryview indices must be integers");
      if (index < 0n) index += BigInt(value.length);
      if (index < 0n || index >= BigInt(value.length)) this.fail("IndexError", "memoryview index out of bounds");
      this.charge(1); return this.int(BigInt(value.owner.items[Number(value.offset + value.stride * index)]));
    }
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
    return value instanceof StringValue ? this.string([items[Number(index)]]) : value instanceof BinaryValue ? this.int(BigInt(items[Number(index)])) : items[Number(index)];
  }
  set(value, key, item) {
    if (value instanceof MemoryViewValue) {
      this.liveView(value);
      if (value.readonly) this.fail("TypeError", "cannot modify read-only memory");
      key = integer(key);
      if (typeof key !== "bigint") this.fail("TypeError", "memoryview indices must be integers");
      if (key < 0n) key += BigInt(value.length);
      if (key < 0n || key >= BigInt(value.length)) this.fail("IndexError", "memoryview index out of bounds");
      const byte = this.byte(item); this.charge(1); value.owner.items[Number(value.offset + value.stride * key)] = byte; return null;
    }
    if (value instanceof BinaryValue) {
      if (!value.mutable) this.fail("TypeError", "bytes object does not support item assignment");
      key = integer(key);
      if (typeof key !== "bigint") this.fail("TypeError", "Byte indices must be integers");
      if (key < 0n) key += BigInt(value.items.length);
      if (key < 0n || key >= BigInt(value.items.length)) this.fail("IndexError", "bytearray index out of range");
      const byte = this.byte(item); this.charge(1); value.items[Number(key)] = byte; return null;
    }
    if (value instanceof DictValue) {
      const hash = this.hash(key), found = this.find(value, key);
      if (found >= 0) {
        const children = value.entries.flatMap((entry, index) => [entry.key, index === found ? item : entry.value]);
        this.resize(value, valueLayout(value).bytes, children);
        value.entries[found].value = item;
      }
      else {
        this.limit(value.entries.length < VALUE_LIMITS.items, "Container length budget exceeded.");
        this.charge(1); const plan = this.dictionarySlotPlan(value);
        this.resize(value, valueLayout(value).bytes + (value.namespace ? 56 : 48) + 2 * hash.length,
          [...value.entries.flatMap(entry => [entry.key, entry.value]), key, item]);
        value.entries.push({hash, key, value: item, position: this.commitDictionarySlot(value, plan), ...(value.namespace ? {serial: value.namespace.serial++} : {})}); value.version++;
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
    if (value instanceof MemoryViewValue) { this.liveView(value); this.fail("TypeError", "cannot delete memory"); }
    if (value instanceof BinaryValue && value.mutable) this.fail("UnsupportedOperationError", "Bytearray deletion requires a later value stage.", "UNSUPPORTED");
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
    if (value instanceof BinaryValue) {
      if (!value.mutable) this.fail("TypeError", "bytes object does not support item assignment");
      this.fail("UnsupportedOperationError", "Bytearray resizing and slice mutation require a later value stage.", "UNSUPPORTED");
    }
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
    if (value instanceof MemoryViewValue) this.liveView(value);
    if (!sequence(value) && !(value instanceof RangeValue || value instanceof MemoryViewValue)) this.fail("TypeError", "Slicing requires an adopted sequence.");
    const items = value instanceof RangeValue || value instanceof MemoryViewValue ? null : elements(value),
      length = value instanceof RangeValue ? value.length : value instanceof MemoryViewValue ? BigInt(value.length) : BigInt(items.length);
    step = step === null ? 1n : integer(step);
    if (typeof step !== "bigint") this.fail("TypeError", "slice indices must be integers or None");
    if (step === 0n) this.fail("ValueError", "slice step cannot be zero");
    if (value instanceof MemoryViewValue) step = step < -9223372036854775807n ? -9223372036854775807n : step > 9223372036854775807n ? 9223372036854775807n : step;
    const positive = step > 0n, low = positive ? 0n : -1n, high = positive ? length : length - 1n;
    const normalize = (index, fallback) => {
      if (index === null) return fallback;
      index = integer(index);
      if (typeof index !== "bigint") this.fail("TypeError", "slice indices must be integers or None");
      if (index < 0n) index += length;
      return index < low ? low : index > high ? high : index;
    };
    start = normalize(start, positive ? 0n : length - 1n); stop = normalize(stop, positive ? length : -1n);
    if (value instanceof MemoryViewValue) {
      const stride = value.stride * step;
      if (stride < -9223372036854775808n || stride > 9223372036854775807n)
        this.fail("UnsupportedOperationError", "Nested buffer strides outside the signed-size range require a later value stage.", "UNSUPPORTED");
      const distance = positive ? stop - start : start - stop, magnitude = positive ? step : -step;
      return this.viewValue(value.owner, value.offset + value.stride * start, stride, Number(distance <= 0n ? 0n : (distance - 1n) / magnitude + 1n), value.readonly, value.sourceObject);
    }
    if (value instanceof RangeValue) {
      this.charge((value.step.toString().length + 1) * (start.toString().length + stop.toString().length + step.toString().length));
      return this.range([this.int(value.start + value.step * start), this.int(value.start + value.step * stop), this.int(value.step * step)]);
    }
    const result = [];
    for (let index = start; positive ? index < stop : index > stop; index += step) { this.charge(1); result.push(items[Number(index)]); }
    return value instanceof StringValue ? this.string(result) : value instanceof BinaryValue ? this.binaryValue(result, value.mutable) : value instanceof TupleValue ? this.tuple(result) : this.list(result);
  }
  classNamespaceDictionary(proxy) {
    let owner = proxy.owner;
    while (owner instanceof ClassNamespaceValue) { this.charge(1); owner = owner.owner; }
    const dictionary = owner instanceof DictValue ? owner : owner.namespaceDictionary;
    if (!(dictionary instanceof DictValue)) throw new TypeError("A materialized namespace dictionary is required.");
    this.memory?.primitive(dictionary); return dictionary;
  }
  enableNamespace(dictionary) {
    if (dictionary.namespace) return dictionary;
    if (dictionary.entries.some(entry => entry.position === undefined)) {
      dictionary.slots = dictionary.entries.length;
      while (Math.floor(dictionary.capacity * 2 / 3) < dictionary.slots) dictionary.capacity *= 2;
      dictionary.usable = Math.floor(dictionary.capacity * 2 / 3) - dictionary.slots;
      dictionary.entries.forEach((entry, position) => { entry.position = position; });
    }
    const bytes = valueLayout(dictionary).bytes + 16 + 8 * dictionary.entries.length;
    this.resize(dictionary, bytes, dictionary.entries.flatMap(entry => [entry.key, entry.value]));
    dictionary.namespace = {serial: dictionary.entries.length};
    dictionary.entries.forEach((entry, serial) => { entry.serial = serial; }); return dictionary;
  }
  dictionaryPosition(dictionary, position, reverse = false) {
    let lower = 0, upper = dictionary.entries.length;
    while (lower < upper) {
      this.charge(1); const middle = Math.floor((lower + upper) / 2), slot = dictionary.entries[middle].position;
      if (slot < position || reverse && slot === position) lower = middle + 1; else upper = middle;
    }
    return reverse ? lower - 1 : lower < dictionary.entries.length ? lower : -1;
  }
  dictionaryIterator(dictionary, kind = 0, reverse = false) {
    this.enableNamespace(dictionary); this.charge(1);
    return this.make(96, [dictionary], () => new IteratorValue(dictionary, kind, reverse));
  }
  dictionaryView(dictionary, kind) { return this.make(56, [dictionary], () => new DictionaryViewValue(dictionary, kind)); }
  iterator(value) {
    if (value instanceof ClassNamespaceValue) return this.dictionaryIterator(this.classNamespaceDictionary(value));
    if (value instanceof DictionaryViewValue) return this.dictionaryIterator(value.dictionary, value.kind);
    if (value instanceof DictValue && value.namespace) return this.dictionaryIterator(value);
    if (value instanceof IteratorValue) return value;
    if (value instanceof RangeValue) { this.charge(1); return this.make(80, [value, 0n], () => new IteratorValue(value)); }
    if (value instanceof MemoryViewValue) this.liveView(value);
    if (!sequence(value) && !(value instanceof DictValue || value instanceof SetValue || value instanceof MemoryViewValue)) this.fail("TypeError", "Value is not iterable in this stage.");
    this.charge(1); return this.make(value.namespace ? 80 : 64, [value], () => new IteratorValue(value));
  }
  isIterator(value) { this.charge(1); return value instanceof GeneratorValue || value instanceof IteratorValue || value instanceof ProtocolIteratorValue; }
  finishDictionaryIterator(iterator, name = "StopIteration", message = "") {
    if (iterator.dictionaryKind !== undefined) { this.resize(iterator, 96, []); iterator.value = null; }
    iterator.exhausted = true; this.fail(name, message);
  }
  next(iterator) {
    if (!(iterator instanceof IteratorValue)) this.fail("TypeError", "next requires an iterator.");
    const value = iterator.value; this.charge(1);
    if (iterator.exhausted) this.fail("StopIteration", "");
    if (value instanceof MemoryViewValue) {
      this.liveView(value);
      if (iterator.index >= value.length) { iterator.exhausted = true; this.fail("StopIteration", ""); }
      return this.index(value, BigInt(iterator.index++));
    }
    if (value instanceof RangeValue) {
      if (iterator.index >= value.length) { iterator.exhausted = true; this.fail("StopIteration", ""); }
      this.charge(value.start.toString().length + value.step.toString().length * iterator.index.toString().length);
      const item = value.start + value.step * iterator.index, index = this.int(iterator.index + 1n);
      this.resize(iterator, 80, [value, index]); iterator.index = index;
      return this.int(item);
    }
    if (value instanceof DictValue || value instanceof SetValue) {
      const storage = value instanceof SetValue ? value.storage : value, label = value instanceof SetValue ? "Set" : "dictionary";
      if (iterator.invalidated || iterator.size !== storage.entries.length) {
        iterator.invalidated = true; this.fail("RuntimeError", label + " changed size during iteration");
      }
      if (storage.namespace) {
        if (iterator.dictionaryKind === undefined) {
          this.resize(iterator, 96, [value]); iterator.dictionaryKind = 0; iterator.reverse = false;
        }
        const index = this.dictionaryPosition(storage, iterator.index, iterator.reverse);
        const entry = index < 0 ? null : storage.entries[index];
        if (!entry) return this.finishDictionaryIterator(iterator);
        if (!iterator.reverse && iterator.remaining === 0) return this.finishDictionaryIterator(iterator, "RuntimeError", "dictionary keys changed during iteration");
        const item = iterator.dictionaryKind === 1 ? entry.value : iterator.dictionaryKind === 2 ? this.tuple([entry.key, entry.value]) : entry.key;
        iterator.serial = entry.serial + (iterator.reverse ? -1 : 1); iterator.index = entry.position + (iterator.reverse ? -1 : 1); iterator.remaining--; return item;
      }
      if (iterator.version !== storage.version) this.fail("UnsupportedOperationError", "Equal-size key mutation during iteration is deferred.", "UNSUPPORTED");
      const index = this.dictionaryPosition(storage, iterator.index);
      if (index < 0) { iterator.exhausted = true; this.fail("StopIteration", ""); }
      iterator.index = storage.entries[index].position + 1; iterator.remaining--; return storage.entries[index].key;
    }
    const items = elements(value);
    if (iterator.index >= items.length) { iterator.exhausted = true; this.fail("StopIteration", ""); }
    const item = items[iterator.index++];
    return value instanceof StringValue ? this.string([item]) : value instanceof BinaryValue ? this.int(BigInt(item)) : item;
  }
  contains(key, value) {
    if (value instanceof ClassNamespaceValue) return this.classNamespaceEntry(value, key).found;
    if (value instanceof MemoryViewValue) return this.viewItems(value).some(byte => this.equal(this.int(BigInt(byte)), key));
    if (value instanceof BinaryValue) {
      if (["bigint", "boolean"].includes(typeof key)) { const byte = this.byte(key); this.charge(value.items.length + 1); return value.items.includes(byte); }
      if (!(key instanceof BinaryValue || key instanceof MemoryViewValue)) this.fail("TypeError", "Binary membership requires a byte integer or binary sequence");
      const items = key instanceof MemoryViewValue ? this.viewItems(key) : key.items;
      this.charge((value.items.length + 1) * (items.length + 1));
      for (let index = 0; index <= value.items.length - items.length; index++)
        if (items.every((byte, offset) => byte === value.items[index + offset])) return true;
      return false;
    }
    if (value instanceof SetValue) return this.findSet(value, key) >= 0;
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
      if (value instanceof ClassNamespaceValue) return this.int(BigInt(this.classNamespaceDictionary(value).entries.length));
      if (value instanceof DictionaryViewValue) return this.int(BigInt(value.dictionary.entries.length));
      if (value instanceof MemoryViewValue) { this.liveView(value); return this.int(BigInt(value.length)); }
      if (value instanceof RangeValue) {
        if (value.length > 9223372036854775807n) this.fail("OverflowError", "Python int too large to convert to length");
        return value.length;
      }
      if (sequence(value)) return BigInt(elements(value).length);
      if (value instanceof DictValue) return BigInt(value.entries.length);
      if (value instanceof SetValue) return BigInt(value.storage.entries.length);
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
    if (operation === "matmul") this.fail("TypeError", "unsupported operand types for @");
    if (operation === "equal") return this.equal(left, right);
    if (operation === "not-equal") return !this.equal(left, right);
    if (operation === "less") return this.less(left, right);
    if (operation === "greater") return this.less(right, left);
    if (operation === "less-equal") return this.less(left, right) || this.equal(left, right);
    if (operation === "greater-equal") return this.less(right, left) || this.equal(left, right);
    if (operation === "is") {
      if (left === null || right === null) return left === right;
      if (!this.numeric && (typeof left === "bigint" || typeof right === "bigint"))
        this.fail("UnsupportedOperationError", "Integer identity requires the current source value profile.", "UNSUPPORTED");
      if (typeof left === "bigint" && typeof right === "bigint") this.charge(valueLayout(left).work + valueLayout(right).work);
      return left === right;
    }
    if (operation === "contains") return this.contains(left, right);
    if (operation === "getitem") return this.index(left, right);
    if (operation === "append") return this.append(left, right);
    if (operation === "dict-delete") return this.remove(left, right);
    if (left instanceof BinaryValue && operation === "add" && (right instanceof BinaryValue || right instanceof MemoryViewValue))
      return this.binaryValue([...left.items, ...(right instanceof MemoryViewValue ? this.viewItems(right) : right.items)], left.mutable);
    if (operation === "multiply" && (left instanceof BinaryValue || right instanceof BinaryValue)) {
      const value = left instanceof BinaryValue ? left : right, count = integer(value === left ? right : left);
      if (typeof count !== "bigint") this.fail("TypeError", "Binary repetition requires an integer");
      if (count < -9223372036854775808n || count > 9223372036854775807n) this.fail("OverflowError", "cannot fit repetition into an index-sized integer");
      this.charge(count.toString().length); const size = BigInt(value.items.length) * (count < 0n ? 0n : count);
      this.limit(size <= BigInt(VALUE_LIMITS.text), "Binary length budget exceeded.");
      this.charge(Number(size)); return this.binaryValue(Array.from({length: Number(size)}, (_, index) => value.items[index % value.items.length]), value.mutable);
    }
    if ((left instanceof SetValue || right instanceof SetValue) && ["bit-and", "bit-or", "bit-xor", "subtract"].includes(operation))
      return this.setAlgebra(operation, left, right);
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
        (sequence(right) && ["bigint", "boolean"].includes(typeof left)))) {
      if (!this.numeric) this.fail("UnsupportedOperationError", "Sequence repetition requires the source value profile.", "UNSUPPORTED");
      const value = sequence(left) ? left : right, count = value === left ? right : left;
      return this.repeat(value, count);
    }
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
      if (args[0] instanceof BinaryValue) {
        if (args[0].items.length !== 1) this.fail("TypeError", "ord() requires a one-byte binary value");
        return this.int(BigInt(args[0].items[0]));
      }
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
  if (value instanceof IntegerIdentityRecord) return {bytes: 64 + 2 * (value.integer.toString().length + value.identity.toString().length), children: []};
  if (value === null || typeof value === "boolean") return {bytes: 8, children: []};
  if (typeof value === "bigint") {
    const digits = value.toString().replace(/^-/, "").length;
    return {bytes: 24 + 2 * digits, children: [], work: digits};
  }
  if (value instanceof FloatValue) return {bytes: 64, children: []};
  if (value instanceof ComplexValue) return {bytes: 80, children: []};
  if (value instanceof RangeValue) return {bytes: 112, children: [value.start, value.stop, value.step, value.length]};
  if (value instanceof StringValue) return {bytes: 64 + 4 * value.points.length, children: []};
  if (value instanceof BinaryValue) return {bytes: 64 + value.items.length, children: []};
  if (value instanceof MemoryViewValue) return {bytes: 112 + (value.sourceObject ? 8 : 0), children: value.released ? [] : [value.owner, ...(value.sourceObject ? [value.sourceObject] : [])]};
  if (value instanceof TupleValue || value instanceof ListValue) return {bytes: 64 + 8 * value.items.length, children: value.items};
  if (value instanceof DictValue) return {bytes: 96 + (value.namespace ? 16 : 0) + value.entries.reduce((bytes, entry) => bytes + (value.namespace ? 56 : 48) + 2 * entry.hash.length, 0),
    children: value.entries.flatMap(entry => [entry.key, entry.value])};
  if (value instanceof SetValue) return {bytes: 64, children: [value.storage]};
  if (value instanceof DictionaryViewValue) return {bytes: 56, children: [value.dictionary]};
  if (value instanceof IteratorValue && value.dictionaryKind !== undefined) return {bytes: 96, children: value.value === null ? [] : [value.value]};
  if (value instanceof IteratorValue) return value.value?.namespace ? {bytes: 80, children: [value.value]} : value.value instanceof RangeValue ? {bytes: 80, children: [value.value, value.index]} : {bytes: 64, children: [value.value]};
  if (value instanceof GeneratorValue) return {bytes: 152 + 8 * ([value.reflector, value.identityName, value.identityQualname].filter(item => item != null).length) + 48 * (value.frame?.tasks.length ?? 0) + 32 * (value.frame?.locals.size ?? value.bindings.size) + 8 * (value.frame?.tasks.reduce((sum, task) => sum + (task.stack?.length ?? 0), 0) ?? 0), children: generatorRoots(value)};
  if (value instanceof FrameValue) return {bytes: 128 + 8 * (value.locals.size + value.closure.size + (value.keys === null ? 0 : 1) + (value.extras === null ? 0 : 1)) + (value.nameKeys === null ? 0 : 8 + [...value.nameKeys.keys()].reduce((sum, name) => sum + 32 + 2 * name.length, 0)),
    children: [value.pool, value.callable, value.back, ...value.locals.values(), ...value.closure.values(), value.keys, value.extras, ...(value.nameKeys?.values() ?? []), ...(value.raw.namespaceEnvironment ? [value.raw.namespaceEnvironment] : [])]};
  if (value instanceof FrameLocalsValue) return {bytes: 48, children: [value.frame]};
  if (value instanceof ProtocolIteratorValue) return {bytes: 88, children: [value.source, value.sentinel, value.index]};
  if (value instanceof NotImplementedValue) return {bytes: 48, children: []};
  if (value instanceof SliceValue) return {bytes: 88, children: [value.start, value.stop, value.step]};
  if (value instanceof Cell) return {bytes: 48, children: value.bound ? [value.value] : []};
  if (value instanceof Environment) return value.dictionary === null ?
    {bytes: 64 + [...value.cells.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0), children: [...value.cells.values()]} :
    {bytes: 72 + (value.dictionaryIdentity ? 8 : 0) + [...value.cells.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0), children: [value.dictionary, ...(value.dictionaryIdentity ? [value.dictionaryIdentity] : []), ...value.cells.values()]};
  if (value instanceof CodePool) return {bytes: value.bytes + (value.source === null ? 0 : 32 + 2 * value.source.source.length) + (value.codeObjects === null ? 0 : 8 + 8 * value.codeObjects.size), children: [...value.code.constants, ...(value.module ? [value.module] : []), ...(value.codeObjects?.values() ?? [])]};
  if (value instanceof CodeValue) return {bytes: 56 + 24 * value.metadata.size, children: [value.pool, ...value.metadata.values()]};
  if (value instanceof ModuleValue) return {bytes: 112 + 2 * value.name.length + (value.type ? 8 : 0), children: [value.environment, value.pool, ...(value.type ? [value.type] : [])]};
  if (value instanceof CallArguments) return {bytes: 80 + (value.keywordMap === null ? 0 : 8) + 8 * value.args.length + value.keywords.reduce((sum, key) => sum + 24 + 2 * key.length, 0),
    children: [value.callable, ...value.args, ...value.keywordValues, ...(value.keywordMap === null ? [] : [value.keywordMap])]};
  if (value instanceof FunctionValue) {
    const metadata = [value.identityName, value.identityQualname, value.identityModule, value.builtins, value.closureTuple].filter(item => item != null);
    const defaults = [...(Array.isArray(value.positionalDefaults) ? value.positionalDefaults : [value.positionalDefaults]),
      ...(value.keywordDefaults instanceof Map ? value.keywordDefaults.values() : [value.keywordDefaults])].filter(item => item != null);
    return {bytes: 80 + 8 * (value.closure.size + defaults.length + (value.attributes === null ? 0 : 1) + (value.documentation === null ? 0 : 1) + metadata.length),
      children: [value.pool, value.globals, ...value.closure.values(), ...defaults, ...(value.attributes === null ? [] : [value.attributes]), ...(value.documentation === null ? [] : [value.documentation]), ...metadata]};
  }
  if (value instanceof ClassValue) return {bytes: (value.storage?.explicit || value.storage?.count ? 48 + value.storage.ownNames.reduce((sum, name) => sum + 8 + 2 * name.length, 0) : 0) + (value.namespaceKeys ? 8 + 8 * value.namespaceKeys.length : 0) + 128 + 2 * (value.name.length + value.qualname.length + value.module.length) +
    8 * (value.bases.length + value.mro.length + (value.identityName === undefined ? 0 : 1) + (value.identityQualname === undefined ? 0 : 1) + (value.metaclass === null ? 0 : 1) + (value.namespaceDictionary ? 1 : 0)) + (value.protocolNames === null ? 0 : 8 + value.protocolNames.reduce((sum, name) => sum + 8 + 2 * name.length, 0)) + (value.namespaceEntries === null ? 0 : 8 + value.namespaceEntries.reduce((sum, entry) => sum + 40 + 2 * entry.hash.length, 0)) + (value.staticAttributes || []).reduce((sum, name) => sum + 8 + 2 * name.length, 0) + [...value.namespace.keys()].reduce((sum, key) => sum + 32 + (typeof key === "string" ? 2 * key.length : 8), 0),
    children: [...(value.namespaceKeys || []), ...value.bases, ...value.mro.filter(item => item !== value), ...[...value.namespace.keys()].filter(key => typeof key !== "string"), ...value.namespace.values(), ...(value.namespaceEntries || []).map(entry => entry.key), ...(value.namespaceDictionary ? [value.namespaceDictionary] : []), ...(value.metaclass === null ? [] : [value.metaclass]), ...(value.identityName === undefined ? [] : [value.identityName]), ...(value.identityQualname === undefined ? [] : [value.identityQualname])]};
  if (value instanceof NamespaceLookupCache) return {bytes: 64 + value.entries.reduce((sum, entry) => sum + 48 + 2 * entry.name.length, 0),
    children: value.entries.flatMap(entry => [entry.owner, entry.dictionary, entry.key])};
  if (value instanceof HierarchyTransaction) return {bytes: 96 + 8 * value.bases.length + value.snapshots.reduce((sum, entry) => sum + 64 + 8 * (entry.bases.length + entry.mro.length + (entry.installed?.length || 0)), 0),
    children: [value.type, ...value.bases, ...value.snapshots.flatMap(entry => [entry.type, ...entry.bases, ...entry.mro, ...(entry.installed || [])])]};
  if (value instanceof ClassNamespaceValue) return {bytes: 48, children: [value.owner]};
  if (value instanceof InstanceValue) return value.attributes instanceof Map ?
    {bytes: 80 + (value.nativePayload === undefined ? 0 : 8) + (value.slotValues ? 8 + 8 * value.type.storage.count : 0) + [...value.attributes.keys()].reduce((sum, key) => sum + 32 + 2 * key.length, 0),
      children: [value.type, ...(value.nativePayload === undefined ? [] : [value.nativePayload]), ...value.attributes.values(), ...(value.slotValues?.values() || [])]} : {bytes: 88 + (value.nativePayload === undefined ? 0 : 8) + (value.slotValues ? 8 + 8 * value.type.storage.count : 0), children: [value.type, value.attributes, ...(value.nativePayload === undefined ? [] : [value.nativePayload]), ...(value.slotValues?.values() || [])]};
  if (value instanceof BoundMethodValue) return {bytes: 64, children: [value.callable, value.receiver]};
  if (value instanceof SuperValue) return {bytes: 72, children: [value.thisclass, value.self, value.selfClass]};
  if (value instanceof PropertyValue) return {bytes: 80 + (value.propertyName === undefined ? 0 : 8) + (value.documentation == null ? 0 : 8),
    children: [value.fget, value.fset, value.fdel, ...(value.propertyName === undefined ? [] : [value.propertyName]), ...(value.documentation == null ? [] : [value.documentation])]};
  if (value instanceof MethodWrapperValue) return {bytes: 64 + (value.attributes === null ? 0 : 8), children: [value.callable, ...(value.attributes === null ? [] : [value.attributes])]};
  if (value instanceof PropertyAccessorValue) return {bytes: 64, children: [value.property]};
  if (value instanceof AppendValue) return {bytes: 64, children: [value.receiver]};
  if (value instanceof ValueMethod) return {bytes: 64 + 2 * value.name.length, children: [value.receiver]};
  if (value instanceof BuiltinValue) return {bytes: (value.namespaceKeys ? 8 + 8 * value.namespaceKeys.length : 0) + 48 + 2 * value.name.length + (value.nativeOwner ? 8 : 0) + (value.namespaceDictionary ? 8 : 0) + (value.qualifiedName === undefined ? 0 : 8),
    children: [...(value.namespaceKeys || []), ...(value.nativeOwner ? [value.nativeOwner] : []), ...(value.namespaceDictionary ? [value.namespaceDictionary] : []), ...(value.qualifiedName === undefined ? [] : [value.qualifiedName])]};
  if (value instanceof ExceptionValue) return {bytes: 96 + 2 * (value.name.length + value.message.length) +
    value.traceback.reduce((sum, frame) => sum + 64 + 2 * (frame.function.length + (frame.location?.filename.length || 0)), 0),
    children: [...value.args, ...(value.context ? [value.context] : [])]};
  throw new TypeError("Only adopted VM values have an allocation layout.");
}
