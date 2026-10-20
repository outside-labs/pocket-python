// Experimental architecture spike. This is not the versioned Python bytecode API.
const MAX_INSTRUCTIONS = 256;
const MAX_STACK = 256;
const MAX_DIGITS = 4096;

export class PrototypeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrototypeError";
    this.code = code;
  }
}

function invalid(message) {
  throw new PrototypeError("BYTECODE", message);
}

function snapshot(program) {
  if (program?.format !== "pocket-python-prototype" || program.version !== 0) {
    invalid("Unsupported prototype format or version.");
  }
  const source = program.instructions;
  if (!Array.isArray(source) || source.length === 0 || source.length > MAX_INSTRUCTIONS) {
    invalid("Expected 1-256 instructions.");
  }
  return Array.from(source, instruction => {
    if (!Array.isArray(instruction)) invalid("An instruction must be an array.");
    const [operation, argument] = instruction;
    if (operation === "const") {
      if (instruction.length !== 2 || typeof argument !== "string" ||
          argument.length > MAX_DIGITS || !/^-?(0|[1-9][0-9]*)$/.test(argument)) {
        invalid("Integer constants require bounded canonical decimal strings.");
      }
    } else if (operation === "jump") {
      if (instruction.length !== 2 || !Number.isSafeInteger(argument) ||
          argument < 0 || argument >= source.length) {
        invalid("Jump target is outside the instruction list.");
      }
    } else if (["add", "subtract", "return"].includes(operation)) {
      if (instruction.length !== 1) invalid("Unexpected instruction operand.");
    } else {
      invalid("Unknown prototype operation.");
    }
    return Object.freeze([...instruction]);
  });
}

export function execute(program, {maxSteps = 1000} = {}) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1_000_000) {
    invalid("maxSteps must be an integer between 1 and 1000000.");
  }
  const instructions = snapshot(program);
  const stack = [];
  let position = 0;
  let steps = 0;
  while (position < instructions.length) {
    if (++steps > maxSteps) throw new PrototypeError("BUDGET", "Instruction budget exceeded.");
    const [operation, argument] = instructions[position++];
    if (operation === "const") {
      if (stack.length >= MAX_STACK) throw new PrototypeError("BUDGET", "Stack budget exceeded.");
      stack.push(BigInt(argument));
    } else if (operation === "add" || operation === "subtract") {
      if (stack.length < 2) invalid("Arithmetic stack underflow.");
      const right = stack.pop();
      const left = stack.pop();
      const value = operation === "add" ? left + right : left - right;
      if (value.toString().length > MAX_DIGITS) {
        throw new PrototypeError("BUDGET", "Integer digit budget exceeded.");
      }
      stack.push(value);
    } else if (operation === "jump") {
      position = argument;
    } else if (operation === "return") {
      if (stack.length !== 1) invalid("Return requires exactly one value.");
      return stack[0];
    }
  }
  invalid("Execution reached the end without a return.");
}
