import {ClassValue, ClassNamespaceValue, InstanceValue, BoundMethodValue, SuperValue, FunctionValue, BuiltinValue, EXCEPTIONS, matchesException, PropertyValue, MethodWrapperValue, PropertyAccessorValue, GeneratorValue, ModuleValue, Cell, NotImplementedValue, ProtocolIteratorValue} from "./function-objects.mjs";
import {allowsClassSpecial, isSpecialName} from "./class-policy.mjs";
import {ValueRuntime, valueLayout} from "./values.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

export const CLASS_LIMITS = Object.freeze({bases: 16, mro: 64, attributes: 128, name: 256});
const NATIVE_TYPES = new Set(["type", "bool", "int", "float", "complex", "str", "list", "tuple", "dict", "range", "slice", "set", "frozenset", "bytes", "bytearray", "memoryview",
  "mappingproxy", "super", "property", "staticmethod", "classmethod", "NoneType", "NotImplementedType", "function", "method", "method-wrapper", "method_descriptor", "wrapper_descriptor", "builtin_function_or_method", "generator", "module", "cell",
  "list_iterator", "tuple_iterator", "str_iterator", "dict_keyiterator", "range_iterator", "set_iterator", "bytes_iterator", "bytearray_iterator", "memory_iterator", "iterator", "callable_iterator", ...Object.keys(EXCEPTIONS)]);
const META_SPECIALS = new Set(["__dict__", "__new__", "__init__", "__init_subclass__", "__call__", "__module__", "__qualname__", "__instancecheck__", "__subclasscheck__", "__dir__", "__getattribute__", "__getattr__", "__name__", "__isabstractmethod__", "__doc__", "__setattr__", "__delattr__"]);
const NATIVE_CHECK_METHODS = new Set(["type.__instancecheck__", "type.__subclasscheck__"]);
const NATIVE_COPY_METHODS = new Set(["property.getter", "property.setter", "property.deleter"]);
const NATIVE_PROPERTY_METHODS = new Set([...NATIVE_COPY_METHODS, "property.__set_name__"]);
const NATIVE_METHOD_DESCRIPTORS = new Set([...NATIVE_CHECK_METHODS, ...NATIVE_PROPERTY_METHODS, "type.mro", "mappingproxy.get", "object.__dir__"]);
const NATIVE_TYPE_WRAPPERS = new Set(["type.__getattribute__", "type.__setattr__", "type.__delattr__"]);
const NATIVE_DESCRIPTOR_WRAPPERS = new Set(["property.__get__", "property.__set__", "property.__delete__", "staticmethod.__get__", "classmethod.__get__", "function.__get__"]);
const NATIVE_BINDING_WRAPPERS = new Set(["method_descriptor.__get__", "wrapper_descriptor.__get__"]);
const nativeWrapper = name => NATIVE_TYPE_WRAPPERS.has(name) || NATIVE_DESCRIPTOR_WRAPPERS.has(name) || NATIVE_BINDING_WRAPPERS.has(name);
const FUNCTION_DATA = new Set(["__dict__", "__class__", "__name__", "__qualname__", "__module__", "__doc__"]);
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
const GENERATOR_DIRECTORY_KEYS = Object.freeze([
  "__repr__", "__iter__", "__next__", "__del__", "send", "throw", "close",
  "__sizeof__", "__class_getitem__", "__name__", "__qualname__", "gi_yieldfrom",
  "gi_running", "gi_frame", "gi_suspended", "gi_code", "__doc__",
  ...OBJECT_DIRECTORY_KEYS
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
      if (entries.includes("mro") || bases.some(base => base instanceof ClassValue && this.hasSlot(base, "mro")))
        this.fail("UnsupportedOperationError", "Custom metaclass MRO construction requires a separate stage", "UNSUPPORTED");
      if (entries.some(key => isSpecialName(key) && !META_SPECIALS.has(key)))
        this.fail("UnsupportedOperationError", "Further metaclass special protocols require a separate stage", "UNSUPPORTED");
    }
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
    if (namespace.get("__init_subclass__") instanceof FunctionValue)
      namespace.set("__init_subclass__", this.make(MethodWrapperValue, "classmethod", namespace.get("__init_subclass__")));
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
  isPythonMethod(value) { return value instanceof BoundMethodValue && (value.pythonMethod || !(value.callable instanceof BuiltinValue)); }
  isMetaclass(value) { return value instanceof ClassValue && value.mro.some(base => base instanceof BuiltinValue && base.name === "type"); }
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
    return type.bases[0];
  }
  typeOf(value) {
    this.touch(value);
    if (value instanceof InstanceValue) return value.type;
    if (value instanceof ClassValue) return value.metaclass || this.builtin("type");
    let name = this.values.typeName(value);
    if (name === null) {
      if (this.isType(value)) name = "type";
      else if (value instanceof BuiltinValue) name = NATIVE_METHOD_DESCRIPTORS.has(value.name) ? "method_descriptor" : nativeWrapper(value.name) ? "wrapper_descriptor" : "builtin_function_or_method";
      else if (value instanceof FunctionValue) name = "function";
      else if (value instanceof BoundMethodValue) name = !value.pythonMethod && value.callable instanceof BuiltinValue ?
        NATIVE_METHOD_DESCRIPTORS.has(value.callable.name) || NATIVE_CLASS_METHODS.has(value.callable.name) ? "builtin_function_or_method" : "method-wrapper" : "method";
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
    return value instanceof InstanceValue && this.hasSlot(value.type, "__class__") ||
      ["__getattribute__", "__getattr__"].some(name => this.hasAttributeHook(value, name));
  }
  checkingType(value) {
    return value instanceof ClassValue ? value.metaclass : value instanceof InstanceValue ? value.type : null;
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
  lookup(type, name, native = true, start = 0) {
    this.key(name); this.touch(type);
    if (!this.isType(type)) throw new TypeError("An adopted class is required.");
    for (const base of this.mro(type).slice(start)) {
      this.charge(1);
      if (base instanceof BuiltinValue) {
        if (native && (NATIVE_DESCRIPTOR_WRAPPERS.has(base.name + "." + name) || NATIVE_PROPERTY_METHODS.has(base.name + "." + name) || base.name === "mappingproxy" && name === "get" || NATIVE_BINDING_WRAPPERS.has(base.name + "." + name)))
          return {found: true, value: this.builtin(base.name + "." + name)};
        if (native && base.name === "type" && ["__new__", "__init__", "__call__", "__instancecheck__", "__subclasscheck__", "__getattribute__", "__setattr__", "__delattr__", "mro"].includes(name))
          return {found: true, value: this.builtin("type." + name)};
        continue;
      }
      if (!native && base.root && ["__new__", "__init__", "__getattribute__", "__setattr__", "__delattr__"].includes(name)) continue;
      if (base.namespace.has(name)) return {found: true, value: base.namespace.get(name)};
      if (name === "__doc__" && !base.root) return {found: true, value: null};
      if (native && base.root && name === "__init_subclass__") {
        const value = this.make(MethodWrapperValue, "classmethod", this.builtin("object.__init_subclass__"));
        base.namespace.set(name, value);
        try { const layout = valueLayout(base); this.memory?.resize(base, layout.bytes, layout.children); }
        catch (error) { base.namespace.delete(name); throw error; }
        return {found: true, value};
      }
      if (native && base.root && ["__dir__", "__hash__", "__new__", "__init__", "__getattribute__", "__setattr__", "__delattr__"].includes(name)) {
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
      callable: hook.value.kind === "classmethod" ? this.make(BoundMethodValue, hook.value.callable, receiver.type, !NATIVE_CLASS_METHODS.has(hook.value.callable?.name)) : hook.value.callable, args};
    if (hook.value instanceof FunctionValue) return {kind: "call", callable: hook.value, args: [receiver, ...args]};
    if (hook.value instanceof PropertyValue || this.descriptor(hook.value)?.get.found) {
      const plan = this.bindAttribute(hook.value, receiver, receiver.type);
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
    if (!required && !type.mro.slice(1).some(base => base instanceof ClassValue && !base.root && base.namespace.has("__init_subclass__"))) return null;
    const item = this.lookup(type, "__init_subclass__", true, 1);
    return this.bindAttribute(item.value, null, type);
  }
  read(receiver, name, native = false, key = null) {
    this.key(name); this.touch(receiver);
    const value = value => ({kind: "value", value});
    if (receiver instanceof SuperValue) {
      if (name === "__class__") return value(this.builtin("super"));
      if (["__thisclass__", "__self__", "__self_class__"].includes(name))
        return value(receiver[{__thisclass__: "thisclass", __self__: "self", __self_class__: "selfClass"}[name]]);
      if (receiver.selfClass !== null) {
        if (name === "__dict__" && this.instanceDictionarySlot(receiver.selfClass, this.mro(receiver.selfClass).indexOf(receiver.thisclass) + 1))
          this.fail("UnsupportedOperationError", "Super dictionary reflection requires native getset descriptors.", "UNSUPPORTED");
        const item = this.lookup(receiver.selfClass, name, true, this.mro(receiver.selfClass).indexOf(receiver.thisclass) + 1);
        if (item.found) return this.bindAttribute(item.value, receiver.self === receiver.selfClass ? null : receiver.self, receiver.selfClass);
      }
      this.fail("AttributeError", "super has no attribute '" + name + "'.");
    }
    if (name === "__dir__" && this.hasFixedDirectory(receiver))
      return value(this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver));
    if (receiver instanceof BuiltinValue) {
      if (name === "__dict__" && this.isType(receiver))
        this.fail("UnsupportedOperationError", "Native type dictionaries require their own layout contract.", "UNSUPPORTED");
      if (name === "__doc__") this.fail("UnsupportedOperationError", "Native documentation requires its own metadata contract.", "UNSUPPORTED");
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
        if (receiver.name !== "type" && ["__instancecheck__", "__subclasscheck__", "mro"].includes(name))
          return this.bindAttribute(this.builtin("type." + name), receiver, this.builtin("type"));
        if (name === "__module__") return value(this.values.string(Array.from("builtins", char => char.codePointAt(0))));
        if (name === "__mro__") return value(this.values.tuple(this.mro(receiver)));
        if (name === "__base__") return value(this.primaryBase(receiver));
        if (name === "__bases__") return value(this.values.tuple([this.mro(receiver)[1]]));
        const item = this.lookup(receiver, name);
        if (item.found) return this.bindAttribute(item.value, null, receiver);
      }
      this.fail("AttributeError", "Builtin has no adopted attribute '" + name + "'.");
    }
    if (receiver instanceof PropertyValue) {
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
      if (name === "__func__") return value(receiver.callable);
      this.fail("UnsupportedOperationError", "Method wrapper reflection is outside the adopted profile.", "UNSUPPORTED");
    }
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
        receiver.callable.name === "type.mro" && name === "__qualname__" && this.hasAttributeHook(receiver.receiver, "__getattribute__"))
      this.fail("UnsupportedOperationError", "Hooked native MRO method qualification requires a separate stage.", "UNSUPPORTED");
    if (receiver instanceof BoundMethodValue && !receiver.pythonMethod && receiver.callable instanceof BuiltinValue && (NATIVE_CHECK_METHODS.has(receiver.callable.name) || receiver.callable.name === "type.mro") && ["__name__", "__qualname__"].includes(name))
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
      if (name === "get") return value(this.make(BoundMethodValue, this.builtin("mappingproxy.get"), receiver));
      if (["copy", "keys", "items", "values", "__iter__", "__len__", "__reversed__", "__eq__", "__ne__", "__or__", "__ror__"].includes(name))
        this.fail("UnsupportedOperationError", "Class namespace enumeration and mapping protocols require their own stage.", "UNSUPPORTED");
      this.fail("AttributeError", "Class namespace view has no attribute '" + name + "'.");
    }
    if (!(receiver instanceof ClassValue || receiver instanceof InstanceValue))
      this.fail("UnsupportedOperationError", "Attribute receiver is outside the class profile.", "UNSUPPORTED");
    if (name === "__doc__" && receiver instanceof ClassValue && receiver.root)
      this.fail("UnsupportedOperationError", "Native documentation requires its own metadata contract.", "UNSUPPORTED");
    if (name === "__dict__" && receiver instanceof InstanceValue && this.instanceDictionarySlot(receiver.type))
      return value(this.instanceDictionary(receiver));
    if (receiver instanceof InstanceValue && name === "__class__") {
      const item = this.lookup(receiver.type, name);
      return item.found ? this.bindAttribute(item.value, receiver, receiver.type) : value(this.classAttribute(receiver));
    }
    if (!allowsClassSpecial(name, "attribute") && !["__class__", "__name__", "__qualname__", "__module__", "__bases__", "__base__", "__mro__"].includes(name)) this.fail("UnsupportedOperationError", "This special attribute is outside classes-source/1.", "UNSUPPORTED");
    const owner = receiver instanceof ClassValue ? receiver : receiver.type;
    const metaclass = receiver instanceof ClassValue ? receiver.metaclass || (["__instancecheck__", "__subclasscheck__", "mro"].includes(name) ? this.builtin("type") : null) : null;
    const metaItem = metaclass ? this.lookup(metaclass, name) : null;
    const metaDescriptor = metaItem?.found ? this.descriptor(metaItem.value) : null;
    if (metaItem?.value instanceof PropertyValue || metaDescriptor?.get.found && (metaDescriptor.set.found || metaDescriptor.delete.found))
      return this.bindAttribute(metaItem.value, receiver, metaclass);
    if (receiver instanceof ClassValue) {
      if (name === "__dict__") {
        if (metaItem?.found) this.fail("UnsupportedOperationError", "Shadowed metaclass namespace slots require native layout reflection.", "UNSUPPORTED");
        if (receiver.root) this.fail("UnsupportedOperationError", "Native class namespaces require their own layout contract.", "UNSUPPORTED");
        return value(this.make(ClassNamespaceValue, receiver));
      }
      if (name === "__class__") return value(receiver.metaclass || this.builtin("type"));
      if (["__name__", "__qualname__", "__module__"].includes(name) && !(name === "__name__" && metaItem?.found)) return value(this.values.string(Array.from(
        receiver[{__name__: "name", __qualname__: "qualname", __module__: "module"}[name]], char => char.codePointAt(0))));
      if (["__bases__", "__mro__"].includes(name)) return value(this.values.tuple(name === "__bases__" ? receiver.bases : receiver.mro));
      if (name === "__base__") return value(this.primaryBase(receiver));
    }
    const item = this.lookup(owner, name), descriptor = item.found ? this.descriptor(item.value) : null;
    if (name === "__dir__" && !item.found && !metaItem?.found)
      this.fail("UnsupportedOperationError", "Default directories require their own namespace contract.", "UNSUPPORTED");
    if (receiver instanceof InstanceValue && (item.value instanceof PropertyValue ||
        descriptor?.get.found && (descriptor.set.found || descriptor.delete.found)))
      return this.bindAttribute(item.value, receiver, owner);
    if (receiver instanceof InstanceValue) return this.instanceEntry(receiver, name, "get", null, key, item);
    if (!item.found) {
      if (metaItem?.found) return this.bindAttribute(metaItem.value, receiver, metaclass);
      this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
    }
    return this.bindAttribute(item.value, receiver instanceof ClassValue ? null : receiver, owner);
  }
  bindAttribute(value, receiver, owner) {
    if (receiver !== null && value instanceof BuiltinValue && NATIVE_BINDING_WRAPPERS.has(value.name) &&
        this.nativeDescriptorKind(receiver) !== value.name.slice(0, value.name.indexOf(".")))
      this.fail("TypeError", "Native descriptor binding requires a matching descriptor receiver.");
    if (receiver !== null && value instanceof BuiltinValue && NATIVE_PROPERTY_METHODS.has(value.name) && !(receiver instanceof PropertyValue))
      this.fail("TypeError", "Native property copy requires a property receiver.");
    if (receiver !== null && value instanceof BuiltinValue && NATIVE_DESCRIPTOR_WRAPPERS.has(value.name)) {
      const kind = value.name.slice(0, value.name.indexOf("."));
      if (kind === "function" ? !(receiver instanceof FunctionValue) : kind === "property" ? !(receiver instanceof PropertyValue) : !(receiver instanceof MethodWrapperValue) || receiver.kind !== kind)
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
      value instanceof BuiltinValue && (NATIVE_PROPERTY_METHODS.has(value.name) || NATIVE_DESCRIPTOR_WRAPPERS.has(value.name) || NATIVE_BINDING_WRAPPERS.has(value.name) || ["mappingproxy.get", "object.__dir__"].includes(value.name) || ["object.__hash__", "object.__init__", "object.__getattribute__", "object.__setattr__", "object.__delattr__", "type.__init__", "type.__call__", "type.__getattribute__", "type.__setattr__", "type.__delattr__", "type.__instancecheck__", "type.__subclasscheck__", "type.mro"].includes(value.name))) ? this.make(BoundMethodValue, value, receiver) : value};
  }
  nativeDescriptorKind(value) {
    return value instanceof BuiltinValue ? NATIVE_METHOD_DESCRIPTORS.has(value.name) ? "method_descriptor" :
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
    const item = this.lookup(type, name);
    return item.found ? this.bindAttribute(item.value, receiver, type) : null;
  }

  get(receiver, name) {
    const result = this.read(receiver, name);
    if (result.kind !== "value") this.fail("UnsupportedOperationError", "Descriptor calls require VM execution frames.", "UNSUPPORTED");
    return result.value;
  }
  write(receiver, name, value, remove = false, key = null) {
    this.key(name); this.touch(receiver);
    if (name === "__dir__" && this.hasFixedDirectory(receiver)) this.fail("AttributeError", "Native directory attributes are read-only.");
    if (receiver instanceof ClassNamespaceValue) this.fail("AttributeError", "Class namespace view attributes are read-only.");
    if (this.isPythonMethod(receiver)) {
      if (name === "__class__") this.fail("TypeError", "Method type cannot be changed.");
      this.fail("AttributeError", "Method attributes are read-only.");
    }
    if (receiver instanceof FunctionValue && !FUNCTION_DATA.has(name)) return this.functionEntry(receiver, name, remove ? "delete" : "set", value, key);
    if (name === "__objclass__" && (this.nativeDescriptorKind(receiver) || receiver instanceof BoundMethodValue &&
        (receiver.pythonMethod || receiver.callable instanceof BuiltinValue &&
          (nativeWrapper(receiver.callable.name) || NATIVE_METHOD_DESCRIPTORS.has(receiver.callable.name)))))
      this.fail("AttributeError", "Native descriptor owner metadata is read-only.");
    if (receiver instanceof SuperValue) this.fail("AttributeError", "super attributes are read-only");
    if (receiver instanceof InstanceValue && receiver.type.root && name === "__dict__")
      this.fail("AttributeError", "Object instance has no dictionary.");
    if (receiver instanceof InstanceValue && name === "__dict__" && this.instanceDictionarySlot(receiver.type))
      return {kind: "value", value: this.mutate(receiver, name, value, remove)};
    if (receiver instanceof InstanceValue || receiver instanceof ClassValue && receiver.metaclass) {
      const item = this.lookup(receiver instanceof InstanceValue ? receiver.type : receiver.metaclass, name), descriptor = item.found ? this.descriptor(item.value) : null;
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
    if (receiver instanceof InstanceValue && (!(receiver.attributes instanceof Map) || key !== null))
      return this.instanceEntry(receiver, name, remove ? "delete" : "set", value, key);
    return {kind: "value", value: this.mutate(receiver, name, value, remove)};
  }
  namespaceEntry(receiver, key) { return this.values.classNamespaceEntry(receiver, key); }
  instanceDictionarySlot(type, start = 0) {
    for (const base of this.mro(type).slice(start)) {
      if (!(base instanceof ClassValue) || base.root) continue;
      if (base.namespace.has("__dict__")) return false;
      if (base.bases.every(parent => parent instanceof ClassValue && parent.root)) return true;
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
    this.fail("AttributeError", "Class/instance has no attribute '" + name + "'.");
  }
  instanceEntry(receiver, name, operation = "get", item = null, key = null, fallback = {found: false}) {
    const value = value => ({kind: "value", value});
    if (operation !== "get" && !allowsClassSpecial(name, "mutate") && name !== "__dict__")
      this.fail("UnsupportedOperationError", "Special attribute mutation is outside classes-source/1.", "UNSUPPORTED");
    if (receiver.attributes instanceof Map && operation === "get")
      return receiver.attributes.has(name) ? value(receiver.attributes.get(name)) : this.instanceMissing(receiver, name, fallback);
    const dictionary = this.instanceDictionary(receiver);
    key ??= this.values.string(Array.from(name, char => char.codePointAt(0)));
    if (this.values.dictionaryNeedsProtocol(dictionary, key)) return {kind: "call",
      callable: this.builtin("instance-dictionary-" + operation), args: [receiver, dictionary, key, item, fallback.found, fallback.value ?? null]};
    if (operation === "set") return value(this.values.set(dictionary, key, item));
    const position = this.values.find(dictionary, key);
    if (position < 0) return this.instanceMissing(receiver, name, operation === "get" ? fallback : undefined);
    return value(operation === "get" ? dictionary.entries[position].value : this.values.remove(dictionary, key));
  }
  nativeCallableDirectoryKind(receiver) {
    const kind = this.nativeDescriptorKind(receiver);
    if (kind !== null) return kind;
    if (receiver instanceof BoundMethodValue && !this.isPythonMethod(receiver) && receiver.callable instanceof BuiltinValue) {
      if (nativeWrapper(receiver.callable.name)) return "method-wrapper";
      if (NATIVE_METHOD_DESCRIPTORS.has(receiver.callable.name) || NATIVE_CLASS_METHODS.has(receiver.callable.name))
        return "builtin_function_or_method";
    }
    return null;
  }
  hasFixedDirectory(receiver) {
    return receiver instanceof ClassNamespaceValue || receiver instanceof PropertyValue || receiver instanceof GeneratorValue || this.nativeCallableDirectoryKind(receiver) !== null;
  }
  directoryNames(receiver) {
    if (receiver instanceof FunctionValue) return FUNCTION_DIRECTORY_KEYS;
    if (receiver instanceof ClassNamespaceValue) return NAMESPACE_VIEW_DIRECTORY_KEYS;
    if (receiver instanceof PropertyValue) return PROPERTY_DIRECTORY_KEYS;
    if (receiver instanceof GeneratorValue) return GENERATOR_DIRECTORY_KEYS;
    if (this.isPythonMethod(receiver)) return METHOD_DIRECTORY_KEYS;
    const kind = this.nativeCallableDirectoryKind(receiver);
    if (kind === "method_descriptor" || kind === "wrapper_descriptor") return NATIVE_DESCRIPTOR_DIRECTORY_KEYS;
    if (kind === "builtin_function_or_method") return NATIVE_METHOD_DIRECTORY_KEYS;
    if (kind === "method-wrapper") return NATIVE_WRAPPER_DIRECTORY_KEYS;
    throw new TypeError("Invalid native directory receiver.");
  }
  functionDictionary(receiver) {
    if (receiver.attributes === null) this.functionMetadata(receiver, "attributes", this.values.dict([]));
    return receiver.attributes;
  }
  functionMissing(receiver, name, operation = "get") {
    if (operation === "get" && name === "__dir__")
      return this.make(BoundMethodValue, this.builtin("object.__dir__"), receiver);
    if (operation === "get" && name === "__get__")
      return this.make(BoundMethodValue, this.builtin("function.__get__"), receiver);
    if (operation === "get" && FUNCTION_DEFERRED_METHODS.has(name))
      this.fail("UnsupportedOperationError", "Native function methods require their own contract.", "UNSUPPORTED");
    this.fail("AttributeError", "Function has no attribute '" + name + "'.");
  }
  functionEntry(receiver, name, operation = "get", item = null, key = null) {
    if (FUNCTION_DEFERRED_DATA.has(name))
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
  mutate(receiver, name, value, remove = false) {
    this.key(name); this.touch(receiver);
    if (this.isPythonMethod(receiver) && ["__name__", "__qualname__", "__module__"].includes(name))
      this.fail("AttributeError", "Method identity metadata is read-only.");
    if (receiver instanceof FunctionValue && name === "__dict__") {
      if (remove || !this.values.isDict(value)) this.fail("TypeError", "Function __dict__ must be set to a dictionary.");
      return this.functionMetadata(receiver, "attributes", value);
    }
    if (receiver instanceof FunctionValue && name === "__class__") this.fail("TypeError", "Function type cannot be changed.");
    if (receiver instanceof InstanceValue && name === "__dict__" && this.instanceDictionarySlot(receiver.type)) {
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
    if (name === "__name__" && !(receiver instanceof InstanceValue)) {
      if (!(receiver instanceof PropertyValue))
        this.fail("UnsupportedOperationError", "Name mutation is adopted only for properties.", "UNSUPPORTED");
      const before = receiver.propertyName;
      receiver.propertyName = remove ? undefined : value;
      try { const layout = valueLayout(receiver); this.memory?.resize(receiver, layout.bytes, layout.children); }
      catch (error) { receiver.propertyName = before; throw error; }
      return null;
    }
    if (receiver instanceof BuiltinValue && this.isType(receiver)) this.fail("TypeError", "Cannot mutate an immutable native type.");
    if (!(receiver instanceof ClassValue || receiver instanceof InstanceValue))
      this.fail("UnsupportedOperationError", "Attribute mutation requires a class or instance.", "UNSUPPORTED");
    if (receiver instanceof ClassValue && receiver.root) this.fail("TypeError", "Cannot mutate the immutable object type.");
    if (receiver instanceof ClassValue && name === "__dict__") this.fail("AttributeError", "Class namespace views cannot be replaced or deleted.");
    if (receiver instanceof ClassValue && name === "__base__") this.fail("AttributeError", "Primary base metadata is read-only.");
    if (receiver instanceof ClassValue && this.isMetaclass(receiver) && name === "mro")
      this.fail("UnsupportedOperationError", "Custom metaclass MRO construction requires a separate stage", "UNSUPPORTED");
    if (receiver instanceof ClassValue && this.isMetaclass(receiver) && isSpecialName(name) && !META_SPECIALS.has(name))
      this.fail("UnsupportedOperationError", "Further metaclass special protocols require a separate stage", "UNSUPPORTED");
    if (!allowsClassSpecial(name, "mutate") && !(receiver instanceof InstanceValue && name === "__dict__"))
      this.fail("UnsupportedOperationError", "Special attribute mutation is outside classes-source/1.", "UNSUPPORTED");
    if (receiver instanceof InstanceValue && receiver.type.root && name === "__dict__")
      this.fail("AttributeError", "Object instance has no dictionary.");
    if (receiver instanceof InstanceValue && !(receiver.attributes instanceof Map)) {
      const plan = this.instanceEntry(receiver, name, remove ? "delete" : "set", value);
      if (plan.kind !== "value") this.fail("UnsupportedOperationError", "Dictionary callbacks require VM execution frames.", "UNSUPPORTED");
      return plan.value;
    }
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
    if (selected instanceof ClassValue && this.hasSlot(selected, "mro"))
      this.fail("UnsupportedOperationError", "Custom metaclass MRO construction requires a separate stage", "UNSUPPORTED");
    return selected;
  }
}
