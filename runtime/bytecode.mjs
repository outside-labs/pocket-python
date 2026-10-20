// This format is independent of CPython bytecode and the application compiler IR.
export const LIMITS = Object.freeze({instructions: 1024, constants: 256, stack: 256, digits: 4096});
const BINARY = new Set(["add", "subtract", "multiply", "floor-divide", "modulo", "equal", "less"]);
const SIMPLE = new Set([...BINARY, "dup", "pop", "return"]);

export class BytecodeError extends Error {
  constructor(message, instruction = null) {
    super(message);
    this.name = "BytecodeError";
    this.code = "BYTECODE";
    this.instruction = instruction;
  }
}

function fail(message, instruction) { throw new BytecodeError(message, instruction); }
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value, low, high) {
  return Number.isSafeInteger(value) && value >= low && value <= high;
}

function sourceInfo(source, count) {
  if (source === undefined) return null;
  if (!object(source) || typeof source.filename !== "string" || !source.filename ||
      source.filename.length > 256 || !Array.isArray(source.spans) || source.spans.length !== count) {
    fail("Source metadata requires a filename and one span per instruction.");
  }
  const spans = Array.from(source.spans, (span, index) => {
    if (!Array.isArray(span) || span.length !== 4 ||
        !Array.from(span).every(value => integer(value, 1, 1_000_000)) ||
        span[2] < span[0] || (span[2] === span[0] && span[3] < span[1])) {
      fail("Source spans use ordered one-based line/column coordinates.", index);
    }
    return Object.freeze([...span]);
  });
  return Object.freeze({filename: source.filename, spans: Object.freeze(spans)});
}

export function verify(program) {
  if (!object(program) || program.format !== "pocket-python-bytecode" || program.version !== 1) {
    fail("Expected pocket-python-bytecode version 1.");
  }
  if (!Array.isArray(program.constants) || program.constants.length > LIMITS.constants) {
    fail("Constant pool exceeds its bounded array format.");
  }
  const constants = Array.from(program.constants, constant => {
    if (!object(constant)) fail("A constant must have a type and value.");
    if (constant.type === "bool" && typeof constant.value === "boolean") return constant.value;
    if (constant.type !== "int" || typeof constant.value !== "string" ||
        constant.value.replace(/^-/, "").length > LIMITS.digits ||
        !/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(constant.value)) {
      fail("Integer constants require bounded canonical decimal strings.");
    }
    return BigInt(constant.value);
  });
  const input = program.instructions;
  if (!Array.isArray(input) || !integer(input.length, 1, LIMITS.instructions)) {
    fail("Instruction count must be between 1 and 1024.");
  }
  const instructions = Array.from(input, (instruction, index) => {
    if (!Array.isArray(instruction)) fail("An instruction must be an array.", index);
    const [operation, operand] = instruction;
    if (operation === "const") {
      if (instruction.length !== 2 || !integer(operand, 0, constants.length - 1)) {
        fail("Constant index is outside the pool.", index);
      }
    } else if (operation === "jump" || operation === "jump-if-false") {
      if (instruction.length !== 2 || !integer(operand, 0, input.length - 1)) {
        fail("Jump target is outside the instruction list.", index);
      }
    } else if (!SIMPLE.has(operation) || instruction.length !== 1) {
      fail("Unknown operation or unexpected operands.", index);
    }
    return Object.freeze([...instruction]);
  });
  const source = sourceInfo(program.source, instructions.length);
  // Iterative dataflow: a reachable instruction has exactly one incoming height.
  // Each edge is visited at most once; divergent and stack-growing loops fail.
  const heights = new Map([[0, 0]]);
  const pending = [0];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const position = pending[cursor];
    const [operation, operand] = instructions[position];
    const before = heights.get(position);
    const needs = BINARY.has(operation) ? 2 : ["pop", "dup", "jump-if-false", "return"].includes(operation) ? 1 : 0;
    if (before < needs) fail("Reachable stack underflow.", position);
    if (operation === "return") {
      if (before !== 1) fail("Return requires exactly one stack value.", position);
      continue;
    }
    const after = before + (operation === "const" || operation === "dup" ? 1 :
      BINARY.has(operation) || operation === "pop" || operation === "jump-if-false" ? -1 : 0);
    if (after > LIMITS.stack) fail("Verified stack exceeds 256 values.", position);
    const successors = operation === "jump" ? [operand] :
      operation === "jump-if-false" ? [operand, position + 1] : [position + 1];
    for (const target of successors) {
      if (target >= instructions.length) fail("Reachable path falls off the instruction list.", position);
      if (heights.has(target)) {
        if (heights.get(target) !== after) fail("Control-flow join has inconsistent stack heights.", target);
      } else {
        heights.set(target, after);
        pending.push(target);
      }
    }
  }
  return Object.freeze({format: program.format, version: 1,
    constants: Object.freeze(constants), instructions: Object.freeze(instructions), source,
    maxStack: Math.max(...heights.values())});
}
