import {DESCRIPTOR_HOOKS} from "./class-policy.mjs";
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
  constructor(pool, index, globals, closure) {
    this.pool = pool; this.index = index; this.globals = globals; this.closure = closure;
  }
}
export class ClassValue {
  constructor(name, qualname, module, bases, parents, namespace, root = false) {
    this.name = name; this.qualname = qualname; this.module = module; this.root = root;
    this.bases = Object.freeze([...bases]); this.mro = Object.freeze([this, ...parents]);
    this.namespace = new Map(namespace);
  }
}
export class InstanceValue {
  constructor(type) { this.type = type; this.attributes = new Map(); }
}
export class BoundMethodValue {
  constructor(callable, receiver) { this.callable = callable; this.receiver = receiver; }
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
  BaseException: null, Exception: "BaseException", ArithmeticError: "Exception",
  ZeroDivisionError: "ArithmeticError", OverflowError: "ArithmeticError", LookupError: "Exception", IndexError: "LookupError",
  KeyError: "LookupError", ValueError: "Exception", TypeError: "Exception",
  NameError: "Exception", UnboundLocalError: "NameError", RuntimeError: "Exception",
  RecursionError: "RuntimeError", StopIteration: "Exception", AttributeError: "Exception",
  ImportError: "Exception", ModuleNotFoundError: "ImportError"
});
export function matchesException(name, expected) {
  for (let current = name; current; current = EXCEPTIONS[current]) if (expected === current) return true;
  return false;
}
