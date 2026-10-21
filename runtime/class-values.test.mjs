import test from "node:test";
import assert from "node:assert/strict";
import {ClassRuntime, CLASS_LIMITS} from "./class-values.mjs";
import {ClassValue, InstanceValue, BoundMethodValue, FunctionValue, Environment, CodePool, BuiltinValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue} from "./function-objects.mjs";
import {MemoryArena} from "./memory.mjs";
import {ValueRuntime, encodeValue} from "./values.mjs";

const method = name => new FunctionValue(new CodePool({constants: [], functions: [{name, qualname: "A." + name}]}, 128), 0, new Environment(), new Map());
function setup(limits = {}) {
  const memory = new MemoryArena(limits), roots = [], leave = memory.enter(() => roots);
  const runtime = new ClassRuntime({memory}), root = runtime.root(); roots.push(root);
  const make = (name, bases = [], namespace = new Map()) => {
    const value = runtime.create(name, name, "app", bases, namespace, root); roots.push(value); return value;
  };
  return {memory, roots, runtime, root, make, close() { leave(); memory.close(); }};
}

test("C3 linearization is bounded, ordered and shared across diamonds", () => {
  const s = setup();
  try {
    const A = s.make("A"), B = s.make("B", [A]), C = s.make("C", [A]), D = s.make("D", [B, C]);
    assert.deepEqual(D.mro, [D, B, C, A, s.root]);
    assert.ok(Object.isFrozen(D.mro)); assert.ok(Object.isFrozen(D.bases));
    assert.equal(s.runtime.subclass(D, C), true); assert.equal(s.runtime.subclass(B, C), false);
    const X = s.make("X", [B, C]), Y = s.make("Y", [C, B]);
    assert.throws(() => s.make("Bad", [X, Y]), {name: "TypeError"});
    assert.throws(() => s.make("Bad", [A, A]), {name: "TypeError"});
    assert.throws(() => s.make("Bad", [3n]), {name: "TypeError"});
    assert.throws(() => s.make("Bad", [new BuiltinValue("str")]), {code: "UNSUPPORTED"});
    assert.throws(() => s.make("Bad", [new BuiltinValue("print")]), {name: "TypeError"});
    let tail = A;
    for (let i = 0; i < CLASS_LIMITS.mro - 2; i++) {
      if (tail.mro.length === CLASS_LIMITS.mro) break;
      tail = s.make("Deep" + i, [tail]);
    }
    assert.equal(tail.mro.length, CLASS_LIMITS.mro);
    assert.throws(() => s.make("TooDeep", [tail]), {code: "BUDGET"});
  } finally { s.close(); }
});

test("instances shadow ordinary attributes and fresh bound wrappers retain old functions", () => {
  const s = setup();
  try {
    const first = method("f"), second = method("g"), namespace = new Map([["x", 1n], ["f", first]]);
    const A = s.make("A", [], namespace), a = s.runtime.instance(A); s.roots.push(a);
    namespace.set("x", 99n); assert.equal(s.runtime.get(a, "x"), 1n);
    const bound = s.runtime.get(a, "f"); s.roots.push(bound);
    assert.ok(bound instanceof BoundMethodValue); assert.equal(s.runtime.get(A, "f"), first);
    assert.equal(s.runtime.get(bound, "__self__"), a); assert.equal(s.runtime.get(bound, "__func__"), first);
    assert.notEqual(bound, s.runtime.get(a, "f"));
    assert.equal(s.runtime.values.equal(bound, s.runtime.get(a, "f")), true);
    s.runtime.mutate(A, "f", second);
    assert.equal(bound.callable, first); assert.equal(s.runtime.get(a, "f").callable, second);
    s.runtime.mutate(a, "f", 7n); assert.equal(s.runtime.get(a, "f"), 7n);
    s.runtime.mutate(a, "f", null, true); assert.equal(s.runtime.get(a, "f").callable, second);
    assert.throws(() => s.runtime.mutate(a, "x", null, true), {name: "AttributeError"});
    assert.throws(() => s.runtime.get(a, "missing"), {name: "AttributeError"});
    assert.equal(s.runtime.get(a, "__class__"), A);
    assert.deepEqual(encodeValue(s.runtime.get(A, "__name__")), {type: "str", codepoints: [65]});
  } finally { s.close(); }
});

test("identity/truth, metadata and explicit unsupported boundaries remain separate", () => {
  const s = setup();
  try {
    const A = s.make("A"), a = s.runtime.instance(A); s.roots.push(a);
    assert.ok(A instanceof ClassValue && a instanceof InstanceValue);
    assert.equal(s.runtime.isinstance(a, A), true); assert.equal(s.runtime.isinstance(7n, A), false);
    assert.equal(s.runtime.isinstance(7n, s.root), true); assert.equal(s.runtime.isinstance(A, s.root), true);
    assert.equal(s.runtime.values.truth(a), true); assert.equal(s.runtime.values.equal(a, s.runtime.instance(A)), false);
    for (const value of [A, a, s.runtime.make(BoundMethodValue, method("f"), a)]) {
      assert.throws(() => encodeValue(value), {name: "TypeError"});
      assert.throws(() => s.runtime.values.hash(value), {code: "UNSUPPORTED"});
    }
    assert.throws(() => s.runtime.get(a, "__dict__"), {code: "UNSUPPORTED"});
    assert.throws(() => s.runtime.mutate(A, "__bases__", null), {code: "UNSUPPORTED"});
    assert.throws(() => s.runtime.mutate(s.root, "value", 7n), {name: "TypeError"});
    assert.throws(() => s.make("Special", [], new Map([["__len__", method("f")]])), {code: "UNSUPPORTED"});
    assert.throws(() => s.make("BadInit", [], new Map([["__init__", A]])), {code: "UNSUPPORTED"});
    assert.throws(() => s.runtime.mutate(A, "__init__", s.runtime.make(BoundMethodValue, A, a)), {code: "UNSUPPORTED"});
    assert.throws(() => s.runtime.subclass(a, A), {name: "TypeError"});
  } finally { s.close(); }
});

test("failed growth/foreign-arena mutations restore the exact prior namespace", () => {
  const s = setup({maxBytes: 8000}), foreign = setup();
  try {
    const A = s.make("A"), a = s.runtime.instance(A); s.roots.push(a);
    s.runtime.mutate(a, "keep", 7n);
    const huge = new ValueRuntime().string(new Array(4000).fill(65));
    assert.throws(() => s.runtime.mutate(a, "keep", huge), {code: "OOM"});
    assert.equal(s.runtime.get(a, "keep"), 7n);
    assert.throws(() => s.runtime.mutate(a, "new", huge), {code: "OOM"}); assert.equal(a.attributes.has("new"), false);
    const other = foreign.make("Foreign");
    assert.throws(() => s.runtime.mutate(A, "foreign", other), {code: "STALE_HANDLE"});
    assert.equal(A.namespace.has("foreign"), false);
    assert.throws(() => s.runtime.get(other, "missing"), {code: "STALE_HANDLE"});
  } finally { s.close(); foreign.close(); }
});

test("class/instance/method cycles release with their roots and reject a closed arena", () => {
  const s = setup();
  const A = s.make("A", [], new Map([["f", method("f")]])), a = s.runtime.instance(A); s.roots.push(a);
  s.runtime.mutate(a, "self", a); s.runtime.mutate(A, "current", a);
  s.runtime.mutate(a, "method", s.runtime.get(a, "f"));
  s.memory.collect(); assert.ok(s.memory.stats().objects > 0);
  s.roots.length = 0; s.memory.collect(); assert.equal(s.memory.stats().objects, 0);
  s.close(); assert.equal(s.memory.stats().bytes, 0); assert.equal(s.memory.stats().roots, 0); assert.equal(s.memory.stats().frames, 0);
  assert.throws(() => s.runtime.get(a, "self"), {code: "STALE_HANDLE"});
});

test("C3 and namespace limits charge work and preserve cancellation", () => {
  const s = setup();
  try {
    assert.throws(() => s.make("Large", [], new Map(Array.from({length:129}, (_, i) => ["x" + i, null]))), {code: "BUDGET"});
    const A = s.make("A");
    let work = 0;
    const runtime = new ClassRuntime({memory:s.memory, charge:n => { if ((work += n) > 10) throw Object.assign(new Error("cancelled"), {code:"CANCELLED"}); }});
    assert.throws(() => runtime.create("Child", "Child", "app", [A], new Map(), s.root), {code: "CANCELLED"});
    assert.equal(A.mro[0], A);
  } finally { s.close(); }
});


test("native descriptor layouts retain accessors and functions without exporting or hashing them", () => {
  const s = setup(), foreign = setup();
  try {
    const fn = method("read"), property = s.runtime.make(PropertyValue, fn), wrapper = s.runtime.make(MethodWrapperValue, "staticmethod", fn);
    const copy = s.runtime.get(property, "setter"); s.roots.push(copy, wrapper);
    assert.ok(copy instanceof PropertyAccessorValue); assert.equal(copy.property, property);
    s.memory.collect(); assert.equal(s.runtime.get(copy.property, "fget"), fn);
    for (const value of [property, wrapper, copy]) {
      assert.equal(s.runtime.values.truth(value), true);
      assert.throws(() => encodeValue(value), {name: "TypeError"});
      assert.throws(() => s.runtime.values.hash(value), {code: "UNSUPPORTED"});
    }
    assert.throws(() => s.runtime.make(PropertyValue, foreign.make("Other")), {code: "STALE_HANDLE"});
    s.roots.length = 0; s.memory.collect(); assert.equal(s.memory.stats().objects, 0);
  } finally { s.close(); foreign.close(); }
});
