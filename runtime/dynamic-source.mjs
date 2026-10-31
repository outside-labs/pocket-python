import {compileSource} from "./source-compiler.mjs";
import {SourceError} from "./source-tokens.mjs";
import {verifyFunctions} from "./function-bytecode.mjs";
import {CodePool, InstanceValue} from "./function-objects.mjs";
import {completion, unaryTask, valueTask} from "./operations.mjs";

// Dynamic compilation has the same grammar and verifier as registry source.
// The transient compiler reservation and every unit of compilation work belong
// to the calling arena/run, including unsuccessful attempts.
export function dynamicCompiler({state, memory, values, classes, allocate, charge, python, hard}) {
  const payload = value => value instanceof InstanceValue && value.nativePayload !== undefined ? value.nativePayload : value;
  const sourceInput = value => {
    value = payload(value);
    const text = values.text(value);
    if (text !== null) return text;
    if (values.isBinary(value)) { charge(value.items.length + 1); return new Uint8Array(value.items); }
    if (values.isView(value)) {
      values.liveView(value);
      if (value.stride !== 1n) python("TypeError", "compile() source buffer must be contiguous");
      charge(value.length + 1);
      return new Uint8Array(value.owner.items.slice(Number(value.offset), Number(value.offset) + value.length));
    }
    python("TypeError", "compile() arg 1 must be a string, bytes or adopted source buffer");
  };
  const filenameInput = value => {
    value = payload(value);
    let text = values.text(value);
    if (text === null && values.isBinary(value) && !value.mutable) {
      charge(value.items.length + 1);
      try { text = new TextDecoder("utf-8", {fatal: true}).decode(new Uint8Array(value.items)); }
      catch { python("UnicodeDecodeError", "filename is not valid UTF-8"); }
    }
    if (text === null) python("TypeError", "compile() filename must be a string or bytes");
    if (text.includes("\0")) python("ValueError", "embedded null character");
    if (text.length > 256) hard("COMPILE_BUDGET", "CompileLimitError", "Logical filename budget exceeded");
    return text;
  };
  const compile = (source, filename, mode, optimize = 0) => {
    const input = sourceInput(source), size = typeof input === "string" ? new TextEncoder().encode(input).length : input.length;
    const release = memory.external(256 + 128 * size);
    try {
      const result = compileSource(input, {filename, mode, optimize, languageProfile: state.frames.at(-1).pool.code.version === 5 ? "classes-source/1" : "core-source/1",
        onWork: charge});
      charge(result.stats.bytecodeBytes);
      const verified = verifyFunctions(result.program);
      const pool = allocate(CodePool, verified.code, verified.bytes, state.frames.at(-1).pool.module,
        Object.freeze({source: result.source, mode}));
      state.temporaries.push(pool);
      return classes.codeObject(pool, 0);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      if (error.code === "SYNTAX") python(error.name, error.message);
      hard(error.code, error.name, error.message);
    } finally { release(); }
  };
  const next = (record, site) => {
    if (record.position < 4) {
      const index = [3, 4, 5, 6][record.position];
      return unaryTask(index === 4 ? "truth" : "index", record.args[index], site,
        completion("compile-argument", record));
    }
    const [source, filename, mode, flags, , optimize] = record.args;
    if (flags !== 0n) {
      // Known AST, future, interactive and async flags are named boundaries.
      if (flags < 0n || flags & ~0x1fef610n) python("ValueError", "compile(): unrecognised flags");
      hard("UNSUPPORTED", "UnsupportedOperationError", "AST, future, incomplete-input and async compiler flags require their own contracts");
    }
    if (optimize < -1n || optimize > 2n) python("ValueError", "compile(): invalid optimize value");
    const modeText = values.text(payload(mode));
    if (!["exec", "eval", "single"].includes(modeText)) python("ValueError", "compile() mode must be 'exec', 'eval' or 'single'");
    return valueTask(compile(source, filename, modeText, Number(optimize < 0n ? 0n : optimize)), site, record.after);
  };
  const start = (args, keywords, keywordValues, site, after) => {
    const labels = ["source", "filename", "mode", "flags", "dont_inherit", "optimize", "_feature_version"];
    if (args.length > 6) python("TypeError", "compile() takes at most 6 positional arguments");
    const bound = new Map(labels.slice(0, args.length).map((key, index) => [key, args[index]]));
    for (let index = 0; index < keywords.length; index++) {
      const key = keywords[index];
      if (!labels.includes(key) || bound.has(key)) python("TypeError", "compile() received an invalid or duplicate keyword argument");
      bound.set(key, keywordValues[index]);
    }
    if (labels.slice(0, 3).some(key => !bound.has(key))) python("TypeError", "compile() requires source, filename and mode");
    const operands = labels.map((key, index) => bound.has(key) ? bound.get(key) : [null, null, null, 0n, false, -1n, -1n][index]);
    operands[1] = filenameInput(operands[1]);
    if (values.text(payload(operands[2])) === null) python("TypeError", "compile() mode must be a string");
    return next({args: operands, position: 0, after}, site);
  };
  const converted = (record, value, site) => {
    if (record.position !== 1 && (value < -2147483648n || value > 2147483647n)) python("OverflowError", "Python int too large to convert to C int");
    const index = [3, 4, 5, 6][record.position];
    return next({...record, args: record.args.map((item, at) => at === index ? value : item), position: record.position + 1}, site);
  };
  return {start, converted, compile, sourceInput};
}
