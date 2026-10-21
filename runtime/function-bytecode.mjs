import {verify, BytecodeError} from "./bytecode.mjs";
import {EXCEPTIONS} from "./function-objects.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

export const FUNCTION_LIMITS = Object.freeze({functions: 128, blocks: 512, instructions: 4096,
  names: 128, depth: 32, stack: 256});
const BINARY = new Set(["add", "subtract", "multiply", "floor-divide", "modulo", "divide",
  "inplace-add", "inplace-subtract", "inplace-multiply", "inplace-floor-divide", "inplace-modulo", "inplace-divide",
  "equal", "not-equal", "less", "less-equal", "greater", "greater-equal", "is", "contains", "getitem", "append", "dict-delete"]);
const UNARY = new Set(["truth", "not", "len", "negative", "positive", "iter", "next"]);
const CONSTRUCT = new Set(["build-list", "build-tuple", "build-dict"]);
const fail = message => { throw new BytecodeError(message); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, high) => Number.isSafeInteger(value) && value >= 0 && value <= high;
const name = value => typeof value === "string" && /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(value);
function sourceSpan(span) {
  if (!Array.isArray(span) || span.length !== 4 || !Array.from(span).every(value =>
    Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000) ||
    span[2] < span[0] || (span[2] === span[0] && span[3] < span[1])) fail("Invalid source span.");
  return Object.freeze([...span]);
}
function names(value, validName = name) {
  if (!Array.isArray(value) || value.length > FUNCTION_LIMITS.names || !Array.from(value).every(validName) ||
      new Set(value).size !== value.length) fail("Names require a bounded unique identifier array.");
  return Object.freeze([...value]);
}
function fields(value, expected) {
  if (!record(value) || Object.keys(value).length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) fail("Invalid bytecode record fields.");
}

export function verifyFunctions(program) {
  fields(program, ["format", "version", "constants", "functions"]);
  if (program.format !== "pocket-python-bytecode" || ![3, 4].includes(program.version) || !Array.isArray(program.functions) ||
      !integer(program.functions.length - 1, FUNCTION_LIMITS.functions - 1)) fail("Expected bounded pocket-python-bytecode version 3 or 4 functions.");
  const constants = verify({format: program.format, version: 2, constants: program.constants,
    instructions: [["build-tuple", 0], ["return"]]}).constants;
  const validName = program.version === 4 ? isPythonIdentifier : name;
  const privateName = value => program.version === 4 && typeof value === "string" && /^@source:[0-9]{1,5}$/.test(value);
  const storageName = value => validName(value) || privateName(value);
  let count = 0, blockCount = 0;
  const functions = Array.from(program.functions, (fn, functionIndex) => {
    fields(fn, ["name", "qualname", "params", "locals", "free", "body", "blocks"]);
    if (!(fn.name === "<module>" && functionIndex === 0) && !validName(fn.name)) fail("Invalid function name.");
    if (typeof fn.qualname !== "string" || !fn.qualname || fn.qualname.length > 256) fail("Invalid qualified function name.");
    fields(fn.params, ["posonly", "positional", "kwonly", "defaults", "kwdefaults"]);
    const params = Object.fromEntries(["posonly", "positional", "kwonly"].map(key => [key, names(fn.params[key], validName)]));
    const allParams = [...params.posonly, ...params.positional, ...params.kwonly];
    const locals = names(fn.locals, storageName), free = names(fn.free, validName);
    if (new Set(allParams).size !== allParams.length || allParams.length > FUNCTION_LIMITS.names ||
        allParams.some(key => !locals.includes(key)) || free.some(key => locals.includes(key))) fail("Parameter, local and free names conflict.");
    if (!Array.isArray(fn.params.defaults) || fn.params.defaults.length > params.posonly.length + params.positional.length ||
        !Array.from(fn.params.defaults).every(index => integer(index, constants.length - 1)) || !record(fn.params.kwdefaults) ||
        Object.keys(fn.params.kwdefaults).some(key => !params.kwonly.includes(key) || !integer(fn.params.kwdefaults[key], constants.length - 1))) fail("Defaults must refer to immutable constants and declared parameters.");
    params.defaults = Object.freeze([...fn.params.defaults]);
    params.kwdefaults = Object.freeze({...fn.params.kwdefaults});
    if (functionIndex === 0 && (allParams.length || free.length)) fail("Module entry has no parameters or free cells.");
    if (!Array.isArray(fn.blocks) || fn.blocks.length < 1 || (blockCount += fn.blocks.length) > FUNCTION_LIMITS.blocks ||
        !integer(fn.body, fn.blocks.length - 1)) fail("Function blocks exceed their bounded format.");
    const blocks = Array.from(fn.blocks, block => {
      fields(block, ["kind", "instructions", "source"]);
      if (!["statement", "expression"].includes(block.kind) || !Array.isArray(block.instructions) ||
          block.instructions.length < 1 || (count += block.instructions.length) > FUNCTION_LIMITS.instructions) fail("Block instruction budget exceeded.");
      let location = null;
      if (block.source !== null) {
        if (!record(block.source) || typeof block.source.filename !== "string" || !block.source.filename ||
            block.source.filename.length > 256 || !Array.isArray(block.source.spans) ||
            block.source.spans.length !== block.instructions.length) fail("Block source requires one span per instruction.");
        const spans = block.source.spans.map(sourceSpan);
        location = Object.freeze({filename: block.source.filename, spans: Object.freeze(spans)});
      }
      const edges = [], instructions = Array.from(block.instructions, instruction => {
        if (!Array.isArray(instruction)) fail("Instruction requires an array.");
        const [op, arg, extra] = instruction;
        if (program.version !== 4 && typeof op === "string" && op.startsWith("inplace-")) fail("In-place operations require version 4.");
        let length = 1;
        const blockRef = (id, kind) => {
          if (!integer(id, fn.blocks.length - 1) || fn.blocks[id]?.kind !== kind) fail("Block reference has the wrong index or kind.");
          edges.push(id);
        };
        if (op === "const") { length = 2; if (!integer(arg, constants.length - 1)) fail("Constant outside pool."); }
        else if (["load", "store", "delete"].includes(op) || (program.version === 4 && ["module-get", "import-from"].includes(op))) {
          length = 2;
          const storage = ["load", "store", "delete"].includes(op);
          if (!(storage ? storageName(arg) : validName(arg)) || (storage && privateName(arg) && !locals.includes(arg)) ||
              (["store", "delete"].includes(op) && !locals.includes(arg))) fail("Store/delete requires a declared local.");
        } else if (program.version === 4 && op === "import") {
          length = 4;
          if (typeof arg !== "string" || arg.length > 192 || (!arg && !extra) ||
              (arg && !/^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*$/.test(arg)) ||
              !integer(extra, 32) || typeof instruction[3] !== "boolean" || (extra && instruction[3])) fail("Invalid static import operands.");
        } else if (op === "function") { length = 2; if (!integer(arg, program.functions.length - 1) || arg === 0) fail("Invalid function reference."); }
        else if (op === "call") {
          length = 3; if (!integer(arg, FUNCTION_LIMITS.names)) fail("Invalid positional argument count."); names(extra, validName);
        } else if (CONSTRUCT.has(op)) { length = 2; if (!integer(arg, 1024)) fail("Invalid container item count."); }
        else if (["jump", "jump-if-false"].includes(op)) { length = 2; if (!integer(arg, block.instructions.length - 1)) fail("Jump outside current block."); }
        else if (op === "if") { length = 3; blockRef(arg, "statement"); blockRef(extra, "statement"); }
        else if (op === "while") { length = 4; blockRef(arg, "expression"); blockRef(extra, "statement"); blockRef(instruction[3], "statement"); }
        else if (op === "for") {
          length = 5; if (!locals.includes(arg)) fail("For target requires a local.");
          blockRef(extra, "expression"); blockRef(instruction[3], "statement"); blockRef(instruction[4], "statement");
        } else if (op === "try") {
          length = 5; blockRef(arg, "statement");
          if (!Array.isArray(extra) || extra.length > 32 || (!extra.length && instruction[4] === null)) fail("Try requires handlers or finally.");
          extra.forEach((handler, index) => {
            if (!Array.isArray(handler) || handler.length !== 4 || !Array.isArray(handler[0]) || handler[0].length > 16 ||
                !Array.from(handler[0]).every(type => Object.hasOwn(EXCEPTIONS, type)) ||
                (!handler[0].length && index !== extra.length - 1) || (handler[1] !== null && !locals.includes(handler[1]))) fail("Invalid exception clause.");
            blockRef(handler[2], "statement");
            sourceSpan(handler[3]);
          });
          if (instruction[3] !== null) blockRef(instruction[3], "statement");
          if (instruction[4] !== null) blockRef(instruction[4], "statement");
        } else if (!(BINARY.has(op) || UNARY.has(op) || ["pop", "dup", "swap", "setitem", "slice", "end", "return", "raise", "reraise", "break", "continue"].includes(op))) fail("Unknown function opcode.");
        if (instruction.length !== length || (block.kind === "expression" && ["return", "break", "continue", "if", "while", "for", "try"].includes(op))) fail("Invalid operands or expression control flow.");
        return Object.freeze(instruction.map((value, index) => op === "try" && index === 2 ?
          Object.freeze(value.map(handler => Object.freeze([Object.freeze([...handler[0]]), handler[1], handler[2], sourceSpan(handler[3])]))) :
          Array.isArray(value) ? Object.freeze([...value]) : value));
      });
      const heights = new Map([[0, 0]]), pending = [0];
      for (let cursor = 0; cursor < pending.length; cursor++) {
        const at = pending[cursor], [op, arg, extra] = instructions[at], before = heights.get(at);
        const needs = BINARY.has(op) || op === "swap" ? 2 : op === "setitem" ? 3 : op === "slice" ? 4 :
          op === "call" ? 1 + arg + extra.length : CONSTRUCT.has(op) ? arg * (op === "build-dict" ? 2 : 1) :
          UNARY.has(op) || ["module-get", "import-from", "store", "pop", "dup", "if", "jump-if-false", "return", "raise"].includes(op) ? 1 : 0;
        if (before < needs) fail("Reachable function stack underflow.");
        if (["end", "return", "raise", "reraise", "break", "continue"].includes(op)) {
          if (before !== (op === "end" ? Number(block.kind === "expression") : needs)) fail("Block completion requires an exact stack height.");
          continue;
        }
        const after = before + (["const", "load", "function", "dup", "import"].includes(op) ? 1 :
          BINARY.has(op) || CONSTRUCT.has(op) || ["call", "setitem", "slice"].includes(op) ? 1 - needs :
          ["store", "pop", "if", "jump-if-false"].includes(op) ? -1 : 0);
        if (after > FUNCTION_LIMITS.stack) fail("Function stack exceeds 256 values.");
        const targets = op === "jump" ? [arg] : op === "jump-if-false" ? [arg, at + 1] : [at + 1];
        for (const target of targets) {
          if (target >= instructions.length) fail("Block falls off its instruction list.");
          if (heights.has(target)) { if (heights.get(target) !== after) fail("Inconsistent block stack join."); }
          else { heights.set(target, after); pending.push(target); }
        }
      }
      return Object.freeze({kind: block.kind, instructions: Object.freeze(instructions), source: location, edges: Object.freeze(edges)});
    });
    if (blocks[fn.body].kind !== "statement") fail("Function body requires a statement block.");
    // Structured edges cannot recursively expand the host/control stack.
    const depths = new Map();
    const visit = (id, path) => {
      if (path.includes(id) || path.length >= FUNCTION_LIMITS.depth) fail("Cyclic or excessive block nesting.");
      if (depths.has(id)) {
        if (path.length + depths.get(id) > FUNCTION_LIMITS.depth) fail("Excessive block nesting.");
        return depths.get(id);
      }
      let depth = 1;
      for (const next of blocks[id].edges) depth = Math.max(depth, 1 + visit(next, [...path, id]));
      depths.set(id, depth);
      return depth;
    };
    for (let id = 0; id < blocks.length; id++) visit(id, []);
    const contexts = new Set(), reached = new Set();
    const control = (id, loop) => {
      const key = id + ":" + loop;
      if (contexts.has(key)) return;
      contexts.add(key); reached.add(id);
      for (const instruction of blocks[id].instructions) {
        const [op, a, b, c, d] = instruction;
        if (!loop && ["break", "continue"].includes(op)) fail("Loop control requires a containing loop body.");
        if (op === "if") { control(a, loop); control(b, loop); }
        if (op === "while") { control(a, loop); control(b, true); control(c, loop); }
        if (op === "for") { control(b, loop); control(c, true); control(d, loop); }
        if (op === "try") {
          control(a, loop); for (const handler of b) control(handler[2], loop);
          if (c !== null) control(c, loop); if (d !== null) control(d, loop);
        }
      }
    };
    control(fn.body, false);
    if (reached.size !== blocks.length) fail("Function contains an unreferenced block.");
    return Object.freeze({name: fn.name, qualname: fn.qualname, params: Object.freeze(params), locals, free, body: fn.body, blocks: Object.freeze(blocks)});
  });
  for (const fn of functions) for (const block of fn.blocks) for (const [op, target] of block.instructions) {
    if (op === "function" && functions[target].free.some(key => !fn.locals.includes(key) && !fn.free.includes(key))) fail("Function capture has no lexical cell.");
  }
  const code = Object.freeze({format: program.format, version: program.version, constants, functions: Object.freeze(functions)});
  return Object.freeze({code, bytes: 64 + 2 * JSON.stringify({constants: program.constants, functions}).length});
}
