import {ClassValue, InstanceValue, BoundMethodValue, SuperValue, FunctionValue, BuiltinValue, EXCEPTIONS, matchesException, PropertyValue, MethodWrapperValue, PropertyAccessorValue, GeneratorValue, ModuleValue, Cell, NotImplementedValue, ProtocolIteratorValue} from "./function-objects.mjs";
import {allowsClassSpecial, isSpecialName} from "./class-policy.mjs";
import {ValueRuntime, valueLayout} from "./values.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

export const CLASS_LIMITS = Object.freeze({bases: 16, mro: 64, attributes: 128, name: 256});
const NATIVE_TYPES = new Set(["type", "bool", "int", "float", "complex", "str", "list", "tuple", "dict", "range", "slice", "set", "frozenset", "bytes", "bytearray", "memoryview",
  "super", "property", "staticmethod", "classmethod", "NoneType", "NotImplementedType", "function", "method", "method-wrapper", "method_descriptor", "builtin_function_or_method", "generator", "module", "cell",
  "list_iterator", "tuple_iterator", "str_iterator", "dict_keyiterator", "range_iterator", "set_iterator", "bytes_iterator", "bytearray_iterator", "memory_iterator", "iterator", "callable_iterator", ...Object.keys(EXCEPTIONS)]);
const META_SPECIALS = new Set(["__new__", "__init__", "__call__", "__module__", "__qualname__", "__instancecheck__", "__subclasscheck__"]);
const NATIVE_CHECK_METHODS = new Set(["type.__instancecheck__", "type.__subclasscheck__"]);

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
    if (metaLayout && [...names].some(key => isSpecialName(key) && !META_SPECIALS.has(key)))
      this.fail("UnsupportedOperationError", "Further metaclass special protocols require a separate stage", "UNSUPPORTED");
  }
  create(name, qualname, module, bases, namespace, root, {dynamic = false, metaclass = null} = {}) {
    this.key(name);
    if (!dynamic && !isPythonIdentifier(name)) throw new TypeError("Invalid class name.");
    this.bounded(typeof qualname === "string" && qualname.length <= 256 && typeof module === "string" && module.length <= 192,
      "Class identity budget exceeded.");
    if (!(root instanceof ClassValue) || !root.root || !Array.isArray(bases) || !(namespace instanceof Map)) throw new TypeError("Invalid class construction record.");
    this.touch(root);
    this.bounded(bases.length <= CLASS_LIMITS.bases && namespace.size <= CLASS_LIMITS.attributes, "Class base/namespace budget exceeded.");
    bases = bases.length ? [...bases] : [root]; namespace = new Map(namespace);
    this.validateNamespace(bases, namespace.keys());
    if (namespace.has("__eq__") && !namespace.has("__hash__")) namespace.set("__hash__", null);
    this.bounded(namespace.size <= CLASS_LIMITS.attributes, "Class namespace budget exceeded.");
    for (const base of bases) {
      this.charge(1);
      if (base instanceof BuiltinValue && base.name === "type") { this.touch(base); continue; }
      if (base instanceof BuiltinValue && NATIVE_TYPES.has(base.name))
        this.fail("UnsupportedOperationError", "Builtin subclassing is outside classes-source/1.", "UNSUPPORTED");
      if (!(base instanceof ClassValue)) this.fail("TypeError", "Class bases must be adopted class values.");
      this.touch(base);
    }
    if (new Set(bases).size !== bases.length) this.fail("TypeError", "Duplicate class base.");
    for (const key of namespace.keys()) {
      this.key(key);
      if (!allowsClassSpecial(key, "define"))
        this.fail("UnsupportedOperationError", "Custom special methods require a later class stage.", "UNSUPPORTED");
    }
    if (namespace.get("__new__") instanceof FunctionValue)
      namespace.set("__new__", this.make(MethodWrapperValue, "staticmethod", namespace.get("__new__")));
    for (const [key, expected] of [["__module__", module], ["__qualname__", qualname]])
      if (namespace.has(key) && this.values.text(namespace.get(key)) !== expected)
        this.fail("UnsupportedOperationError", "Class metadata overrides are outside C1.", "UNSUPPORTED");
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
    return this.make(ClassValue, name, qualname, module, bases, parents, namespace, false, metaclass);
  }
  instance(type) {
    if (!(type instanceof ClassValue)) throw new TypeError("An adopted class is required.");
    this.touch(type); return this.make(InstanceValue, type);
  }
  hasSlot(type, name) {
    // The bounded MRO is also the native slot-presence index. Default calls keep
    // their original lookup/accounting path; only adopted overrides add phases.
    return type.mro.some(base => base instanceof ClassValue && !base.root && base.namespace.has(name));
  }
  isType(value) { return value instanceof ClassValue || value?.constructor === BuiltinValue && NATIVE_TYPES.has(value.name); }
  isMetaclass(value) { return value instanceof ClassValue && value.mro.some(base => base instanceof BuiltinValue && base.name === "type"); }
  mro(type) {
    if (type instanceof ClassValue) return type.mro;
    if (!this.isType(type)) this.fail("TypeError", "An adopted type is required");
    const result = [type];
    let name = type.name;
    while (name === "bool" || EXCEPTIONS[name]) { name = name === "bool" ? "int" : EXCEPTIONS[name]; result.push(this.builtin(name)); }
    result.push(this.builtin("object")); return result;
  }
  typeOf(value) {
    this.touch(value);
    if (value instanceof InstanceValue) return value.type;
    if (value instanceof ClassValue) return value.metaclass || this.builtin("type");
    let name = this.values.typeName(value);
    if (name === null) {
      if (this.isType(value)) name = "type";
      else if (value instanceof BuiltinValue) name = NATIVE_CHECK_METHODS.has(value.name) ? "method_descriptor" : "builtin_function_or_method";
      else if (value instanceof FunctionValue) name = "function";
      else if (value instanceof BoundMethodValue) name = value.callable instanceof BuiltinValue ?
        NATIVE_CHECK_METHODS.has(value.callable.name) ? "builtin_function_or_method" : "method-wrapper" : "method";
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
    return value instanceof InstanceValue && ["__class__", "__getattribute__", "__getattr__"].some(name => this.hasSlot(value.type, name));
  }
  checkingType(value) {
    return value instanceof ClassValue ? value.metaclass : value instanceof InstanceValue ? value.type : null;
  }
  customCheck(value, name) {
    const type = this.checkingType(value);
    return type !== null && this.hasSlot(type, name);
  }
  bindCheck(value, name) {
    const type = this.checkingType(value), item = this.lookup(type, name);
    return this.bindAttribute(item.value, value, type);
  }
  lookup(type, name, native = true, start = 0) {
    this.key(name); this.touch(type);
    if (!this.isType(type)) throw new TypeError("An adopted class is required.");
    for (const base of this.mro(type).slice(start)) {
      this.charge(1);
      if (base instanceof BuiltinValue) {
        if (native && base.name === "type" && ["__new__", "__init__", "__call__", "__instancecheck__", "__subclasscheck__"].includes(name))
          return {found: true, value: this.builtin("type." + name)};
        continue;
      }
      if (!native && base.root && ["__new__", "__init__", "__getattribute__", "__setattr__", "__delattr__"].includes(name)) continue;
      if (base.namespace.has(name)) return {found: true, value: base.namespace.get(name)};
      if (native && base.root && ["__hash__", "__new__", "__init__", "__getattribute__", "__setattr__", "__delattr__"].includes(name)) {
        const value = this.make(BuiltinValue, "object." + name);
        base.namespace.set(name, value);
        try { const layout = valueLayout(base); this.memory?.resize(base, layout.bytes, layout.children); }
        catch (error) { base.namespace.delete(name); throw error; }
        return {found: true, value};
      }
    }
    return {found: false, value: null};
  }
  descriptor(value) {
    if (!(value instanceof InstanceValue)) return null;
    return {get: this.lookup(value.type, "__get__"), set: this.lookup(value.type, "__set__"),
      delete: this.lookup(value.type, "__delete__")};
  }
  boundHook(receiver, name, args) {
    if (!(receiver instanceof InstanceValue)) return null;
    const hook = this.lookup(receiver.type, name);
    if (!hook.found) return null;
    if (hook.value instanceof MethodWrapperValue) return {kind: "call",
      callable: hook.value.kind === "classmethod" ? this.make(BoundMethodValue, hook.value.callable, receiver.type) : hook.value.callable, args};
    if (hook.value instanceof FunctionValue) return {kind: "call", callable: hook.value, args: [receiver, ...args]};
    if (hook.value instanceof PropertyValue || this.descriptor(hook.value)?.get.found)
      this.fail("UnsupportedOperationError", "Descriptor-valued mutation/notification hooks require a later stage.", "UNSUPPORTED");
    return {kind: "call", callable: hook.value, args};
  }
  notification(receiver, owner, name) { return this.boundHook(receiver, "__set_name__", [owner, name]); }
  read(receiver, name) {
    this.key(name); this.touch(receiver);
    const value = value => ({kind: "value", value});
    if (receiver instanceof SuperValue) {
      if (name === "__class__") return value(this.builtin("super"));
      if (["__thisclass__", "__self__", "__self_class__"].includes(name))
        return value(receiver[{__thisclass__: "thisclass", __self__: "self", __self_class__: "selfClass"}[name]]);
      if (receiver.selfClass !== null) {
        const item = this.lookup(receiver.selfClass, name, true, this.mro(receiver.selfClass).indexOf(receiver.thisclass) + 1);
        if (item.found) return this.bindAttribute(item.value, receiver.self === receiver.selfClass ? null : receiver.self, receiver.selfClass);
      }
      this.fail("AttributeError", "super has no attribute '" + name + "'.");
    }
    if (receiver instanceof BuiltinValue) {
      if (name === "__class__") return value(this.typeOf(receiver));
      if (["__name__", "__qualname__"].includes(name)) return value(this.values.string(Array.from(
        name === "__name__" && NATIVE_CHECK_METHODS.has(receiver.name) ? receiver.name.slice(5) : receiver.name, char => char.codePointAt(0))));
      if (this.isType(receiver)) {
        if (receiver.name !== "type" && ["__instancecheck__", "__subclasscheck__"].includes(name))
          return this.bindAttribute(this.builtin("type." + name), receiver, this.builtin("type"));
        if (name === "__module__") return value(this.values.string(Array.from("builtins", char => char.codePointAt(0))));
        if (name === "__mro__") return value(this.values.tuple(this.mro(receiver)));
        if (name === "__bases__") return value(this.values.tuple([this.mro(receiver)[1]]));
        const item = this.lookup(receiver, name);
        if (item.found) return this.bindAttribute(item.value, null, receiver);
      }
      this.fail("AttributeError", "Builtin has no adopted attribute '" + name + "'.");
    }
    if (receiver instanceof PropertyValue) {
      if (["fget", "fset", "fdel"].includes(name)) return value(receiver[name]);
      if (["getter", "setter", "deleter"].includes(name)) return value(this.make(PropertyAccessorValue, name, receiver));
      this.fail("UnsupportedOperationError", "Property reflection is outside the adopted profile.", "UNSUPPORTED");
    }
    if (receiver instanceof MethodWrapperValue) {
      if (name === "__func__") return value(receiver.callable);
      this.fail("UnsupportedOperationError", "Method wrapper reflection is outside the adopted profile.", "UNSUPPORTED");
    }
    if (receiver instanceof BoundMethodValue && name === "__func__" && receiver.callable instanceof BuiltinValue && NATIVE_CHECK_METHODS.has(receiver.callable.name))
      this.fail("AttributeError", "Native checking methods have no __func__ attribute.");
    if (receiver instanceof BoundMethodValue && ["__self__", "__func__"].includes(name))
      return value(name === "__self__" ? receiver.receiver : receiver.callable);
    if (receiver instanceof FunctionValue && ["__name__", "__qualname__"].includes(name)) {
      const fn = receiver.pool.code.functions[receiver.index];
      return value(this.values.string(Array.from(name === "__name__" ? fn.name : fn.qualname, char => char.codePointAt(0))));
    }
    if (!(receiver instanceof ClassValue || receiver instanceof InstanceValue))
      this.fail("UnsupportedOperationError", "Attribute receiver is outside the class profile.", "UNSUPPORTED");
    if (receiver instanceof InstanceValue && name === "__class__") {
      const item = this.lookup(receiver.type, name);
      return item.found ? this.bindAttribute(item.value, receiver, receiver.type) : value(this.classAttribute(receiver));
    }
    if (receiver instanceof ClassValue) {
      if (name === "__class__") return value(receiver.metaclass || this.builtin("type"));
      if (["__name__", "__qualname__", "__module__"].includes(name)) return value(this.values.string(Array.from(
        receiver[{__name__: "name", __qualname__: "qualname", __module__: "module"}[name]], char => char.codePointAt(0))));
      if (["__bases__", "__mro__"].includes(name)) return value(this.values.tuple(name === "__bases__" ? receiver.bases : receiver.mro));
    }
    if (!allowsClassSpecial(name, "attribute")) this.fail("UnsupportedOperationError", "This special attribute is outside classes-source/1.", "UNSUPPORTED");
    const owner = receiver instanceof ClassValue ? receiver : receiver.type;
    const metaclass = receiver instanceof ClassValue ? receiver.metaclass || (["__instancecheck__", "__subclasscheck__"].includes(name) ? this.builtin("type") : null) : null;
    const metaItem = metaclass ? this.lookup(metaclass, name) : null;
    const metaDescriptor = metaItem?.found ? this.descriptor(metaItem.value) : null;
    if (metaItem?.value instanceof PropertyValue || metaDescriptor?.get.found && (metaDescriptor.set.found || metaDescriptor.delete.found))
      return this.bindAttribute(metaItem.value, receiver, metaclass);
    const item = this.lookup(owner, name), descriptor = item.found ? this.descriptor(item.value) : null;
    if (receiver instanceof InstanceValue && (item.value instanceof PropertyValue ||
        descriptor?.get.found && (descriptor.set.found || descriptor.delete.found)))
      return this.bindAttribute(item.value, receiver, owner);
    if (receiver instanceof InstanceValue && receiver.attributes.has(name)) return value(receiver.attributes.get(name));
    if (!item.found) {
      if (metaItem?.found) return this.bindAttribute(metaItem.value, receiver, metaclass);
      this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    }
    return this.bindAttribute(item.value, receiver instanceof ClassValue ? null : receiver, owner);
  }
  bindAttribute(value, receiver, owner) {
    if (value instanceof SuperValue && value.self === null && receiver !== null) {
      if (this.needsAdvertised(receiver) && !this.subclass(receiver.type, value.thisclass))
        return {kind: "call", callable: this.builtin("super"), args: [value.thisclass, receiver]};
      return {kind: "value", value: this.superProxy(value.thisclass, receiver)};
    }
    if (receiver !== null && value instanceof PropertyValue) {
      if (value.fget === null) this.fail("AttributeError", "Property has no getter.");
      return {kind: "call", callable: value.fget, args: [receiver]};
    }
    const descriptor = this.descriptor(value);
    if (descriptor?.get.found) return {kind: "call", callable: descriptor.get.value, args: [value, receiver, owner]};
    if (value instanceof MethodWrapperValue) return {kind: "value", value: value.kind === "staticmethod" ?
      value.callable : this.make(BoundMethodValue, value.callable, owner)};
    return {kind: "value", value: receiver !== null && (value instanceof FunctionValue ||
      value instanceof BuiltinValue && ["object.__hash__", "object.__init__", "object.__getattribute__", "object.__setattr__", "object.__delattr__", "type.__init__", "type.__call__", "type.__instancecheck__", "type.__subclasscheck__"].includes(value.name)) ? this.make(BoundMethodValue, value, receiver) : value};
  }
  special(receiver, name) {
    this.key(name); this.touch(receiver);
    if (!isSpecialName(name) || !allowsClassSpecial(name, "implicit"))
      this.fail("UnsupportedOperationError", "This implicit special protocol is outside classes-source/1.", "UNSUPPORTED");
    if (!(receiver instanceof InstanceValue)) throw new TypeError("Implicit user protocols require an instance.");
    const item = this.lookup(receiver.type, name);
    return item.found ? this.bindAttribute(item.value, receiver, receiver.type) : null;
  }

  get(receiver, name) {
    const result = this.read(receiver, name);
    if (result.kind !== "value") this.fail("UnsupportedOperationError", "Descriptor calls require VM execution frames.", "UNSUPPORTED");
    return result.value;
  }
  write(receiver, name, value, remove = false) {
    this.key(name); this.touch(receiver);
    if (receiver instanceof SuperValue) this.fail("AttributeError", "super attributes are read-only");
    if (receiver instanceof InstanceValue || receiver instanceof ClassValue && receiver.metaclass) {
      const item = this.lookup(receiver instanceof InstanceValue ? receiver.type : receiver.metaclass, name), descriptor = item.found ? this.descriptor(item.value) : null;
      if (item.value instanceof PropertyValue) {
        const callable = item.value[remove ? "fdel" : "fset"];
        if (callable === null) this.fail("AttributeError", "Property has no " + (remove ? "deleter" : "setter") + ".");
        return {kind: "call", callable, args: remove ? [receiver] : [receiver, value]};
      }
      if (descriptor && (descriptor.set.found || descriptor.delete.found)) {
        const hook = remove ? "__delete__" : "__set__";
        if (!descriptor[remove ? "delete" : "set"].found) this.fail("AttributeError", "Descriptor has no " + hook + " operation.");
        return this.boundHook(item.value, hook, remove ? [receiver] : [receiver, value]);
      }
    }
    return {kind: "value", value: this.mutate(receiver, name, value, remove)};
  }
  mutate(receiver, name, value, remove = false) {
    this.key(name); this.touch(receiver);
    if (!(receiver instanceof ClassValue || receiver instanceof InstanceValue))
      this.fail("UnsupportedOperationError", "Attribute mutation requires a class or instance.", "UNSUPPORTED");
    if (receiver instanceof ClassValue && receiver.root) this.fail("TypeError", "Cannot mutate the immutable object type.");
    if (receiver instanceof ClassValue && this.isMetaclass(receiver) && isSpecialName(name) && !META_SPECIALS.has(name))
      this.fail("UnsupportedOperationError", "Further metaclass special protocols require a separate stage", "UNSUPPORTED");
    if (!allowsClassSpecial(name, "mutate")) this.fail("UnsupportedOperationError", "Special attribute mutation is outside classes-source/1.", "UNSUPPORTED");
    const map = receiver instanceof ClassValue ? receiver.namespace : receiver.attributes;
    const present = map.has(name), before = map.get(name);
    if (remove && !present) this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    this.bounded(remove || present || map.size < CLASS_LIMITS.attributes, "Class/instance attribute budget exceeded.");
    if (remove) map.delete(name); else map.set(name, value);
    try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
    catch (error) { if (present) map.set(name, before); else map.delete(name); throw error; }
    return null;
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
    if (value instanceof InstanceValue) return this.lookup(value.type, "__call__").found;
    return value instanceof ClassValue || value instanceof FunctionValue || value instanceof BuiltinValue ||
      value instanceof BoundMethodValue || value instanceof MethodWrapperValue && value.kind === "staticmethod";
  }
  property(args, keywordNames, keywordValues) {
    const fields = ["fget", "fset", "fdel"], assigned = new Map();
    if (args.length > fields.length || keywordNames.includes("doc"))
      this.fail("UnsupportedOperationError", "Property documentation requires a later stage.", "UNSUPPORTED");
    args.forEach((value, index) => assigned.set(fields[index], value));
    keywordNames.forEach((name, index) => {
      if (!fields.includes(name) || assigned.has(name)) this.fail("TypeError", "Invalid or duplicate property argument.");
      assigned.set(name, keywordValues[index]);
    });
    return this.make(PropertyValue, ...fields.map(name => assigned.has(name) ? assigned.get(name) : null));
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
    if (!this.callable(selected)) this.fail("TypeError", "Metaclass must be callable");
    if (!this.isType(selected)) this.fail("UnsupportedOperationError", "Callable metaclass factories require a separate construction stage", "UNSUPPORTED");
    for (const base of bases) {
      this.charge(1);
      const candidate = this.typeOf(base);
      if (this.subclass(selected, candidate)) continue;
      if (this.subclass(candidate, selected)) selected = candidate;
      else this.fail("TypeError", "Metaclass conflict");
    }
    if (!(selected instanceof BuiltinValue && selected.name === "type") && !this.isMetaclass(selected))
      this.fail("UnsupportedOperationError", "Non-type metaclass constructors require a separate stage", "UNSUPPORTED");
    return selected;
  }
}
