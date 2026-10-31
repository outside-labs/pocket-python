import {CodeValue, Environment, FunctionValue, ModuleValue, InstanceValue, Cell, GeneratorValue, FrameLocalsValue, ClassNamespaceValue} from "./function-objects.mjs";
import {isVerifiedFunctionCode} from "./function-bytecode.mjs";
import {completion, callTask, dictionaryTask, valueTask} from "./operations.mjs";

// Namespace preparation is a sequence of ordinary owned operations. Callback
// keys and mappings can suspend without losing source, namespaces or results.
export function dynamicEvaluator({state, values, classes, allocate, enter, bind, loadName, classModule, compiler, python}) {
  const rawDictionary = value => value instanceof InstanceValue ? value.nativePayload : value;
  const record = (kind, fields) => completion(kind, fields);
  const execute = (task, site) => {
    let code = task.source;
    const mode = task.mode ?? "eval";
    if (mode === "exec" && task.closure !== null && !(code instanceof CodeValue)) python("TypeError", "closure can only be used if source is a code object");
    if (!(code instanceof CodeValue)) {
      let input = compiler.sourceInput(code);
      // eval, unlike compile, strips leading spaces and tabs from source.
      if (mode === "eval") {
        if (typeof input === "string") input = input.replace(/^[ \t]+/, "");
        else { let at = 0; while ([9, 32].includes(input[at])) at++; input = input.slice(at); }
      }
      const source = typeof input === "string" ? values.string(Array.from(input, ch => ch.codePointAt(0))) : values.binaryValue([...input], false);
      state.temporaries.push(source);
      code = compiler.compile(source, "<string>", mode); state.temporaries.push(code);
    }
    classes.touch(code);
    if (!isVerifiedFunctionCode(code.pool.code)) python("TypeError", "eval() requires independently verified code");
    const fn = code.pool.code.functions[code.index];
    let closure = new Map();
    if (mode === "eval" && fn.free.length) python("TypeError", "code object passed to eval() may not contain free variables");
    if (mode === "exec") {
      if (!fn.free.length && task.closure !== null) python("TypeError", "cannot use a closure with this code object");
      if (fn.free.length) {
        const cells = values.isSequenceType(task.closure, "tuple") ? values.comparisonSequence(task.closure) : null;
        if (!cells || cells.length !== fn.free.length || cells.some(cell => !(cell instanceof Cell))) python("TypeError", "code object requires a closure of exactly length " + fn.free.length);
        cells.forEach(cell => classes.touch(cell));
        closure = new Map(fn.free.map((key, index) => [key, cells[index]]));
      }
    }
    const globals = allocate(Environment, rawDictionary(task.globals), task.globals); state.temporaries.push(globals);
    const callable = allocate(FunctionValue, code.pool, code.index, globals, closure, [], task.builtins); state.temporaries.push(callable);
    const namespace = allocate(Environment, task.locals); state.temporaries.push(namespace);
    const after = mode === "exec" ? completion("exec-return", {after: task.after}) : task.after;
    const bindings = bind(callable, [], [], []);
    if (fn.blocks.some(block => block.instructions.some(([op]) => ["yield", "yield-from"].includes(op)))) return valueTask(allocate(GeneratorValue, callable, bindings), site, after);
    enter(callable, bindings, site, after);
    const frame = state.frames.at(-1);
    if (["module", "class"].includes(fn.kind) || code.index === 0) { frame.dynamicNamespace = true; frame.namespaceEnvironment = namespace; }
    if (fn.kind === "class") {
      const resolved = loadName(frame, "__name__", site, completion("class-body-module"));
      return resolved.task || classModule(resolved.value);
    }
    return null;
  };
  const namespace = (task, site) => {
    const key = values.string(Array.from("__builtins__", ch => ch.codePointAt(0))); state.temporaries.push(key);
    return dictionaryTask(rawDictionary(task.globals), key, site, record("eval-builtins-probe", {...task, key}), 0, "probe");
  };
  const resume = (task, value, site) => {
    if (task.kind === "eval-locals") return namespace({...task, locals: value}, site);
    if (task.kind === "eval-builtins-probe") {
      const [found, builtins] = values.comparisonSequence(value);
      if (found) return execute({...task, builtins: builtins instanceof ModuleValue ? builtins.environment : builtins}, site);
      return callTask(classes.builtin("function-builtins"), [state.frames.at(-1).callable], [], [], site, record("eval-builtins-default", task));
    }
    if (task.kind === "eval-builtins-default")
      return dictionaryTask(rawDictionary(task.globals), task.key, site, record("eval-builtins-stored", {...task, builtins: value}), 0, "set", value);
    return execute(task, site);
  };
  const start = (mode, args, keywords, keywordValues, site, after) => {
    if (args.length < 1 || args.length > 3) python("TypeError", mode + "() requires one to three positional arguments");
    const bound = new Map([['globals', args[1] ?? null], ['locals', args[2] ?? null], ['closure', null]]);
    for (let i = 0; i < keywords.length; i++) {
      const key = keywords[i];
      if (!['globals', 'locals', ...(mode === 'exec' ? ['closure'] : [])].includes(key) || key !== 'closure' && args.length > (key === 'globals' ? 1 : 2)) python("TypeError", mode + "() received an invalid or duplicate keyword argument");
      bound.set(key, keywordValues[i]);
    }
    let globals = bound.get('globals'), locals = bound.get('locals');
    const mapping = value => values.isDict(rawDictionary(value)) || values.comparisonSequence(value) !== null || values.isString(value) || values.isBinary(value) || values.isView(value) || values.isSequenceType(value, "range") || value instanceof FrameLocalsValue || value instanceof ClassNamespaceValue || classes.protocolObject(value) && classes.hasSlot(classes.checkingType(value), "__getitem__");
    if (locals !== null && !mapping(locals)) python("TypeError", "locals must be a mapping");
    if (globals !== null && !values.isDict(rawDictionary(globals))) python("TypeError", "globals must be a dict");
    const defaults = globals === null;
    globals ??= values.environmentDictionary(state.frames.at(-1).callable.globals); state.temporaries.push(globals);
    const task = {source: args[0], globals, locals, builtins: null, key: null, mode, closure: bound.get("closure"), after};
    if (locals === null && defaults) return callTask(classes.builtin('locals'), [], [], [], site, record('eval-locals', task));
    return namespace({...task, locals: locals ?? globals}, site);
  };
  return {start, resume};
}
