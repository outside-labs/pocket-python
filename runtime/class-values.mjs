import {ClassValue, InstanceValue, BoundMethodValue, FunctionValue, BuiltinValue, EXCEPTIONS} from "./function-objects.mjs";
import {ValueRuntime, valueLayout} from "./values.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

export const CLASS_LIMITS = Object.freeze({bases: 16, mro: 64, attributes: 128, name: 256});
const special = name => name.startsWith("__") && name.endsWith("__");

export class ClassRuntime {
  constructor({memory = null, charge = () => {}, fail = null, values = null} = {}) {
    this.memory = memory; this.charge = charge;
    this.fail = fail || ((name, message, code = "PYTHON") => { throw Object.assign(new Error(message), {name, code}); });
    this.values = values || new ValueRuntime({memory, charge, fail: this.fail});
  }
  make(Type, ...args) {
    const value = new Type(...args), layout = valueLayout(value);
    return this.memory ? this.memory.allocate(layout.bytes, layout.children, () => value) : value;
  }
  touch(value) { this.charge(1); this.memory?.primitive(value); }
  bounded(condition, message) { if (!condition) this.fail("ExecutionLimitError", message, "BUDGET"); }
  key(name) {
    this.charge(typeof name === "string" ? name.length + 1 : 1);
    if (typeof name !== "string" || name.length > CLASS_LIMITS.name || !isPythonIdentifier(name)) throw new TypeError("Invalid class attribute name.");
  }
  root() { return this.make(ClassValue, "object", "object", "builtins", [], [], new Map(), true); }
  create(name, qualname, module, bases, namespace, root) {
    this.key(name);
    this.bounded(typeof qualname === "string" && qualname.length <= 256 && typeof module === "string" && module.length <= 192,
      "Class identity budget exceeded.");
    if (!(root instanceof ClassValue) || !root.root || !Array.isArray(bases) || !(namespace instanceof Map)) throw new TypeError("Invalid class construction record.");
    this.touch(root);
    this.bounded(bases.length <= CLASS_LIMITS.bases && namespace.size <= CLASS_LIMITS.attributes, "Class base/namespace budget exceeded.");
    bases = bases.length ? [...bases] : [root]; namespace = new Map(namespace);
    for (const base of bases) {
      this.charge(1);
      if (base instanceof BuiltinValue && (["str", "bool", "type"].includes(base.name) || Object.hasOwn(EXCEPTIONS, base.name)))
        this.fail("UnsupportedOperationError", "Builtin subclassing is outside classes-source/1.", "UNSUPPORTED");
      if (!(base instanceof ClassValue)) this.fail("TypeError", "Class bases must be adopted class values.");
      this.touch(base);
    }
    if (new Set(bases).size !== bases.length) this.fail("TypeError", "Duplicate class base.");
    for (const key of namespace.keys()) {
      this.key(key);
      if (special(key) && !["__init__", "__module__", "__qualname__"].includes(key))
        this.fail("UnsupportedOperationError", "Custom special methods require a later class stage.", "UNSUPPORTED");
    }
    if (namespace.has("__init__")) this.initializer(namespace.get("__init__"));
    for (const [key, expected] of [["__module__", module], ["__qualname__", qualname]])
      if (namespace.has(key) && this.values.text(namespace.get(key)) !== expected)
        this.fail("UnsupportedOperationError", "Class metadata overrides are outside C1.", "UNSUPPORTED");
    const pending = [...bases.map(base => [...base.mro]), [...bases]], parents = [];
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
    return this.make(ClassValue, name, qualname, module, bases, parents, namespace);
  }
  instance(type) {
    if (!(type instanceof ClassValue)) throw new TypeError("An adopted class is required.");
    this.touch(type); return this.make(InstanceValue, type);
  }
  lookup(type, name) {
    this.key(name); this.touch(type);
    if (!(type instanceof ClassValue)) throw new TypeError("An adopted class is required.");
    for (const base of type.mro) {
      this.charge(1);
      if (base.namespace.has(name)) return {found: true, value: base.namespace.get(name)};
    }
    return {found: false, value: null};
  }
  get(receiver, name) {
    this.key(name); this.touch(receiver);
    if (receiver instanceof BoundMethodValue && ["__self__", "__func__"].includes(name))
      return name === "__self__" ? receiver.receiver : receiver.callable;
    if (receiver instanceof FunctionValue && ["__name__", "__qualname__"].includes(name)) {
      const fn = receiver.pool.code.functions[receiver.index];
      return this.values.string(Array.from(name === "__name__" ? fn.name : fn.qualname, char => char.codePointAt(0)));
    }
    if (!(receiver instanceof ClassValue || receiver instanceof InstanceValue))
      this.fail("UnsupportedOperationError", "Attribute receiver is outside the class profile.", "UNSUPPORTED");
    if (receiver instanceof InstanceValue && name === "__class__") return receiver.type;
    if (receiver instanceof ClassValue) {
      if (["__name__", "__qualname__", "__module__"].includes(name)) return this.values.string(Array.from(
        receiver[{__name__: "name", __qualname__: "qualname", __module__: "module"}[name]], char => char.codePointAt(0)));
      if (["__bases__", "__mro__"].includes(name)) return this.values.tuple(name === "__bases__" ? receiver.bases : receiver.mro);
    }
    if (special(name) && name !== "__init__") this.fail("UnsupportedOperationError", "This special attribute is outside classes-source/1.", "UNSUPPORTED");
    if (receiver instanceof InstanceValue && receiver.attributes.has(name)) return receiver.attributes.get(name);
    const item = this.lookup(receiver instanceof ClassValue ? receiver : receiver.type, name);
    if (!item.found) this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    return receiver instanceof InstanceValue && item.value instanceof FunctionValue ? this.make(BoundMethodValue, item.value, receiver) : item.value;
  }
  mutate(receiver, name, value, remove = false) {
    this.key(name); this.touch(receiver);
    if (!(receiver instanceof ClassValue || receiver instanceof InstanceValue))
      this.fail("UnsupportedOperationError", "Attribute mutation requires a class or instance.", "UNSUPPORTED");
    if (receiver instanceof ClassValue && receiver.root) this.fail("TypeError", "Cannot mutate the immutable object type.");
    if (special(name) && name !== "__init__") this.fail("UnsupportedOperationError", "Special attribute mutation is outside classes-source/1.", "UNSUPPORTED");
    if (receiver instanceof ClassValue && name === "__init__" && !remove) this.initializer(value);
    const map = receiver instanceof ClassValue ? receiver.namespace : receiver.attributes;
    const present = map.has(name), before = map.get(name);
    if (remove && !present) this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    this.bounded(remove || present || map.size < CLASS_LIMITS.attributes, "Class/instance attribute budget exceeded.");
    if (remove) map.delete(name); else map.set(name, value);
    try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
    catch (error) { if (present) map.set(name, before); else map.delete(name); throw error; }
    return null;
  }
  subclass(type, parent) {
    if (!(type instanceof ClassValue) || !(parent instanceof ClassValue)) this.fail("TypeError", "issubclass requires adopted class values.");
    this.touch(type); this.touch(parent);
    for (const base of type.mro) { this.charge(1); if (base === parent) return true; }
    return false;
  }
  initializer(value) {
    if (!(value instanceof FunctionValue || value instanceof BoundMethodValue && value.callable instanceof FunctionValue))
      this.fail("UnsupportedOperationError", "Initializers require Python functions or retained bound methods in C1.", "UNSUPPORTED");
  }
  isinstance(value, type) {
    if (!(type instanceof ClassValue)) this.fail("TypeError", "isinstance requires an adopted class.");
    this.touch(type); this.touch(value);
    return type.root || value instanceof InstanceValue && this.subclass(value.type, type);
  }
}
