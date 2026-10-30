import {DESCRIPTOR_HOOKS} from "./class-policy.mjs";
import {controlRoots} from "./operations.mjs";
// VM-owned edges are explicit so closed-over cells and recursive graphs are rooted.
export class Cell {
  constructor() { this.bound = false; this.value = null; }
}
export class Environment {
  constructor() { this.cells = new Map(); this.order = new Set(); this.dictionary = null; }
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
  constructor(code, bytes, module = null) { this.code = code; this.bytes = bytes; this.module = module; }
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
    this.status = "created";
  }
}
export function generatorRoots(value) {
  const frame = value.frame;
  return [value.callable, ...value.bindings.values(), ...(frame ?
    [...frame.locals.values(), frame.activeException, ...frame.tasks.flatMap(controlRoots)] : [])];
}
export class CallArguments {
  constructor(callable) { this.callable = callable; this.args = []; this.keywords = []; this.keywordValues = []; this.keywordMap = null; }
}
export class ClassValue {
  constructor(name, qualname, module, bases, parents, namespace, root = false, metaclass = null, sourceDefined = true, automaticHash = false) {
    this.name = name; this.qualname = qualname; this.module = module; this.root = root;
    this.bases = Object.freeze([...bases]); this.mro = Object.freeze([this, ...parents]);
    this.namespace = new Map(namespace);
    this.metaclass = metaclass; this.sourceDefined = sourceDefined; this.automaticHash = automaticHash;
    this.firstLine = 1; this.staticAttributes = []; this.namespaceEntries = null;
    this.protocolNames = null;
    this.directoryInitialCount = namespace.size; this.defaultDoc = !namespace.has("__doc__");
  }
}
export class ClassNamespaceValue {
  constructor(owner) { this.owner = owner; Object.freeze(this); }
}
export class DictionaryViewValue {
  constructor(dictionary, kind) { this.dictionary = dictionary; this.kind = kind; Object.freeze(this); }
}
// A suspended attribute plan retains the results of owned key comparisons.
// Results are local to that plan; a callback that changes a dictionary forces
// a fresh probe before the plan resumes.
export class NamespaceLookupCache { constructor() { this.entries = []; } }
export class NamespaceLookupRequest {
  constructor(owner, name, dictionary, phase = 0) { this.owner = owner; this.name = name; this.dictionary = dictionary; this.phase = phase; }
}
export class InstanceValue {
  constructor(type) { this.type = type; this.attributes = new Map(); }
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
export class ExceptionValue {
  constructor(name, args, message) {
    this.name = name; this.args = args; this.message = message;
    this.traceback = []; this.context = null;
  }
}
export const EXCEPTIONS = Object.freeze({
  BaseException: null, GeneratorExit: "BaseException", Exception: "BaseException", AssertionError: "Exception", ArithmeticError: "Exception",
  ZeroDivisionError: "ArithmeticError", OverflowError: "ArithmeticError", LookupError: "Exception", IndexError: "LookupError",
  KeyError: "LookupError", ValueError: "Exception", TypeError: "Exception", UnicodeError: "ValueError",
  UnicodeEncodeError: "UnicodeError", UnicodeDecodeError: "UnicodeError", UnicodeTranslateError: "UnicodeError",
  NameError: "Exception", UnboundLocalError: "NameError", RuntimeError: "Exception",
  RecursionError: "RuntimeError", StopIteration: "Exception", AttributeError: "Exception",
  ImportError: "Exception", ModuleNotFoundError: "ImportError"
});
export function matchesException(name, expected) {
  for (let current = name; current; current = EXCEPTIONS[current]) if (expected === current) return true;
  return false;
}

// The source-visible builtin namespace contains only adopted capabilities.
export const SOURCE_BUILTINS = Object.freeze(["print", "str", "repr", "len", "isinstance", "bool", "iter", "next", "memoryview", "bytes", "bytearray", "set", "frozenset", "all", "any", "list", "tuple", "range", "int", "float", "complex", "abs", "divmod", "pow", "round", "bin", "oct", "hex", "chr", "ord", "id", "globals", "locals", "vars", "dir", "dict", "super", "getattr", "setattr", "delattr", "hasattr", "type", "issubclass", "property", "staticmethod", "classmethod", "callable", "slice", "hash", "reversed", "object", "NotImplemented", ...Object.keys(EXCEPTIONS)]);
