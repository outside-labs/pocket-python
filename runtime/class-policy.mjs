// Admission is separate from descriptor binding and scoped metadata validation.
export const DESCRIPTOR_HOOKS = Object.freeze(["__get__", "__set__", "__delete__", "__set_name__"]);
const contexts = new Set(["define", "attribute", "mutate", "implicit"]);
const ordinarySlot = Object.freeze({define: true, attribute: true, mutate: true, implicit: false});
export const CLASS_SPECIAL_POLICY = Object.freeze(Object.fromEntries([
  ["__call__", Object.freeze({...ordinarySlot, implicit: true})],
  ["__init__", ordinarySlot], ...DESCRIPTOR_HOOKS.map(name => [name, ordinarySlot]),
  ["__module__", Object.freeze({define: true})], ["__qualname__", Object.freeze({define: true})]
]));
export const isSpecialName = name => typeof name === "string" && name.startsWith("__") && name.endsWith("__");
export function allowsClassSpecial(name, context) {
  if (typeof name !== "string" || !contexts.has(context)) throw new TypeError("Invalid special-method policy query.");
  return !isSpecialName(name) || Object.hasOwn(CLASS_SPECIAL_POLICY, name) && CLASS_SPECIAL_POLICY[name][context] === true;
}
