import {DESCRIPTOR_HOOKS} from "./class-policy.mjs";
import {controlRoots} from "./operations.mjs";
// VM-owned edges are explicit so closed-over cells and recursive graphs are rooted.
export class Cell {
  constructor() { this.bound = false; this.value = null; }
}
export class Environment {
  constructor(dictionary = null, identity = null) { this.cells = new Map(); this.order = new Set(); this.dictionary = dictionary; if (identity !== null && identity !== dictionary) this.dictionaryIdentity = identity; }
}
// Host export/metadata reads use exact string entries. Source name resolution
// uses the owned dictionary operation, including callback-bearing collisions.
export function environmentCell(environment, name) {
  if (!environment?.dictionary) return environment?.cells.get(name);
  const entry = environment.dictionary.entries.find(entry => entry.key?.points &&
    String.fromCodePoint(...entry.key.points) === name);
  return entry ? {bound: true, value: entry.value} : undefined;
}
export class CodePool {
  constructor(code, bytes, module = null, source = null) { this.code = code; this.bytes = bytes; this.module = module; this.source = source; this.codeObjects = null; }
}
export class CodeValue {
  constructor(pool, index) { this.pool = pool; this.index = index; this.metadata = new Map(); Object.freeze(this); }
}
export class ModuleValue {
  constructor(name, package_, environment) {
    this.name = name; this.package = package_; this.environment = environment;
    this.pool = null; this.status = "initializing";
  }
}
export class FunctionValue {
  constructor(pool, index, globals, closure, defaults = null, builtins = undefined) {
    this.pool = pool; this.index = index; this.globals = globals; this.closure = closure;
    const params = pool?.code.functions[index]?.params;
    this.positionalDefaults = defaults === null ? (params?.defaults ?? []).map(index => pool.code.constants[index]) : defaults.slice(0, params.defaults.length);
    this.keywordDefaults = new Map(Object.entries(params?.kwdefaults ?? {}).map(([name, index], position) =>
      [name, defaults === null ? pool.code.constants[index] : defaults[params.defaults.length + position]]));
    this.builtins = builtins;
    this.attributes = null;
    this.closureTuple = undefined;
    this.documentation = pool?.code.functions[index]?.doc === undefined ? null : pool.code.constants[pool.code.functions[index].doc];
    this.identityName = undefined; this.identityQualname = undefined;
    const ordinary = pool?.code.version === 5 && index !== 0 && pool.code.functions[index]?.kind === "function";
    const module = ordinary ? environmentCell(globals, "__name__") : null;
    this.identityModule = ordinary ? module?.bound ? module.value : null : undefined;
  }
}
export class GeneratorValue {
  constructor(callable, bindings) {
    this.callable = callable; this.bindings = bindings; this.frame = null;
    this.pool = callable.pool; this.index = callable.index; this.closure = callable.closure;
    this.reflector = null; this.identityName = callable.identityName; this.identityQualname = callable.identityQualname;
    this.status = "created";
  }
}
export function generatorRoots(value) {
  const frame = value.frame;
  return [value.callable, value.reflector, ...[value.identityName, value.identityQualname].filter(item => item != null), ...(value.pool === value.callable?.pool ? [] : [value.pool]),
    ...(value.closure && value.closure !== value.callable?.closure ? value.closure.values() : []), ...value.bindings.values(), ...(frame ?
    [...frame.locals.values(), frame.activeException, ...frame.tasks.flatMap(controlRoots)] : [])];
}
export class FrameValue {
  constructor(raw, back = null) {
    this.raw = raw; this.pool = raw.pool; this.index = raw.index; this.callable = raw.callable;
    this.locals = raw.locals; this.closure = raw.closure; this.back = back;
    this.keys = null; this.extras = null; this.nameKeys = null; this.keyVersion = -1;
  }
}
export class FrameLocalsValue {
  constructor(frame) { this.frame = frame; Object.freeze(this); }
}
export class CallArguments {
  constructor(callable) { this.callable = callable; this.args = []; this.keywords = []; this.keywordValues = []; this.keywordMap = null; }
}
export class ClassValue {
  constructor(name, qualname, module, bases, parents, namespace, root = false, metaclass = null, sourceDefined = true, automaticHash = false) {
    this.name = name; this.qualname = qualname; this.module = module; this.root = root;
    this.bases = Object.freeze([...bases]); this.mro = Object.freeze([this, ...parents]);
    this.typeLayout = bases.some(base => base instanceof BuiltinValue && base.name === "type" || base instanceof ClassValue && base.typeLayout);
    this.namespace = new Map(namespace);
    this.metaclass = metaclass; this.sourceDefined = sourceDefined; this.automaticHash = automaticHash;
    this.firstLine = 1; this.staticAttributes = []; this.namespaceEntries = null;
    this.protocolNames = null;
    this.directoryInitialCount = namespace.size; this.defaultDoc = !namespace.has("__doc__");
  }
}
export class HierarchyTransaction {
  constructor(type, bases, snapshots) { this.type = type; this.bases = bases; this.snapshots = snapshots; this.active = true; }
  rollback() {
    if (!this.active) return;
    for (const entry of [...this.snapshots].reverse()) {
      const type = entry.type;
      if (entry.installed === null ? type.mro === entry.mro : type.mro === entry.installed) {
        type.mro = entry.mro; type.storage = entry.storage; type.typeLayout = entry.typeLayout;
      }
    }
    if (this.type.bases === this.bases) this.type.bases = this.snapshots[0].bases;
    this.active = false;
  }
}
export class ClassNamespaceValue {
  constructor(owner) { this.owner = owner; Object.freeze(this); }
}
export class DictionaryViewValue {
  constructor(dictionary, kind, owner = dictionary) {
    this.dictionary = dictionary; this.kind = kind;
    if (owner !== dictionary) this.owner = owner;
    Object.freeze(this);
  }
}
// A suspended attribute plan retains the results of owned key comparisons.
// Results are local to that plan; a callback that changes a dictionary forces
// a fresh probe before the plan resumes.
export class NamespaceLookupCache { constructor() { this.entries = []; } }
export class NamespaceLookupRequest {
  constructor(owner, name, dictionary, phase = 0) { this.owner = owner; this.name = name; this.dictionary = dictionary; this.phase = phase; }
}
export class InstanceValue {
  constructor(type, nativePayload = undefined) {
    this.type = type; this.attributes = new Map();
    if (nativePayload !== undefined) this.nativePayload = nativePayload;
    if (type.storage?.count) this.slotValues = new Map();
  }
}
export class BoundMethodValue {
  constructor(callable, receiver, pythonMethod = false) {
    this.callable = callable; this.receiver = receiver;
    if (pythonMethod) this.pythonMethod = true;
  }
}
export class SuperValue {
  constructor(thisclass, self, selfClass) { this.thisclass = thisclass; this.self = self; this.selfClass = selfClass; Object.freeze(this); }
}
export {DESCRIPTOR_HOOKS};
export class BuiltinValue { constructor(name) { this.name = name; } }
export class PropertyValue {
  constructor(fget = null, fset = null, fdel = null, propertyName = undefined, documentation = undefined, getterDoc = false) {
    Object.defineProperties(this, {fget: {value: fget, enumerable: true}, fset: {value: fset, enumerable: true},
      fdel: {value: fdel, enumerable: true}, propertyName: {value: propertyName, writable: true},
      documentation: {value: documentation, writable: true}, getterDoc: {value: getterDoc}});
    Object.seal(this);
  }
}
export class MethodWrapperValue {
  constructor(kind, callable) { this.kind = kind; this.callable = callable; this.attributes = null; }
}
export class PropertyAccessorValue extends BuiltinValue {
  constructor(name, property) { super(name); this.property = property; Object.freeze(this); }
}
export class AppendValue extends BuiltinValue {
  constructor(receiver) { super("append"); this.receiver = receiver; }
}
export class ValueMethod extends BuiltinValue {
  constructor(receiver, name) { super(name); this.receiver = receiver; Object.freeze(this); }
}
export class ProtocolIteratorValue {
  constructor(kind, source, sentinel = null) {
    this.kind = kind; this.source = source; this.sentinel = sentinel;
    this.index = 0n; this.exhausted = false;
  }
}
export class NotImplementedValue {}
// Internal canonical scalar identity record; never a source-visible value.
export class IntegerIdentityRecord {
  constructor(integer, identity) { this.integer = integer; this.identity = identity; Object.freeze(this); }
}
export class ExceptionValue {
  constructor(name, args, message, type = null) {
    this.name = name; this.args = args ?? []; this.message = message;
    this.messageArgs = args === null;
    this.traceback = []; this.context = null;
    this.attributes = null;
    if (EXCEPTION_FIELDS[name]) this.nativeFields = new Map(EXCEPTION_FIELDS[name].map(key => [key, null]));
    if (["UnicodeTranslateError", "UnicodeEncodeError"].includes(name)) {
      this.nativeFields.set("start", 0n); this.nativeFields.set("end", 0n);
      this.unicodeFields = 0;
    }
    if (name === "AttributeError") this.attributeFields = 0;
    if (["AttributeError", "ImportError", "ModuleNotFoundError", "SyntaxError", "IndentationError", "TabError", "UnicodeEncodeError"].includes(name) && args === null) this.nativeFieldBoundaries = new Set(EXCEPTION_FIELDS[name]);
    if (type !== null) {
      this.type = type; this.attributes = new Map();
      if (type.storage?.count) this.slotValues = new Map();
    }
  }
}
export const EXCEPTIONS = Object.freeze({
  BaseException: null, GeneratorExit: "BaseException", Exception: "BaseException", AssertionError: "Exception", ArithmeticError: "Exception",
  ZeroDivisionError: "ArithmeticError", OverflowError: "ArithmeticError", LookupError: "Exception", IndexError: "LookupError",
  KeyError: "LookupError", ValueError: "Exception", BufferError: "Exception", TypeError: "Exception", UnicodeError: "ValueError",
  UnicodeEncodeError: "UnicodeError", UnicodeDecodeError: "UnicodeError", UnicodeTranslateError: "UnicodeError",
  SyntaxError: "Exception", IndentationError: "SyntaxError", TabError: "IndentationError",
  NameError: "Exception", UnboundLocalError: "NameError", RuntimeError: "Exception", SystemError: "Exception",
  RecursionError: "RuntimeError", StopIteration: "Exception", AttributeError: "Exception",
  ImportError: "Exception", ModuleNotFoundError: "ImportError"
});
export function matchesException(name, expected) {
  for (let current = name; current; current = EXCEPTIONS[current]) if (expected === current) return true;
  return false;
}
export function isException(value, name) {
  return value instanceof ExceptionValue && (value.type ? value.type.mro.some(base => base instanceof BuiltinValue && base.name === name) : matchesException(value.name, name));
}
// Generic native bases share BaseException storage. Adopted structured bases
// below keep their distinct solid layouts for multiple-inheritance checks.
export const GENERIC_EXCEPTION_BASES = Object.freeze(Object.keys(EXCEPTIONS).filter(name =>
  !["StopIteration", "AttributeError", "ImportError", "ModuleNotFoundError", "NameError", "UnboundLocalError", "SyntaxError", "IndentationError", "TabError", "UnicodeEncodeError", "UnicodeDecodeError", "UnicodeTranslateError"].includes(name)));
const SYNTAX_FIELDS = Object.freeze(["msg", "filename", "lineno", "offset", "text", "end_lineno", "end_offset", "print_file_and_line", "_metadata"]);
export const EXCEPTION_FIELDS = Object.freeze({NameError: Object.freeze(["name"]), UnboundLocalError: Object.freeze(["name"]),
  AttributeError: Object.freeze(["name", "obj"]), ImportError: Object.freeze(["msg", "name", "path", "name_from"]),
  ModuleNotFoundError: Object.freeze(["msg", "name", "path", "name_from"]),
  UnicodeTranslateError: Object.freeze(["encoding", "object", "start", "end", "reason"]),
  UnicodeEncodeError: Object.freeze(["encoding", "object", "start", "end", "reason"]),
  SyntaxError: SYNTAX_FIELDS, IndentationError: SYNTAX_FIELDS, TabError: SYNTAX_FIELDS});
export const EXCEPTION_LAYOUTS = Object.freeze({...Object.fromEntries(GENERIC_EXCEPTION_BASES.map(name => [name, "BaseException"])),
  NameError: "NameError", UnboundLocalError: "NameError", AttributeError: "AttributeError", ImportError: "ImportError", ModuleNotFoundError: "ImportError", StopIteration: "StopIteration",
  SyntaxError: "SyntaxError", IndentationError: "SyntaxError", TabError: "SyntaxError", UnicodeTranslateError: "UnicodeTranslateError", UnicodeEncodeError: "UnicodeEncodeError"});
export const EXCEPTION_BASES = Object.freeze(Object.keys(EXCEPTION_LAYOUTS));

// The source-visible builtin namespace contains only adopted capabilities.
export const SOURCE_BUILTINS = Object.freeze(["__import__", "exec", "__name__", "eval", "compile", "print", "str", "repr", "len", "isinstance", "bool", "iter", "next", "memoryview", "bytes", "bytearray", "set", "frozenset", "all", "any", "list", "tuple", "range", "int", "float", "complex", "abs", "divmod", "pow", "round", "bin", "oct", "hex", "chr", "ord", "id", "globals", "locals", "vars", "dir", "dict", "super", "getattr", "setattr", "delattr", "hasattr", "type", "issubclass", "property", "staticmethod", "classmethod", "callable", "slice", "hash", "reversed", "object", "NotImplemented", ...Object.keys(EXCEPTIONS)]);
