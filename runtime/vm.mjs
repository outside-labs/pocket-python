import {LIMITS, verify} from "./bytecode.mjs";

export class ExecutionError extends Error {
  constructor(code, name, message, instruction, source) {
    super(message);
    this.name = name;
    this.code = code;
    this.instruction = instruction;
    this.location = source ? {filename: source.filename, span: source.spans[instruction]} : null;
  }
}

function numeric(value) { return typeof value === "boolean" ? (value ? 1n : 0n) : value; }
function digits(value) { return value.toString().replace(/^-/, "").length; }

export function execute(program, {maxSteps = 10_000, maxWork = 1_000_000, shouldCancel = null} = {}) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1_000_000 ||
      !Number.isSafeInteger(maxWork) || maxWork < 1 || maxWork > 100_000_000 ||
      (shouldCancel !== null && typeof shouldCancel !== "function")) {
    throw new TypeError("Invalid execution budget or cancellation callback.");
  }
  const code = verify(program);
  const stack = [];
  let position = 0, steps = 0, work = 0;
  const error = (codeName, name, message, at) => {
    throw new ExecutionError(codeName, name, message, at, code.source);
  };
  while (true) {
    const at = position;
    if (shouldCancel?.()) error("CANCELLED", "ExecutionCancelled", "Execution cancelled.", at);
    if (++steps > maxSteps) error("BUDGET", "ExecutionLimitError", "Instruction budget exceeded.", at);
    const [operation, operand] = code.instructions[position++];
    if (operation === "const") stack.push(code.constants[operand]);
    else if (operation === "dup") stack.push(stack.at(-1));
    else if (operation === "pop") stack.pop();
    else if (operation === "jump") position = operand;
    else if (operation === "jump-if-false") {
      if (!stack.pop()) position = operand;
    } else if (operation === "return") return stack[0];
    else {
      const right = numeric(stack.pop()), left = numeric(stack.pop());
      const leftDigits = digits(left), rightDigits = digits(right);
      work += ["multiply", "floor-divide", "modulo"].includes(operation) ?
        leftDigits * rightDigits : Math.max(leftDigits, rightDigits);
      if (work > maxWork) error("BUDGET", "ExecutionLimitError", "Arithmetic work budget exceeded.", at);
      // Cancellation is checked immediately before each bounded primitive too.
      if (shouldCancel?.()) error("CANCELLED", "ExecutionCancelled", "Execution cancelled.", at);
      let value;
      if (operation === "add") value = left + right;
      else if (operation === "subtract") value = left - right;
      else if (operation === "multiply") value = left * right;
      else if (operation === "equal") value = left === right;
      else if (operation === "less") value = left < right;
      else {
        if (right === 0n) error("ZERO_DIVISION", "ZeroDivisionError", "integer division or modulo by zero", at);
        let quotient = left / right;
        if (left % right !== 0n && (left < 0n) !== (right < 0n)) quotient -= 1n;
        value = operation === "floor-divide" ? quotient : left - quotient * right;
      }
      if (typeof value === "bigint" && digits(value) > LIMITS.digits) {
        error("BUDGET", "ExecutionLimitError", "Integer digit budget exceeded.", at);
      }
      stack.push(value);
    }
  }
}
