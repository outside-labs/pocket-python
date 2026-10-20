import {test} from "node:test";
import assert from "node:assert/strict";
import {ValueRuntime, encodeValue} from "./values.mjs";
import {verify, BytecodeError} from "./bytecode.mjs";
import {execute} from "./vm.mjs";

const int = value => ({type: "int", value: String(value)});
const str = value => ({type: "str", codepoints: Array.from(value, character => character.codePointAt(0))});
const float = bits => ({type: "float", bits});
const tuple = items => ({type: "tuple", items});
const program = (constants, instructions) => ({format: "pocket-python-bytecode", version: 2, constants, instructions});

test("typed scalars preserve float bits, Python code points and exact numeric comparisons", () => {
  const values = new ValueRuntime();
  for (const record of [{type: "none"}, {type: "bool", value: true}, int("9007199254740993"),
    float("8000000000000000"), float("7ff0000000000000"), float("7ff8000000000001"),
    {type: "str", codepoints: [0x1f600, 0xd83d, 0xde00, 0x301]}]) {
    assert.deepEqual(values.encode(values.decode(record)), record);
  }
  const high = values.decode(int("9007199254740993")), rounded = values.float(9007199254740992);
  assert.equal(values.equal(high, rounded), false);
  assert.equal(values.less(rounded, high), true);
  assert.equal(values.equal(true, 1n), true);
  assert.equal(values.equal(null, 0n), false);
  assert.throws(() => values.binary("less-equal", null, null), {name: "TypeError"});
  assert.equal(values.truth(values.float(NaN)), true);
  assert.equal(values.truth(values.float(-0)), false);
  assert.equal(values.equal(values.decode(str("😀")), values.decode({type: "str", codepoints: [0xd83d, 0xde00]})), false);
});

test("mixed float arithmetic, floor and modulo follow Python signs and conversion errors", () => {
  const values = new ValueRuntime(), f = value => values.float(value);
  for (const [a, b, floor, mod] of [[-7, 3, -3, 2], [7, -3, -3, -2], [-7, -3, 2, -1], [1, 0.1, 9, 1 % 0.1]]) {
    assert.equal(values.binary("floor-divide", f(a), f(b)).value, floor);
    assert.equal(values.binary("modulo", f(a), f(b)).value, mod);
  }
  assert.equal(Object.is(values.binary("modulo", f(6), f(-3)).value, -0), true);
  assert.equal(Object.is(values.binary("floor-divide", f(0), f(-3)).value, -0), true);
  assert.equal(values.binary("add", 9007199254740993n, f(1)).value, 9007199254740992);
  assert.throws(() => values.binary("add", 10n ** 400n, f(1)), {name: "OverflowError"});
  assert.throws(() => values.binary("divide", 3n, 2n), {code: "UNSUPPORTED"});
  assert.throws(() => values.binary("divide", f(1), f(-0)), {name: "ZeroDivisionError"});
  assert.throws(() => values.binary("unknown", 1n, 2n), {code: "UNSUPPORTED"});
});

test("list aliases and slices preserve mutation and independent outer containers", () => {
  const values = new ValueRuntime(), list = values.list([1n, 2n, 3n]);
  const alias = list;
  values.set(alias, -1n, 9n); values.append(list, true);
  assert.equal(values.index(list, -2n), 9n);
  const slice = values.slice(list, null, null, -1n);
  values.set(slice, 0n, false);
  assert.deepEqual(values.encode(list), {type: "list", items: [int(1), int(2), int(9), {type: "bool", value: true}]});
  assert.equal(values.index(slice, 0n), false);
  assert.equal(values.binary("is", list, alias), true);
  assert.equal(values.binary("is", list, slice), false);
  assert.throws(() => values.set(values.tuple([1n]), 0n, 2n), {name: "TypeError"});
  assert.throws(() => values.slice(list, null, null, 0n), {name: "ValueError"});
  assert.throws(() => values.index(list, -(10n ** 100n)), {name: "IndexError"});
});

test("dictionary hash equality preserves numeric key identity and insertion order", () => {
  const values = new ValueRuntime(), a = values.decode(str("a")), b = values.decode(str("b"));
  const dict = values.dict([[true, a], [1n, b], [values.float(1), 3n], [a, 4n]]);
  assert.equal(values.unary("len", dict), 2n);
  assert.equal(values.index(dict, 1n), 3n);
  assert.equal(values.encode(dict).entries[0][0].type, "bool");
  values.remove(dict, true); values.set(dict, 1n, 5n);
  assert.equal(values.encode(dict).entries[1][0].type, "int");
  const key = values.tuple([true, a]); values.set(dict, key, 6n);
  assert.equal(values.index(dict, values.tuple([1n, values.decode(str("a"))])), 6n);
  const colliding = values.dict([[1n, true], [2305843009213693952n, false]]);
  assert.equal(values.index(colliding, 1n), true);
  assert.equal(values.index(colliding, 2305843009213693952n), false);
  assert.throws(() => values.set(dict, values.list([]), null), {name: "TypeError"});
  assert.throws(() => values.index(dict, false), {name: "KeyError"});
  const nan = values.float(NaN); values.set(dict, nan, 7n);
  assert.equal(values.index(dict, nan), 7n);
  assert.throws(() => values.index(dict, values.float(NaN)), {name: "KeyError"});
  assert.equal(values.equal(nan, nan), false);
  assert.equal(values.equal(values.list([nan]), values.list([nan])), true);
});

test("iterators retain identity, live list values, dictionary rules and exhausted state", () => {
  const values = new ValueRuntime(), list = values.list([1n]), iterator = values.iterator(list);
  assert.equal(values.iterator(iterator), iterator);
  assert.equal(values.next(iterator), 1n);
  values.append(list, 2n); assert.equal(values.next(iterator), 2n);
  assert.throws(() => values.next(iterator), {name: "StopIteration"});
  values.append(list, 3n); assert.throws(() => values.next(iterator), {name: "StopIteration"});
  const dict = values.dict([[1n, 0n], [2n, 0n]]), keys = values.iterator(dict);
  values.set(dict, 1n, true); assert.equal(values.next(keys), 1n);
  values.set(dict, 3n, null); assert.throws(() => values.next(keys), {name: "RuntimeError"});
  values.remove(dict, 3n); assert.throws(() => values.next(keys), {name: "RuntimeError"});
  const changed = values.iterator(dict); values.remove(dict, 2n); values.set(dict, 3n, 0n);
  assert.throws(() => values.next(changed), {code: "UNSUPPORTED"});
});

test("Unicode slices and comparisons do not combine explicit surrogates", () => {
  const values = new ValueRuntime(), text = values.decode({type: "str", codepoints: [65, 0x1f600, 0xd83d, 0xde00, 0x301]});
  assert.equal(values.unary("len", text), 5n);
  assert.deepEqual(values.encode(values.index(text, -3n)).codepoints, [0xd83d]);
  assert.deepEqual(values.encode(values.slice(text, null, null, -2n)).codepoints, [0x301, 0xd83d, 65]);
  assert.equal(values.contains(values.decode(str("😀")), text), true);
  assert.equal(values.less(values.decode(str("😀")), values.decode(str("\uffff"))), false);
  assert.throws(() => values.contains(1n, text), {name: "TypeError"});
});

test("bytecode 2 validates construction, mutation stack effects and immutable constants", () => {
  const code = program([int(1), int(2)], [["const", 0], ["build-list", 1], ["dup"], ["const", 1], ["append"], ["pop"], ["return"]]);
  assert.deepEqual(encodeValue(execute(code)), {type: "list", items: [int(1), int(2)]});
  assert.equal(verify(code).maxStack, 3);
  const malformed = [program([], [["build-dict", 1], ["return"]]), program([], [["slice"], ["return"]]),
    program([], [["build-list", -1], ["return"]]), program([{type: "list", items: []}], [["const", 0], ["return"]]),
    program([float("bad")], [["const", 0], ["return"]]), program([str("x")], [["const", 0], ["setitem"], ["return"]]),
    program([{type: "constructor"}], [["const", 0], ["return"]]),
    {...code, version: 1}];
  for (const input of malformed) assert.throws(() => verify(input), BytecodeError);
  const text = str("A😀"), input = program([text], [["const", 0], ["return"]]), verified = verify(input);
  text.codepoints[0] = 0;
  assert.deepEqual(encodeValue(verified.constants[0]), str("A😀"));
});

test("nested operations, allocations, transport cycles and cancellation are bounded", () => {
  let work = 0;
  const values = new ValueRuntime({charge: count => { work += count; if (work > 10000) throw Object.assign(new Error(), {code: "BUDGET"}); }});
  let key = values.decode(str("\\".repeat(10)));
  for (let i = 0; i < 20; i++) key = values.tuple([key]);
  assert.ok(values.hash(key).length < 200);
  const cycle = values.list([]); values.append(cycle, cycle);
  assert.throws(() => encodeValue(cycle), {name: "ValueError"});
  const large = new ValueRuntime().string(Array(65536).fill(65));
  assert.throws(() => encodeValue(new ValueRuntime().tuple(Array(1024).fill(large))), {code: "BUDGET"});
  assert.throws(() => execute(program([str("test")], [["const", 0], ["truth"], ["return"]]), {maxWork: 1}), {code: "BUDGET"});
  let polls = 0;
  assert.throws(() => execute(program([str("test")], [["const", 0], ["len"], ["return"]]), {shouldCancel: () => ++polls > 2}), {code: "CANCELLED"});
});
