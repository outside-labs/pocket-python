import assert from "node:assert/strict";
import test from "node:test";
import {execute, PrototypeError} from "./prototype.mjs";

const program = instructions => ({format: "pocket-python-prototype", version: 0, instructions});
const errorCode = code => error => error instanceof PrototypeError && error.code === code;

test("integer execution preserves precision beyond JavaScript Number", () => {
  assert.equal(execute(program([
    ["const", "9007199254740993"], ["const", "1"], ["add"], ["return"]
  ])), 9007199254740994n);
  assert.equal(execute(program([
    ["const", "2"], ["const", "5"], ["subtract"], ["return"]
  ])), -3n);
});

test("validation covers unreachable instructions, operands and versions", () => {
  for (const instructions of [
    [["const", "1"], ["return"], ["unknown"]],
    [["const", 1], ["return"]],
    [["const", "01"], ["return"]],
    [["return", "extra"]],
    [["jump", -1]], [["jump", 1]], [["jump", 0.5]],
    Array(1), []
  ]) assert.throws(() => execute(program(instructions)), errorCode("BYTECODE"));
  assert.throws(() => execute({...program([["return"]]), version: 1}), errorCode("BYTECODE"));
});

test("stack and termination failures are explicit", () => {
  for (const instructions of [
    [["add"]], [["return"]], [["const", "1"]],
    [["const", "1"], ["const", "2"], ["return"]]
  ]) assert.throws(() => execute(program(instructions)), errorCode("BYTECODE"));
});

test("backward jumps obey deterministic work limits", () => {
  assert.throws(() => execute(program([["jump", 0]]), {maxSteps: 3}), errorCode("BUDGET"));
  for (const maxSteps of [0, -1, Infinity, NaN, 1.5, 1_000_001]) {
    assert.throws(() => execute(program([["return"]]), {maxSteps}), errorCode("BYTECODE"));
  }
});

test("integer and stack growth are bounded in the prototype", () => {
  assert.throws(() => execute(program([["const", "1".repeat(4097)], ["return"]])), errorCode("BYTECODE"));
  assert.throws(() => execute(program([
    ["const", "9".repeat(4096)], ["const", "1"], ["add"], ["return"]
  ])), errorCode("BUDGET"));
  assert.throws(() => execute(program([["const", "1"], ["jump", 0]])), errorCode("BUDGET"));
});
