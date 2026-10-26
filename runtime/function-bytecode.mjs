import {verify, BytecodeError} from "./bytecode.mjs";
import {EXCEPTIONS} from "./function-objects.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

export const FUNCTION_LIMITS = Object.freeze({functions: 128, blocks: 512, instructions: 4096,
  names: 128, depth: 32, stack: 256});
const BINARY = new Set(["add", "subtract", "multiply", "floor-divide", "modulo", "divide",
  "power", "bit-and", "bit-or", "bit-xor", "left-shift", "right-shift",
  "inplace-power", "inplace-bit-and", "inplace-bit-or", "inplace-bit-xor", "inplace-left-shift", "inplace-right-shift",
  "inplace-add", "inplace-subtract", "inplace-multiply", "inplace-floor-divide", "inplace-modulo", "inplace-divide",
  "equal", "not-equal", "less", "less-equal", "greater", "greater-equal", "is", "contains", "getitem", "append", "dict-delete"]);
const UNARY = new Set(["truth", "not", "len", "negative", "positive", "invert", "iter", "next"]);
const NUMERIC = new Set(["power", "bit-and", "bit-or", "bit-xor", "left-shift", "right-shift", "invert"]);
const CONSTRUCT = new Set(["build-list", "build-tuple", "build-dict", "build-set"]);
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
  if (program.format !== "pocket-python-bytecode" || ![3, 4, 5].includes(program.version) || !Array.isArray(program.functions) ||
      !integer(program.functions.length - 1, FUNCTION_LIMITS.functions - 1)) fail("Expected bounded pocket-python-bytecode version 3, 4 or 5 functions.");
  const constants = verify({format: program.format, version: 2, constants: program.constants,
    instructions: [["build-tuple", 0], ["return"]]}, {numeric:program.version >= 4}).constants;
  const modern = program.version >= 4, classes = program.version === 5;
  const validName = modern ? isPythonIdentifier : name;
  const privateName = value => modern && typeof value === "string" && /^@source:[0-9]{1,5}$/.test(value);
  const storageName = value => validName(value) || privateName(value);
  let count = 0, blockCount = 0;
  const functions = Array.from(program.functions, (fn, functionIndex) => {
    const scopeFields = modern ? ["globals", "nonlocals"].filter(key => Object.hasOwn(fn, key)) : [];
    fields(fn, ["name", "qualname", "params", "locals", "free", "body", "blocks", ...(classes ? ["kind"] : []), ...scopeFields]);
    const kind = classes ? fn.kind : functionIndex === 0 ? "module" : "function";
    if (!["module", "function", "class"].includes(kind) || (functionIndex === 0) !== (kind === "module")) fail("Invalid function/class body kind.");
    if (!(fn.name === "<module>" && functionIndex === 0) && !(modern && fn.name === "<lambda>" && kind === "function") && !validName(fn.name)) fail("Invalid function name.");
    if (typeof fn.qualname !== "string" || !fn.qualname || fn.qualname.length > 256) fail("Invalid qualified function name.");
    const variadic = modern ? ["vararg", "kwarg"].filter(key => Object.hasOwn(fn.params, key)) : [];
    fields(fn.params, ["posonly", "positional", "kwonly", "defaults", "kwdefaults", ...variadic]);
    const params = Object.fromEntries(["posonly", "positional", "kwonly"].map(key => [key, names(fn.params[key], validName)]));
    for (const key of variadic) {
      if (!validName(fn.params[key])) fail("Invalid variadic parameter name.");
      params[key] = fn.params[key];
    }
    const allParams = [...params.posonly, ...params.positional, ...params.kwonly, ...variadic.map(key => params[key])];
    const locals = names(fn.locals, storageName), free = names(fn.free, validName);
    const globals = names(Object.hasOwn(fn, "globals") ? fn.globals : [], validName), nonlocals = names(Object.hasOwn(fn, "nonlocals") ? fn.nonlocals : [], validName);
    if (globals.some(key => locals.includes(key) || nonlocals.includes(key) || kind !== "class" && free.includes(key)) ||
        nonlocals.some(key => !free.includes(key) || locals.includes(key)) || functionIndex === 0 && nonlocals.length)
      fail("Invalid explicit scope binding.");
    const writable = key => locals.includes(key) || globals.includes(key) || nonlocals.includes(key);
    if (new Set(allParams).size !== allParams.length || allParams.length > FUNCTION_LIMITS.names ||
        allParams.some(key => !locals.includes(key)) || (kind !== "class" && free.some(key => locals.includes(key)))) fail("Parameter, local and free names conflict.");
    if (kind === "class" && (allParams.length || !["__module__", "__qualname__"].every(key => locals.includes(key)))) fail("Class bodies require metadata locals and no parameters.");
    if (!Array.isArray(fn.params.defaults) || fn.params.defaults.length > params.posonly.length + params.positional.length ||
        !Array.from(fn.params.defaults).every(index => (modern && index === null || integer(index, constants.length - 1))) || !record(fn.params.kwdefaults) ||
        Object.keys(fn.params.kwdefaults).some(key => !params.kwonly.includes(key) || !(modern && fn.params.kwdefaults[key] === null || integer(fn.params.kwdefaults[key], constants.length - 1)))) fail("Defaults must refer to immutable constants and declared parameters.");
    const runtimeDefaults = [...fn.params.defaults, ...Object.values(fn.params.kwdefaults)].some(value => value === null);
    if (runtimeDefaults && [...fn.params.defaults, ...Object.values(fn.params.kwdefaults)].some(value => value !== null)) fail("Runtime defaults require a complete definition-time vector.");
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
        if (!modern && typeof op === "string" && op.startsWith("inplace-")) fail("In-place operations require version 4 or later.");
        if (!modern && NUMERIC.has(op)) fail("Numeric operators require version 4 or later.");
        let length = 1;
        const blockRef = (id, kind) => {
          if (!integer(id, fn.blocks.length - 1) || fn.blocks[id]?.kind !== kind) fail("Block reference has the wrong index or kind.");
          edges.push(id);
        };
        if (op === "const") { length = 2; if (!integer(arg, constants.length - 1)) fail("Constant outside pool."); }
        else if (["load", "store", "delete"].includes(op) || (modern && ["module-get", "import-from"].includes(op)) ||
            (classes && ["attribute-get", "attribute-set", "attribute-delete"].includes(op))) {
          length = 2;
          const storage = ["load", "store", "delete"].includes(op);
          if (!(storage ? storageName(arg) : validName(arg)) || (storage && privateName(arg) && !locals.includes(arg)) ||
              (["store", "delete"].includes(op) && !writable(arg))) fail("Store/delete requires a declared local.");
        } else if (modern && op === "import") {
          length = 4;
          if (typeof arg !== "string" || arg.length > 192 || (!arg && !extra) ||
              (arg && !/^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*$/.test(arg)) ||
              !integer(extra, 32) || typeof instruction[3] !== "boolean" || (extra && instruction[3])) fail("Invalid static import operands.");
        } else if (op === "function") { length = 2; if (!integer(arg, program.functions.length - 1) || arg === 0 || (classes && program.functions[arg]?.kind !== "function")) fail("Invalid function reference."); }
        else if (modern && op === "function-defaults") {
          length = 4;
          if (!integer(arg, program.functions.length - 1) || arg === 0 || classes && program.functions[arg]?.kind !== "function" ||
              !integer(extra, FUNCTION_LIMITS.names)) fail("Invalid runtime-default function reference.");
          names(instruction[3], validName);
          const p = program.functions[arg].params;
          if (p.defaults.length !== extra || Object.keys(p.kwdefaults).length !== instruction[3].length ||
              !instruction[3].every((key, index) => Object.keys(p.kwdefaults)[index] === key) ||
              ![...p.defaults, ...Object.values(p.kwdefaults)].length ||
              [...p.defaults, ...Object.values(p.kwdefaults)].some(value => value !== null)) fail("Runtime defaults do not match the target signature.");
        }
        else if (classes && op === "class") {
          length = 3;
          if (!integer(arg, program.functions.length - 1) || arg === 0 || program.functions[arg]?.kind !== "class" || !integer(extra, 16)) fail("Invalid class body or base count.");
        }
        else if (modern && op === "unpack") {
          length = 3;
          if (!integer(arg, 128) || extra !== null && (!integer(extra, 128) || arg + extra + 1 > 128)) fail("Invalid unpacking counts.");
        }
        else if (modern && ["yield", "yield-from", "list-push", "list-extend", "list-to-tuple", "dict-merge", "dict-insert", "set-insert", "set-extend"].includes(op)) {
          if (["yield", "yield-from"].includes(op) && (functionIndex === 0 || kind === "class")) fail("Yield requires a function body.");
        }
        else if (modern && op === "assertion-error") { length = 2; if (typeof arg !== "boolean") fail("Invalid assertion message flag."); }
        else if (modern && op === "call-keyword") { length = 2; if (!validName(arg)) fail("Invalid assembled keyword name."); }
        else if (modern && ["call-start", "call-argument", "call-star", "call-mapping", "call-expanded"].includes(op)) {}
        else if (op === "call") {
          length = 3; if (!integer(arg, FUNCTION_LIMITS.names)) fail("Invalid positional argument count."); names(extra, validName);
        } else if (CONSTRUCT.has(op)) { length = 2; if (op === "build-set" && !modern || !integer(arg, 1024)) fail("Invalid container item count."); }
        else if (["jump", "jump-if-false"].includes(op)) { length = 2; if (!integer(arg, block.instructions.length - 1)) fail("Jump outside current block."); }
        else if (op === "if") { length = 3; blockRef(arg, "statement"); blockRef(extra, "statement"); }
        else if (op === "while") { length = 4; blockRef(arg, "expression"); blockRef(extra, "statement"); blockRef(instruction[3], "statement"); }
        else if (op === "for") {
          length = 5; if (!writable(arg)) fail("For target requires a writable binding.");
          blockRef(extra, "expression"); blockRef(instruction[3], "statement"); blockRef(instruction[4], "statement");
        } else if (op === "try") {
          length = 5; blockRef(arg, "statement");
          if (!Array.isArray(extra) || extra.length > 32 || (!extra.length && instruction[4] === null)) fail("Try requires handlers or finally.");
          extra.forEach((handler, index) => {
            if (!Array.isArray(handler) || handler.length !== 4 || !Array.isArray(handler[0]) || handler[0].length > 16 ||
                !Array.from(handler[0]).every(type => Object.hasOwn(EXCEPTIONS, type)) ||
                (!handler[0].length && index !== extra.length - 1) || (handler[1] !== null && !writable(handler[1]))) fail("Invalid exception clause.");
            blockRef(handler[2], "statement");
            sourceSpan(handler[3]);
          });
          if (instruction[3] !== null) blockRef(instruction[3], "statement");
          if (instruction[4] !== null) blockRef(instruction[4], "statement");
        } else if (!(BINARY.has(op) || UNARY.has(op) || (classes && op === "build-slice") || ["pop", "dup", "swap", "setitem", "slice", "end", "return", "raise", "reraise", "break", "continue"].includes(op))) fail("Unknown function opcode.");
        if (instruction.length !== length || (kind === "class" && op === "return") ||
            (block.kind === "expression" && ["return", "break", "continue", "if", "while", "for", "try"].includes(op))) fail("Invalid operands or expression control flow.");
        return Object.freeze(instruction.map((value, index) => op === "try" && index === 2 ?
          Object.freeze(value.map(handler => Object.freeze([Object.freeze([...handler[0]]), handler[1], handler[2], sourceSpan(handler[3])]))) :
          Array.isArray(value) ? Object.freeze([...value]) : value));
      });
      const heights = new Map([[0, 0]]), pending = [0];
      for (let cursor = 0; cursor < pending.length; cursor++) {
        const at = pending[cursor], [op, arg, extra] = instructions[at], before = heights.get(at);
        const needs = op === "dict-insert" ? 3 : ["list-push", "list-extend", "dict-merge", "set-insert", "set-extend"].includes(op) ? 2 : ["unpack", "list-to-tuple"].includes(op) ? 1 : op === "assertion-error" ? Number(arg) : ["call-argument", "call-star", "call-mapping", "call-keyword"].includes(op) ? 2 : ["call-start", "call-expanded"].includes(op) ? 1 : op === "function-defaults" ? extra + instructions[at][3].length : op === "class" ? extra : op === "attribute-set" ? 2 : BINARY.has(op) || op === "swap" ? 2 : ["setitem", "build-slice"].includes(op) ? 3 : op === "slice" ? 4 :
          op === "call" ? 1 + arg + extra.length : CONSTRUCT.has(op) ? arg * (op === "build-dict" ? 2 : 1) :
          UNARY.has(op) || ["yield", "yield-from", "attribute-get", "attribute-delete", "module-get", "import-from", "store", "pop", "dup", "if", "jump-if-false", "return", "raise"].includes(op) ? 1 : 0;
        if (before < needs) fail("Reachable function stack underflow.");
        if (["end", "return", "raise", "reraise", "break", "continue"].includes(op)) {
          if (before !== (op === "end" ? Number(block.kind === "expression") : needs)) fail("Block completion requires an exact stack height.");
          continue;
        }
        const after = before + (op === "dict-insert" ? -2 : ["list-push", "list-extend", "dict-merge", "set-insert", "set-extend"].includes(op) ? -1 : op === "assertion-error" ? 1 - needs : ["call-argument", "call-star", "call-mapping", "call-keyword"].includes(op) ? -1 : ["class", "function-defaults"].includes(op) ? 1 - needs : op === "attribute-set" ? -1 : ["const", "load", "function", "dup", "import"].includes(op) ? 1 :
          BINARY.has(op) || CONSTRUCT.has(op) || ["call", "setitem", "slice", "build-slice"].includes(op) ? 1 - needs :
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
    return Object.freeze({name: fn.name, qualname: fn.qualname, params: Object.freeze(params), locals, free, body: fn.body, blocks: Object.freeze(blocks), ...(classes ? {kind} : {}), ...Object.fromEntries(scopeFields.map(key => [key, key === "globals" ? globals : nonlocals]))});
  });
  for (const fn of functions) for (const block of fn.blocks) for (const [op, target] of block.instructions) {
    if (op === "function" && [...functions[target].params.defaults, ...Object.values(functions[target].params.kwdefaults)].some(value => value === null))
      fail("A runtime-default function requires definition values.");
    if (["function", "function-defaults", "class"].includes(op) && functions[target].free.some(key =>
      (fn.kind === "class" || !fn.locals.includes(key)) && !fn.free.includes(key))) fail("Function/class capture has no lexical cell.");
  }
  const code = Object.freeze({format: program.format, version: program.version, constants, functions: Object.freeze(functions)});
  return Object.freeze({code, bytes: 64 + 2 * JSON.stringify({constants: program.constants, functions}).length});
}
