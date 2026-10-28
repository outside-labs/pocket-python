import {DESCRIPTOR_HOOKS} from "./class-policy.mjs";
import {controlRoots} from "./operations.mjs";
// VM-owned edges are explicit so closed-over cells and recursive graphs are rooted.
export class Cell {
  constructor() { this.bound = false; this.value = null; }
}
export class Environment {
  constructor() { this.cells = new Map(); }
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
  constructor(pool, index, globals, closure, defaults = null) {
    this.pool = pool; this.index = index; this.globals = globals; this.closure = closure;
    this.defaults = defaults === null ? null : Object.freeze([...defaults]);
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
  constructor(name, qualname, module, bases, parents, namespace, root = false, metaclass = null) {
    this.name = name; this.qualname = qualname; this.module = module; this.root = root;
    this.bases = Object.freeze([...bases]); this.mro = Object.freeze([this, ...parents]);
    this.namespace = new Map(namespace);
    this.metaclass = metaclass;
  }
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
  constructor(fget = null, fset = null, fdel = null) {
    this.fget = fget; this.fset = fset; this.fdel = fdel; Object.freeze(this);
  }
}
export class MethodWrapperValue {
  constructor(kind, callable) { this.kind = kind; this.callable = callable; Object.freeze(this); }
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
