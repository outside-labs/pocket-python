// Admission is separate from descriptor binding and scoped metadata validation.
export const DESCRIPTOR_HOOKS = Object.freeze(["__get__", "__set__", "__delete__", "__set_name__"]);
export const ARITHMETIC_SLOTS = Object.freeze({add: "add", subtract: "sub", multiply: "mul", divide: "truediv", "floor-divide": "floordiv",
  modulo: "mod", power: "pow", matmul: "matmul", "bit-and": "and", "bit-or": "or", "bit-xor": "xor", "left-shift": "lshift", "right-shift": "rshift", divmod: "divmod"});
export const ORDERING_SLOTS = Object.freeze({less: Object.freeze(["__lt__", "__gt__"]),
  "less-equal": Object.freeze(["__le__", "__ge__"]), greater: Object.freeze(["__gt__", "__lt__"]),
  "greater-equal": Object.freeze(["__ge__", "__le__"])});
const contexts = new Set(["define", "attribute", "mutate", "implicit"]);
const ordinarySlot = Object.freeze({define: true, attribute: true, mutate: true, implicit: false});
export const CLASS_SPECIAL_POLICY = Object.freeze(Object.fromEntries([
  ...["__weakref__", "__firstlineno__", "__static_attributes__", "__call__", "__len__", "__bool__", "__repr__", "__str__", "__index__", "__bytes__", "__getitem__", "__setitem__", "__delitem__", "__iter__", "__next__", "__contains__", "__eq__", "__ne__", "__hash__", "__int__", "__float__", "__complex__", "__abs__", "__round__"].map(name => [name, Object.freeze({...ordinarySlot, implicit: true})]),
  ...Object.values(ARITHMETIC_SLOTS).flatMap(stem => ["", "r", ...(stem === "divmod" ? [] : ["i"])].map(prefix =>
    ["__" + prefix + stem + "__", Object.freeze({...ordinarySlot, implicit: true})])),
  ...["__lt__", "__le__", "__gt__", "__ge__", "__dir__", "__length_hint__"].map(name => [name, Object.freeze({...ordinarySlot, implicit: true})]),
  ...["__neg__", "__pos__", "__invert__", "__getattribute__", "__getattr__", "__setattr__", "__delattr__", "__instancecheck__", "__subclasscheck__"].map(name => [name, Object.freeze({...ordinarySlot, implicit: true})]),
  ["__prepare__", ordinarySlot], ["__classcell__", ordinarySlot], ["__classdictcell__", ordinarySlot],
  ["__slots__", ordinarySlot],
  ...["__func__", "__wrapped__", "__self__", "__self_class__", "__thisclass__", "__package__", "__loader__", "__spec__"].map(name => [name, ordinarySlot]),
  ["__mro_entries__", ordinarySlot], ["__orig_bases__", ordinarySlot],
  ["__init__", ordinarySlot], ["__new__", ordinarySlot], ["__init_subclass__", ordinarySlot], ...DESCRIPTOR_HOOKS.map(name => [name, ordinarySlot]),
  ["__module__", ordinarySlot], ["__qualname__", ordinarySlot],
  ["__class__", ordinarySlot], ["__subclasses__", ordinarySlot],
  ["__dict__", Object.freeze({define: true, attribute: true})],
  ["__name__", Object.freeze({define: true, attribute: true, mutate: true})],
  ["__isabstractmethod__", Object.freeze({define: true, attribute: true, mutate: true})],
  ["__doc__", Object.freeze({define: true, attribute: true, mutate: true})],
  ["__text_signature__", ordinarySlot],
  ...["__cause__", "__context__", "__suppress_context__", "__notes__"].map(name => [name, ordinarySlot]),
  ["__reversed__", ordinarySlot],
  ["__bases__", ordinarySlot], ["__base__", Object.freeze({attribute: true, mutate: true})],
  ["__objclass__", Object.freeze({attribute: true, mutate: true})]
]));
export const isSpecialName = name => typeof name === "string" && name.startsWith("__") && name.endsWith("__");
// Names queried by type construction, including the explicitly deferred layouts.
export const CLASS_PROTOCOL_NAMES = Object.freeze([
  "__slots__", "__new__", "__init_subclass__", "__class_getitem__",
  ...Object.keys(CLASS_SPECIAL_POLICY).filter(name => !["__slots__", "__new__", "__init_subclass__"].includes(name)),
  "mro", "__prepare__"
]);
export function allowsClassSpecial(name, context) {
  if (typeof name !== "string" || !contexts.has(context)) throw new TypeError("Invalid special-method policy query.");
  return !isSpecialName(name) || Object.hasOwn(CLASS_SPECIAL_POLICY, name) && CLASS_SPECIAL_POLICY[name][context] === true;
}

// The finite O83 slot inventory shares the ordinary instance dispatch paths.
export const METACLASS_PROTOCOLS = Object.freeze([
  "__call__", "__len__", "__bool__", "__repr__", "__str__", "__index__", "__bytes__",
  "__getitem__", "__setitem__", "__delitem__", "__iter__", "__next__", "__contains__",
  "__eq__", "__ne__", "__hash__", "__lt__", "__le__", "__gt__", "__ge__",
  "__int__", "__float__", "__complex__", "__abs__", "__round__", "__neg__", "__pos__", "__invert__", "__length_hint__",
  ...Object.values(ARITHMETIC_SLOTS).flatMap(stem => ["", "r", ...(stem === "divmod" ? [] : ["i"])].map(prefix => "__" + prefix + stem + "__")),
  ...DESCRIPTOR_HOOKS, "__class__"
]);

// Explicit entry points for protocols with an adopted execution path. Display,
// serialization, generic, buffer and async APIs retain their own contracts.
export const NATIVE_PROTOCOL_KEYS = Object.freeze([
  "__call__", "__get__", "__set__", "__delete__", "__set_name__", "__repr__", "__str__",
  "__getattribute__", "__setattr__", "__delattr__", "__dir__",
  "__eq__", "__ne__", "__lt__", "__le__", "__gt__", "__ge__", "__hash__",
  "__len__", "__bool__", "__iter__", "__next__", "__reversed__", "__contains__",
  "__getitem__", "__setitem__", "__delitem__", "__length_hint__",
  "__int__", "__float__", "__complex__", "__index__", "__bytes__", "__abs__", "__round__",
  "__neg__", "__pos__", "__invert__",
  ...Object.values(ARITHMETIC_SLOTS).flatMap(stem => ["", "r", ...(stem === "divmod" ? [] : ["i"])].map(prefix => "__" + prefix + stem + "__")),
]);
