import {test} from "node:test";
import assert from "node:assert/strict";
import {verify, BytecodeError} from "./bytecode.mjs";
import {execute} from "./vm.mjs";

const program = (instructions, values = ["-7", "3"]) => ({format: "pocket-python-bytecode", version: 1,
  constants: values.map(value => ({type: typeof value === "boolean" ? "bool" : "int", value})), instructions});
const binary = operation => program([["const", 0], ["const", 1], [operation], ["return"]]);

test("integer operations retain precision and Python signed division rules", () => {
  assert.equal(execute(binary("floor-divide")), -3n);
  assert.equal(execute(binary("modulo")), 2n);
  assert.equal(execute(program(binary("modulo").instructions, ["7", "-3"])), -2n);
  assert.equal(execute(program(binary("floor-divide").instructions, ["-7", "-3"])), 2n);
  assert.equal(execute(program(binary("multiply").instructions, ["9007199254740993", "2"])), 18014398509481986n);
  assert.equal(execute(program(binary("add").instructions, [true, "2"])), 3n);
  assert.equal(execute(binary("less")), true);
});

test("branches, duplicate and pop execute without host recursion", () => {
  const code = program([["const", 0], ["const", 1], ["less"], ["jump-if-false", 7],
    ["const", 1], ["dup"], ["pop"], ["return"]]);
  // The false edge must also provide a result for the join.
  assert.throws(() => verify(code), BytecodeError);
  code.instructions = [["const", 0], ["const", 1], ["less"], ["jump-if-false", 6],
    ["const", 1], ["jump", 7], ["const", 0], ["dup"], ["pop"], ["return"]];
  assert.equal(execute(code), 3n);
  assert.equal(verify(code).maxStack, 2);
});

test("format, operands, all opcodes and reachable control flow are verified", () => {
  const malformed = [
    {...binary("add"), version: 99},
    program([["const", -1], ["return"]]), program([["jump", 99]]),
    program([["const", 0, 1], ["return"]]), program([["const", 0]]),
    program([["add"], ["return"]]), program([["const", 0], ["const", 1], ["return"]]),
    program([["const", 0], ["return"], ["unknown"]]),
    program([["const", 0], ["jump", 0]]),
    program([["const", 0], ["return"]], ["-0"]),
    program([["const", 0], ["return"]], ["1".repeat(4097)]),
    program([...Array.from({length: 257}, () => ["const", 0]), ["return"]]),
  ];
  for (const code of malformed) assert.throws(() => verify(code), BytecodeError);
  const holes = binary("add"); delete holes.instructions[1];
  assert.throws(() => verify(holes), BytecodeError);
});

test("verification snapshots inputs and source locations", () => {
  const input = binary("add");
  input.source = {filename: "sample.py", spans: input.instructions.map(() => [2, 1, 2, 8])};
  const code = verify(input);
  input.instructions[0][1] = 9;
  input.source.spans[0][0] = 8;
  assert.equal(code.instructions[0][1], 0);
  assert.equal(code.source.spans[0][0], 2);
  assert.throws(() => { code.instructions[0][1] = 9; }, TypeError);
  assert.throws(() => verify({...binary("add"), source: {filename: "x", spans: [[0, 1, 1, 1]]}}), BytecodeError);
});

test("division errors preserve original instruction source span", () => {
  const input = program(binary("floor-divide").instructions, ["1", "0"]);
  input.source = {filename: "zero.py", spans: input.instructions.map(() => [1, 1, 1, 7])};
  assert.throws(() => execute(input), error => error.code === "ZERO_DIVISION" &&
    error.name === "ZeroDivisionError" && error.instruction === 2 &&
    error.location.filename === "zero.py" && error.location.span[3] === 7);
});

test("instruction, primitive work, result limits and cancellation are explicit", () => {
  assert.throws(() => execute(program([["jump", 0]]), {maxSteps: 5}), {code: "BUDGET"});
  assert.throws(() => execute(program(binary("multiply").instructions, ["77", "3"]), {maxWork: 1}), {code: "BUDGET"});
  assert.throws(() => execute(program(binary("add").instructions, ["9".repeat(4096), "1"])), {code: "BUDGET"});
  let calls = 0;
  assert.throws(() => execute(binary("add"), {shouldCancel: () => ++calls === 4}), {code: "CANCELLED"});
  assert.throws(() => execute(binary("add"), {maxSteps: 0}), TypeError);
});
