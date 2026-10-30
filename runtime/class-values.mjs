import {isVerifiedFunctionCode} from "./function-bytecode.mjs";
import {NATIVE_NAMESPACES, NATIVE_DOC_COPIES, NATIVE_CALLABLE_DOCS} from "./native-namespaces.mjs";
import {ClassValue, HierarchyTransaction, ClassNamespaceValue, DictionaryViewValue, NamespaceLookupRequest, InstanceValue, BoundMethodValue, SuperValue, FunctionValue, BuiltinValue, ExceptionValue, EXCEPTIONS, matchesException, PropertyValue, MethodWrapperValue, PropertyAccessorValue, GeneratorValue, FrameValue, FrameLocalsValue, ModuleValue, CodeValue, Cell, NotImplementedValue, ProtocolIteratorValue, AppendValue, ValueMethod} from "./function-objects.mjs";
import {allowsClassSpecial, isSpecialName, METACLASS_PROTOCOLS} from "./class-policy.mjs";
import {ValueRuntime, valueLayout, IteratorValue} from "./values.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

export const NATIVE_SUBCLASS_BASES = Object.freeze(["int", "float", "complex", "str", "bytes", "tuple", "frozenset", "list", "dict", "set", "bytearray", "property", "staticmethod", "classmethod", "module", "super"]);
export const CLASS_LIMITS = Object.freeze({bases: 16, mro: 64, attributes: 128, name: 256});
const NATIVE_TYPES = new Set(["type", "bool", "int", "float", "complex", "str", "list", "tuple", "dict", "range", "slice", "set", "frozenset", "bytes", "bytearray", "memoryview",
  "mappingproxy", "super", "property", "staticmethod", "classmethod", "NoneType", "NotImplementedType", "function", "method", "method-wrapper", "method_descriptor", "wrapper_descriptor", "builtin_function_or_method", "generator", "module", "code", "frame", "FrameLocalsProxy", "cell",
  "list_iterator", "tuple_iterator", "str_iterator", "str_ascii_iterator", "dict_keyiterator", "range_iterator", "longrange_iterator", "set_iterator", "bytes_iterator", "bytearray_iterator", "memory_iterator", "iterator", "callable_iterator", ...Object.keys(EXCEPTIONS)]);
for (const name of Object.keys(NATIVE_NAMESPACES)) if (name !== "object") NATIVE_TYPES.add(name);
const NAMESPACE_DESCRIPTOR_KINDS = new Set(["method_descriptor", "wrapper_descriptor", "classmethod_descriptor", "getset_descriptor", "member_descriptor"]);
const META_SPECIALS = new Set([...METACLASS_PROTOCOLS, "__subclasses__", "__slots__", "__mro_entries__", "__orig_bases__", "__prepare__", "__classcell__", "__classdictcell__", "__bases__", "__firstlineno__", "__static_attributes__", "__weakref__", "__dict__", "__new__", "__init__", "__init_subclass__", "__call__", "__module__", "__qualname__", "__instancecheck__", "__subclasscheck__", "__dir__", "__getattribute__", "__getattr__", "__name__", "__isabstractmethod__", "__doc__", "__setattr__", "__delattr__"]);
const NATIVE_CHECK_METHODS = new Set(["type.__instancecheck__", "type.__subclasscheck__"]);
const NATIVE_COPY_METHODS = new Set(["property.getter", "property.setter", "property.deleter"]);
const NATIVE_PROPERTY_METHODS = new Set([...NATIVE_COPY_METHODS, "property.__set_name__"]);
const NATIVE_METHOD_DESCRIPTORS = new Set([...NATIVE_CHECK_METHODS, ...NATIVE_PROPERTY_METHODS, "type.mro", "type.__subclasses__", "type.__dir__", "mappingproxy.get", "object.__dir__"]);
const NATIVE_TYPE_WRAPPERS = new Set(["type.__getattribute__", "type.__setattr__", "type.__delattr__"]);
const NATIVE_DESCRIPTOR_WRAPPERS = new Set(["property.__get__", "property.__set__", "property.__delete__", "staticmethod.__get__", "classmethod.__get__", "function.__get__"]);
const NATIVE_BINDING_WRAPPERS = new Set(["method_descriptor.__get__", "wrapper_descriptor.__get__", "getset_descriptor.__get__", "member_descriptor.__get__", "classmethod_descriptor.__get__", "getset_descriptor.__set__", "getset_descriptor.__delete__", "member_descriptor.__set__", "member_descriptor.__delete__"]);
const nativeWrapper = name => NATIVE_TYPE_WRAPPERS.has(name) || NATIVE_DESCRIPTOR_WRAPPERS.has(name) || NATIVE_BINDING_WRAPPERS.has(name) ||
  NATIVE_NAMESPACES[name.slice(0, name.indexOf("."))]?.some(([key, kind]) => key === name.slice(name.indexOf(".") + 1) && kind === "wrapper_descriptor");
const FUNCTION_DATA = new Set(["__dict__", "__class__", "__name__", "__qualname__", "__module__", "__doc__", "__defaults__", "__kwdefaults__", "__globals__", "__builtins__", "__code__", "__closure__"]);
const FUNCTION_DEFERRED_DATA = new Set(["__builtins__", "__code__", "__defaults__", "__kwdefaults__", "__closure__", "__globals__", "__annotations__", "__annotate__", "__type_params__"]);
const FUNCTION_DEFERRED_METHODS = new Set(["__call__", "__getattribute__", "__setattr__", "__delattr__", "__repr__", "__str__", "__hash__", "__eq__", "__ne__", "__reduce__", "__reduce_ex__", "__sizeof__", "__format__", "__dir__", "__init__", "__new__", "__init_subclass__", "__subclasshook__", "__getstate__"]);
const NATIVE_CLASS_METHODS = new Set(["object.__init_subclass__"]);

// Native namespace keys in pinned CPython 3.14.7 merge order.
const OBJECT_DIRECTORY_KEYS = Object.freeze([
  "__new__",
  "__repr__",
  "__hash__",
  "__str__",
  "__getattribute__",
  "__setattr__",
  "__delattr__",
  "__lt__",
  "__le__",
  "__eq__",
  "__ne__",
  "__gt__",
  "__ge__",
  "__init__",
  "__reduce_ex__",
  "__reduce__",
  "__getstate__",
  "__subclasshook__",
  "__init_subclass__",
  "__format__",
  "__sizeof__",
  "__dir__",
  "__class__",
  "__doc__"
]);
const STR_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__str__", "__lt__", "__le__",
  "__eq__", "__ne__", "__gt__", "__ge__", "__iter__", "__mod__",
  "__rmod__", "__len__", "__getitem__", "__add__", "__mul__", "__rmul__",
  "__contains__", "encode", "replace", "split", "rsplit", "join",
  "capitalize", "casefold", "title", "center", "count", "expandtabs",
  "find", "partition", "index", "ljust", "lower", "lstrip",
  "rfind", "rindex", "rjust", "rstrip", "rpartition", "splitlines",
  "strip", "swapcase", "translate", "upper", "startswith", "endswith",
  "removeprefix", "removesuffix", "isascii", "islower", "isupper", "istitle",
  "isspace", "isdecimal", "isdigit", "isnumeric", "isalpha", "isalnum",
  "isidentifier", "isprintable", "zfill", "format", "format_map", "__format__",
  "maketrans", "__sizeof__", "__getnewargs__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const LIST_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__init__", "__len__",
  "__getitem__", "__setitem__", "__delitem__", "__add__", "__mul__", "__rmul__",
  "__contains__", "__iadd__", "__imul__", "__reversed__", "__sizeof__", "clear",
  "copy", "append", "insert", "extend", "pop", "remove",
  "index", "count", "reverse", "sort", "__class_getitem__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const TUPLE_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__len__", "__getitem__",
  "__add__", "__mul__", "__rmul__", "__contains__", "__getnewargs__", "index",
  "count", "__class_getitem__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const DICT_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__init__", "__or__",
  "__ror__", "__ior__", "__len__", "__getitem__", "__setitem__", "__delitem__",
  "__contains__", "__sizeof__", "get", "setdefault", "pop", "popitem",
  "keys", "items", "values", "update", "fromkeys", "clear",
  "copy", "__reversed__", "__class_getitem__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const SET_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__init__", "__sub__",
  "__rsub__", "__and__", "__rand__", "__xor__", "__rxor__", "__or__",
  "__ror__", "__isub__", "__iand__", "__ixor__", "__ior__", "__len__",
  "__contains__", "add", "clear", "copy", "discard", "difference",
  "difference_update", "intersection", "intersection_update", "isdisjoint", "issubset", "issuperset",
  "pop", "__reduce__", "remove", "__sizeof__", "symmetric_difference", "symmetric_difference_update",
  "union", "update", "__class_getitem__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const FROZENSET_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__sub__", "__rsub__",
  "__and__", "__rand__", "__xor__", "__rxor__", "__or__", "__ror__",
  "__len__", "__contains__", "copy", "difference", "intersection", "isdisjoint",
  "issubset", "issuperset", "__reduce__", "__sizeof__", "symmetric_difference", "union",
  "__class_getitem__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const BYTES_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__str__", "__lt__", "__le__",
  "__eq__", "__ne__", "__gt__", "__ge__", "__iter__", "__buffer__",
  "__mod__", "__rmod__", "__len__", "__getitem__", "__add__", "__mul__",
  "__rmul__", "__contains__", "__getnewargs__", "__bytes__", "capitalize", "center",
  "count", "decode", "endswith", "expandtabs", "find", "fromhex",
  "hex", "index", "isalnum", "isalpha", "isascii", "isdigit",
  "islower", "isspace", "istitle", "isupper", "join", "ljust",
  "lower", "lstrip", "maketrans", "partition", "replace", "removeprefix",
  "removesuffix", "rfind", "rindex", "rjust", "rpartition", "rsplit",
  "rstrip", "split", "splitlines", "startswith", "strip", "swapcase",
  "title", "translate", "upper", "zfill", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const BYTEARRAY_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__str__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__init__", "__buffer__",
  "__release_buffer__", "__mod__", "__rmod__", "__len__", "__getitem__", "__setitem__",
  "__delitem__", "__add__", "__mul__", "__rmul__", "__contains__", "__iadd__",
  "__imul__", "__alloc__", "__reduce__", "__reduce_ex__", "__sizeof__", "append",
  "capitalize", "center", "clear", "copy", "count", "decode",
  "endswith", "expandtabs", "extend", "find", "fromhex", "hex",
  "index", "insert", "isalnum", "isalpha", "isascii", "isdigit",
  "islower", "isspace", "istitle", "isupper", "join", "ljust",
  "lower", "lstrip", "maketrans", "partition", "pop", "remove",
  "replace", "removeprefix", "removesuffix", "resize", "reverse", "rfind",
  "rindex", "rjust", "rpartition", "rsplit", "rstrip", "split",
  "splitlines", "startswith", "strip", "swapcase", "title", "translate",
  "upper", "zfill", "__doc__", "__hash__",
  ...OBJECT_DIRECTORY_KEYS
]);
const MEMORYVIEW_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__buffer__", "__release_buffer__",
  "__len__", "__getitem__", "__setitem__", "__delitem__", "release", "tobytes",
  "hex", "tolist", "cast", "toreadonly", "_from_flags", "count",
  "index", "__enter__", "__exit__", "__class_getitem__", "obj", "nbytes",
  "readonly", "itemsize", "format", "ndim", "shape", "strides",
  "suboffsets", "c_contiguous", "f_contiguous", "contiguous", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const CONTAINER_DIRECTORY_KEYS = Object.freeze({str: STR_DIRECTORY_KEYS, list: LIST_DIRECTORY_KEYS, tuple: TUPLE_DIRECTORY_KEYS, dict: DICT_DIRECTORY_KEYS,
  set: SET_DIRECTORY_KEYS, frozenset: FROZENSET_DIRECTORY_KEYS, bytes: BYTES_DIRECTORY_KEYS, bytearray: BYTEARRAY_DIRECTORY_KEYS, memoryview: MEMORYVIEW_DIRECTORY_KEYS});
const NONE_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__bool__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const NOT_IMPLEMENTED_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__bool__", "__reduce__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const INT_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__add__", "__radd__", "__sub__",
  "__rsub__", "__mul__", "__rmul__", "__mod__", "__rmod__", "__divmod__",
  "__rdivmod__", "__pow__", "__rpow__", "__neg__", "__pos__", "__abs__",
  "__bool__", "__invert__", "__lshift__", "__rlshift__", "__rshift__", "__rrshift__",
  "__and__", "__rand__", "__xor__", "__rxor__", "__or__", "__ror__",
  "__int__", "__float__", "__floordiv__", "__rfloordiv__", "__truediv__", "__rtruediv__",
  "__index__", "conjugate", "bit_length", "bit_count", "to_bytes", "from_bytes",
  "as_integer_ratio", "__trunc__", "__floor__", "__ceil__", "__round__", "__getnewargs__",
  "__format__", "__sizeof__", "is_integer", "real", "imag", "numerator",
  "denominator", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const BOOL_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__invert__", "__and__", "__rand__", "__xor__",
  "__rxor__", "__or__", "__ror__", "__doc__",
  ...INT_DIRECTORY_KEYS
]);
const FLOAT_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__add__", "__radd__", "__sub__",
  "__rsub__", "__mul__", "__rmul__", "__mod__", "__rmod__", "__divmod__",
  "__rdivmod__", "__pow__", "__rpow__", "__neg__", "__pos__", "__abs__",
  "__bool__", "__int__", "__float__", "__floordiv__", "__rfloordiv__", "__truediv__",
  "__rtruediv__", "from_number", "conjugate", "__trunc__", "__floor__", "__ceil__",
  "__round__", "as_integer_ratio", "fromhex", "hex", "is_integer", "__getnewargs__",
  "__getformat__", "__format__", "real", "imag", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const COMPLEX_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__add__", "__radd__", "__sub__",
  "__rsub__", "__mul__", "__rmul__", "__pow__", "__rpow__", "__neg__",
  "__pos__", "__abs__", "__bool__", "__truediv__", "__rtruediv__", "from_number",
  "conjugate", "__complex__", "__getnewargs__", "__format__", "real", "imag",
  "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const FUNCTION_DIRECTORY_KEYS = Object.freeze([
  "__new__",
  "__repr__",
  "__call__",
  "__get__",
  "__closure__",
  "__globals__",
  "__builtins__",
  "__code__",
  "__defaults__",
  "__kwdefaults__",
  "__annotations__",
  "__annotate__",
  "__dict__",
  "__doc__",
  "__module__",
  "__name__",
  "__qualname__",
  "__type_params__",
  ...OBJECT_DIRECTORY_KEYS
]);
const METHOD_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__call__", "__getattribute__",
  "__lt__", "__le__", "__eq__", "__ne__", "__gt__", "__ge__", "__get__",
  "__reduce__", "__func__", "__self__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);

const NAMESPACE_VIEW_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__str__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__or__", "__ror__", "__ior__",
  "__len__", "__getitem__", "__contains__", "get", "keys", "values", "items",
  "copy", "__class_getitem__", "__reversed__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const PROPERTY_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__get__", "__set__", "__delete__", "__init__", "getter", "setter",
  "deleter", "__set_name__", "fget", "fset", "fdel", "__doc__", "__name__",
  "__isabstractmethod__", ...OBJECT_DIRECTORY_KEYS
]);
const RANGE_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "__iter__", "__bool__", "__len__",
  "__getitem__", "__contains__", "__reversed__", "__reduce__", "count", "index",
  "start", "stop", "step", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const SLICE_DIRECTORY_KEYS = Object.freeze([
  "__new__", "__repr__", "__hash__", "__lt__", "__le__", "__eq__",
  "__ne__", "__gt__", "__ge__", "indices", "__reduce__", "start",
  "stop", "step", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const GENERATOR_DIRECTORY_KEYS = Object.freeze([
  "__repr__", "__iter__", "__next__", "__del__", "send", "throw", "close",
  "__sizeof__", "__class_getitem__", "__name__", "__qualname__", "gi_yieldfrom",
  "gi_running", "gi_frame", "gi_suspended", "gi_code", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const ITERATOR_DIRECTORY_KEYS = Object.freeze([
  "__iter__", "__next__", "__length_hint__", "__reduce__", "__setstate__",
  "__doc__", ...OBJECT_DIRECTORY_KEYS
]);
const HASH_ITERATOR_DIRECTORY_KEYS = Object.freeze([
  "__iter__", "__next__", "__length_hint__", "__reduce__", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
]);
const MEMORY_ITERATOR_DIRECTORY_KEYS = Object.freeze([
  "__iter__", "__next__", "__doc__", ...OBJECT_DIRECTORY_KEYS
]);
const CALLABLE_ITERATOR_DIRECTORY_KEYS = Object.freeze([
  "__iter__", "__next__", "__reduce__", "__doc__", ...OBJECT_DIRECTORY_KEYS
]);
const NATIVE_DESCRIPTOR_DIRECTORY_KEYS = Object.freeze([
  "__repr__", "__call__", "__get__", "__reduce__", "__objclass__", "__name__",
  "__doc__", "__qualname__", "__text_signature__", ...OBJECT_DIRECTORY_KEYS
]);
const NATIVE_METHOD_DIRECTORY_KEYS = Object.freeze([
  "__repr__", "__hash__", "__call__", "__lt__", "__le__", "__eq__", "__ne__",
  "__gt__", "__ge__", "__reduce__", "__module__", "__doc__", "__name__",
  "__qualname__", "__self__", "__text_signature__", ...OBJECT_DIRECTORY_KEYS
]);
const NATIVE_WRAPPER_DIRECTORY_KEYS = Object.freeze([
  "__repr__", "__hash__", "__call__", "__lt__", "__le__", "__eq__", "__ne__",
  "__gt__", "__ge__", "__reduce__", "__self__", "__objclass__", "__name__",
  "__qualname__", "__doc__", "__text_signature__", ...OBJECT_DIRECTORY_KEYS
]);

export class ClassRuntime {
  constructor({memory = null, charge = () => {}, fail = null, values = null, builtin = null} = {}) {
    this.memory = memory; this.charge = charge;
    this.fail = fail || ((name, message, code = "PYTHON") => { throw Object.assign(new Error(message), {name, code}); });
    this.values = values || new ValueRuntime({memory, charge, fail: this.fail});
    this.builtin = builtin || (name => this.make(BuiltinValue, name));
  }
  make(Type, ...args) {
    const value = new Type(...args), layout = valueLayout(value);
    return this.memory ? this.memory.allocate(layout.bytes, layout.children, () => value) : value;
  }
  touch(value) { this.charge(1); this.memory?.primitive(value); }
  bounded(condition, message) { if (!condition) this.fail("ExecutionLimitError", message, "BUDGET"); }
  key(name) {
    this.charge(typeof name === "string" ? name.length + 1 : 1);
    if (typeof name !== "string" || name.length > CLASS_LIMITS.name) throw new TypeError("Invalid class attribute name.");
  }
  root() { return this.make(ClassValue, "object", "object", "builtins", [], [], new Map(), true); }
  validateNamespace(bases, names) {
    const metaLayout = bases.some(base => base instanceof BuiltinValue && base.name === "type" || this.isMetaclass(base));
    if (metaLayout) {
      const entries = [...names];
      if (entries.some(key => isSpecialName(key) && !META_SPECIALS.has(key)))
        this.fail("UnsupportedOperationError", "Further metaclass special protocols require a separate stage", "UNSUPPORTED");
    }
  }
  create(name, qualname, module, bases, namespace, root, {dynamic = false, metaclass = null, firstLine = 1, staticAttributes = [], namespaceEntries = null, protocolNames = null, slotNames = null} = {}) {
    this.key(name);
    if (!dynamic && !isPythonIdentifier(name)) throw new TypeError("Invalid class name.");
    this.bounded(typeof qualname === "string" && qualname.length <= 256 && typeof module === "string" && module.length <= 192,
      "Class identity budget exceeded.");
    if (!(root instanceof ClassValue) || !root.root || !Array.isArray(bases) || !(namespace instanceof Map)) throw new TypeError("Invalid class construction record.");
    this.touch(root);
    this.bounded(bases.length <= CLASS_LIMITS.bases && namespace.size <= CLASS_LIMITS.attributes, "Class base/namespace budget exceeded.");
    bases = bases.length ? [...bases] : [root]; namespace = new Map(namespace);
    this.validateNamespace(bases, [...namespace.keys(), ...(protocolNames || [])]);
    const has = name => namespace.has(name) || protocolNames?.includes(name);
    const automaticHash = has("__eq__") && !has("__hash__");
    if (automaticHash) namespace.set("__hash__", null);
    this.bounded(namespace.size <= CLASS_LIMITS.attributes, "Class namespace budget exceeded.");
    for (const base of bases) {
      this.charge(1);
      if (base instanceof BuiltinValue && base.name === "type") { this.touch(base); continue; }
      if (base instanceof BuiltinValue && NATIVE_SUBCLASS_BASES.includes(base.name)) { this.touch(base); continue; }
      if (base instanceof BuiltinValue && NATIVE_TYPES.has(base.name)) {
        if (Object.hasOwn(EXCEPTIONS, base.name) || ["list", "dict", "set", "bytearray", "property", "staticmethod", "classmethod", "module", "super"].includes(base.name))
          this.fail("UnsupportedOperationError", "This native subclass layout retains its owning stage", "UNSUPPORTED");
        this.fail("TypeError", "type '" + base.name + "' is not an acceptable base type");
      }
      if (!(base instanceof ClassValue)) this.fail("TypeError", "Class bases must be adopted class values.");
      this.touch(base);
    }
    if (new Set(bases).size !== bases.length) this.fail("TypeError", "Duplicate class base.");
    for (const key of namespace.keys()) {
      if (typeof key !== "string") continue;
      this.key(key);
      if (!allowsClassSpecial(key, "define"))
        this.fail("UnsupportedOperationError", "Custom special methods require a later class stage.", "UNSUPPORTED");
    }
    if (namespace.get("__new__") instanceof FunctionValue)
      namespace.set("__new__", this.make(MethodWrapperValue, "staticmethod", namespace.get("__new__")));
    if (namespace.get("__init_subclass__") instanceof FunctionValue)
      namespace.set("__init_subclass__", this.make(MethodWrapperValue, "classmethod", namespace.get("__init_subclass__")));
    for (const [key, expected] of [["__qualname__", qualname]])
      if (namespace.has(key) && this.values.text(namespace.get(key)) !== expected)
        this.fail("UnsupportedOperationError", "Class metadata overrides are outside C1.", "UNSUPPORTED");
    namespace.delete("__qualname__");
    const customMro = metaclass instanceof ClassValue && (this.hasSlot(metaclass, "mro") || !this.hasTypeNamespace({metaclass}));
    const parents = customMro ? [] : this.mergeMro(bases);
    const type = new ClassValue(name, qualname, module, bases, parents, namespace, false, metaclass, !dynamic, automaticHash);
    type.storage = this.storageLayout(name, bases, namespace, slotNames);
    type.mroPending = customMro; type.customMro = customMro;
    type.protocolNames = protocolNames?.length ? [...protocolNames] : null;
    type.firstLine = firstLine; type.staticAttributes = staticAttributes === null ? null : [...staticAttributes];
    type.namespaceEntries = namespaceEntries === null ? null : namespaceEntries.filter(entry => !["__qualname__", "__classcell__", "__classdictcell__"].includes(this.values.text(entry.key))).map(entry => ({key: entry.key, hash: entry.hash}));
    const layout = valueLayout(type);
    const result = this.memory ? this.memory.allocate(layout.bytes, layout.children, () => type) : type;
    type.creationOrder = this.memory ? this.memory.identityHash(type) : (this.nextClassOrder = (this.nextClassOrder ?? 0n) + 1n);
    return result;
  }
  storageLayout(name, bases, namespace, slotNames) {
    let best = null;
    for (const base of bases) {
      const solid = base.storage?.solid ?? (this.isMetaclass(base) || base instanceof BuiltinValue ? base : null);
      if (solid === null) continue;
      if (best === null || this.subclass(solid, best)) best = solid;
      else if (!this.subclass(best, solid)) this.fail("TypeError", "multiple bases have instance lay-out conflict");
    }
    const inherited = bases.find(base => base.storage?.solid === best)?.storage;
    const count = inherited?.count ?? 0;
    const dict = bases.some(base => base.storage?.dict ?? (base instanceof ClassValue && !base.root || base instanceof BuiltinValue && ["type", "module", "staticmethod", "classmethod"].includes(base.name)));
    const weak = bases.some(base => base.storage?.weak ?? (base instanceof ClassValue && !base.root || base instanceof BuiltinValue && ["type", "frozenset", "set", "module"].includes(base.name)));
    const family = best instanceof BuiltinValue ? best.name : best?.storage?.family ?? "object";
    const variable = ["int", "bytes", "tuple"].includes(family);
    const ownNames = []; let ownDict = slotNames === null && !dict, ownWeak = slotNames === null && !weak && !variable;
    if (slotNames !== null) for (const item of slotNames) {
      this.charge(1); const label = this.values.text(item);
      if (label === null) this.fail("TypeError", "__slots__ items must be strings");
      if (!isPythonIdentifier(label)) this.fail("TypeError", "__slots__ must be identifiers");
      if (label === "__dict__" || label === "__weakref__") {
        const dictionary = label === "__dict__";
        if (dictionary ? dict || ownDict : weak || ownWeak) this.fail("TypeError", label + " slot disallowed: we already got one");
        if (dictionary) ownDict = true; else ownWeak = true;
        continue;
      }
      const prefix = name.replace(/^_+/, ""), key = label.startsWith("__") && !label.endsWith("__") && prefix ? "_" + prefix + label : label;
      if (namespace.has(key)) this.fail("ValueError", "'" + key + "' in __slots__ conflicts with class variable");
      this.key(key); ownNames.push(key);
    }
    if (variable && (ownNames.length || ownWeak)) this.fail("TypeError", "nonempty __slots__ not supported for variable-size native layout");
    if (ownNames.length && bases.some(base => base instanceof BuiltinValue && base.name === "type" || this.isMetaclass(base))) this.fail("TypeError", "nonempty __slots__ not supported for subtype of type");
    ownNames.sort();
    this.bounded(count + ownNames.length <= CLASS_LIMITS.attributes, "Instance slot budget exceeded");
    return {count: count + ownNames.length, ownNames, dict: dict || ownDict, weak: weak || ownWeak,
      ownDict, ownWeak, solid: best, baseSolid: best, family, explicit: slotNames !== null};
  }
  installStorage(type) {
    if (!type.storage?.ownNames.length) return;
    const roots = [type], leave = this.memory?.enter(() => roots, {charge: this.charge});
    try {
      const storage = type.storage;
      const first = storage.count - storage.ownNames.length;
      for (let i = 0; i < storage.ownNames.length; i++) {
        const name = storage.ownNames[i], descriptor = this.namespaceDescriptor(type, name, "member_descriptor"); roots.push(descriptor);
        descriptor.slotIndex = first + i;
        const key = this.values.string(Array.from(name, char => char.codePointAt(0))); roots.push(key);
        this.values.set(type.namespaceDictionary, key, descriptor);
        type.namespace.set(name, descriptor);
      }
      if (storage.ownNames.length) storage.solid = type;
      const layout = valueLayout(type); this.memory?.resize(type, layout.bytes, layout.children);
    } finally { leave?.(); }
  }
  mergeMro(bases) {
    if (bases.some(base => base.mroPending)) this.fail("TypeError", "Cannot extend an incomplete type");
    const pending = [...bases.map(base => [...this.mro(base)]), [...bases]], parents = [];
    while (pending.some(items => items.length)) {
      this.charge(1); let candidate = null;
      for (const items of pending) {
        if (!items.length) continue;
        const first = items[0]; let blocked = false;
        for (const other of pending) for (let index = 1; index < other.length; index++) {
          this.charge(1); if (other[index] === first) blocked = true;
        }
        if (!blocked) { candidate = first; break; }
      }
      if (!candidate) this.fail("TypeError", "Cannot create a consistent method resolution order.");
      this.bounded(parents.length + 1 < CLASS_LIMITS.mro, "Class MRO budget exceeded.");
      parents.push(candidate);
      for (const items of pending) if (items[0] === candidate) items.shift();
    }
    return parents;
  }
  defaultMro(type) { return type instanceof ClassValue ? [type, ...this.mergeMro(type.bases)] : this.mro(type); }
  layoutFamily(type) {
    if (type instanceof ClassValue && type.storage) return type.storage.family;
    const pending = [type], seen = new Set();
    while (pending.length) {
      this.charge(1); const item = pending.pop();
      if (seen.has(item)) continue; seen.add(item);
      if (item instanceof BuiltinValue) { if (item.name !== "type") return item.name; return "type"; }
      if (item instanceof ClassValue) pending.push(...item.bases);
    }
    return "object";
  }
  validateMro(type, items) {
    if (!items.length) this.fail("TypeError", "type MRO must not be empty");
    this.bounded(items.length <= CLASS_LIMITS.mro, "Class MRO budget exceeded.");
    const layout = this.layoutFamily(type);
    for (const item of items) {
      this.charge(1);
      if (!this.isType(item)) this.fail("TypeError", "mro() returned a non-class");
      const family = this.layoutFamily(item);
      const solid = item.storage?.solid;
      if (family !== "object" && family !== layout || item !== type && solid instanceof ClassValue && solid.storage?.ownNames.length &&
          type.storage?.solid !== solid && !this.actualSubtype(type.storage.solid, solid))
        this.fail("TypeError", "mro() returned base with unsuitable layout");
    }
  }
  payload(value) { return value instanceof InstanceValue && value.nativePayload !== undefined ? value.nativePayload : value; }
  instance(type, nativePayload = undefined) {
    if (!(type instanceof ClassValue)) throw new TypeError("An adopted class is required.");
    this.touch(type); return this.make(InstanceValue, type, nativePayload);
  }
  hasSlot(type, name) {
    // The bounded MRO is also the native slot-presence index. Default calls keep
    // their original lookup/accounting path; only adopted overrides add phases.
    return this.mro(type).some(base => base instanceof ClassValue && !base.root && (base.namespace.has(name) || base.protocolNames?.includes(name)));
  }
  isType(value) { return value instanceof ClassValue || value?.constructor === BuiltinValue && NATIVE_TYPES.has(value.name); }
  isPythonMethod(value) { return value instanceof BoundMethodValue && (value.pythonMethod || !(value.callable instanceof BuiltinValue)); }
  isMetaclass(value) { return value instanceof ClassValue && value.typeLayout; }
  hasTypeNamespace(value) { return !value.metaclass || value.metaclass.mro.some(base => base instanceof BuiltinValue && base.name === "type"); }
  mro(type) {
    if (type instanceof ClassValue) return type.mro;
    if (!this.isType(type)) this.fail("TypeError", "An adopted type is required");
    const result = [type];
    let name = type.name;
    while (name === "bool" || EXCEPTIONS[name]) { name = name === "bool" ? "int" : EXCEPTIONS[name]; result.push(this.builtin(name)); }
    result.push(this.builtin("object")); return result;
  }
  primaryBase(type) {
    if (!(type instanceof ClassValue)) return this.mro(type)[1] ?? null;
    if (type.root) return null;
    // Only ordinary object and type-derived instance layouts are adopted.
    // A type-derived base supplies the native layout even after an ordinary base.
    for (const base of type.bases) {
      this.charge(1);
      if (base instanceof BuiltinValue && base.name === "type" || this.isMetaclass(base)) return base;
    }
    if (type.storage?.baseSolid) return type.bases.find(base => base === type.storage.baseSolid || base.storage?.solid === type.storage.baseSolid) ?? type.bases[0];
    return type.bases[0];
  }
  typeOf(value) {
    this.touch(value);
    if (this.isInstance(value)) return value.type;
    if (value instanceof ClassValue) return value.metaclass || this.builtin("type");
    let name = this.values.typeName(value);
    if (name === null) {
      if (this.isType(value)) name = "type";
      else if (value instanceof BuiltinValue) name = value.nativeKind || (NATIVE_METHOD_DESCRIPTORS.has(value.name) ? "method_descriptor" : nativeWrapper(value.name) ? "wrapper_descriptor" : "builtin_function_or_method");
      else if (value instanceof FunctionValue) name = "function";
      else if (value instanceof CodeValue) name = "code";
      else if (value instanceof FrameValue) name = "frame";
      else if (value instanceof BoundMethodValue) name = !value.pythonMethod && value.callable instanceof BuiltinValue ?
        NATIVE_METHOD_DESCRIPTORS.has(value.callable.name) || NATIVE_CLASS_METHODS.has(value.callable.name) || ["method_descriptor", "classmethod_descriptor", "builtin_function_or_method"].includes(value.callable.nativeKind) ? "builtin_function_or_method" : "method-wrapper" : "method";
      else if (value instanceof PropertyValue) name = "property";
      else if (value instanceof MethodWrapperValue) name = value.kind;
      else if (value instanceof SuperValue) name = "super";
      else if (value instanceof GeneratorValue) name = "generator";
      else if (value instanceof ModuleValue) name = "module";
      else if (value instanceof Cell) name = "cell";
      else if (value instanceof NotImplementedValue) name = "NotImplementedType";
      else if (value instanceof ProtocolIteratorValue) name = value.kind === "callable" ? "callable_iterator" : "iterator";
      else if (Object.hasOwn(EXCEPTIONS, value?.name)) name = value.name;
    }
    if (name === null || name === undefined) this.fail("UnsupportedOperationError", "This reflective value type requires a separate stage", "UNSUPPORTED");
    return this.builtin(name);
  }
  classAttribute(value) {
    return this.typeOf(value);
  }
  needsAdvertised(value) {
    return this.protocolObject(value) && this.hasSlot(this.checkingType(value), "__class__") ||
      ["__getattribute__", "__getattr__"].some(name => this.hasAttributeHook(value, name));
  }
  isInstance(value) { return value instanceof InstanceValue || value instanceof ModuleValue && value.type instanceof ClassValue; }
  nativeModule(value) { return value instanceof ModuleValue ? value : value?.nativePayload instanceof ModuleValue ? value.nativePayload : null; }
  protocolObject(value) { return this.isInstance(value) || value instanceof ClassValue && value.metaclass !== null; }
  checkingType(value) {
    return value instanceof ClassValue ? value.metaclass : this.isInstance(value) ? value.type : null;
  }
  hasAttributeHook(value, name) {
    const type = this.checkingType(value);
    return type !== null && this.hasSlot(type, name);
  }
  customCheck(value, name) {
    const type = this.checkingType(value);
    return type !== null && this.hasSlot(type, name);
  }
  bindCheck(value, name) {
    const type = this.checkingType(value), item = this.lookup(type, name);
    return this.bindAttribute(item.value, value, type);
  }
  lookupMayCallback(receiver) {
    const types = receiver instanceof ClassValue ? [receiver, receiver.metaclass] : this.isInstance(receiver) ? [receiver.type] : [];
    const proxy = receiver instanceof SuperValue ? receiver : receiver?.nativePayload;
    if (proxy instanceof SuperValue && proxy.selfClass !== null) types.push(proxy.selfClass);
    const seen = new Set();
    while (types.length) {
      const type = types.pop(); if (!type || seen.has(type)) continue; seen.add(type);
      for (const base of this.mro(type)) {
        if (base.namespaceDictionary?.ownedKeys || base.namespaceEntries?.some(entry => this.values.needsOwnedHash(entry.key))) return true;
        for (const value of base.namespace?.values() || []) if (value instanceof InstanceValue) { this.charge(1); types.push(value.type); }
      }
    }
    return false;
  }
  ownNamespaceEntry(owner, name, phase = 0) {
    const dictionary = owner.namespaceDictionary;
    if (!dictionary) return {found: owner.namespace.has(name), value: owner.namespace.get(name) ?? null};
    if (this.values.callbackKeyMayMatch(dictionary, name)) {
      const cached = this.lookupCache?.entries.find(entry => entry.owner === owner && entry.name === name && entry.phase === phase && entry.version === dictionary.version);
      if (!cached) throw new NamespaceLookupRequest(owner, name, dictionary, phase);
      const entry = cached.found ? dictionary.entries.find(entry => entry.key === cached.key) : null;
      return {found: !!entry, value: entry?.value ?? null, key: entry?.key};
    }
    if (phase === -1 && owner instanceof ClassValue && !owner.root) {
      if (owner.namespace.has(name) && !["__qualname__", "__classcell__", "__classdictcell__"].includes(name)) return {found: true, value: owner.namespace.get(name)};
      if (!["__dict__", "__weakref__", "__doc__", "__module__", "__firstlineno__", "__static_attributes__"].includes(name)) return {found: false, value: null};
    }
    const entry = dictionary.entries.find(entry => this.values.text(entry.key) === name);
    return {found: !!entry, value: entry?.value ?? null, key: entry?.key};
  }
  lookup(type, name, native = true, start = 0) {
    this.key(name); this.touch(type);
    if (!this.isType(type)) throw new TypeError("An adopted class is required.");
    for (const base of this.mro(type).slice(start)) {
      this.charge(1);
      if (base instanceof BuiltinValue) {
        if (native && (NATIVE_DESCRIPTOR_WRAPPERS.has(base.name + "." + name) || NATIVE_PROPERTY_METHODS.has(base.name + "." + name) || base.name === "mappingproxy" && name === "get" || NATIVE_BINDING_WRAPPERS.has(base.name + "." + name)))
          return {found: true, value: this.builtin(base.name + "." + name)};
        if (native && base.name === "type" && ["__prepare__", "__new__", "__init__", "__call__", "__instancecheck__", "__subclasscheck__", "__getattribute__", "__setattr__", "__delattr__", "mro", "__subclasses__", "__dir__"].includes(name))
          return {found: true, value: this.builtin("type." + name)};
        if (native && NATIVE_SUBCLASS_BASES.includes(base.name)) {
          const item = this.nativeEntry(base, name); if (item.found) return item;
        }
        continue;
      }
      if (!native && base.root && ["__new__", "__init__", "__getattribute__", "__setattr__", "__delattr__"].includes(name)) continue;
      if (base.root) { if (base.namespace.has(name)) return {found: true, value: base.namespace.get(name)}; }
      else {
        if (base.namespaceEntries?.some(entry => this.values.needsOwnedHash(entry.key)) ||
            ["__firstlineno__", "__static_attributes__"].includes(name) && !base.namespaceDictionary) this.namespaceDictionary(base);
        const own = this.ownNamespaceEntry(base, name, -1);
        if (own.found) return own;
      }
      if (name === "__doc__" && !base.root) return {found: true, value: null};
      if (native && base.root && name === "__init_subclass__") {
        const value = this.make(MethodWrapperValue, "classmethod", this.builtin("object.__init_subclass__"));
        base.namespace.set(name, value);
        try { const layout = valueLayout(base); this.memory?.resize(base, layout.bytes, layout.children); }
        catch (error) { base.namespace.delete(name); throw error; }
        return {found: true, value};
      }
      if (native && base.root && ["__dir__", "__hash__", "__new__", "__init__", "__getattribute__", "__setattr__", "__delattr__"].includes(name)) {
        const value = this.builtin("object." + name);
        base.namespace.set(name, value);
        try { const layout = valueLayout(base); this.memory?.resize(base, layout.bytes, layout.children); }
        catch (error) { base.namespace.delete(name); throw error; }
        return {found: true, value};
      }
    }
    return {found: false, value: null};
  }
  descriptor(value) {
    if (value instanceof BuiltinValue && ["getset_descriptor", "member_descriptor"].includes(value.nativeKind))
      return {get: {found: true, value: this.builtin(value.nativeKind + ".__get__")}, set: {found: true, value: this.builtin(value.nativeKind + ".__set__")}, delete: {found: true, value: this.builtin(value.nativeKind + ".__delete__")}};
    if (!this.protocolObject(value)) return null;
    const type = this.checkingType(value);
    return {get: this.lookup(type, "__get__"), set: this.lookup(type, "__set__"),
      delete: this.lookup(type, "__delete__")};
  }
  boundHook(receiver, name, args) {
    if (receiver instanceof BuiltinValue && ["getset_descriptor", "member_descriptor"].includes(receiver.nativeKind) && ["__get__", "__set__", "__delete__"].includes(name))
      return {kind: "call", callable: this.builtin(receiver.nativeKind + "." + name), args: [receiver, ...args]};
    if (!this.protocolObject(receiver)) return null;
    const hook = this.lookup(this.checkingType(receiver), name);
    if (!hook.found) return null;
    if (hook.value instanceof MethodWrapperValue) return {kind: "call",
      callable: hook.value.kind === "classmethod" ? this.make(BoundMethodValue, hook.value.callable, this.checkingType(receiver), !NATIVE_CLASS_METHODS.has(hook.value.callable?.name)) : hook.value.callable, args};
    if (hook.value instanceof BuiltinValue && this.nativeDescriptorKind(hook.value)) {
      const plan = this.bindAttribute(hook.value, receiver, this.checkingType(receiver));
      return plan.kind === "value" ? {kind: "call", callable: plan.value, args} : {kind: "bind-call", callable: plan.callable, args: plan.args, invokeArgs: args};
    }
    if (hook.value instanceof FunctionValue) return {kind: "call", callable: hook.value, args: [receiver, ...args]};
    if (hook.value instanceof PropertyValue || this.descriptor(hook.value)?.get.found) {
      const plan = this.bindAttribute(hook.value, receiver, this.checkingType(receiver));
      return {kind: "bind-call", callable: plan.callable, args: plan.args, invokeArgs: args};
    }
    return {kind: "call", callable: hook.value, args};
  }
  notification(receiver, owner, name) {
    if (receiver instanceof PropertyValue) { this.mutate(receiver, "__name__", name); return null; }
    return this.boundHook(receiver, "__set_name__", [owner, name]);
  }
  subclassNotification(type, required = false) {
    // Default construction retains the established allocation/work accounting.
    // The new class's own hook is excluded, just as with super(newclass, newclass).
    if (type.customMro && !type.mro.includes(type)) this.fail("TypeError", "super receiver is not a subtype of its class");
    if (!required && !type.customMro && !type.mro.slice(1).some(base => base instanceof ClassValue && !base.root && (base.namespace.has("__init_subclass__") || this.values.callbackKeyMayMatch(base.namespaceDictionary || {ownedKeys: false}, "__init_subclass__")))) return null;
    const item = this.lookup(type, "__init_subclass__", true, type.mro.indexOf(type) + 1);
    if (!item.found) return null;
    return this.bindAttribute(item.value, null, type);
  }
  read(receiver, name, native = false, key = null) {
    this.key(name); this.touch(receiver);
    const value = value => ({kind: "value", value});
    if (["__dict__", "__bases__"].includes(name) && !this.isType(receiver) &&
        !(this.isInstance(receiver) || receiver instanceof FunctionValue || receiver instanceof MethodWrapperValue || receiver instanceof SuperValue || this.isPythonMethod(receiver)))
      this.fail("AttributeError", "Object has no attribute " + name);
    if (this.values.typeName(receiver) !== null) {
      if (name === "__doc__") return value(this.nativeDocumentation(this.typeOf(receiver)));
      if (["__module__", "__name__", "__qualname__"].includes(name)) this.fail("AttributeError", "Value has no callable metadata");
    }
    if (!native && receiver instanceof InstanceValue && receiver.nativePayload instanceof SuperValue && name !== "__class__") {
      const payload = receiver.nativePayload;
      if (payload.selfClass !== null) {
        const item = this.lookup(payload.selfClass, name, true, this.mro(payload.selfClass).indexOf(payload.thisclass) + 1);
        if (item.found) return this.bindAttribute(item.value, payload.self === payload.selfClass ? null : payload.self, payload.selfClass);
      }
    }
    if (receiver instanceof SuperValue) {
      if (name === "__class__") return value(this.builtin("super"));
      if (["__thisclass__", "__self__", "__self_class__"].includes(name))
        return value(receiver[{__thisclass__: "thisclass", __self__: "self", __self_class__: "selfClass"}[name]]);
      if (receiver.selfClass !== null) {
        const item = this.lookup(receiver.selfClass, name, true, this.mro(receiver.selfClass).indexOf(receiver.thisclass) + 1);
        if (item.found) return this.bindAttribute(item.value, receiver.self === receiver.selfClass ? null : receiver.self, receiver.selfClass);
      }
      if (name === "__dir__") return value(this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver));
      this.fail("AttributeError", "super has no attribute '" + name + "'.");
    }
    if (name === "__dir__" && receiver instanceof MethodWrapperValue) return this.functionEntry(receiver, name, "get", null, key);
    if (name === "__dir__" && this.hasFixedDirectory(receiver))
      return value(this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver));
    if (receiver instanceof BuiltinValue) {
      if (name === "__qualname__" && (receiver instanceof AppendValue || receiver instanceof ValueMethod)) return value(this.values.string(Array.from(this.typeOf(receiver.receiver).name + "." + receiver.name, char => char.codePointAt(0))));
      if (name === "__module__" && !this.isType(receiver) && !this.nativeDescriptorKind(receiver)) return value(receiver instanceof AppendValue || receiver instanceof ValueMethod ? null : this.values.string(Array.from("builtins", char => char.codePointAt(0))));
      if (receiver.nativeKind) {
        if (name === "__doc__") return value(this.callableDocumentation(receiver));
        if (name === "__class__") return value(this.builtin(receiver.nativeKind));
        if (name === "__objclass__" && NAMESPACE_DESCRIPTOR_KINDS.has(receiver.nativeKind)) return value(receiver.nativeOwner);
        if (name === "__self__" && receiver.nativeKind === "builtin_function_or_method") return value(receiver.nativeOwner ?? null);
        if (name === "__qualname__" && receiver.nativeOwner instanceof ClassValue && !receiver.nativeOwner.root) {
          return receiver.qualifiedName === undefined ? {kind: "call", callable: this.builtin("descriptor-qualification"), args: [receiver]} : value(receiver.qualifiedName);
        }
        if (["__name__", "__qualname__"].includes(name)) return value(this.values.string(Array.from(name === "__name__" ? receiver.nativeKey : receiver.name, char => char.codePointAt(0))));
        if (["__get__", "__set__", "__delete__"].includes(name) && NAMESPACE_DESCRIPTOR_KINDS.has(receiver.nativeKind)) {
          if (name !== "__get__" && !["getset_descriptor", "member_descriptor"].includes(receiver.nativeKind)) this.fail("AttributeError", "Descriptor has no mutation protocol");
          return value(this.make(BoundMethodValue, this.builtin(receiver.nativeKind + "." + name), receiver));
        }
      }
      if (this.isType(receiver) && name === "__dict__") { this.namespaceDictionary(receiver); return value(this.make(ClassNamespaceValue, receiver)); }
      if (name === "__dict__" && this.isType(receiver))
        this.fail("UnsupportedOperationError", "Native type dictionaries require their own layout contract.", "UNSUPPORTED");
      if (name === "__doc__") { if (this.isType(receiver)) return value(this.nativeDocumentation(receiver)); return value(this.callableDocumentation(receiver)); }
      if (name === "__class__") return value(this.typeOf(receiver));
      if (name === "__objclass__" && this.nativeDescriptorKind(receiver))
        return value(this.builtin(receiver.name.slice(0, receiver.name.indexOf("."))));
      if (name === "__get__" && NATIVE_METHOD_DESCRIPTORS.has(receiver.name))
        return value(this.make(BoundMethodValue, this.builtin("method_descriptor.__get__"), receiver));
      if (name === "__get__" && nativeWrapper(receiver.name))
        return value(this.make(BoundMethodValue, this.builtin("wrapper_descriptor.__get__"), receiver));
      if (["__name__", "__qualname__"].includes(name)) return value(this.values.string(Array.from(
        name === "__name__" && (NATIVE_METHOD_DESCRIPTORS.has(receiver.name) || nativeWrapper(receiver.name)) ? receiver.name.slice(receiver.name.lastIndexOf(".") + 1) : receiver.name, char => char.codePointAt(0))));
      if (this.isType(receiver)) {
        if (name === "__doc__") return value(this.nativeDocumentation(receiver));
        const metaField = NATIVE_NAMESPACES.type.find(entry => entry[0] === name && ["getset_descriptor", "member_descriptor"].includes(entry[1]));
        if (metaField && !["__dict__", "__name__", "__qualname__", "__module__", "__mro__", "__base__", "__bases__"].includes(name))
          return {kind: "call", callable: this.builtin("namespace-getset"), args: [this.namespaceDictionary(this.builtin("type")).entries.find(entry => this.values.text(entry.key) === name).value, receiver]};
        if (name === "__subclasses__" && this.isType(receiver)) return value(receiver.name === "type" ? this.builtin("type.__subclasses__") : this.make(BoundMethodValue, this.builtin("type.__subclasses__"), receiver));
        if (receiver.name !== "type" && ["__instancecheck__", "__subclasscheck__", "mro"].includes(name))
          return this.bindAttribute(this.builtin("type." + name), receiver, this.builtin("type"));
        if (name === "__module__") return value(this.values.string(Array.from("builtins", char => char.codePointAt(0))));
        if (name === "__mro__") return value(this.values.tuple(this.mro(receiver)));
        if (name === "__base__") return value(this.primaryBase(receiver));
        if (name === "__bases__") return value(this.values.tuple([this.mro(receiver)[1]]));
        if (receiver.name === "module" && name === "__dir__") return this.bindAttribute(this.namespaceDescriptor(receiver, name, "method_descriptor"), null, receiver);
        let item = this.lookup(receiver, name);
        if (!item.found) item = this.nativeEntry(receiver, name);
        if (item.found) return this.bindAttribute(item.value, null, receiver);
      }
      this.fail("AttributeError", "Builtin has no adopted attribute '" + name + "'.");
    }
    if (receiver instanceof PropertyValue) {
      if (["__module__", "__qualname__"].includes(name)) this.fail("AttributeError", "Property has no callable metadata");
      if (name === "__dir__") return value(this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver));
      if (name === "__class__") return value(this.builtin("property"));
      if (name === "__doc__") {
        if (receiver.documentation === undefined && receiver.fget !== null)
          this.fail("UnsupportedOperationError", "Native getter documentation requires its own metadata contract.", "UNSUPPORTED");
        return value(receiver.documentation ?? null);
      }
      if (name === "__isabstractmethod__") return {kind: "call", callable: this.builtin("descriptor-abstract"), args: [receiver]};
      if (name === "__name__") return receiver.propertyName !== undefined ? value(receiver.propertyName) :
        {kind: "call", callable: this.builtin("property-name"), args: [receiver]};
      if (NATIVE_DESCRIPTOR_WRAPPERS.has("property." + name))
        return value(this.make(BoundMethodValue, this.builtin("property." + name), receiver));
      if (["fget", "fset", "fdel"].includes(name)) return value(receiver[name]);
      if (NATIVE_PROPERTY_METHODS.has("property." + name)) return value(this.make(BoundMethodValue, this.builtin("property." + name), receiver));
      this.fail("UnsupportedOperationError", "Property reflection is outside the adopted profile.", "UNSUPPORTED");
    }
    if (receiver instanceof MethodWrapperValue) {
      if (name === "__class__") return value(this.builtin(receiver.kind));
      if (name === "__isabstractmethod__") return {kind: "call", callable: this.builtin("descriptor-abstract"), args: [receiver]};
      if (name === "__get__") return value(this.make(BoundMethodValue, this.builtin(receiver.kind + ".__get__"), receiver));
      if (["__func__", "__wrapped__"].includes(name)) return value(receiver.callable);
      if (name === "__dict__") return value(this.functionDictionary(receiver));
      return this.functionEntry(receiver, name, "get", null, key);
    }
    if (receiver instanceof BoundMethodValue && !this.isPythonMethod(receiver) && name === "__func__") this.fail("AttributeError", "Native methods have no __func__ attribute");
    if (receiver instanceof BoundMethodValue && receiver.callable instanceof BuiltinValue && receiver.callable.name === "object.__dir__" && ["__name__", "__qualname__"].includes(name)) {
      const type = this.typeOf(receiver.receiver);
      return value(this.values.string(Array.from((name === "__qualname__" ? (type.qualname ?? type.name) + "." : "") + "__dir__", char => char.codePointAt(0))));
    }
    if (receiver instanceof BoundMethodValue && receiver.callable instanceof BuiltinValue && receiver.callable.name === "mappingproxy.get" && ["__name__", "__qualname__"].includes(name))
      return this.read(receiver.callable, name);
    if (receiver instanceof BoundMethodValue && name === "__isabstractmethod__") {
      if (native && this.isPythonMethod(receiver)) this.fail("AttributeError", "Method marker requires ordinary callable fallback.");
      return {kind: "call", callable: this.builtin("method-abstract-marker"), args: [receiver]};
    }
    if (receiver instanceof BoundMethodValue && name === "__doc__")
      return {kind: "call", callable: this.builtin("method-documentation"), args: [receiver]};
    if (this.isPythonMethod(receiver)) {
      if (name === "__class__") return value(this.builtin("method"));
      if (name === "__dir__") return value(this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver));
      if (["__name__", "__qualname__", "__module__"].includes(name)) {
        if (native) this.fail("AttributeError", "Method metadata requires ordinary callable fallback.");
        return {kind: "call", callable: this.builtin("method-" + name.slice(2, -2)), args: [receiver]};
      }
    }
    if (name === "__objclass__" && receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue) {
      if (nativeWrapper(receiver.callable.name))
        return value(this.builtin(receiver.callable.name.slice(0, receiver.callable.name.indexOf("."))));
      if (NATIVE_METHOD_DESCRIPTORS.has(receiver.callable.name))
        this.fail("AttributeError", "Native methods have no __objclass__ attribute.");
    }
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && name === "__func__" && receiver.callable instanceof BuiltinValue &&
        (NATIVE_METHOD_DESCRIPTORS.has(receiver.callable.name) || NATIVE_CLASS_METHODS.has(receiver.callable.name) || nativeWrapper(receiver.callable.name)))
      this.fail("AttributeError", "Native methods have no __func__ attribute.");
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && name === "__class__" && receiver.callable instanceof BuiltinValue && nativeWrapper(receiver.callable.name))
      return value(this.builtin("method-wrapper"));
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue && nativeWrapper(receiver.callable.name) && ["__name__", "__qualname__"].includes(name))
      return value(this.values.string(Array.from(name === "__name__" ? receiver.callable.name.slice(receiver.callable.name.lastIndexOf(".") + 1) : receiver.callable.name, char => char.codePointAt(0))));
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue && NATIVE_CLASS_METHODS.has(receiver.callable.name) && ["__name__", "__qualname__"].includes(name))
      return value(this.values.string(Array.from((name === "__qualname__" ? (receiver.receiver.qualname ?? receiver.receiver.name) + "." : "") + "__init_subclass__", char => char.codePointAt(0))));
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue &&
        (NATIVE_CHECK_METHODS.has(receiver.callable.name) || ["type.mro", "type.__dir__"].includes(receiver.callable.name)) && name === "__qualname__" && this.hasAttributeHook(receiver.receiver, "__getattribute__"))
      return {kind: "call", callable: this.builtin("native-method-qualname"), args: [receiver]};
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue && (NATIVE_CHECK_METHODS.has(receiver.callable.name) || ["type.mro", "type.__dir__"].includes(receiver.callable.name)) && ["__name__", "__qualname__"].includes(name))
      return value(this.values.string(Array.from((name === "__qualname__" ? (receiver.receiver.qualname ?? receiver.receiver.name) + "." : "") + receiver.callable.name.slice("type.".length), char => char.codePointAt(0))));
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue && NATIVE_PROPERTY_METHODS.has(receiver.callable.name)) {
      if (name === "__class__") return value(this.typeOf(receiver));
      if (["__name__", "__qualname__"].includes(name)) return this.read(receiver.callable, name);
    }
    if (receiver instanceof BoundMethodValue && ["__self__", "__func__"].includes(name))
      return value(name === "__self__" ? receiver.receiver : receiver.callable);
    if (this.isPythonMethod(receiver)) {
      if (FUNCTION_DEFERRED_METHODS.has(name) || name === "__get__")
        this.fail("UnsupportedOperationError", "Native method reflection requires its own contract.", "UNSUPPORTED");
      if (native) this.fail("AttributeError", "Method has no native attribute '" + name + "'.");
      return {kind: "call", callable: this.builtin("method-attribute"),
        args: [receiver, key ?? this.values.string(Array.from(name, char => char.codePointAt(0)))]};
    }
    if (receiver instanceof FunctionValue && name === "__class__") return value(this.builtin("function"));
    if (receiver instanceof GeneratorValue) {
      if (name === "__class__") return value(this.builtin("generator"));
      if (name === "__doc__") return value(this.nativeDocumentation(this.builtin("generator")));
      if (["__name__", "__qualname__"].includes(name)) {
        const field = name === "__name__" ? "identityName" : "identityQualname";
        if (receiver[field] === undefined) this.functionMetadata(receiver, field, this.values.string(Array.from(receiver.pool.code.functions[receiver.index][name === "__name__" ? "name" : "qualname"], char => char.codePointAt(0))));
        return value(receiver[field]);
      }
      if (name === "gi_code") return value(this.codeObject(receiver.pool, receiver.index));
      if (name === "gi_frame") return {kind: "call", callable: this.builtin("generator-frame"), args: [receiver]};
      if (name === "gi_running") return value(receiver.status === "running");
      if (name === "gi_suspended") return value(receiver.status === "suspended");
      if (name === "gi_yieldfrom") return value(receiver.frame?.tasks.find(task => task.type === "delegate")?.iterator ?? null);
      if (["send", "throw", "close", "__iter__", "__next__"].includes(name)) return value(this.make(ValueMethod, receiver, name));
      if (name !== "__dir__") this.fail("AttributeError", "Generator has no attribute " + name);
    }
    if (receiver instanceof FrameValue) {
      if (name === "__class__") return value(this.builtin("frame"));
      if (name === "__doc__") return value(this.nativeDocumentation(this.builtin("frame")));
      if (name === "f_code") return value(this.codeObject(receiver.pool, receiver.index));
      if (name === "f_back") return value(receiver.back);
      if (name === "f_globals") return value(this.values.environmentDictionary(receiver.callable.globals));
      if (name === "f_builtins") return {kind: "call", callable: this.builtin("function-builtins"), args: [receiver.callable]};
      if (name === "f_locals") return {kind: "call", callable: this.builtin("frame-locals"), args: [receiver]};
      if (name === "f_lineno") return value(this.values.int(BigInt((receiver.raw.inlineFrames?.at(-1)?.currentSite ?? receiver.raw.currentSite)?.span[0] ?? receiver.pool.code.functions[receiver.index].firstLine ?? 1)));
      if (name === "f_trace") return value(null);
      if (!NATIVE_NAMESPACES.frame.some(entry => entry[0] === name)) this.fail("AttributeError", "Frame has no attribute " + name);
      this.fail("UnsupportedOperationError", "Frame field " + name + " is outside the finite source-frame interface; tracing, jumping and bytecode positions are separate", "UNSUPPORTED");
    }
    if (receiver instanceof FrameLocalsValue) {
      if (name === "__class__") return value(this.builtin("FrameLocalsProxy"));
      const entry = this.nativeEntry(this.builtin("FrameLocalsProxy"), name);
      if (entry.found) return this.bindAttribute(entry.value, receiver, this.builtin("FrameLocalsProxy"));
      this.fail("AttributeError", "Frame locals proxy has no attribute " + name);
    }
    if (receiver instanceof Cell) {
      if (name === "__class__") return value(this.builtin("cell"));
      if (name === "cell_contents") {
        if (!receiver.bound) this.fail("ValueError", "Cell is empty");
        return value(receiver.value);
      }
      if (name === "__doc__") return value(this.nativeDocumentation(this.builtin("cell")));
      this.fail("UnsupportedOperationError", "Additional cell protocols retain O78/O90", "UNSUPPORTED");
    }
    if (receiver instanceof CodeValue) {
      if (name === "__class__") return value(this.builtin("code"));
      if (name === "__doc__") return value(this.nativeDocumentation(this.builtin("code")));
      return value(this.codeMetadata(receiver, name));
    }
    if (receiver instanceof FunctionValue && name === "__code__") return value(this.codeObject(receiver.pool, receiver.index));
    if (receiver instanceof FunctionValue && name === "__closure__") {
      if (receiver.closureTuple === undefined) this.functionMetadata(receiver, "closureTuple", receiver.closure.size ? this.values.tuple([...receiver.closure.values()]) : null);
      return value(receiver.closureTuple);
    }
    if (receiver instanceof FunctionValue && name === "__globals__") return value(this.values.environmentDictionary(receiver.globals));
    if (receiver instanceof FunctionValue && name === "__builtins__") return {kind: "call", callable: this.builtin("function-builtins"), args: [receiver]};
    if (receiver instanceof FunctionValue && ["__defaults__", "__kwdefaults__"].includes(name)) return value(this.functionDefaults(receiver, name));
    if (receiver instanceof FunctionValue && name === "__dict__") return value(this.functionDictionary(receiver));
    if (receiver instanceof FunctionValue && !FUNCTION_DATA.has(name)) return this.functionEntry(receiver, name, "get", null, key);
    if (receiver instanceof FunctionValue && name === "__doc__") return value(receiver.documentation);
    if (receiver instanceof FunctionValue && name === "__module__") return value(receiver.identityModule ?? null);
    if (receiver instanceof FunctionValue && ["__name__", "__qualname__"].includes(name)) {
      const field = name === "__name__" ? "identityName" : "identityQualname";
      if (receiver[field] === undefined) {
        const fn = receiver.pool.code.functions[receiver.index];
        const text = this.values.string(Array.from(name === "__name__" ? fn.name : fn.qualname, char => char.codePointAt(0)));
        this.functionMetadata(receiver, field, text);
      }
      return value(receiver[field]);
    }
    if (receiver instanceof ClassNamespaceValue) {
      if (name === "__dir__") return value(this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver));
      if (name === "__class__") return value(this.builtin("mappingproxy"));
      const entry = this.nativeEntry(this.builtin("mappingproxy"), name);
      if (entry.found) return this.bindAttribute(entry.value, receiver, this.builtin("mappingproxy"));
      this.fail("AttributeError", "Class namespace view has no attribute '" + name + "'.");
    }
    if (receiver instanceof DictionaryViewValue) {
      if (name === "__class__") return value(this.typeOf(receiver));
      const entry = this.nativeEntry(this.typeOf(receiver), name);
      if (entry.found) return this.bindAttribute(entry.value, receiver, this.typeOf(receiver));
      this.fail("AttributeError", "Dictionary view has no attribute " + name);
    }
    if (!(receiver instanceof ClassValue || this.isInstance(receiver)))
      this.fail("UnsupportedOperationError", "Attribute receiver is outside the class profile.", "UNSUPPORTED");
    if (name === "__doc__" && receiver instanceof ClassValue && receiver.root) return value(this.nativeDocumentation(receiver));
    if (name === "__dict__" && this.isInstance(receiver) && this.instanceDictionarySlot(receiver.type))
      return value(this.instanceDictionary(receiver));
    if (this.isInstance(receiver) && name === "__class__") {
      const item = this.lookup(receiver.type, name);
      return item.found ? this.bindAttribute(item.value, receiver, receiver.type) : value(this.classAttribute(receiver));
    }
    if (!allowsClassSpecial(name, "attribute") && !["__class__", "__name__", "__qualname__", "__module__", "__bases__", "__base__", "__mro__"].includes(name)) this.fail("UnsupportedOperationError", "This special attribute is outside classes-source/1.", "UNSUPPORTED");
    const owner = receiver instanceof ClassValue ? receiver : receiver.type;
    const metaclass = receiver instanceof ClassValue ? receiver.metaclass || (["__instancecheck__", "__subclasscheck__", "mro", "__subclasses__"].includes(name) ? this.builtin("type") : null) : null;
    const metaItem = metaclass ? this.lookup(metaclass, name) : null;
    const metaDescriptor = metaItem?.found ? this.descriptor(metaItem.value) : null;
    if (metaItem?.value instanceof PropertyValue || metaDescriptor?.get.found && (metaDescriptor.set.found || metaDescriptor.delete.found))
      return this.bindAttribute(metaItem.value, receiver, metaclass);
    if (receiver instanceof ClassValue && !this.hasTypeNamespace(receiver) &&
        ["__dict__", "__name__", "__qualname__", "__module__", "__mro__", "__bases__", "__base__"].includes(name)) {
      this.namespaceDictionary(receiver);
      const item = this.lookup(receiver, name);
      if (item.found) return this.bindAttribute(item.value, null, receiver);
      if (metaItem?.found) return this.bindAttribute(metaItem.value, receiver, metaclass);
      this.fail("AttributeError", "Class has no attribute '" + name + "'.");
    }
    if (receiver instanceof ClassValue) {
      if (name === "__dict__") {
        if (metaItem?.found) {
          for (const base of this.mro(receiver)) {
            this.namespaceDictionary(base);
            const entry = this.ownNamespaceEntry(base, name);
            if (entry.found) return this.bindAttribute(entry.value, null, receiver);
          }
          return this.bindAttribute(metaItem.value, receiver, metaclass);
        }
        this.namespaceDictionary(receiver);
        return value(this.make(ClassNamespaceValue, receiver));
      }
      if (name === "__class__") return value(receiver.metaclass || this.builtin("type"));
      if (name === "__doc__") { this.namespaceDictionary(receiver); return this.bindAttribute(this.ownNamespaceEntry(receiver, name).value, null, receiver); }
      if (name === "__module__") {
        if (!receiver.namespaceDictionary && !receiver.namespaceEntries?.some(entry => this.values.needsOwnedHash(entry.key)) && !receiver.namespace.has(name)) return value(this.values.string(Array.from(receiver.module, char => char.codePointAt(0))));
        if (!receiver.namespaceDictionary && receiver.namespaceEntries?.some(entry => this.values.needsOwnedHash(entry.key))) this.namespaceDictionary(receiver);
        const own = this.ownNamespaceEntry(receiver, name);
        if (!own.found) this.fail("AttributeError", "Class has no __module__");
        return value(own.value);
      }
      if (["__name__", "__qualname__"].includes(name) && !(name === "__name__" && metaItem?.found)) return value(receiver[name === "__name__" ? "identityName" : "identityQualname"] ?? this.values.string(Array.from(
        receiver[{__name__: "name", __qualname__: "qualname", __module__: "module"}[name]], char => char.codePointAt(0))));
      if (["__bases__", "__mro__"].includes(name)) return value(name === "__mro__" && receiver.mroPending ? null : this.values.tuple(name === "__bases__" ? receiver.bases : receiver.mro));
      if (name === "__base__") return value(this.primaryBase(receiver));
    }
    let item = this.lookup(owner, name);
    if (!item.found) item = this.nativeEntry(owner, name);
    if (!item.found && this.isInstance(receiver) && name === "__weakref__") {
      this.materializeInstanceStorage(receiver.type);
      item = this.lookup(owner, name);
    }
    const descriptor = item.found ? this.descriptor(item.value) : null;
    if (name === "__dir__" && !item.found && !metaItem?.found)
      this.fail("UnsupportedOperationError", "Default directories require their own namespace contract.", "UNSUPPORTED");
    if (this.isInstance(receiver) && (item.value instanceof PropertyValue ||
        descriptor?.get.found && (descriptor.set.found || descriptor.delete.found)))
      return this.bindAttribute(item.value, receiver, owner);
    if (this.isInstance(receiver)) return this.instanceEntry(receiver, name, "get", null, key, {...item, skipNative: native});
    if (!item.found) {
      if (metaItem?.found) return this.bindAttribute(metaItem.value, receiver, metaclass);
      this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    }
    return this.bindAttribute(item.value, receiver instanceof ClassValue ? null : receiver, owner);
  }
  bindAttribute(value, receiver, owner) {
    if (value instanceof BuiltinValue && NAMESPACE_DESCRIPTOR_KINDS.has(value.nativeKind)) return this.bindNamespaceDescriptor(value, receiver, owner);
    if (value instanceof BuiltinValue && value.name === "type.__dir__" && receiver !== null)
      return {kind: "value", value: this.bindNativeDescriptor("method_descriptor", value, receiver)};

    if (receiver !== null && value instanceof BuiltinValue && NATIVE_BINDING_WRAPPERS.has(value.name) &&
        this.nativeDescriptorKind(receiver) !== value.name.slice(0, value.name.indexOf(".")))
      this.fail("TypeError", "Native descriptor binding requires a matching descriptor receiver.");
    if (receiver !== null && value instanceof BuiltinValue && NATIVE_PROPERTY_METHODS.has(value.name) && !(this.payload(receiver) instanceof PropertyValue))
      this.fail("TypeError", "Native property copy requires a property receiver.");
    if (receiver !== null && value instanceof BuiltinValue && NATIVE_DESCRIPTOR_WRAPPERS.has(value.name)) {
      const kind = value.name.slice(0, value.name.indexOf("."));
      if (kind === "function" ? !(receiver instanceof FunctionValue) : kind === "property" ? !(this.payload(receiver) instanceof PropertyValue) : !(this.payload(receiver) instanceof MethodWrapperValue) || this.payload(receiver).kind !== kind)
        this.fail("TypeError", "Native descriptor requires a matching receiver.");
    }
    if (value instanceof SuperValue && value.self === null && receiver !== null) {
      if (this.needsAdvertised(receiver) && !(receiver instanceof ClassValue && this.subclass(receiver, value.thisclass)) && !this.subclass(this.typeOf(receiver), value.thisclass))
        return {kind: "call", callable: this.builtin("super"), args: [value.thisclass, receiver]};
      return {kind: "value", value: this.superProxy(value.thisclass, receiver)};
    }
    if (receiver !== null && value instanceof PropertyValue) {
      if (value.fget === null) this.missingPropertyAccessor(value, "getter");
      return {kind: "call", callable: value.fget, args: [receiver]};
    }
    const descriptor = this.descriptor(value);
    if (descriptor?.get.found) return {kind: "call", callable: descriptor.get.value, args: [value, receiver, owner]};
    if (value instanceof MethodWrapperValue) return {kind: "value", value: value.kind === "staticmethod" ?
      value.callable : this.make(BoundMethodValue, value.callable, owner, !NATIVE_CLASS_METHODS.has(value.callable?.name))};
    return {kind: "value", value: receiver !== null && (value instanceof FunctionValue ||
      value instanceof BuiltinValue && (NATIVE_PROPERTY_METHODS.has(value.name) || NATIVE_DESCRIPTOR_WRAPPERS.has(value.name) || NATIVE_BINDING_WRAPPERS.has(value.name) || ["mappingproxy.get", "object.__dir__"].includes(value.name) || ["object.__hash__", "object.__init__", "object.__getattribute__", "object.__setattr__", "object.__delattr__", "type.__init__", "type.__call__", "type.__getattribute__", "type.__setattr__", "type.__delattr__", "type.__instancecheck__", "type.__subclasscheck__", "type.mro", "type.__subclasses__", "type.__dir__"].includes(value.name))) ? this.make(BoundMethodValue, value, receiver) : value};
  }
  nativeDescriptorKind(value) {
    return value instanceof BuiltinValue && NAMESPACE_DESCRIPTOR_KINDS.has(value.nativeKind) ? value.nativeKind : value instanceof BuiltinValue ? NATIVE_METHOD_DESCRIPTORS.has(value.name) ? "method_descriptor" :
      nativeWrapper(value.name) ? "wrapper_descriptor" : null : null;
  }
  bindNativeDescriptor(kind, descriptor, receiver) {
    if (this.nativeDescriptorKind(descriptor) !== kind)
      this.fail("TypeError", "Native descriptor binding requires a matching descriptor receiver.");
    if (receiver === null) return descriptor;
    this.touch(receiver);
    const layout = descriptor.name.slice(0, descriptor.name.indexOf("."));
    const valid = layout === "object" ? true : layout === "type" ? this.isType(receiver) : layout === "property" ? receiver instanceof PropertyValue :
      layout === "function" ? receiver instanceof FunctionValue : layout === "mappingproxy" ? receiver instanceof ClassNamespaceValue : ["staticmethod", "classmethod"].includes(layout) ?
        receiver instanceof MethodWrapperValue && receiver.kind === layout : this.nativeDescriptorKind(receiver) === layout;
    if (!valid)
      this.fail("TypeError", "Native descriptor does not apply to this receiver type.");
    return this.make(BoundMethodValue, descriptor, receiver);
  }
  special(receiver, name) {
    this.key(name); this.touch(receiver);
    if (!isSpecialName(name) || !allowsClassSpecial(name, "implicit"))
      this.fail("UnsupportedOperationError", "This implicit special protocol is outside classes-source/1.", "UNSUPPORTED");
    const type = this.checkingType(receiver);
    if (type === null) throw new TypeError("Implicit user protocols require a class or instance.");
    const present = this.hasSlot(type, name), callbacks = this.lookupMayCallback(receiver);
    if (!present && receiver.nativePayload !== undefined && name === "__str__" && !NATIVE_NAMESPACES[this.layoutFamily(type)]?.some(entry => entry[0] === name)) return this.special(receiver, "__repr__");
    if (!present && receiver.nativePayload === undefined && ["__eq__", "__ne__", "__repr__", "__str__"].includes(name)) return null;
    const start = !present && callbacks ? this.mro(type).findIndex(base => base instanceof BuiltinValue || base.root) : 0;
    const item = this.lookup(type, name, true, Math.max(start, 0));
    if (!item.found && present && callbacks) this.fail("AttributeError", "Type slot '" + name + "' is missing.");
    return item.found ? this.bindAttribute(item.value, receiver, type) : null;
  }

  get(receiver, name) {
    const result = this.read(receiver, name);
    if (result.kind !== "value") this.fail("UnsupportedOperationError", "Descriptor calls require VM execution frames.", "UNSUPPORTED");
    return result.value;
  }
  write(receiver, name, value, remove = false, key = null) {
    if (name === "__class__" && !this.protocolObject(receiver) && !(receiver instanceof ClassValue)) return {kind: "value", value: this.reassignClass(receiver, value, remove)};
    if (receiver instanceof GeneratorValue && ["__name__", "__qualname__"].includes(name)) {
      if (remove || !this.values.isString(value)) this.fail("TypeError", name + " must be a string");
      return {kind: "value", value: this.functionMetadata(receiver, name === "__name__" ? "identityName" : "identityQualname", value)};
    }
    if (receiver instanceof GeneratorValue || receiver instanceof FrameValue || receiver instanceof FrameLocalsValue)
      this.fail(receiver instanceof FrameValue && ["f_lineno", "f_trace"].includes(name) ? "UnsupportedOperationError" : "AttributeError", "Frame/generator metadata is read-only; tracing and jumping are separate", receiver instanceof FrameValue && ["f_lineno", "f_trace"].includes(name) ? "UNSUPPORTED" : "PYTHON");
    if (receiver instanceof Cell) {
      if (name !== "cell_contents") this.fail("AttributeError", "Cell attributes are read-only");
      const before = [receiver.bound, receiver.value]; receiver.bound = !remove; receiver.value = remove ? null : value;
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { [receiver.bound, receiver.value] = before; throw error; }
      return {kind: "value", value: null};
    }
    if (receiver instanceof CodeValue) this.fail(name === "__class__" ? "TypeError" : "AttributeError", "Code metadata is read-only");
    if (receiver instanceof BuiltinValue && !this.isType(receiver)) this.fail(name === "__class__" ? "TypeError" : "AttributeError", "Native callable/descriptor attributes are read-only");
    this.key(name); this.touch(receiver);
    if (name === "__dir__" && this.hasFixedDirectory(receiver) && !(receiver instanceof MethodWrapperValue)) this.fail("AttributeError", "Native directory attributes are read-only.");
    if (["__name__", "__qualname__", "__self__", "__objclass__"].includes(name) &&
        (receiver instanceof BuiltinValue && receiver.name === "type.__dir__" ||
         receiver instanceof BoundMethodValue && receiver.callable instanceof BuiltinValue && receiver.callable.name === "type.__dir__"))
      this.fail("AttributeError", "Native directory method metadata is read-only.");

    if (receiver instanceof ClassNamespaceValue || receiver instanceof DictionaryViewValue) this.fail("AttributeError", "Dictionary view attributes are read-only.");
    if (this.isPythonMethod(receiver)) {
      if (name === "__class__") this.fail("TypeError", "Method type cannot be changed.");
      this.fail("AttributeError", "Method attributes are read-only.");
    }
    if (receiver instanceof MethodWrapperValue) {
      if (["__func__", "__wrapped__", "__isabstractmethod__"].includes(name)) this.fail("AttributeError", "Wrapper storage is read-only");
      if (name === "__class__") this.fail("TypeError", "Wrapper type cannot be changed");
      if (name === "__dict__") {
        if (remove || !this.values.isDict(value)) this.fail("TypeError", "Wrapper __dict__ must be set to a dictionary");
        return {kind: "value", value: this.functionMetadata(receiver, "attributes", value)};
      }
      return this.functionEntry(receiver, name, remove ? "delete" : "set", value, key);
    }
    if (receiver instanceof FunctionValue && !FUNCTION_DATA.has(name)) return this.functionEntry(receiver, name, remove ? "delete" : "set", value, key);
    if (name === "__objclass__" && (this.nativeDescriptorKind(receiver) || receiver instanceof BoundMethodValue &&
        (receiver.pythonMethod || receiver.callable instanceof BuiltinValue &&
          (nativeWrapper(receiver.callable.name) || NATIVE_METHOD_DESCRIPTORS.has(receiver.callable.name)))))
      this.fail("AttributeError", "Native descriptor owner metadata is read-only.");
    if (receiver instanceof SuperValue) this.fail("AttributeError", "super attributes are read-only");
    if (this.isInstance(receiver) && receiver.type.root && name === "__dict__")
      this.fail("AttributeError", "Object instance has no dictionary.");
    if (this.isInstance(receiver) && name === "__dict__" && this.instanceDictionarySlot(receiver.type))
      return {kind: "value", value: this.mutate(receiver, name, value, remove, key)};
    if (this.isInstance(receiver) && name === "__weakref__") this.materializeInstanceStorage(receiver.type);
    if (this.isInstance(receiver) || receiver instanceof ClassValue && receiver.metaclass) {
      const item = this.lookup(this.isInstance(receiver) ? receiver.type : receiver.metaclass, name), descriptor = item.found ? this.descriptor(item.value) : null;
      if (item.value instanceof PropertyValue) {
        const callable = item.value[remove ? "fdel" : "fset"];
        if (callable === null) this.missingPropertyAccessor(item.value, remove ? "deleter" : "setter");
        return {kind: "call", callable, args: remove ? [receiver] : [receiver, value]};
      }
      if (descriptor && (descriptor.set.found || descriptor.delete.found)) {
        const hook = remove ? "__delete__" : "__set__";
        if (!descriptor[remove ? "delete" : "set"].found) this.fail("AttributeError", "Descriptor has no " + hook + " operation.");
        return this.boundHook(item.value, hook, remove ? [receiver] : [receiver, value]);
      }
    }
    if (name === "__class__") return {kind: "value", value: this.reassignClass(receiver, value, remove)};
    if (this.isInstance(receiver) && (!(receiver.attributes instanceof Map) || key !== null))
      return this.instanceEntry(receiver, name, remove ? "delete" : "set", value, key);
    if (receiver instanceof ClassValue && name === "__bases__") return {kind: "call", callable: this.builtin("assign-bases"), args: [receiver, value, remove]};
    return {kind: "value", value: this.mutate(receiver, name, value, remove, key)};
  }
  nativeInvocationOwner(callable) {
    const name = callable.name, owner = name.slice(0, name.indexOf(".")), key = name.slice(name.indexOf(".") + 1);
    if (["__repr__", "__str__", "__format__"].includes(key)) return "#127";
    if (["__reduce__", "__reduce_ex__", "__getstate__", "__sizeof__"].includes(key)) return "#126";
    if (Object.hasOwn(EXCEPTIONS, owner)) return "#124";
    if (owner === "generator" || owner.endsWith("iterator")) return key.startsWith("__") ? "O90" : "#120";
    if (["int", "bool", "float", "complex"].includes(owner)) return key === "__new__" ? "O85" : key.startsWith("__") ? "O90" : "#184";
    if (["str", "list", "tuple", "dict", "range", "slice"].includes(owner)) return key === "__new__" || key === "__init__" ? ["list", "dict"].includes(owner) ? "O86" : "O85" : key.startsWith("__") ? "O90" : "#116";
    if (["set", "frozenset", "bytes", "bytearray", "memoryview"].includes(owner)) return key.startsWith("__") ? "O90" : "#117";
    if (["property", "staticmethod", "classmethod", "super", "module"].includes(owner) && ["__new__", "__init__"].includes(key)) return "O87";
    if (owner === "type") return key === "__prepare__" ? "O80" : ["__subclasses__"].includes(key) ? "O88" : key === "mro" ? "O82" : "O90";
    if (["__reduce__", "__reduce_ex__", "__getstate__", "__sizeof__"].includes(key)) return "#126";
    return "O90";
  }
  nativeFieldOwner(name) {
    if (["__defaults__", "__kwdefaults__", "__globals__", "__builtins__"].includes(name)) return "O72";
    if (["__code__", "__closure__", "cell_contents"].includes(name)) return "O73";
    if (name.startsWith("gi_") || name.startsWith("f_")) return "O74";
    if (["__annotations__", "__annotate__", "__type_params__"].includes(name)) return "#125";
    return null;
  }
  callableDocumentation(receiver) {
    const name = receiver instanceof AppendValue || receiver instanceof ValueMethod ? this.typeOf(receiver.receiver).name + "." + receiver.name : receiver.name;
    const text = receiver.nativeOwner instanceof ClassValue && !receiver.nativeOwner.root && ["__dict__", "__weakref__"].includes(receiver.nativeKey) ?
      receiver.nativeKey === "__dict__" ? "dictionary for instance variables" : "list of weak references to the object" : NATIVE_CALLABLE_DOCS[name] ?? null;
    return text === null ? null : this.values.string(Array.from(text, char => char.codePointAt(0)));
  }
  nativeDocumentation(owner) {
    const value = this.namespaceDictionary(owner).entries.find(entry => this.values.text(entry.key) === "__doc__")?.value ?? null;
    return this.values.isString(value) && NATIVE_DOC_COPIES.includes(owner.root ? "object" : owner.name) ? this.values.string(value.points) : value;
  }
  namespaceDescriptor(owner, key, kind) {
    const native = owner instanceof BuiltinValue || owner.root;
    const descriptor = native ? this.builtin((owner.root ? "object" : owner.name) + "." + key) : this.make(BuiltinValue, owner.name + "." + key);
    if (!descriptor.nativeKind) {
      descriptor.nativeKind = kind; descriptor.nativeOwner = owner; descriptor.nativeKey = key;
      try { const layout = valueLayout(descriptor); this.memory?.resize(descriptor, layout.bytes, layout.children); }
      catch (error) { delete descriptor.nativeKind; delete descriptor.nativeOwner; delete descriptor.nativeKey; throw error; }
    }
    return descriptor;
  }
  namespaceDictionary(owner) {
    if (owner.namespaceDictionary) return owner.namespaceDictionary;
    if (!this.isType(owner)) this.fail("TypeError", "A type namespace owner is required");
    const roots = [owner], leave = this.memory?.enter(() => roots, {charge: this.charge});
    try {
      const dictionary = this.values.dict([]); roots.push(dictionary);
      const native = owner instanceof BuiltinValue || owner.root;
      if (native) {
        const name = owner.root ? "object" : owner.name, entries = NATIVE_NAMESPACES[name];
        if (!entries) this.fail("UnsupportedOperationError", "This native namespace is owned by O78.", "UNSUPPORTED");
        for (const [index, [key, kind, data]] of entries.entries()) {
          this.charge(key.length + 1);
          const label = owner.namespaceKeys?.[index] ?? this.values.string(Array.from(key, char => char.codePointAt(0))); roots.push(label);
          let value;
          if (kind === "value") value = data.type === "text" ? this.values.string(Array.from(data.value, char => char.codePointAt(0))) : this.values.decode(data);
          else if (kind === "staticmethod") value = this.make(MethodWrapperValue, "staticmethod", this.namespaceDescriptor(owner, key, "builtin_function_or_method"));
          else value = this.namespaceDescriptor(owner, key, kind);
          roots.push(value); this.values.set(dictionary, label, value);
        }
      } else {
        for (const key of this.ownClassDirectoryNames(owner, true)) {
          this.charge(1);
          const stored = owner.namespaceEntries?.find(entry => typeof key === "string" ? this.values.text(entry.key) === key : entry.key === key);
          const label = stored?.key || (typeof key === "string" ? this.values.string(Array.from(key, char => char.codePointAt(0))) : key); roots.push(label);
          let value;
          if (owner.namespace.has(key)) value = owner.namespace.get(key);
          else if (key === "__module__") value = this.values.string(Array.from(owner.module, char => char.codePointAt(0)));
          else if (key === "__doc__") value = null;
          else if (key === "__firstlineno__") value = this.values.int(BigInt(owner.firstLine));
          else if (key === "__static_attributes__") {
            const names = (owner.staticAttributes || []).map(name => { const value = this.values.string(Array.from(name, char => char.codePointAt(0))); roots.push(value); return value; });
            value = this.values.tuple(names);
          } else if (["__dict__", "__weakref__"].includes(key)) value = this.namespaceDescriptor(owner, key, "getset_descriptor");
          else throw new TypeError("Incomplete source namespace entry: " + key);
          roots.push(value);
          if (stored) { dictionary.entries.push({hash: stored.hash, key: label, value, position: this.values.prepareDictionarySlot(dictionary)}); dictionary.ownedKeys ||= this.values.needsOwnedHash(label); }
          else this.values.set(dictionary, label, value);
        }
      }
      // Serial positions are shared with live namespace iterators in O70.
      dictionary.namespace = {serial: dictionary.entries.length};
      dictionary.entries.forEach((entry, serial) => { entry.serial = serial; });
      let layout = valueLayout(dictionary); this.memory?.resize(dictionary, layout.bytes, layout.children);
      this.installNamespaceDictionary(owner, dictionary);
      return dictionary;
    } finally { leave?.(); }
  }
  installNamespaceDictionary(owner, dictionary) {
    if (!dictionary.namespace) {
      dictionary.namespace = {serial: dictionary.entries.length};
      dictionary.entries.forEach((entry, serial) => { entry.serial = serial; });
      const layout = valueLayout(dictionary); this.memory?.resize(dictionary, layout.bytes, layout.children);
    }
    const entries = owner instanceof ClassValue ? owner.namespaceEntries : null;
    const keys = owner.namespaceKeys;
    owner.namespaceDictionary = dictionary;
    delete owner.namespaceKeys;
    if (owner instanceof ClassValue) owner.namespaceEntries = null;
    try { const layout = valueLayout(owner); this.memory?.resize(owner, layout.bytes, layout.children); }
    catch (error) { delete owner.namespaceDictionary; if (keys) owner.namespaceKeys = keys; if (owner instanceof ClassValue) owner.namespaceEntries = entries; throw error; }
  }
  nativeEntry(type, name) {
    for (const base of this.mro(type)) {
      const label = base instanceof ClassValue && base.root ? "object" : base instanceof BuiltinValue ? base.name : null;
      if (label && NATIVE_NAMESPACES[label]?.some(entry => entry[0] === name)) {
        const dictionary = this.namespaceDictionary(base);
        return {found: true, value: dictionary.entries.find(entry => this.values.text(entry.key) === name).value};
      }
    }
    return {found: false, value: null};
  }
  namespaceDescriptorValid(descriptor, receiver, classReceiver = false) {
    if (!descriptor.nativeOwner) this.fail("TypeError", "A stored native descriptor is required");
    const type = classReceiver ? receiver : this.typeOf(receiver);
    if (!this.isType(type) || !this.subclass(type, descriptor.nativeOwner)) this.fail("TypeError", "Descriptor does not apply to this receiver");
  }
  bindNamespaceDescriptor(descriptor, receiver, owner = null) {
    const kind = descriptor.nativeKind;
    if (!NAMESPACE_DESCRIPTOR_KINDS.has(kind)) this.fail("TypeError", "A native descriptor is required");
    if (kind === "classmethod_descriptor") {
      const type = owner ?? (receiver === null ? null : this.typeOf(receiver));
      if (type === null) this.fail("TypeError", "__get__(None, None) is invalid");
      this.namespaceDescriptorValid(descriptor, type, true);
      return {kind: "value", value: this.make(BoundMethodValue, descriptor, type)};
    }
    if (receiver === null) {
      if (owner === null) this.fail("TypeError", "__get__(None, None) is invalid");
      return {kind: "value", value: descriptor};
    }
    this.namespaceDescriptorValid(descriptor, receiver);
    if (["getset_descriptor", "member_descriptor"].includes(kind))
      return {kind: "call", callable: this.builtin("namespace-getset"), args: [descriptor, receiver]};
    return {kind: "value", value: this.make(BoundMethodValue, descriptor, receiver)};
  }
  namespaceGetset(descriptor, receiver, operation = "get", item = null) {
    this.namespaceDescriptorValid(descriptor, receiver);
    const owner = descriptor.nativeOwner, name = descriptor.nativeKey;
    if (this.isInstance(receiver) && receiver.nativePayload !== undefined && owner instanceof BuiltinValue && ["property", "staticmethod", "classmethod", "module", "super"].includes(owner.name))
      return this.namespaceGetset(descriptor, receiver.nativePayload, operation, item);
    if (descriptor.slotIndex !== undefined) {
      const slots = receiver.slotValues;
      if (!(slots instanceof Map)) this.fail("TypeError", "Descriptor does not apply to this receiver layout");
      const index = descriptor.slotIndex, present = slots.has(index), before = slots.get(index);
      if (operation !== "set" && !present) this.fail("AttributeError", "'" + this.typeOf(receiver).name + "' object has no attribute '" + name + "'");
      if (operation === "get") return {kind: "value", value: before};
      if (operation === "set") slots.set(index, item); else slots.delete(index);
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { if (present) slots.set(index, before); else slots.delete(index); throw error; }
      return {kind: "value", value: null};
    }
    if (owner instanceof BuiltinValue && owner.name === "type" && name === "__doc__") {
      if (operation !== "get") { if (receiver instanceof BuiltinValue || receiver.root) this.fail("TypeError", "Cannot mutate native documentation"); return {kind: "value", value: this.mutate(receiver, name, item, operation === "delete")}; }
      if (receiver instanceof BuiltinValue || receiver.root) return {kind: "value", value: this.nativeDocumentation(receiver)};
      this.namespaceDictionary(receiver); return this.bindAttribute(this.ownNamespaceEntry(receiver, name).value, null, receiver);
    }
    if (receiver instanceof BuiltinValue && receiver.nativeKind && ["__name__", "__qualname__", "__objclass__", "__self__"].includes(name)) {
      if (operation !== "get") this.fail("AttributeError", "Native metadata is read-only");
      return this.read(receiver, name, true);
    }
    if (receiver instanceof BuiltinValue && this.isType(receiver) && ["__name__", "__qualname__", "__module__", "__mro__", "__base__", "__bases__"].includes(name)) {
      if (operation !== "get") this.fail("TypeError", "Cannot mutate native type metadata");
      return this.read(receiver, name, true);
    }
    if (receiver instanceof DictionaryViewValue && name === "mapping") {
      if (operation !== "get") this.fail("AttributeError", "Dictionary view mapping is read-only");
      return {kind: "value", value: this.make(ClassNamespaceValue, receiver.dictionary)};
    }
    const fieldOwner = this.nativeFieldOwner(name);
    if (fieldOwner && !(receiver instanceof FunctionValue && ["O72", "O73"].includes(fieldOwner) || receiver instanceof Cell && fieldOwner === "O73" || (receiver instanceof FrameValue || receiver instanceof GeneratorValue) && fieldOwner === "O74")) this.fail("UnsupportedOperationError", "Native field " + descriptor.name + " is owned by " + fieldOwner + ".", "UNSUPPORTED");
    if (operation !== "get" && (receiver instanceof PropertyValue && ["fget", "fset", "fdel"].includes(name) ||
        receiver instanceof MethodWrapperValue && ["__func__", "__wrapped__"].includes(name))) this.fail("AttributeError", "Native storage is read-only");
    if (name === "__dict__") {
      if (owner instanceof ClassValue && !owner.root && !this.isMetaclass(owner)) {
        if (operation === "get") return {kind: "value", value: this.instanceDictionary(receiver)};
        if (operation === "set" && !this.values.isDict(item)) this.fail("TypeError", "__dict__ must be set to a dictionary");
        return {kind: "value", value: this.functionMetadata(receiver, "attributes", operation === "delete" ? new Map() : item)};
      }
      if (owner instanceof BuiltinValue && owner.name === "type") {
        if (operation !== "get") this.fail("AttributeError", "Type __dict__ is read-only");
        this.namespaceDictionary(receiver); return {kind: "value", value: this.make(ClassNamespaceValue, receiver)};
      }
      if (receiver instanceof FunctionValue || receiver instanceof MethodWrapperValue) return operation === "get" ? {kind: "value", value: this.functionDictionary(receiver)} : this.write(receiver, name, item, operation === "delete");
      if (receiver instanceof ModuleValue) {
        if (operation !== "get") this.fail("AttributeError", "Module __dict__ is read-only");
        return {kind: "value", value: this.values.environmentDictionary(receiver.environment)};
      }
    }
    if (name === "__weakref__" && owner instanceof ClassValue && !owner.root) {
      if (operation !== "get") this.fail("AttributeError", "__weakref__ is read-only");
      return {kind: "value", value: null};
    }
    if (owner instanceof BuiltinValue && owner.name === "type" && receiver instanceof ClassValue && ["__name__", "__qualname__", "__module__", "__bases__", "__mro__", "__base__"].includes(name)) {
      if (operation !== "get") return name === "__bases__" ? {kind: "call", callable: this.builtin("assign-bases"), args: [receiver, item, operation === "delete"]} : {kind: "value", value: this.mutate(receiver, name, item, operation === "delete")};
      if (name === "__module__") { this.namespaceDictionary(receiver); const entry = this.ownNamespaceEntry(receiver, name); if (!entry.found) this.fail("AttributeError", "Class has no module"); return {kind: "value", value: entry.value}; }
      return {kind: "value", value: name === "__bases__" ? this.values.tuple(receiver.bases) : name === "__mro__" ? receiver.mroPending ? null : this.values.tuple(receiver.mro) : name === "__base__" ? this.primaryBase(receiver) : receiver[name === "__name__" ? "identityName" : "identityQualname"] ?? this.values.string(Array.from(receiver[name === "__name__" ? "name" : "qualname"], char => char.codePointAt(0)))};
    }
    if (receiver instanceof FrameValue || receiver instanceof GeneratorValue || receiver instanceof Cell || receiver instanceof CodeValue || receiver instanceof FunctionValue || receiver instanceof PropertyValue || receiver instanceof SuperValue || receiver instanceof BoundMethodValue || receiver instanceof MethodWrapperValue)
      return operation === "get" ? this.read(receiver, name, true) : this.write(receiver, name, item, operation === "delete");
    if (owner instanceof ClassValue && owner.root && name === "__class__") {
      if (operation !== "get") return {kind: "value", value: this.reassignClass(receiver, item, operation === "delete")};
      return {kind: "value", value: this.typeOf(receiver)};
    }
    if (operation !== "get") this.fail("AttributeError", "Native storage is read-only");
    receiver = this.payload(receiver);
    if (owner instanceof BuiltinValue && ["int", "float"].includes(owner.name) && ["real", "imag", "numerator", "denominator"].includes(name))
      return {kind: "value", value: ["real", "numerator"].includes(name) ? typeof receiver === "boolean" ? this.values.int(BigInt(receiver)) : receiver : owner.name === "float" ? this.values.float(0) : name === "denominator" ? 1n : 0n};
    if (this.values.isComplex(receiver) && ["real", "imag"].includes(name)) return {kind: "value", value: this.values.complexAttribute(receiver, name)};
    if (this.values.isRange(receiver) && ["start", "stop", "step"].includes(name)) return {kind: "value", value: this.values.rangeAttribute(receiver, name)};
    if (this.values.isSlice(receiver) && ["start", "stop", "step"].includes(name)) return {kind: "value", value: this.values.sliceAttribute(receiver, name)};
    const fieldOwnerLabel = owner instanceof BuiltinValue && Object.hasOwn(EXCEPTIONS, owner.name) ? "#124" : owner instanceof BuiltinValue && owner.name === "type" ? "the explicit C ABI/layout boundary" : owner instanceof BuiltinValue && ["staticmethod", "classmethod", "super", "getset_descriptor", "member_descriptor", "method_descriptor", "wrapper_descriptor", "builtin_function_or_method"].includes(owner.name) ? "O71" : owner instanceof BuiltinValue && owner.name === "generator" ? "O74" : "#117";
    this.fail("UnsupportedOperationError", "Native field " + descriptor.name + " is owned by " + fieldOwnerLabel + ".", "UNSUPPORTED");
  }
  namespaceEntry(receiver, key) { return this.values.classNamespaceEntry(receiver, key); }
  rememberNamespaceKey(owner, name, key) {
    if (owner.namespaceDictionary?.entries.some(entry => entry.key === key)) return;
    if (owner.namespaceEntries?.some(entry => this.values.text(entry.key) === name)) return;
    const before = owner.namespaceEntries;
    owner.namespaceEntries = [...(before || []), {key, hash: this.values.hash(key)}];
    try { const layout = valueLayout(owner); this.memory?.resize(owner, layout.bytes, layout.children); }
    catch (error) { owner.namespaceEntries = before; throw error; }
  }
  materializeInstanceStorage(type) {
    for (const base of this.mro(type)) if (base instanceof ClassValue && !base.root && !base.namespaceDictionary &&
        base.bases.every(parent => parent instanceof ClassValue && parent.root)) this.namespaceDictionary(base);
  }
  instanceDictionarySlot(type, start = 0) {
    for (const base of this.mro(type).slice(start)) {
      if (!(base instanceof ClassValue) || base.root) continue;
      const own = this.ownNamespaceEntry(base, "__dict__", -1);
      if (own.found) return own.value?.nativeKind === "getset_descriptor" && own.value.nativeOwner === base && own.value.nativeKey === "__dict__";
      if (!base.namespaceDictionary && (base.storage ? base.storage.ownDict : base.bases.every(parent => parent instanceof ClassValue && parent.root))) return true;
    }
    return false;
  }
  instanceDictionary(receiver) {
    if (receiver.attributes instanceof Map) {
      const pairs = [], leave = this.memory?.enter(() => [receiver, ...pairs.flat()]);
      try {
        for (const [name, value] of receiver.attributes)
          pairs.push([this.values.string(Array.from(name, char => char.codePointAt(0))), value]);
        this.functionMetadata(receiver, "attributes", this.values.dict(pairs));
      } finally { leave?.(); }
    }
    return receiver.attributes;
  }
  instanceMissing(receiver, name, fallback = {found: false}) {
    if (fallback.found) return this.bindAttribute(fallback.value, receiver, receiver.type);
    if (!fallback.skipNative && receiver.nativePayload instanceof SuperValue) return this.read(receiver.nativePayload, name);
    if (!fallback.skipNative && this.nativeModule(receiver)) return {kind: "call", callable: this.builtin("native-module-missing"), args: [receiver, this.values.string(Array.from(name, char => char.codePointAt(0)))]};
    this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
  }
  instanceEntry(receiver, name, operation = "get", item = null, key = null, fallback = {found: false}) {
    const value = value => ({kind: "value", value});
    if (operation !== "get" && !allowsClassSpecial(name, "mutate") && name !== "__dict__")
      this.fail("UnsupportedOperationError", "Special attribute mutation is outside classes-source/1.", "UNSUPPORTED");
    if (receiver.attributes instanceof Map && operation === "get")
      return receiver.attributes.has(name) ? value(receiver.attributes.get(name)) : this.instanceMissing(receiver, name, fallback);
    if (receiver.type.storage && !receiver.type.storage.dict) return this.instanceMissing(receiver, name, operation === "get" ? fallback : {found: false, skipNative: true});
    const dictionary = this.instanceDictionary(receiver);
    key ??= this.values.string(Array.from(name, char => char.codePointAt(0)));
    if (this.values.dictionaryNeedsProtocol(dictionary, key)) return {kind: "call",
      callable: this.builtin("instance-dictionary-" + operation), args: [receiver, dictionary, key, item, fallback.found, fallback.value ?? null, ...(fallback.skipNative ? [true] : [])]};
    if (operation === "set") return value(this.values.set(dictionary, key, item));
    const position = this.values.find(dictionary, key);
    if (position < 0) return this.instanceMissing(receiver, name, operation === "get" ? fallback : {found: false, skipNative: true});
    return value(operation === "get" ? dictionary.entries[position].value : this.values.remove(dictionary, key));
  }
  nativeCallableDirectoryKind(receiver) {
    const kind = this.nativeDescriptorKind(receiver);
    if (kind !== null) return kind;
    if (receiver instanceof BuiltinValue && !this.isType(receiver)) return "builtin_function_or_method";
    if (receiver instanceof BoundMethodValue && !this.isPythonMethod(receiver) && receiver.callable instanceof BuiltinValue) {
      if (nativeWrapper(receiver.callable.name)) return "method-wrapper";
      return this.typeOf(receiver).name;
    }
    return null;
  }
  numericDirectoryNames(receiver) {
    if (receiver === null) return NONE_DIRECTORY_KEYS;
    if (receiver instanceof NotImplementedValue) return NOT_IMPLEMENTED_DIRECTORY_KEYS;
    if (typeof receiver === "boolean") return BOOL_DIRECTORY_KEYS;
    if (typeof receiver === "bigint") return INT_DIRECTORY_KEYS;
    if (this.values.isFloat(receiver)) return FLOAT_DIRECTORY_KEYS;
    if (this.values.isComplex(receiver)) return COMPLEX_DIRECTORY_KEYS;
    return null;
  }
  containerDirectoryNames(receiver) {
    return CONTAINER_DIRECTORY_KEYS[this.values.containerDirectoryType(receiver)] ?? null;
  }
  hasFixedDirectory(receiver) {
    if (this.isInstance(receiver)) return false;
    return receiver instanceof ModuleValue || receiver instanceof Cell || receiver instanceof CodeValue || receiver instanceof FrameValue || receiver instanceof FrameLocalsValue || receiver instanceof ExceptionValue || receiver instanceof DictionaryViewValue ||
      receiver instanceof MethodWrapperValue || receiver instanceof SuperValue || receiver instanceof ClassNamespaceValue || receiver instanceof PropertyValue || receiver instanceof GeneratorValue ||
      receiver instanceof IteratorValue || receiver instanceof ProtocolIteratorValue && ["indexed", "callable"].includes(receiver.kind) ||
      this.values.isRange(receiver) || this.values.isSlice(receiver) || this.containerDirectoryNames(receiver) !== null || this.numericDirectoryNames(receiver) !== null || this.nativeCallableDirectoryKind(receiver) !== null;
  }
  nativeTypeDirectoryNames(type) {
    if (!(type instanceof BuiltinValue) || !this.isType(type)) return null;
    return this.mro(type).flatMap(base => this.nativeNamespaceKeys(base));
  }
  nativeNamespaceKeys(owner) {
    if (owner.namespaceDictionary) return owner.namespaceDictionary.entries.map(entry => entry.key);
    if (owner.namespaceKeys) return owner.namespaceKeys;
    const entries = NATIVE_NAMESPACES[owner.root ? "object" : owner.name], keys = [], roots = [owner], leave = this.memory?.enter(() => [...roots, ...keys], {charge: this.charge});
    try {
      for (const [name] of entries) {
        this.charge(name.length + 1);
        keys.push(this.values.string(Array.from(name, char => char.codePointAt(0))));
      }
      owner.namespaceKeys = keys;
      try { const layout = valueLayout(owner); this.memory?.resize(owner, layout.bytes, layout.children); }
      catch (error) { delete owner.namespaceKeys; throw error; }
      return keys;
    } finally { leave?.(); }
  }
  directoryNames(receiver) {
    return this.nativeTypeDirectoryNames(this.typeOf(receiver));
  }
  ownClassDirectoryNames(type, namespace = false) {
    this.touch(type); this.charge(1);
    const native = this.nativeTypeDirectoryNames(type);
    if (native !== null) return native;
    if (!(type instanceof ClassValue))
      this.fail("UnsupportedOperationError", "Further class namespace reflection requires a separate directory contract.", "UNSUPPORTED");
    if (!namespace) return type.root ? this.nativeNamespaceKeys(type) : this.namespaceDictionary(type).entries.map(entry => entry.key);
    if (type.root) return OBJECT_DIRECTORY_KEYS;
    if (type.namespaceDictionary) return type.namespaceDictionary.entries.map(entry => entry.key);
    const names = [], initial = [...type.namespace.keys()].slice(0, type.directoryInitialCount);
    for (const name of initial) {
      this.charge(1);
      if (name === "__qualname__" || name === "__classcell__" || name === "__hash__" && type.automaticHash) continue;
      names.push(name);
      if (name === "__module__" && type.sourceDefined && type.firstLine !== null && !type.namespace.has("__firstlineno__")) names.push("__firstlineno__");
    }
    if (!type.namespace.has("__module__")) names.push("__module__");
    if (type.sourceDefined && type.staticAttributes !== null && !type.namespace.has("__static_attributes__")) names.push("__static_attributes__");
    if (type.storage?.ownDict && !type.namespace.has("__dict__")) names.push("__dict__");
    if (type.storage?.ownWeak) names.push("__weakref__");
    if (type.defaultDoc) names.push("__doc__");
    if (type.automaticHash && initial.includes("__hash__")) names.push("__hash__");
    for (const name of [...type.namespace.keys()].slice(type.directoryInitialCount)) {
      this.charge(1);
      if (name !== "__doc__" || !type.defaultDoc) names.push(name);
    }
    return names;
  }
  classDirectoryEntry(type, name) {
    this.touch(type); this.charge(1);
    // Finite native lists already include base keys; enumeration does not read entries.
    if (this.nativeTypeDirectoryNames(type) !== null) return null;
    if (type.namespaceDictionary) {
      const entry = type.namespaceDictionary.entries.find(entry => entry.key === name);
      if (entry) return entry.value;
      this.fail("KeyError", "Class directory namespace changed during merging.");
    }
    if (type.namespace.has(name)) return type.namespace.get(name);
    if (this.ownClassDirectoryNames(type).includes(name)) return null;
    this.fail("KeyError", "Class directory namespace changed during merging.");
  }
  frameKeys(frame) {
    this.touch(frame);
    const version = frame.raw.inlineVersion ?? 0;
    if (frame.keys !== null && frame.keyVersion === version) return frame.keys;
    const overlays = [...(frame.raw.inlineFrames ?? [])];
    const optimized = frame.raw.fn.kind === "function", base = optimized ? frame.raw : overlays.shift();
    const fn = base?.fn ?? frame.raw.fn;
    const cells = base ? new Map([...base.locals, ...base.closure]) : new Map(), targets = new Set();
    for (const overlay of overlays) for (const name of overlay.fn.namespace ?? overlay.fn.locals) {
      if (name.startsWith("@source:")) continue;
      const cell = overlay.locals.get(name); if (cell) targets.add(cell);
      cells.set(name, cell ?? overlay.closure.get(name) ?? cells.get(name));
    }
    const cellNames = base ? [...(fn.namespaceCells ?? []), ...base.closure.keys()] : [];
    const names = base ? [...new Set([...(fn.namespace ?? fn.locals).filter(name => !cellNames.includes(name) || targets.has(cells.get(name))), ...cellNames])] : [];
    const iterator = fn.name === "<genexpr>" ? fn.params.posonly[0] : null;
    const roots = [frame], leave = this.memory?.enter(() => roots, {charge: this.charge});
    try {
      const dictionary = this.values.dict([]); roots.push(dictionary);
      for (const name of names) {
        this.charge(name.length + 1);
        if (name.startsWith("@source:") && name !== iterator) continue;
        const cell = cells.get(name); if (!cell) continue;
        const visible = name === iterator ? ".0" : name;
        let key = frame.nameKeys?.get(visible);
        if (!key) {
          key = this.values.string(Array.from(visible, char => char.codePointAt(0))); roots.push(key);
          const cache = new Map(frame.nameKeys); cache.set(visible, key); this.functionMetadata(frame, "nameKeys", cache);
        }
        this.values.set(dictionary, key, cell);
      }
      this.functionMetadata(frame, "keys", dictionary); frame.keyVersion = version; return dictionary;
    } finally { leave?.(); }
  }
  frameExtras(frame) {
    this.touch(frame);
    if (frame.extras === null) this.functionMetadata(frame, "extras", this.values.dict([]));
    return frame.extras;
  }
  codeObject(pool, index) {
    if (!isVerifiedFunctionCode(pool.code) || !Number.isSafeInteger(index) || index < 0 || index >= pool.code.functions.length) this.fail("TypeError", "Code objects require independently verified code");
    if (pool.codeObjects?.has(index)) return pool.codeObjects.get(index);
    const value = this.make(CodeValue, pool, index), previous = pool.codeObjects;
    pool.codeObjects = new Map(previous); pool.codeObjects.set(index, value);
    try { const layout = valueLayout(pool); this.memory?.resize(pool, layout.bytes, layout.children); }
    catch (error) { pool.codeObjects = previous; throw error; }
    return value;
  }
  codeMetadata(code, name) {
    if (code.metadata.has(name)) return code.metadata.get(name);
    const roots = [code], leave = this.memory?.enter(() => roots, {charge: this.charge});
    try {
    const fn = code.pool.code.functions[code.index], p = fn.params;
    const strings = names => this.values.tuple(names.map(name => { const value = this.values.string(Array.from(name, char => char.codePointAt(0))); roots.push(value); return value; }));
    const text = text => this.values.string(Array.from(text, char => char.codePointAt(0)));
    const instructions = fn.blocks.flatMap(block => block.instructions);
    this.charge(instructions.length + fn.locals.length + fn.free.length + 1);
    const parameters = [...p.posonly, ...p.positional, ...p.kwonly, ...(p.vararg ? [p.vararg] : []), ...(p.kwarg ? [p.kwarg] : [])];
    const captured = new Set(instructions.filter(([op]) => ["function", "function-defaults", "class", "class-meta", "class-keywords", "class-expanded"].includes(op)).flatMap(([,index]) => code.pool.code.functions[index].free).filter(name => fn.locals.includes(name)));
    const locals = fn.kind === "function" ? [...parameters, ...(fn.namespace ?? fn.locals).filter(name => !parameters.includes(name) && !captured.has(name) && !name.startsWith("@source:"))] : [];
    let result;
    if (["co_name", "co_qualname", "co_filename"].includes(name)) result = text(name === "co_name" ? fn.name : name === "co_qualname" ? fn.qualname : fn.blocks.find(block => block.source)?.source.filename ?? "<source>");
    else if (name === "co_firstlineno") result = this.values.int(BigInt(fn.firstLine ?? 1));
    else if (name === "co_argcount") result = this.values.int(BigInt(p.posonly.length + p.positional.length));
    else if (name === "co_posonlyargcount") result = this.values.int(BigInt(p.posonly.length));
    else if (name === "co_kwonlyargcount") result = this.values.int(BigInt(p.kwonly.length));
    else if (name === "co_nlocals") result = this.values.int(BigInt(locals.length));
    else if (name === "co_varnames") result = strings(locals);
    else if (name === "co_freevars") result = strings(fn.free);
    else if (name === "co_cellvars") result = strings(fn.kind === "class" ? fn.locals.includes("@source:class") ? ["__class__"] : [] : [...parameters.filter(name => captured.has(name)), ...[...captured].filter(name => !parameters.includes(name)).sort()]);
    else if (name === "co_flags") result = this.values.int(BigInt((fn.kind === "function" ? 3 : 0) | (p.vararg ? 4 : 0) | (p.kwarg ? 8 : 0) | (fn.kind === "function" && fn.qualname.includes("<locals>") ? 16 : 0) | (instructions.some(([op]) => ["yield", "yield-from"].includes(op)) ? 32 : 0)));
    else if (name === "co_names") result = strings([...new Set(instructions.filter(([op,key]) => ["attribute-get", "attribute-set", "attribute-delete"].includes(op) || ["load", "store", "delete"].includes(op) && (fn.kind !== "function" || !fn.locals.includes(key)) && !fn.free.includes(key)).map(([,key]) => key))]);
    else if (name === "co_consts") {
      const items = [fn.doc === undefined ? null : code.pool.code.constants[fn.doc]], roots = [code, ...items], leave = this.memory?.enter(() => roots, {charge: this.charge});
      try {
        for (const [op,index] of instructions) {
          let item;
          if (op === "const") item = code.pool.code.constants[index];
          else if (["function", "function-defaults", "class", "class-meta", "class-keywords", "class-expanded"].includes(op)) item = this.codeObject(code.pool, index);
          else continue;
          roots.push(item); if (!items.includes(item)) items.push(item);
        }
        result = this.values.tuple(items);
      } finally { leave?.(); }
    } else this.fail("UnsupportedOperationError", "Code field " + name + " is outside the source-code metadata interface; CPython bytecode and C layouts are not executable here", "UNSUPPORTED");
    code.metadata.set(name, result);
    try { const layout = valueLayout(code); this.memory?.resize(code, layout.bytes, layout.children); }
    catch (error) { code.metadata.delete(name); throw error; }
    return result;
    } finally { leave?.(); }
  }
  replaceCode(receiver, code) {
    if (!(code instanceof CodeValue) || !isVerifiedFunctionCode(code.pool.code) || code.pool.code.functions[code.index]?.kind !== "function") this.fail("TypeError", "__code__ must be set to an owned verified function code object");
    this.touch(code);
    const names = code.pool.code.functions[code.index].free, cells = [...receiver.closure.values()];
    if (names.length !== cells.length) this.fail("ValueError", "Function requires a code object with " + cells.length + " free vars, not " + names.length);
    const roots = [receiver, code], leave = this.memory?.enter(() => roots, {charge: this.charge});
    try {
      const original = receiver.pool.code.functions[receiver.index];
      const name = receiver.identityName ?? this.values.string(Array.from(original.name, char => char.codePointAt(0))); roots.push(name);
      const qualification = receiver.identityQualname ?? this.values.string(Array.from(original.qualname, char => char.codePointAt(0))); roots.push(qualification);
      const previous = [receiver.pool, receiver.index, receiver.closure, receiver.identityName, receiver.identityQualname];
      receiver.pool = code.pool; receiver.index = code.index; receiver.closure = new Map(names.map((name, i) => [name, cells[i]]));
      receiver.identityName = name; receiver.identityQualname = qualification;
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { [receiver.pool, receiver.index, receiver.closure, receiver.identityName, receiver.identityQualname] = previous; throw error; }
      return null;
    } finally { leave?.(); }
  }
  functionDefaults(receiver, name) {
    if (name === "__defaults__" && Array.isArray(receiver.positionalDefaults)) {
      const items = receiver.positionalDefaults;
      this.functionMetadata(receiver, "positionalDefaults", items.length ? this.values.tuple(items) : null);
    }
    if (name === "__kwdefaults__" && receiver.keywordDefaults instanceof Map) {
      const items = [...receiver.keywordDefaults], roots = [receiver], leave = this.memory?.enter(() => roots, {charge: this.charge});
      try {
        const dictionary = items.length ? this.values.dict([]) : null; roots.push(dictionary);
        for (const [name, item] of items) {
          const key = this.values.string(Array.from(name, char => char.codePointAt(0))); roots.push(key);
          this.values.set(dictionary, key, item);
        }
        this.functionMetadata(receiver, "keywordDefaults", dictionary);
      } finally { leave?.(); }
    }
    return receiver[name === "__defaults__" ? "positionalDefaults" : "keywordDefaults"];
  }
  functionDictionary(receiver) {
    if (receiver.attributes === null) this.functionMetadata(receiver, "attributes", this.values.dict([]));
    return receiver.attributes;
  }
  functionMissing(receiver, name, operation = "get") {
    if (operation === "get" && name === "__dir__")
      return this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver);
    if (receiver instanceof MethodWrapperValue) this.fail("AttributeError", "Wrapper has no attribute '" + name + "'.");
    if (operation === "get" && name === "__get__")
      return this.make(BoundMethodValue, this.builtin("function.__get__"), receiver);
    if (operation === "get" && FUNCTION_DEFERRED_METHODS.has(name))
      this.fail("UnsupportedOperationError", "Native function methods require their own contract.", "UNSUPPORTED");
    this.fail("AttributeError", "Function has no attribute '" + name + "'.");
  }
  functionEntry(receiver, name, operation = "get", item = null, key = null) {
    if (FUNCTION_DEFERRED_DATA.has(name) && (receiver instanceof FunctionValue || ["__annotations__", "__annotate__", "__type_params__"].includes(name)))
      this.fail("UnsupportedOperationError", "Native function metadata requires its own contract.", "UNSUPPORTED");
    const value = value => ({kind: "value", value});
    const dictionary = operation === "set" ? this.functionDictionary(receiver) : receiver.attributes;
    if (dictionary === null) return value(this.functionMissing(receiver, name, operation));
    key ??= this.values.string(Array.from(name, char => char.codePointAt(0)));
    if (this.values.dictionaryNeedsProtocol(dictionary, key)) return {kind: "call",
      callable: this.builtin("function-dictionary-" + operation), args: [receiver, dictionary, key, item]};
    if (operation === "set") return value(this.values.set(dictionary, key, item));
    const position = this.values.find(dictionary, key);
    if (position < 0) return value(this.functionMissing(receiver, name, operation));
    return value(operation === "get" ? dictionary.entries[position].value : this.values.remove(dictionary, key));
  }
  functionMetadata(receiver, field, value) {
    const before = receiver[field]; receiver[field] = value;
    try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
    catch (error) { receiver[field] = before; throw error; }
    return null;
  }
  mutate(receiver, name, value, remove = false, key = null, namespaceShadow = false) {
    this.key(name); this.touch(receiver);
    if (receiver instanceof ClassValue && receiver.root || receiver instanceof BuiltinValue && this.isType(receiver)) this.fail("TypeError", "Cannot mutate an immutable native type");
    if (name === "__class__" && (this.isInstance(receiver) || receiver instanceof ClassValue)) return this.reassignClass(receiver, value, remove);
    if (receiver instanceof ClassValue && !receiver.root && ["__name__", "__qualname__"].includes(name)) {
      const label = this.values.text(this.payload(value));
      if (remove || label === null) this.fail("TypeError", name + " must be set to a string");
      if (name === "__name__" && label.includes("\0")) this.fail("ValueError", "type name must not contain null characters");
      this.bounded(label.length <= CLASS_LIMITS.name, "Class identity budget exceeded");
      const field = name === "__name__" ? "name" : "qualname", identity = name === "__name__" ? "identityName" : "identityQualname", before = receiver[field];
      receiver[field] = label;
      try { return this.functionMetadata(receiver, identity, value); }
      catch (error) { receiver[field] = before; throw error; }
    }
    if (receiver instanceof ClassValue && name === "__module__") {
      if (remove) this.fail("TypeError", "Cannot delete type __module__");
      this.namespaceDictionary(receiver);
      if (this.ownNamespaceEntry(receiver, "__firstlineno__").found) this.mutate(receiver, "__firstlineno__", null, true);
      receiver.firstLine = null;
    }
    if (this.isPythonMethod(receiver) && ["__name__", "__qualname__", "__module__"].includes(name))
      this.fail("AttributeError", "Method identity metadata is read-only.");
    if (receiver instanceof ClassValue && name === "__dict__" && receiver.metaclass && !namespaceShadow) {
      const item = this.lookup(receiver.metaclass, name), descriptor = item.found ? this.descriptor(item.value) : null;
      if (item.found && !(item.value instanceof PropertyValue) && !(descriptor && (descriptor.set.found || descriptor.delete.found)))
        return this.mutate(receiver, name, value, remove, key, true);
    }
    if (receiver instanceof FunctionValue && name === "__closure__") this.fail("AttributeError", "Function closure is read-only");
    if (receiver instanceof FunctionValue && name === "__code__") {
      if (remove) this.fail("TypeError", "__code__ cannot be deleted");
      return this.replaceCode(receiver, value);
    }
    if (receiver instanceof FunctionValue && ["__globals__", "__builtins__"].includes(name)) this.fail("AttributeError", "Function defining namespaces are read-only");
    if (receiver instanceof FunctionValue && ["__defaults__", "__kwdefaults__"].includes(name)) {
      if (!remove && value !== null && !(name === "__defaults__" ? this.values.isSequenceType(value, "tuple") : this.values.isDict(value)))
        this.fail("TypeError", name + " must be set to " + (name === "__defaults__" ? "a tuple" : "a dict") + " or None");
      return this.functionMetadata(receiver, name === "__defaults__" ? "positionalDefaults" : "keywordDefaults", remove ? null : value);
    }
    if (receiver instanceof FunctionValue && name === "__dict__") {
      if (remove || !this.values.isDict(value)) this.fail("TypeError", "Function __dict__ must be set to a dictionary.");
      return this.functionMetadata(receiver, "attributes", value);
    }
    if (receiver instanceof FunctionValue && name === "__class__") this.fail("TypeError", "Function type cannot be changed.");
    if (this.isInstance(receiver) && name === "__dict__" && this.instanceDictionarySlot(receiver.type)) {
      if (!remove && !this.values.isDict(value)) this.fail("TypeError", "Instance __dict__ must be set to a dictionary.");
      return this.functionMetadata(receiver, "attributes", remove ? new Map() : value);
    }
    if (receiver instanceof FunctionValue && ["__name__", "__qualname__", "__module__"].includes(name)) {
      if (name !== "__module__" && (remove || !this.values.isString(value)))
        this.fail("TypeError", "Function " + name + " must be set to a string.");
      return this.functionMetadata(receiver, name === "__name__" ? "identityName" : name === "__qualname__" ? "identityQualname" : "identityModule", remove ? null : value);
    }
    if (name === "__doc__" && (receiver instanceof FunctionValue || receiver instanceof PropertyValue)) {
      const before = receiver.documentation;
      receiver.documentation = remove ? null : value;
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { receiver.documentation = before; throw error; }
      return null;
    }
    if (name === "__doc__" && receiver instanceof BoundMethodValue) this.fail("AttributeError", "Method documentation is read-only.");
    if (name === "__doc__" && receiver instanceof ClassValue && remove) this.fail("TypeError", "Class documentation cannot be deleted.");
    if (name === "__isabstractmethod__" && (receiver instanceof PropertyValue || receiver instanceof MethodWrapperValue || receiver instanceof BoundMethodValue))
      this.fail("AttributeError", "Computed abstract-method flags are read-only.");
    if (name === "__name__" && !(this.isInstance(receiver))) {
      if (!(receiver instanceof PropertyValue))
        this.fail("UnsupportedOperationError", "Name mutation is adopted only for properties.", "UNSUPPORTED");
      const before = receiver.propertyName;
      receiver.propertyName = remove ? undefined : value;
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { receiver.propertyName = before; throw error; }
      return null;
    }
    if (receiver instanceof BuiltinValue && this.isType(receiver)) this.fail("TypeError", "Cannot mutate an immutable native type.");
    if (!(receiver instanceof ClassValue || this.isInstance(receiver)))
      this.fail("UnsupportedOperationError", "Attribute mutation requires a class or instance.", "UNSUPPORTED");
    if (receiver instanceof ClassValue && receiver.root) this.fail("TypeError", "Cannot mutate the immutable object type.");
    if (receiver instanceof ClassValue && name === "__dict__" && !namespaceShadow) this.fail("AttributeError", "Class namespace views cannot be replaced or deleted.");
    if (receiver instanceof ClassValue && name === "__base__") this.fail("AttributeError", "Primary base metadata is read-only.");
    if (receiver instanceof ClassValue && name === "__bases__") this.fail("UnsupportedOperationError", "Type base reassignment requires owned hierarchy execution.", "UNSUPPORTED");
    if (receiver instanceof ClassValue && this.isMetaclass(receiver) && isSpecialName(name) && !META_SPECIALS.has(name))
      this.fail("UnsupportedOperationError", "Further metaclass special protocols require a separate stage", "UNSUPPORTED");
    if (!allowsClassSpecial(name, "mutate") && !namespaceShadow && !(this.isInstance(receiver) && name === "__dict__"))
      this.fail("UnsupportedOperationError", "Special attribute mutation is outside classes-source/1.", "UNSUPPORTED");
    if (this.isInstance(receiver) && receiver.type.root && name === "__dict__")
      this.fail("AttributeError", "Object instance has no dictionary.");
    if (this.isInstance(receiver) && receiver.type.storage && !receiver.type.storage.dict) this.instanceMissing(receiver, name, {found: false, skipNative: true});
    if (this.isInstance(receiver) && !(receiver.attributes instanceof Map)) {
      const plan = this.instanceEntry(receiver, name, remove ? "delete" : "set", value);
      if (plan.kind !== "value") this.fail("UnsupportedOperationError", "Dictionary callbacks require VM execution frames.", "UNSUPPORTED");
      return plan.value;
    }
    if (receiver instanceof ClassValue && ["__firstlineno__", "__static_attributes__", "__weakref__"].includes(name)) this.namespaceDictionary(receiver);
    const map = receiver instanceof ClassValue ? receiver.namespace : receiver.attributes;
    const dictionary = receiver instanceof ClassValue ? receiver.namespaceDictionary : null;
    if (dictionary) this.ownNamespaceEntry(receiver, name);
    const own = dictionary ? this.ownNamespaceEntry(receiver, name, 1) : null;
    const mapName = own?.found ? this.values.text(own.key) ?? own.key : name;
    const mapPresent = map.has(mapName), before = map.get(mapName);
    const position = own?.found ? dictionary.entries.findIndex(entry => entry.key === own.key) : -1;
    const present = mapPresent || position >= 0;
    if (remove && !present) this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    this.bounded(remove || present || map.size < CLASS_LIMITS.attributes, "Class/instance attribute budget exceeded.");
    const initialCount = receiver instanceof ClassValue ? receiver.directoryInitialCount : null;
    const entries = receiver.namespaceEntries;
    const protocolNames = receiver instanceof ClassValue ? receiver.protocolNames : null;
    if (remove && initialCount !== null && mapPresent && [...map.keys()].indexOf(mapName) < initialCount) receiver.directoryInitialCount--;
    if (remove) map.delete(mapName); else map.set(mapName, value);
    if (receiver instanceof ClassValue && (protocolNames?.includes(name) || own?.found && this.values.needsOwnedHash(own.key)))
      receiver.protocolNames = remove ? (protocolNames || []).filter(item => item !== name) : [...new Set([...(protocolNames || []), name])];
    if (receiver instanceof ClassValue && entries) receiver.namespaceEntries = remove ? entries.filter(entry => entry.key !== own?.key && this.values.text(entry.key) !== name) : entries;
    const rollback = () => {
      if (initialCount !== null) { receiver.directoryInitialCount = initialCount; receiver.namespaceEntries = entries; receiver.protocolNames = protocolNames; }
      if (mapPresent) map.set(mapName, before); else map.delete(mapName);
    };
    try {
      let layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children);
      if (dictionary) {
        const label = key || this.values.string(Array.from(name, char => char.codePointAt(0)));
        try {
          if (remove) this.values.commitDictionary(dictionary, label, null, this.values.dictionaryEntryHash(dictionary.entries[position]), position, true);
          else this.values.commitDictionary(dictionary, label, value, this.values.pythonHash(label), position);
        } catch (error) {
          rollback(); layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); throw error;
        }
      }
    } catch (error) { rollback(); throw error; }
    return null;
  }
  actualSubtype(type, parent) {
    const pending = [type], seen = new Set();
    while (pending.length) {
      this.charge(1); const item = pending.pop(); if (item === parent) return true;
      if (seen.has(item)) continue; seen.add(item); if (item instanceof ClassValue) pending.push(...item.bases);
    }
    return false;
  }
  layoutShape(type) {
    if (type instanceof ClassValue && !type.root) return {...type.storage, gc: true};
    const family = type.root ? "object" : type.name;
    return {family, count: 0, ownNames: [], dict: ["type", "module", "staticmethod", "classmethod"].includes(family),
      weak: ["type", "module", "set", "frozenset"].includes(family), gc: !["object", "int", "float", "complex", "str", "bytes", "bytearray"].includes(family)};
  }
  compatibleLayout(left, right) {
    const equal = (a, b) => a.family === b.family && a.count === b.count && a.dict === b.dict && a.weak === b.weak && a.gc === b.gc;
    if (!equal(this.layoutShape(left), this.layoutShape(right))) return false;
    const reduce = type => {
      while (type instanceof ClassValue && !type.root) {
        const parent = this.primaryBase(type);
        if (!equal(this.layoutShape(type), this.layoutShape(parent))) break;
        type = parent;
      }
      return type;
    };
    const a = reduce(left), b = reduce(right);
    if (a === b) return true;
    if (!(a instanceof ClassValue && !a.root && b instanceof ClassValue && !b.root) || this.primaryBase(a) !== this.primaryBase(b)) return false;
    const x = a.storage.ownNames, y = b.storage.ownNames;
    return x.length === y.length && x.every((name, i) => name === y[i]);
  }
  reassignClass(receiver, type, remove = false) {
    if (remove || !this.isType(type)) this.fail("TypeError", remove ? "can't delete __class__ attribute" : "__class__ must be set to a class");
    const old = this.typeOf(receiver), modules = this.layoutFamily(old) === "module" && this.layoutFamily(type) === "module";
    if (!modules && (!(old instanceof ClassValue) || old.root || !(type instanceof ClassValue) || type.root))
      this.fail("TypeError", "__class__ assignment only supported for mutable types or ModuleType subclasses");
    if (!this.compatibleLayout(old, type)) this.fail("TypeError", "__class__ assignment: object layout differs");
    if (receiver instanceof ClassValue) return this.functionMetadata(receiver, "metaclass", type);
    if (receiver instanceof InstanceValue) {
      if (old.storage?.dict && old.storage.family === "object") this.instanceDictionary(receiver);
      return this.functionMetadata(receiver, "type", type);
    }
    if (receiver instanceof ModuleValue && modules) {
      const previous = [receiver.type, receiver.attributes];
      const dictionary = this.values.environmentDictionary(receiver.environment);
      if (type instanceof ClassValue) { receiver.type = type; receiver.attributes = dictionary; }
      else { delete receiver.type; delete receiver.attributes; }
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { if (previous[0] === undefined) delete receiver.type; else receiver.type = previous[0]; if (previous[1] === undefined) delete receiver.attributes; else receiver.attributes = previous[1]; throw error; }
      return null;
    }
    this.fail("TypeError", "This value cannot change its native layout");
  }
  subclasses(type) {
    if (!this.isType(type)) this.fail("TypeError", "__subclasses__ requires a type");
    const live = this.memory?.liveValues(ClassValue) ?? [];
    const source = live.filter(item => {
      const transaction = this.transactions?.find(record => record.active && record.type === item && item.bases === record.bases);
      const bases = transaction ? transaction.snapshots[0].bases : item.bases;
      return !item.root && !item.mroPending && bases.includes(type);
    });
    source.sort((a, b) => a.creationOrder < b.creationOrder ? -1 : a.creationOrder > b.creationOrder ? 1 : 0);
    const native = [];
    for (const name of NATIVE_TYPES) {
      const parent = name === "bool" ? "int" : EXCEPTIONS[name] ?? "object";
      if ((type.root || type instanceof BuiltinValue) && (type.root ? "object" : type.name) === parent) native.push(this.builtin(name));
    }
    return [...native, ...source];
  }
  derivedStorage(type, bases) {
    const inherited = this.storageLayout(type.name, bases, new Map(), []), old = type.storage;
    return {...inherited, ownNames: old.ownNames, count: inherited.count + old.ownNames.length,
      dict: inherited.dict || old.ownDict, weak: inherited.weak || old.ownWeak, ownDict: old.ownDict, ownWeak: old.ownWeak,
      explicit: old.explicit, solid: old.ownNames.length ? type : inherited.solid};
  }
  beginBases(type, value, remove = false) {
    if (!(type instanceof ClassValue) || type.root || remove) this.fail("TypeError", "Cannot change these type bases");
    value = this.payload(value);
    if (!this.values.isSequenceType(value, "tuple") || !value.items.length) this.fail("TypeError", "__bases__ requires a nonempty tuple");
    const bases = Object.freeze([...value.items]);
    this.bounded(bases.length <= CLASS_LIMITS.bases, "Class base budget exceeded");
    if (new Set(bases).size !== bases.length) this.fail("TypeError", "duplicate base class");
    for (const base of bases) {
      if (!this.isType(base)) this.fail("TypeError", "__bases__ items must be classes");
      const pending = [base], seen = new Set();
      while (pending.length) {
        this.charge(1); const item = pending.pop();
        if (item === type) this.fail("TypeError", "a __bases__ item causes an inheritance cycle");
        if (seen.has(item)) continue; seen.add(item);
        if (item instanceof ClassValue) pending.push(...item.bases);
      }
    }
    const storage = this.derivedStorage(type, bases), previous = type.storage;
    const oldBases = type.bases; type.bases = bases; type.storage = storage;
    let primary; try { primary = this.primaryBase(type); } finally { type.bases = oldBases; type.storage = previous; }
    if (!this.compatibleLayout(this.primaryBase(type), primary)) this.fail("TypeError", "__bases__ assignment: incompatible base layout");
    const entry = {type, bases: type.bases, mro: type.mro, storage: type.storage, typeLayout: type.typeLayout, installed: null};
    const transaction = this.make(HierarchyTransaction, type, bases, [entry]);
    return {transaction, storage};
  }
  subclass(type, parent, depth = 0) {
    if (this.values.isSequenceType(parent, "tuple")) {
      this.bounded(depth < 32, "Class-info tuple nesting budget exceeded");
      for (const item of parent.items) { this.charge(1); if (this.subclass(type, item, depth + 1)) return true; }
      return false;
    }
    if (!this.isType(type) || !this.isType(parent)) this.fail("TypeError", "issubclass requires adopted type values.");
    this.touch(type); this.touch(parent);
    for (const base of this.mro(type)) { this.charge(1); if (base === parent) return true; }
    return false;
  }
  superProxy(type, receiver = null, advertised = undefined) {
    if (!this.isType(type)) this.fail("TypeError", "super requires an adopted type");
    this.touch(type);
    if (receiver === null) return this.make(SuperValue, type, null, null);
    let owner = advertised === undefined ? receiver instanceof ClassValue && this.subclass(receiver, type) ? receiver : this.typeOf(receiver) : advertised;
    if (!this.isType(owner) || !this.subclass(owner, type)) {
      if (advertised === undefined && this.needsAdvertised(receiver))
        this.fail("UnsupportedOperationError", "Advertised class lookup requires owned execution", "UNSUPPORTED");
      this.fail("TypeError", "super receiver must be an instance or subtype of its first argument");
    }
    return this.make(SuperValue, type, receiver, owner);
  }
  callable(value) {
    this.touch(value);
    if (value instanceof InstanceValue) return this.hasSlot(value.type, "__call__");
    return value instanceof ClassValue || value instanceof FunctionValue || value instanceof BuiltinValue && !["getset_descriptor", "member_descriptor"].includes(value.nativeKind) ||
      value instanceof BoundMethodValue || value instanceof MethodWrapperValue && value.kind === "staticmethod";
  }
  propertyArguments(args, keywordNames, keywordValues) {
    const fields = ["fget", "fset", "fdel", "doc"], assigned = new Map();
    if (args.length > fields.length) this.fail("TypeError", "Property accepts at most four arguments.");
    args.forEach((value, index) => assigned.set(fields[index], value));
    keywordNames.forEach((name, index) => {
      if (!fields.includes(name) || assigned.has(name)) this.fail("TypeError", "Invalid or duplicate property argument.");
      assigned.set(name, keywordValues[index]);
    });
    return fields.map(name => assigned.has(name) ? assigned.get(name) : null);
  }
  missingPropertyAccessor(property, operation) {
    const name = property.propertyName;
    let getter = property.fget;
    while (getter instanceof BoundMethodValue) { this.charge(1); getter = getter.callable; }
    if (name !== undefined ? !(name === null || typeof name === "boolean" || typeof name === "bigint" || this.values.isString(name)) :
        getter instanceof InstanceValue || getter instanceof PropertyValue || getter instanceof ClassValue && getter.metaclass !== null)
      this.fail("UnsupportedOperationError", "Property name diagnostic callbacks require a separate stage.", "UNSUPPORTED");
    this.fail("AttributeError", "Property has no " + operation + ".");
  }
  propertyCopyArguments(property, method, replacement) {
    const fields = [property.fget, property.fset, property.fdel];
    if (replacement !== null) fields[{getter: 0, setter: 1, deleter: 2}[method]] = replacement;
    return [...fields, property.getterDoc ? null : property.documentation ?? null];
  }
  isinstance(value, type, depth = 0) {
    if (this.values.isSequenceType(type, "tuple")) {
      this.bounded(depth < 32, "Class-info tuple nesting budget exceeded");
      for (const item of type.items) { this.charge(1); if (this.isinstance(value, item, depth + 1)) return true; }
      return false;
    }
    if (!this.isType(type)) this.fail("TypeError", "isinstance requires an adopted type.");
    this.touch(type); this.touch(value);
    if (type.root || this.subclass(this.typeOf(value), type)) return true;
    if (this.needsAdvertised(value))
      this.fail("UnsupportedOperationError", "Advertised class lookup requires owned execution", "UNSUPPORTED");
    return false;
  }
  selectMetaclass(bases, explicit = undefined) {
    let selected = explicit === undefined ? this.builtin("type") : explicit;
    if (!this.isType(selected)) return selected;
    for (const base of bases) {
      this.charge(1);
      const candidate = this.typeOf(base);
      if (this.subclass(selected, candidate)) continue;
      if (this.subclass(candidate, selected)) selected = candidate;
      else this.fail("TypeError", "Metaclass conflict");
    }
    return selected;
  }
}
