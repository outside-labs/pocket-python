import {LIMITS, verify} from "./bytecode.mjs";
import {ValueRuntime} from "./values.mjs";

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
  let current = 0;
  const values = new ValueRuntime({charge: amount => {
    if ((work += amount) > maxWork) error("BUDGET", "ExecutionLimitError", "Value work budget exceeded.", current);
    if (shouldCancel?.()) error("CANCELLED", "ExecutionCancelled", "Execution cancelled.", current);
  }, fail: (name, message, codeName = "PYTHON") => error(codeName, name, message, current)});
  while (true) {
    const at = position;
    current = at;
    if (shouldCancel?.()) error("CANCELLED", "ExecutionCancelled", "Execution cancelled.", at);
    if (++steps > maxSteps) error("BUDGET", "ExecutionLimitError", "Instruction budget exceeded.", at);
    const [operation, operand] = code.instructions[position++];
    if (operation === "const") stack.push(code.constants[operand]);
    else if (operation === "dup") stack.push(stack.at(-1));
    else if (operation === "swap") { const last = stack.pop(), before = stack.pop(); stack.push(last, before); }
    else if (operation === "pop") stack.pop();
    else if (operation === "jump") position = operand;
    else if (operation === "jump-if-false") {
      const condition = stack.pop();
      if (!(code.version === 2 ? values.truth(condition) : condition)) position = operand;
    } else if (operation === "return") return stack[0];
    else if (code.version === 2) {
      if (operation === "build-list" || operation === "build-tuple" || operation === "build-dict") {
        const items = stack.splice(stack.length - operand * (operation === "build-dict" ? 2 : 1));
        stack.push(operation === "build-dict" ? values.dict(Array.from({length: operand}, (_, index) => items.slice(index * 2, index * 2 + 2))) :
          operation === "build-list" ? values.list(items) : values.tuple(items));
      } else if (operation === "setitem") {
        const item = stack.pop(), key = stack.pop(); stack.push(values.set(stack.pop(), key, item));
      } else if (operation === "slice") {
        const step = stack.pop(), stop = stack.pop(), start = stack.pop(); stack.push(values.slice(stack.pop(), start, stop, step));
      } else if (["truth", "not", "len", "negative", "positive", "iter", "next"].includes(operation)) {
        stack.push(values.unary(operation, stack.pop()));
      } else {
        const right = stack.pop(); stack.push(values.binary(operation, stack.pop(), right));
      }
    }
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
        if (right === 0n) error("ZERO_DIVISION", "ZeroDivisionError",
          operation === "floor-divide" ? "division by zero" : "integer modulo by zero", at);
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
