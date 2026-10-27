import {ARITHMETIC_SLOTS, ORDERING_SLOTS} from "./class-policy.mjs";
import {verifyFunctions} from "./function-bytecode.mjs";
import {GeneratorValue, Cell, Environment, CodePool, ModuleValue, FunctionValue, CallArguments, BuiltinValue, AppendValue, ValueMethod, ExceptionValue, EXCEPTIONS, matchesException, ClassValue, InstanceValue, BoundMethodValue, SuperValue, PropertyValue, MethodWrapperValue, ProtocolIteratorValue, NotImplementedValue} from "./function-objects.mjs";
import {ClassRuntime} from "./class-values.mjs";
import {ValueRuntime, valueLayout, IteratorValue} from "./values.mjs";
import {MemoryArena} from "./memory.mjs";
import {ExecutionError} from "./vm.mjs";
import {isModuleContext} from "./module-context.mjs";
import {RegistryError} from "./module-registry.mjs";
import {completion as continuation, completionRoots, unaryTask, itemTask, attributeTask, sliceTask, containsTask, compareTask, dictionaryTask, dictionaryBuildTask, arithmeticTask, consumeTask, controlRoots, retainTransfer} from "./operations.mjs";

import {Raised, operationRuntime} from "./operation-runtime.mjs";
class Unhandled { constructor(value) { this.value = value; } }
const builtinNames = new Set(["print", "str", "repr", "len", ...Object.keys(EXCEPTIONS)]);
const summary = (frame, cursor) => Object.freeze({function: frame.fn.name,
  location: cursor.block.source ? Object.freeze({filename: cursor.block.source.filename,
    span: cursor.block.source.spans[Math.max(0, cursor.pc - 1)]}) : null});

function activation(program, {maxSteps = 10_000, maxWork = 1_000_000, maxDepth = 48,
  shouldCancel = null, memoryLimits = {}, arena = null, retainResult = false, onOutput = () => {},
  moduleContext = null, module = null, inheritedException = null, entryCall = null} = {}) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1_000_000 ||
      !Number.isSafeInteger(maxWork) || maxWork < 1 || maxWork > 100_000_000 ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 256 ||
      (shouldCancel !== null && typeof shouldCancel !== "function") || typeof onOutput !== "function" ||
      (arena !== null && !(arena instanceof MemoryArena)) || typeof retainResult !== "boolean" ||
      (retainResult && arena === null) || !memoryLimits || typeof memoryLimits !== "object" || Array.isArray(memoryLimits) ||
      (arena !== null && Object.keys(memoryLimits).length)) throw new TypeError("Invalid function execution options.");
  const verified = verifyFunctions(program), memory = arena || new MemoryArena(memoryLimits);
  if ((moduleContext === null) !== (module === null) ||
      (moduleContext !== null && (!isModuleContext(moduleContext) || moduleContext.memory !== arena || !moduleContext.activeRun ||
        !(module instanceof ModuleValue) || moduleContext.module(module.name) !== module || moduleContext.registry.program(module.name) !== program)) ||
      (verified.code.version >= 4 && moduleContext === null) ||
      (inheritedException !== null && (!(inheritedException instanceof ExceptionValue) || moduleContext === null))) throw new TypeError("Version 4/5 requires a verified module execution context.");
  if (entryCall !== null && (moduleContext === null || !(entryCall.callable instanceof FunctionValue) ||
      entryCall.callable.pool.module !== module || !Array.isArray(entryCall.arguments) || entryCall.arguments.length > 128))
    throw new TypeError("Invalid module callback entry.");
  const state = {frames: [], outputLeases: [], builtins: new Map(), pool: null, globals: null,
    temporaries: [], steps: 0, work: 0, outputLength: 0, current: null, result: null, rootLeave: null, pendingImport: null,
    transitions: moduleContext?.transitions || Object.create(null)};
  const hard = (code, name, message) => {
    const error = new ExecutionError(code, name, message, state.current?.instruction ?? null, null);
    error.location = state.current?.location || null;
    throw error;
  };
  const charge = amount => {
    if (moduleContext) { moduleContext.charge(amount, hard); return; }
    if ((state.work += amount) > maxWork) hard("BUDGET", "ExecutionLimitError", "Value work budget exceeded.");
    if (shouldCancel?.()) hard("CANCELLED", "ExecutionCancelled", "Execution cancelled.");
  };

  const allocate = (Type, ...args) => {
    const value = new Type(...args), layout = valueLayout(value);
    return memory.allocate(layout.bytes, layout.children, () => value);
  };
  const mutate = (value, change) => {
    // Cells/environments are tiny; failed mutations restore their complete state.
    const undo = change(), layout = valueLayout(value);
    try { memory.resize(value, layout.bytes, layout.children); }
    catch (error) { undo(); throw error; }
  };
  const addTrace = (value, frame, prepend = true) => {
    if (value.traceback.length >= 256) hard("BUDGET", "ExecutionLimitError", "Traceback frame budget exceeded.");
    mutate(value, () => {
      if (prepend) value.traceback.unshift(frame); else value.traceback.push(frame);
      return () => { if (prepend) value.traceback.shift(); else value.traceback.pop(); };
    });
  };
  const exception = (name, message, args = []) => {
    const error = allocate(ExceptionValue, name, args, message);
    const active = state.frames.at(-1)?.activeException;
    mutate(error, () => {
      error.context = active && active !== error ? active : null;
      if (state.current) error.traceback.push(Object.freeze({function: state.current.function, location: state.current.location}));
      return () => { error.context = null; error.traceback = []; };
    });
    return error;
  };
  const python = (name, message) => { throw new Raised(exception(name, message)); };
  const values = new ValueRuntime({memory, charge, numeric: verified.code.version >= 4, fail: (name, message, code = "PYTHON") => {
    if (["PYTHON", "ZERO_DIVISION"].includes(code)) python(name, message);
    hard(code, name, message);
  }});
  const nativeBuiltin = name => {
    const make = () => name === "object" ? classes.root() : allocate(BuiltinValue, name);
    if (moduleContext) return moduleContext.builtin(name, make);
    if (!state.builtins.has(name)) state.builtins.set(name, make());
    return state.builtins.get(name);
  };
  const classes = new ClassRuntime({memory, charge, values, fail: values.fail, builtin: nativeBuiltin});
  const objectType = () => moduleContext.builtin("object", () => classes.root());
  const setCell = (cell, value, bound = true) => mutate(cell, () => {
    const before = [cell.value, cell.bound]; cell.value = value; cell.bound = bound;
    return () => { [cell.value, cell.bound] = before; };
  });
  const addCell = (environment, name, cell) => mutate(environment, () => {
    environment.cells.set(name, cell); return () => environment.cells.delete(name);
  });
  const block = (frame, id) => frame.tasks.push({type: "block", block: frame.fn.blocks[id], pc: 0, stack: []});
  const load = (frame, key) => {
    const global = frame.fn.globals?.includes(key), local = global ? null : frame.locals.get(key), classBody = frame.fn.kind === "class";
    const cell = global ? frame.callable.globals.cells.get(key) : local?.bound ? local : classBody && local ? frame.callable.globals.cells.get(key) :
      local || frame.closure.get(key) || frame.callable.globals.cells.get(key);
    if (cell?.bound) return cell.value;
    if (local && !classBody && frame.callable.index !== 0) python("UnboundLocalError", "cannot access local variable '" + key + "' where it is not associated with a value");
    if (!global && frame.closure.has(key) && !(classBody && local)) python("NameError", "cannot access free variable '" + key + "' where it is not associated with a value in enclosing scope");
    if (frame.callable.pool.code.version === 5 && key === "object") return objectType();
    if (frame.callable.pool.code.version === 5 && key === "NotImplemented") return moduleContext.builtin(key, () => allocate(NotImplementedValue));
    if (builtinNames.has(key) || (moduleContext && ["isinstance", "bool", "iter", "next"].includes(key)) ||
        (frame.callable.pool.code.version >= 4 && ["memoryview", "bytes", "bytearray", "set", "frozenset", "all", "any", "list", "tuple", "range", "int", "float", "complex", "abs", "divmod", "pow", "round", "bin", "oct", "hex", "chr", "ord"].includes(key)) ||
        (frame.callable.pool.code.version === 5 && ["id", "globals", "locals", "vars", "dir", "dict", "super", "getattr", "setattr", "delattr", "hasattr", "type", "issubclass", "property", "staticmethod", "classmethod", "callable", "slice", "hash"].includes(key))) {
      if (moduleContext) return moduleContext.builtin(key, () => allocate(BuiltinValue, key));
      if (!state.builtins.has(key)) state.builtins.set(key, allocate(BuiltinValue, key));
      return state.builtins.get(key);
    }
    python("NameError", "name '" + key + "' is not defined");
  };
  const targetCell = (frame, key, create = false) => {
    if (frame.fn.nonlocals?.includes(key)) return frame.closure.get(key);
    if (!frame.fn.globals?.includes(key)) return frame.locals.get(key);
    const environment = frame.callable.globals;
    let cell = environment.cells.get(key);
    if (!cell && create) { cell = allocate(Cell); state.temporaries.push(cell); addCell(environment, key, cell); }
    return cell;
  };
  const store = (frame, key, value, bound = true) => {
    setCell(targetCell(frame, key, bound), value, bound);
    if (frame.namespaceOrder && frame.locals.has(key)) { if (bound) frame.namespaceOrder.add(key); else frame.namespaceOrder.delete(key); }
  };
  const bind = (callable, positional, keywordNames, keywordValues) => {
    const fn = callable.pool.code.functions[callable.index], constants = callable.pool.code.constants;
    const p = fn.params, ordered = [...p.posonly, ...p.positional], bindings = new Map();
    const label = fn.qualname + "()";
    positional.slice(0, ordered.length).forEach((value, index) => bindings.set(ordered[index], value));
    const positionalOnly = p.kwarg ? [] : keywordNames.filter(key => p.posonly.includes(key));
    const extraKeywords = [];
    keywordNames.forEach((key, index) => {
      if (positionalOnly.length) python("TypeError", label + " got some positional-only arguments passed as keyword arguments: '" + positionalOnly.join(", ") + "'");
      if (!p.positional.includes(key) && !p.kwonly.includes(key)) {
        if (p.kwarg) { extraKeywords.push([key, keywordValues[index]]); return; }
        python("TypeError", label + " got an unexpected keyword argument '" + key + "'");
      }
      if (bindings.has(key)) python("TypeError", label + " got multiple values for argument '" + key + "'");
      bindings.set(key, keywordValues[index]);
    });
    if (positional.length > ordered.length && !p.vararg) {
      const range = p.defaults.length ? "from " + (ordered.length - p.defaults.length) + " to " + ordered.length : String(ordered.length);
      const kw = keywordNames.filter(key => p.kwonly.includes(key)).length;
      python("TypeError", label + " takes " + range + " positional argument" + (ordered.length === 1 && !p.defaults.length ? "" : "s") +
        " but " + positional.length + (kw ? " positional argument" + (positional.length === 1 ? "" : "s") + " (and " + kw + " keyword-only argument" + (kw === 1 ? "" : "s") + ")" : "") +
        (positional.length === 1 && !kw ? " was" : " were") + " given");
    }
    const missing = (keys, kind) => {
      if (!keys.length) return;
      const quoted = keys.map(key => "'" + key + "'");
      const list = quoted.length === 1 ? quoted[0] : quoted.length === 2 ? quoted.join(" and ") : quoted.slice(0, -1).join(", ") + ", and " + quoted.at(-1);
      python("TypeError", label + " missing " + keys.length + " required " + kind + " argument" + (keys.length === 1 ? "" : "s") + ": " + list);
    };
    for (let i = 0; i < ordered.length; i++) {
      const key = ordered[i], defaultIndex = i - ordered.length + p.defaults.length;
      if (!bindings.has(key) && defaultIndex >= 0) bindings.set(key, callable.defaults ? callable.defaults[defaultIndex] : constants[p.defaults[defaultIndex]]);
    }
    missing(ordered.filter(key => !bindings.has(key)), "positional");
    for (const key of p.kwonly) {
      if (!bindings.has(key) && Object.hasOwn(p.kwdefaults, key)) bindings.set(key, callable.defaults ? callable.defaults[p.defaults.length + Object.keys(p.kwdefaults).indexOf(key)] : constants[p.kwdefaults[key]]);
    }
    missing(p.kwonly.filter(key => !bindings.has(key)), "keyword-only");
    if (p.vararg) {
      const packed = values.tuple(positional.slice(ordered.length)); state.temporaries.push(packed); bindings.set(p.vararg, packed);
    }
    if (p.kwarg) {
      const packed = values.dict([]); state.temporaries.push(packed); bindings.set(p.kwarg, packed);
      for (const [key, value] of extraKeywords) {
        const name = values.string(Array.from(key, char => char.codePointAt(0))); state.temporaries.push(name);
        values.set(packed, name, value);
      }
    }
    return bindings;
  };
  const enter = (callable, bindings, callsite = null, completion = null) => {
    if (state.frames.length >= Math.min(maxDepth, memory.limits.maxFrames - 1) || memory.stats().frames >= memory.limits.maxFrames) python("RecursionError", "maximum recursion depth exceeded");
    const fn = callable.pool.code.functions[callable.index];
    const frame = {fn, callable, closure: callable.closure, locals: callable.index === 0 ? callable.globals.cells : new Map(),
      tasks: [], activeException: state.frames.at(-1)?.activeException || inheritedException, callsite,
      completion, namespaceOrder: fn.kind === "class" ? new Set() : null, returnInstruction: state.current?.instruction ?? null};
    frame.leave = memory.enter(() => [callable, ...frame.locals.values(), ...(frame.activeException ? [frame.activeException] : []),
      ...frame.tasks.flatMap(controlRoots), ...(frame.generator ? [frame.generator] : []), ...completionRoots(frame.completion, true)], {charge, fail: hard});
    state.frames.push(frame);
    for (const key of fn.locals) {
      let cell = frame.locals.get(key);
      if (!cell) {
        cell = allocate(Cell);
        if (callable.index === 0) addCell(callable.globals, key, cell); else frame.locals.set(key, cell);
      }
      if (bindings.has(key)) setCell(cell, bindings.get(key));
    }
    block(frame, fn.body);
  };
  const {dispatch, call, deliver, notifyNext, recover, argumentOwner, appendArgument, appendKeyword, expandArguments, keywordArgument, expandMapping, finishArguments, expandDisplay, expandUnpack} = operationRuntime({state, memory, values, classes,
    moduleContext, maxDepth, allocate, mutate, python, hard, charge, enter, bind, block, store, onOutput,
    setCell, resumeGenerator: (...args) => resumeGenerator(...args), yieldGenerator: value => yieldGenerator(value),
    delegateResult: (...args) => delegateResult(...args), injectGenerator: value => injectGenerator(value)});
  const leaveGenerator = (frame, status) => {
    const generator = frame.generator, completion = frame.completion;
    state.temporaries.push(generator, ...completionRoots(completion));
    frame.completion = null; frame.callsite = null;
    if (!frame.ownsException) frame.activeException = null;
    for (const task of frame.tasks) if (task.type === "try" && !task.previousOwned) task.previous = null;
    generator.status = status; generator.frame = frame;
    frame.leave(); frame.leave = null; state.frames.pop();
    return completion;
  };
  const yieldGenerator = value => {
    const frame = state.frames.at(-1);
    if (!frame.generator) hard("BYTECODE", "BytecodeError", "Yield requires a generator frame.");
    state.temporaries.push(value);
    const task = frame.tasks.at(-1);
    frame.suspensionSite = task.type === "delegate" ? task.site : {function: frame.fn.name, location: state.current.location};
    const mode = frame.generatorMode, site = frame.callsite;
    const completion = leaveGenerator(frame, "suspended");
    if (mode === "close") python("RuntimeError", "generator ignored GeneratorExit");
    dispatch(deliver(value, completion, site));
  };
  const delegateMethod = (iterator, name) => {
    if (iterator instanceof GeneratorValue) return {kind: "value", value: allocate(ValueMethod, iterator, name)};
    if (iterator instanceof InstanceValue) return classes.read(iterator, name);
    python("AttributeError", "Delegate has no attribute '" + name + "'");
  };
  const injectGenerator = value => {
    const frame = state.frames.at(-1);
    addTrace(value, frame.suspensionSite);
    if (frame.ownsException && frame.activeException && frame.activeException !== value) mutate(value, () => {
      const before = value.context; value.context = frame.activeException;
      return () => { value.context = before; };
    });
    handle(new Raised(value));
  };
  const definitionSite = callable => {
    for (const fn of callable.pool.code.functions) for (const block of fn.blocks) {
      for (let index = 0; index < block.instructions.length; index++) {
        charge(1);
        const [op, target] = block.instructions[index];
        if (["function", "function-defaults"].includes(op) && target === callable.index)
          return {function: callable.pool.code.functions[callable.index].name,
            location: block.source ? {filename: block.source.filename, span: block.source.spans[index]} : null};
      }
    }
    return {function: callable.pool.code.functions[callable.index].name, location: null};
  };
  const delegateAdvance = (mode, value) => {
    const frame = state.frames.at(-1), task = frame.tasks.at(-1), site = task.site;
    if (mode === "throw" && value.name === "GeneratorExit") mode = "close";
    if (mode === "close") task.closing = value instanceof ExceptionValue ? value : allocate(ExceptionValue, "GeneratorExit", [], "");
    const finish = continuation(mode === "close" ? "delegate-close" : "delegate-next", {receiver: frame.generator});
    if (mode === "send" && value === null) { dispatch(unaryTask("next", task.iterator, site, finish)); return; }
    let plan;
    try { plan = delegateMethod(task.iterator, mode); }
    catch (error) {
      if (!(error instanceof Raised) || error.value.name !== "AttributeError" || mode === "send") throw error;
      if (mode === "close") { injectGenerator(task.closing); return; }
      injectGenerator(value); return;
    }
    const args = mode === "close" ? [] : [value];
    if (plan.kind === "value") call(plan.value, args, [], [], site, finish);
    else call(plan.callable, plan.args, [], [], site, mode === "send" ?
      continuation("invoke", {args, keywords: [], keywordValues: [], after: finish, depth: 0}) :
      continuation("delegate-bind", {receiver: mode === "close" ? task.closing : value, args, after: finish}));
  };
  const delegateResult = (kind, value, site) => {
    const frame = state.frames.at(-1), task = frame.tasks.at(-1);
    if (kind === "delegate-iter") { task.iterator = value; delegateAdvance("send", null); }
    else if (kind === "delegate-next") yieldGenerator(value);
    else if (kind === "delegate-close") injectGenerator(task.closing);
    else { frame.tasks.pop(); frame.tasks.at(-1).stack.push(value); }
    return null;
  };
  const resumeGenerator = (generator, mode, value, site, completion) => {
    if (generator.status === "running") python("ValueError", "generator already executing");
    if (mode === "throw") {
      if (value instanceof BuiltinValue && Object.hasOwn(EXCEPTIONS, value.name)) value = allocate(ExceptionValue, value.name, [], "");
      if (!(value instanceof ExceptionValue)) python("TypeError", "exceptions must derive from BaseException");
    }
    const fresh = generator.status === "created";
    if (fresh && mode === "send" && value !== null) python("TypeError", "can't send non-None value to a just-started generator");
    if (generator.status === "closed" || fresh && mode !== "send") {
      if (fresh && mode === "throw") addTrace(value, definitionSite(generator.callable));
      generator.status = "closed"; generator.callable = null; generator.bindings.clear();
      if (mode === "close") { dispatch(deliver(null, completion, site)); return; }
      if (mode === "throw") { addTrace(value, site); throw new Raised(value); }
      python("StopIteration", "");
    }
    state.temporaries.push(generator, value, ...completionRoots(completion));
    if (fresh) {
      enter(generator.callable, generator.bindings, site, completion);
      generator.frame = state.frames.at(-1); generator.frame.generator = generator;
      generator.bindings.clear();
    } else {
      if (state.frames.length >= Math.min(maxDepth, memory.limits.maxFrames - 1)) python("RecursionError", "maximum recursion depth exceeded");
      const frame = generator.frame;
      const inherited = state.frames.at(-1)?.activeException || inheritedException;
      if (!frame.ownsException) frame.activeException = inherited;
      for (const task of frame.tasks) if (task.type === "try" && !task.previousOwned) task.previous = inherited;
      frame.completion = completion; frame.callsite = site; frame.returnInstruction = state.current?.instruction ?? null;
      frame.leave = memory.enter(() => [generator, frame.callable, ...frame.locals.values(), frame.activeException,
        ...frame.tasks.flatMap(controlRoots), ...completionRoots(frame.completion, true)], {charge, fail: hard});
      state.frames.push(frame);
    }
    generator.status = "running";
    const frame = generator.frame; frame.generatorMode = mode;
    if (frame.tasks.at(-1).type === "delegate") delegateAdvance(mode, value);
    else if (mode === "close") injectGenerator(allocate(ExceptionValue, "GeneratorExit", [], ""));
    else if (mode === "throw") injectGenerator(value);
    else if (!fresh) frame.tasks.at(-1).stack.push(value);
  };
  const diagnostic = value => {
    const error = new ExecutionError("PYTHON", value.name, value.message, state.current?.instruction ?? null, null);
    // Copy diagnostics without exporting unleased VM objects or frame locals.
    error.traceback = value.traceback.map(frame => ({function: frame.function, location: frame.location}));
    error.location = error.traceback.at(-1)?.location || null;
    error.context = value.context ? {type: value.context.name, message: value.context.message} : null;
    return error;
  };
  const settle = signal => {
    while (state.frames.length) {
      const frame = state.frames.at(-1);
      if (frame.tasks.at(-1)?.type === "block") frame.tasks.pop();
      while (frame.tasks.length) {
        const task = frame.tasks.at(-1);
        if (task.type === "block") {
          if (signal.kind === "normal") return;
          frame.tasks.pop(); continue;
        }
        if (task.type === "delegate") { frame.tasks.pop(); continue; }
        if (task.type === "while" || task.type === "for") {
          if (signal.kind === "break") { frame.tasks.pop(); signal = {kind: "normal"}; continue; }
          if (!["normal", "continue"].includes(signal.kind)) { frame.tasks.pop(); continue; }
          if (task.type === "while") {
            if (task.phase === "test" && signal.kind === "normal") {
              task.phase = "truth";
              dispatch(unaryTask("truth", signal.value, task.site, continuation("condition", {control: "while"}))); return;
            }
            task.phase = "test"; block(frame, task.test); return;
          }
          if (task.phase === "iterable" && task.acquired) {
            task.owned = true; task.phase = "body"; task.iterator = signal.value;
            dispatch(unaryTask("next", task.iterator, task.site, continuation("for-next"))); return;
          }
          if (task.phase === "iterable" && (signal.value instanceof GeneratorValue || signal.value instanceof InstanceValue || signal.value instanceof ProtocolIteratorValue)) {
            task.owned = true; task.phase = "acquire";
            dispatch(unaryTask("iter", signal.value, task.site, continuation("for-iter"))); return;
          }
          if (task.owned) { dispatch(unaryTask("next", task.iterator, task.site, continuation("for-next"))); return; }
          if (task.phase === "iterable") { task.iterator = values.iterator(signal.value); task.phase = "body"; }
          let item;
          try { item = values.next(task.iterator); }
          catch (error) {
            if (!(error instanceof Raised) || error.value.name !== "StopIteration") throw error;
            frame.tasks.pop(); block(frame, task.otherwise); return;
          }
          store(frame, task.target, item); block(frame, task.body); return;
        }
        if (task.type === "try") {
          const [, body, handlers, otherwise, final] = task.instruction;
          void body;
          if (task.phase === "body" && signal.kind === "raise") {
            task.phase = "matching"; task.caught = signal.value; frame.activeException = signal.value; frame.ownsException = true;
            const clause = handlers.find(([types, , , span]) => {
              state.current = {...state.current, location: task.site ? {filename: task.site.filename, span} : null};
              const resolved = types.map(type => {
                const expected = load(frame, type);
                if (!(expected instanceof BuiltinValue) || !Object.hasOwn(EXCEPTIONS, expected.name)) {
                  python("TypeError", "catching classes that do not inherit from BaseException is not allowed");
                }
                return expected.name;
              });
              return !resolved.length || resolved.some(type => matchesException(signal.value.name, type));
            });
            if (clause) {
              task.phase = "handler"; task.caught = signal.value; task.alias = clause[1];
              frame.activeException = signal.value;
              if (task.alias) store(frame, task.alias, signal.value);
              block(frame, clause[2]); return;
            }
          } else if (task.phase === "body" && signal.kind === "normal" && otherwise !== null) {
            task.phase = "else"; block(frame, otherwise); return;
          }
          if (task.phase === "handler") {
            if (task.alias) store(frame, task.alias, null, false);
            frame.activeException = task.previous; frame.ownsException = task.previousOwned;
          }
          if (task.phase === "finally") {
            if (signal.kind === "normal") signal = task.pending;
            frame.activeException = task.previous; frame.ownsException = task.previousOwned; frame.tasks.pop(); continue;
          }
          if (final !== null) {
            task.pending = signal; task.phase = "finally";
            frame.activeException = signal.kind === "raise" ? signal.value : task.previous;
            frame.ownsException = signal.kind === "raise" || task.previousOwned;
            block(frame, final); return;
          }
          frame.activeException = task.previous; frame.ownsException = task.previousOwned; frame.tasks.pop(); continue;
        }
        hard("BYTECODE", "BytecodeError", "Unknown control record.");
      }
      if (["break", "continue"].includes(signal.kind)) hard("BYTECODE", "BytecodeError", "Loop control outside a loop.");
      let returned = signal.kind === "normal" ? null : signal.value;
      if (frame.generator) {
        const generator = frame.generator, mode = frame.generatorMode;
        generator.status = "closed"; generator.frame = null; generator.callable = null; generator.bindings.clear();
        if (signal.kind === "raise" && returned.name === "StopIteration") {
          const original = returned;
          returned = exception("RuntimeError", "generator raised StopIteration");
          returned.context = original;
          signal = {kind: "raise", value: returned};
        }
        if (signal.kind !== "raise" && mode !== "close") {
          returned = exception("StopIteration", "", returned === null ? [] : [returned]);
          signal = {kind: "raise", value: returned};
        } else if (signal.kind === "raise" && mode === "close" && ["GeneratorExit", "StopIteration"].includes(returned.name)) {
          returned = null; signal = {kind: "return", value: null};
        }
      }
      state.temporaries = [returned, frame.callable];
      const parent = state.frames.at(-2);
      if (!parent) {
        if (signal.kind === "raise") throw new Unhandled(returned);
        state.result = retainResult ? memory.pin([returned]) : returned;
        frame.leave(); state.frames.pop(); return;
      }
      if (signal.kind === "raise") {
        const recovery = recover(returned, frame.completion, frame.callsite);
        if (recovery) {
          retainTransfer(state.temporaries, [], frame.completion);
          state.current = {...frame.callsite, instruction: frame.returnInstruction};
          frame.leave(); state.frames.pop(); dispatch(recovery); return;
        }
        addTrace(returned, frame.callsite);
        frame.leave(); state.frames.pop();
        continue;
      }
      if (frame.completion?.kind === "class") {
        const namespace = new Map([...frame.namespaceOrder].filter(key => frame.locals.get(key).bound && !key.startsWith("@source:"))
          .map(key => [key, frame.locals.get(key).value]));
        const completion = frame.completion;
        state.temporaries.push(...namespace.values(), ...completion.bases);
        if (completion.metaclass) state.temporaries.push(completion.metaclass);
        const classCell = frame.locals.get("@source:class");
        if (classCell) state.temporaries.push(classCell);
        state.current = {...frame.callsite, instruction: frame.returnInstruction};
        frame.leave(); state.frames.pop();
        if (completion.invalidMetaclass) python("TypeError", "Metaclass is not callable");
        if (completion.metaclass instanceof ClassValue) {
          const dictionary = values.dict([]); state.temporaries.push(dictionary);
          for (const [key, value] of [...namespace, ...(classCell ? [["__classcell__", classCell]] : [])]) {
            const name = values.string(Array.from(key, char => char.codePointAt(0))); state.temporaries.push(name);
            values.set(dictionary, name, value);
          }
          const name = values.string(Array.from(frame.fn.name, char => char.codePointAt(0))); state.temporaries.push(name);
          const bases = values.tuple(completion.bases); state.temporaries.push(bases);
          call(completion.metaclass, [name, bases, dictionary], [], [], frame.callsite,
            classCell ? continuation("class-created", {cell: classCell}) : null); return;
        }
        const type = classes.create(frame.fn.name, frame.fn.qualname, completion.module, completion.bases, namespace, objectType());
        if (classCell) { state.temporaries.push(type, classCell); setCell(classCell, type); }
        dispatch(notifyNext(type, [...namespace], 0, frame.callsite)); return;
      }
      const completion = frame.completion;
      retainTransfer(state.temporaries, [], completion);
      state.current = {...frame.callsite, instruction: frame.returnInstruction};
      frame.leave(); state.frames.pop(); dispatch(deliver(returned, completion, frame.callsite)); return;
    }
  };
  const start = () => {
    if (entryCall) state.temporaries.push(entryCall.callable);
    state.rootLeave = memory.enter(() => [state.pool, state.globals, inheritedException, ...state.builtins.values(), ...state.temporaries], {charge, fail: hard});
    if (entryCall) {
      state.pool = entryCall.callable.pool; state.globals = module.environment;
      const args = entryCall.arguments.map(record => values.decode(record, {retain: value => state.temporaries.push(value)}));
      enter(entryCall.callable, bind(entryCall.callable, args, [], []));
      return;
    }
    state.pool = allocate(CodePool, verified.code, verified.bytes, module);
    state.globals = module ? module.environment : allocate(Environment);
    if (module) mutate(module, () => { const before = module.pool; module.pool = state.pool; return () => { module.pool = before; }; });
    const entry = allocate(FunctionValue, state.pool, 0, state.globals, new Map());
    state.temporaries = [entry]; enter(entry, new Map());
  };
  const step = () => {
    if (moduleContext) moduleContext.tick(hard);
    else if (++state.steps > maxSteps) hard("BUDGET", "ExecutionLimitError", "Instruction budget exceeded.");
    charge(1); state.temporaries = []; memory.collect();
    const frame = state.frames.at(-1), cursor = frame.tasks.at(-1), stack = cursor.stack;
    state.current = {...summary(frame, cursor), instruction: cursor.pc};
    const [op, arg, extra, fourth, fifth] = cursor.block.instructions[cursor.pc++];
    state.current = {...summary(frame, cursor), instruction: cursor.pc - 1};
    state.temporaries = stack.slice();
    try {
      if (op === "const") stack.push(frame.callable.pool.code.constants[arg]);
      else if (op === "load") stack.push(load(frame, arg));
      else if (op === "store") store(frame, arg, stack.pop());
      else if (op === "delete") {
        if (!targetCell(frame, arg)?.bound) {
          if (frame.fn.nonlocals?.includes(arg)) python("NameError", "cannot access free variable '" + arg + "' where it is not associated with a value in enclosing scope");
          if (frame.callable.index === 0 || frame.fn.globals?.includes(arg)) python("NameError", "name '" + arg + "' is not defined");
          python("UnboundLocalError", "cannot access local variable '" + arg + "' where it is not associated with a value");
        }
        store(frame, arg, null, false);
      }
      else if (op === "function" || op === "function-defaults" || op === "class" || op === "class-meta") {
        const owner = frame.callable.pool;
        const closure = new Map(owner.code.functions[arg].free.map(key => [key,
          frame.fn.kind === "class" ? key === "__class__" && frame.locals.has("@source:class") ? frame.locals.get("@source:class") : frame.closure.get(key) : frame.locals.get(key) || frame.closure.get(key)]));
        const defaults = op === "function-defaults" ? stack.splice(stack.length - extra - fourth.length) : null;
        const callable = allocate(FunctionValue, owner, arg, frame.callable.globals, closure, defaults);
        if (op !== "class" && op !== "class-meta") stack.push(callable);
        else {
          const explicit = op === "class-meta" ? stack.pop() : undefined;
          const bases = stack.splice(stack.length - extra), name = values.text(frame.callable.globals.cells.get("__name__")?.value);
          state.temporaries.push(callable);
          if (name === null) hard("UNSUPPORTED", "UnsupportedOperationError", "Class module metadata requires text in C1.");
          classes.validateNamespace(bases, owner.code.functions[arg].locals);
          const invalidMetaclass = op === "class-meta" && !classes.isType(explicit) && !classes.callable(explicit);
          const metaclass = !invalidMetaclass && (op === "class-meta" || bases.some(base => base instanceof ClassValue && base.metaclass !== null)) ? classes.selectMetaclass(bases, explicit) : null;
          enter(callable, new Map(), summary(frame, cursor), continuation("class", {bases, module: name, metaclass, invalidMetaclass}));
          store(state.frames.at(-1), "__module__", values.string(Array.from(name, char => char.codePointAt(0))));
          store(state.frames.at(-1), "__qualname__", values.string(Array.from(owner.code.functions[arg].qualname, char => char.codePointAt(0))));
        }
      } else if (op === "yield") yieldGenerator(stack.pop());
      else if (op === "yield-from") {
        const iterable = stack.pop();
        frame.tasks.push({type: "delegate", iterator: null, site: summary(frame, cursor)});
        dispatch(unaryTask("iter", iterable, summary(frame, cursor), continuation("delegate-iter", {receiver: frame.generator})));
      } else if (op === "assertion-error") {
        const args = arg ? [stack.pop()] : [];
        const callable = moduleContext.builtin("AssertionError", () => allocate(BuiltinValue, "AssertionError"));
        state.temporaries.push(callable); call(callable, args, [], [], summary(frame, cursor));
      } else if (op === "call-start") stack.push(allocate(CallArguments, stack.pop()));
      else if (["call-argument", "call-keyword", "call-star", "call-mapping"].includes(op)) {
        const value = stack.pop(), receiver = stack.pop();
        if (op === "call-star") dispatch(expandArguments(receiver, value, summary(frame, cursor)));
        else if (op === "call-mapping") dispatch(expandMapping(receiver, value, summary(frame, cursor)));
        else if (op === "call-keyword") dispatch(keywordArgument(receiver, arg, value, summary(frame, cursor)));
        else { appendArgument(receiver, value); stack.push(receiver); }
      } else if (op === "call-expanded") {
        const receiver = stack.pop(), [keywords, keywordValues] = finishArguments(receiver);
        call(receiver.callable, receiver.args, keywords, keywordValues, summary(frame, cursor));
      } else if (op === "call") {
        const kwargs = stack.splice(stack.length - extra.length), args = stack.splice(stack.length - arg), callable = stack.pop();
        call(callable, args, extra, kwargs, summary(frame, cursor));
      } else if (["attribute-set", "attribute-delete"].includes(op)) {
        const value = op === "attribute-set" ? stack.pop() : null;
        const receiver = stack.pop();
        if (values.isView(receiver) || values.isBinary(receiver) || values.isSet(receiver) || values.isSlice(receiver) || values.isComplex(receiver) || values.isRange(receiver)) python("AttributeError", "Value attributes are read-only");
        if (receiver instanceof InstanceValue && classes.hasSlot(receiver.type, op === "attribute-set" ? "__setattr__" : "__delattr__")) {
          dispatch(attributeTask(receiver, arg, summary(frame, cursor), null, 0, op === "attribute-set" ? "set" : "delete", null, null, value)); return;
        }
        const plan = classes.write(receiver, arg, value, op === "attribute-delete");
        if (plan.kind === "value") stack.push(plan.value);
        else { state.temporaries.push(plan.callable, ...plan.args); call(plan.callable, plan.args, [], [], summary(frame, cursor), continuation("discard")); }
      } else if (["import", "module-get", "import-from", "attribute-get"].includes(op)) {
        const owner = frame.callable.pool.module;
        if (!owner || !moduleContext) hard("BYTECODE", "BytecodeError", "Module opcode has no verified registry owner.");
        if (op === "import") state.pendingImport = {plan: moduleContext.planLoad(owner.name, arg, extra, fourth),
          inheritedException: frame.activeException};
        else {
          const receiver = stack.pop();
          if (op === "attribute-get" && receiver instanceof InstanceValue &&
              (classes.hasSlot(receiver.type, "__getattribute__") || classes.hasSlot(receiver.type, "__getattr__") || arg === "__class__" && classes.hasSlot(receiver.type, "__class__")))
            dispatch(attributeTask(receiver, arg, summary(frame, cursor)));
          else if (op === "attribute-get" && arg === "__class__") stack.push(classes.classAttribute(receiver));
          else if (receiver instanceof GeneratorValue) {
            if (!["send", "throw", "close", "__iter__", "__next__"].includes(arg)) hard("UNSUPPORTED", "UnsupportedOperationError", "Generator reflection requires a separate stage.");
            stack.push(allocate(ValueMethod, receiver, arg));
          } else if (receiver instanceof ExceptionValue && arg === "value" && receiver.name === "StopIteration") stack.push(receiver.args[0] ?? null);
          else if (values.isComplex(receiver)) stack.push(values.complexAttribute(receiver, arg));
          else if (values.isRange(receiver)) stack.push(values.rangeAttribute(receiver, arg));
          else if (values.isSet(receiver)) { values.setMethod(receiver, arg); stack.push(allocate(ValueMethod, receiver, arg)); }
          else if (values.isView(receiver)) stack.push(values.viewMethod(arg) ? allocate(ValueMethod, receiver, arg) : values.viewAttribute(receiver, arg));
          else if (values.isBinary(receiver)) { values.binaryMethod(receiver, arg); stack.push(allocate(ValueMethod, receiver, arg)); }
          else if (arg === "encode" && values.isString(receiver)) stack.push(allocate(ValueMethod, receiver, arg));
          else if (op === "attribute-get" && values.isSlice(receiver)) stack.push(values.sliceAttribute(receiver, arg));
          else if (op === "attribute-get" && (receiver instanceof BuiltinValue || receiver instanceof SuperValue || receiver instanceof ClassValue || receiver instanceof InstanceValue || receiver instanceof BoundMethodValue || receiver instanceof FunctionValue || receiver instanceof PropertyValue || receiver instanceof MethodWrapperValue)) {
            const plan = classes.read(receiver, arg);
            if (plan.kind === "value") stack.push(plan.value);
            else { state.temporaries.push(plan.callable, ...plan.args); call(plan.callable, plan.args, [], [], summary(frame, cursor)); }
          } else if (["module-get", "attribute-get"].includes(op) && arg === "append" && values.isList(receiver)) stack.push(allocate(AppendValue, receiver));
          else {
            const result = moduleContext.planAttribute(receiver, arg, op === "import-from", owner.name);
            if (result.kind === "value") stack.push(result.value);
            else state.pendingImport = {plan: result.plan, inheritedException: frame.activeException};
          }
        }
      } else if (op === "if") dispatch(unaryTask("truth", stack.pop(), summary(frame, cursor),
        continuation("condition", {control: "if", body: arg, otherwise: extra})));
      else if (op === "while") { frame.tasks.push({type: "while", phase: "test", test: arg, body: extra, otherwise: fourth, site: summary(frame, cursor)}); block(frame, arg); }
      else if (["for", "for-iterator"].includes(op)) { frame.tasks.push({type: "for", acquired: op === "for-iterator", phase: "iterable", target: arg, body: fourth, otherwise: fifth, iterator: null, site: summary(frame, cursor)}); block(frame, extra); }
      else if (op === "try") {
        frame.tasks.push({type: "try", phase: "body", instruction: cursor.block.instructions[cursor.pc - 1], previous: frame.activeException, previousOwned: frame.ownsException === true,
          caught: null, pending: null, alias: null, site: state.current.location}); block(frame, arg);
      } else if (["end", "return", "break", "continue"].includes(op)) {
        settle({kind: op === "end" ? "normal" : op, value: op === "return" || cursor.block.kind === "expression" ? stack.pop() : null});
      } else if (op === "raise" || op === "reraise") {
        let value = op === "raise" ? stack.pop() : frame.activeException;
        if (!value) python("RuntimeError", "No active exception to reraise");
        if (value instanceof BuiltinValue && Object.hasOwn(EXCEPTIONS, value.name)) value = allocate(ExceptionValue, value.name, [], "");
        if (!(value instanceof ExceptionValue)) python("TypeError", "exceptions must derive from BaseException");
        if (op === "raise") {
          addTrace(value, {function: state.current.function, location: state.current.location});
          if (frame.activeException && frame.activeException !== value) mutate(value, () => {
            const previous = value.context; value.context = frame.activeException;
            return () => { value.context = previous; };
          });
        }
        throw new Raised(value);
      } else if (op === "pop") stack.pop();
      else if (op === "dup") stack.push(stack.at(-1));
      else if (op === "swap") { const right = stack.pop(), left = stack.pop(); stack.push(right, left); }
      else if (op === "jump") cursor.pc = arg;
      else if (op === "jump-if-false") dispatch(unaryTask("truth", stack.pop(), summary(frame, cursor),
        continuation("condition", {control: "jump", target: arg})));
      else if (op === "build-set") {
        const items = stack.splice(stack.length - arg);
        dispatch(consumeTask("set", values.tuple(items), summary(frame, cursor)));
      } else if (["set-insert", "set-extend"].includes(op)) {
        const value = stack.pop(), receiver = stack.pop();
        if (!values.isSet(receiver) || receiver.frozen) hard("BYTECODE", "BytecodeError", "Set display requires a mutable set result.");
        dispatch(op === "set-extend" ? consumeTask("set-update", value, summary(frame, cursor), null, 0, receiver) :
          dictionaryTask(receiver.storage, value, summary(frame, cursor), continuation("display-insert", {receiver}), 0, "set", null));
      } else if (["build-list", "build-tuple", "build-dict"].includes(op)) {
        const items = stack.splice(stack.length - arg * (op === "build-dict" ? 2 : 1));
        if (op === "build-dict" && frame.callable.pool.code.version === 5 && items.some((item, index) => index % 2 === 0 && values.needsOwnedHash(item)))
          dispatch(dictionaryBuildTask(values.dict([]), items, summary(frame, cursor)));
        else stack.push(op === "build-dict" ? values.dict(Array.from({length: arg}, (_, index) => items.slice(index * 2, index * 2 + 2))) :
          op === "build-list" ? values.list(items) : values.tuple(items));
      } else if (op === "build-slice") {
        const step = stack.pop(), stop = stack.pop(), start = stack.pop(); stack.push(values.sliceKey(start, stop, step));
      } else if (op === "unpack") dispatch(expandUnpack(stack.pop(), arg, extra, summary(frame, cursor)));
      else if (op === "list-to-tuple") {
        const receiver = stack.pop();
        if (!values.isList(receiver)) hard("BYTECODE", "BytecodeError", "Tuple display requires a list result.");
        stack.push(values.tuple(receiver.items));
      } else if (["list-push", "list-extend", "dict-merge"].includes(op)) {
        const value = stack.pop(), receiver = stack.pop();
        if (op === "list-extend") dispatch(expandDisplay(receiver, value, summary(frame, cursor)));
        else if (op === "dict-merge") dispatch(expandMapping(receiver, value, summary(frame, cursor), "display"));
        else { values.append(receiver, value); stack.push(receiver); }
      } else if (op === "dict-insert") {
        const item = stack.pop(), key = stack.pop(), receiver = stack.pop();
        if (!values.isDict(receiver)) hard("BYTECODE", "BytecodeError", "Dictionary display requires a dictionary result.");
        if (values.dictionaryNeedsProtocol(receiver, key)) dispatch(dictionaryTask(receiver, key, summary(frame, cursor),
          continuation("display-insert", {receiver}), 0, "set", item));
        else { values.set(receiver, key, item); stack.push(receiver); }
      } else if (op === "setitem") {
        const item = stack.pop(), key = stack.pop(), receiver = stack.pop();
        if (receiver instanceof InstanceValue || key instanceof InstanceValue || values.isSlice(key) || (values.isBinary(receiver) || values.isView(receiver)) && item instanceof InstanceValue ||
            frame.callable.pool.code.version === 5 && values.dictionaryNeedsProtocol(receiver, key))
          dispatch(itemTask(receiver, key, summary(frame, cursor), null, 0, "set", item));
        else stack.push(values.set(receiver, key, item));
      } else if (op === "dict-delete" && (stack.at(-2) instanceof InstanceValue || stack.at(-1) instanceof InstanceValue || values.isSlice(stack.at(-1)) ||
          frame.callable.pool.code.version === 5 && values.dictionaryNeedsProtocol(stack.at(-2), stack.at(-1)))) {
        const key = stack.pop(); dispatch(itemTask(stack.pop(), key, summary(frame, cursor), null, 0, "delete"));
      }
      else if (op === "slice") {
        const step = stack.pop(), stop = stack.pop(), start = stack.pop(), receiver = stack.pop();
        if ([receiver, start, stop, step].some(value => value instanceof InstanceValue))
          dispatch(sliceTask(receiver, [start, stop, step], summary(frame, cursor)));
        else stack.push(values.slice(receiver, start, stop, step));
      } else if (op === "getitem" && (stack.at(-2) instanceof InstanceValue || stack.at(-1) instanceof InstanceValue || values.isSlice(stack.at(-1)) ||
          frame.callable.pool.code.version === 5 && values.dictionaryNeedsProtocol(stack.at(-2), stack.at(-1)))) {
        const key = stack.pop(); dispatch(itemTask(stack.pop(), key, summary(frame, cursor)));
      }
      else if (["truth", "not", "len", "negative", "positive", "invert", "iter", "next"].includes(op))
        dispatch(unaryTask(op, stack.pop(), summary(frame, cursor)));
      else if (op === "contains" && (frame.callable.pool.code.version === 5 || stack.at(-1) instanceof GeneratorValue) &&
          (stack.at(-1) instanceof GeneratorValue || stack.at(-1) instanceof InstanceValue || stack.at(-1) instanceof IteratorValue || stack.at(-1) instanceof ProtocolIteratorValue ||
           values.hasUserEquality(stack.at(-1)) || values.hasUserEquality(stack.at(-2)) ||
           values.dictionaryNeedsProtocol(stack.at(-1), stack.at(-2)))) {
        const receiver = stack.pop(); dispatch(containsTask(receiver, stack.pop(), summary(frame, cursor)));
      }
      else if (frame.callable.pool.code.version === 5 &&
          (["equal", "not-equal"].includes(op) && (values.hasUserEquality(stack.at(-2)) || values.hasUserEquality(stack.at(-1))) ||
           Object.hasOwn(ORDERING_SLOTS, op) && (values.hasUserEquality(stack.at(-2)) || values.hasUserEquality(stack.at(-1))))) {
        const right = stack.pop(); dispatch(compareTask(op, stack.pop(), right, summary(frame, cursor)));
      }
      else if (Object.hasOwn(ARITHMETIC_SLOTS, op.startsWith("inplace-") ? op.slice(8) : op) &&
          (stack.at(-2) instanceof InstanceValue || stack.at(-1) instanceof InstanceValue)) {
        const right = stack.pop(), left = stack.pop(); dispatch(arithmeticTask(op, [left, right], summary(frame, cursor)));
      }
      else { const right = stack.pop(), left = stack.pop(); stack.push(op.startsWith("inplace-") ? values.inplace(op.slice(8), left, right) : values.binary(op, left, right)); }
    } catch (error) { handle(error); }
  };
  const handle = error => {
    if (error instanceof RegistryError && error.code === "IMPORT") error = new Raised(exception(error.name, error.message));
    else if (error instanceof RegistryError && error.code === "UNSUPPORTED") hard(error.code, error.name, error.message);
    if (!(error instanceof Raised)) throw error;
    // Handler matching or iterator setup can itself raise while unwinding.
    let pending = error;
    while (true) {
      try { state.temporaries.push(pending.value); settle({kind: "raise", value: pending.value}); break; }
      catch (next) { if (!(next instanceof Raised)) throw next; pending = next; }
    }
  };
  const close = () => {
    while (state.frames.length) state.frames.pop().leave();
    for (const release of state.outputLeases) release(false);
    state.outputLeases.length = 0;
    state.rootLeave?.(); state.rootLeave = null;
    state.pool = null; state.globals = null; state.temporaries = []; state.builtins.clear(); state.pendingImport = null;
    if (arena === null) memory.close();
  };
  const snapshot = () => Object.freeze({
    steps: moduleContext ? moduleContext.steps : state.steps,
    work: moduleContext ? moduleContext.work : state.work,
    outputLength: moduleContext ? moduleContext.outputLength : state.outputLength,
    temporaryRoots: state.temporaries.length,
    transitions: Object.freeze({...state.transitions}),
    source: state.current ? Object.freeze({...state.current, location: state.current.location ? Object.freeze({
      filename: state.current.location.filename, span: Object.freeze([...state.current.location.span])}) : null}) : null,
    frames: Object.freeze(state.frames.map(frame => Object.freeze({function: frame.fn.name,
      activeException: frame.activeException?.name ?? null,
      completion: frame.completion?.kind ?? null,
      controls: Object.freeze(frame.tasks.map(task => Object.freeze({type: task.type,
        phase: task.phase ?? null, pc: task.pc ?? null, stack: task.stack?.length ?? null,
        pending: task.pending?.kind ?? null})))
    }))),
    memory: memory.stats()
  });
  return {memory, start, step, close, snapshot, diagnostic, context: moduleContext,
    done: () => state.frames.length === 0, result: () => state.result,
    pending: () => { const pending = state.pendingImport; state.pendingImport = null; return pending; },
    resume: value => state.frames.at(-1).tasks.at(-1).stack.push(value),
    resumeError: (error, lease = null) => {
      if (error instanceof Unhandled) {
        state.temporaries.push(error.value); lease?.release(false);
        addTrace(error.value, {function: state.current.function, location: state.current.location});
        error = new Raised(error.value);
      }
      handle(error);
    }};
}


// One controller owns module load plans and activation frames. A module opcode
// schedules a child unit; it never calls execute/drain recursively.
function executionMachine(program, options, context) {
  if (context !== null && (!isModuleContext(context) || !context.activeRun)) throw new TypeError("An active module context is required.");
  const root = context === null ? activation(program, options) : null;
  context = context || root.context;
  const memory = root?.memory || context.memory, stack = [];
  let result = null, last = null, failureLease = null, started = false;
  const loadRecord = (plan, owner, inheritedException = null) => ({kind: "load", plan, owner, inheritedException, index: 0});
  const pump = () => {
    while (stack.length) {
      const top = stack.at(-1);
      if (top.kind === "unit") {
        const pending = top.machine.pending();
        if (pending) { stack.push(loadRecord(pending.plan, top, pending.inheritedException)); continue; }
        if (!top.machine.done()) return;
        if (!top.initialization) result = top.machine.result();
        top.machine.close(); last = top.machine.snapshot(); stack.pop();
        if (top.initialization) { top.initialization.complete(); stack.at(-1).index++; }
        continue;
      }
      if (top.index === top.plan.names.length) {
        const value = context.module(top.plan.result);
        stack.pop();
        if (top.owner) top.owner.machine.resume(value);
        continue;
      }
      const item = top.plan.names[top.index], initialization = context.prepareInitialization(item.name, item.parent);
      if (initialization.ready) { top.index++; continue; }
      const unit = {kind: "unit", initialization, machine: null}; stack.push(unit);
      unit.machine = activation(initialization.program, {...context.options, arena: memory, moduleContext: context,
        module: initialization.module, inheritedException: top.inheritedException});
      unit.machine.start();
    }
  };
  const unwind = original => {
    let error = original, lease = null, diagnostic = original;
    while (stack.length) {
      const top = stack.at(-1);
      if (top.kind === "unit") {
        diagnostic = error instanceof Unhandled ? top.machine.diagnostic(error.value) : error;
        if (error instanceof Unhandled && context) {
          // The explicit error owner replaces the native imported-error bridge.
          // Keep the legacy pin charge and transfer order during consolidation.
          try { lease = memory.pin([error.value]); }
          catch (hardError) { error = diagnostic = hardError; }
        }
        top.machine?.close(); last = top.machine?.snapshot() || last;
        top.initialization?.abort(); stack.pop();
        continue;
      }
      stack.pop();
      if (top.owner) {
        try { top.owner.machine.resumeError(error, lease); lease = null; return; }
        catch (next) { lease?.release(false); lease = null; error = next; }
      }
    }
    failureLease = lease;
    throw diagnostic;
  };
  const guarded = action => {
    // A failed preparation or imported handler can itself raise. Keep unwinding
    // on this controller instead of entering another native evaluator.
    try { action(); }
    catch (error) { unwind(error instanceof Raised ? new Unhandled(error.value) : error); }
  };
  const start = () => {
    started = true;
    if (root) stack.push({kind: "unit", machine: root, initialization: null});
    else stack.push(loadRecord(context.entryPlan(), null));
    guarded(() => { if (root) root.start(); pump(); });
  };
  const step = () => { guarded(() => { stack.at(-1).machine.step(); pump(); }); };
  const close = () => {
    while (stack.length) {
      const top = stack.at(-1);
      if (top.kind === "unit") { top.machine?.close(); last = top.machine?.snapshot() || last; top.initialization?.abort(); }
      stack.pop();
    }
    if (!started) root?.close();
    failureLease?.release(false); failureLease = null;
  };
  const snapshot = () => {
    const units = stack.filter(item => item.kind === "unit" && item.machine), snapshots = units.map(item => item.machine.snapshot());
    const current = snapshots.at(-1) || last || {steps: 0, work: 0, outputLength: 0, temporaryRoots: 0, transitions: {}, source: null};
    return Object.freeze({...current,
      steps: context?.steps ?? current.steps, work: context?.work ?? current.work,
      outputLength: context?.outputLength ?? current.outputLength,
      transitions: Object.freeze({...context?.transitions, ...current.transitions}),
      frames: Object.freeze(snapshots.flatMap((entry, index) => entry.frames.map(frame => Object.freeze({...frame,
        module: units[index].initialization?.module.name ?? null})))),
      imports: Object.freeze(stack.filter(item => item.kind === "load").map(item => Object.freeze({
        result: item.plan.result, index: item.index, names: Object.freeze(item.plan.names.map(item => item.name))}))),
      memory: memory.stats()});
  };
  return {memory, start, step, close, snapshot, done: () => stack.length === 0, result: () => result};
}

const activeExecutions = new WeakMap();

// Instruction-boundary ownership and driving; Python yield/await are separate.
export class Execution {
  #machine;
  #state = "ready";
  #result;
  #error = null;
  #draining = false;
  #claimed = false;
  #boundary = 0;
  #parked = null;
  constructor(program, options = {}, context = null) { this.#machine = executionMachine(program, options, context); }
  static modules(context) {
    if (!isModuleContext(context) || !context.activeRun) throw new TypeError("An active module context is required.");
    return new Execution(null, {}, context);
  }
  static callback(context, callable, args) {
    if (!isModuleContext(context) || !context.activeRun || !(callable instanceof FunctionValue) ||
        context.module(callable.pool.module?.name) !== callable.pool.module || callable.pool.module.status !== "ready")
      throw new TypeError("A ready owned Python callback and active module context are required.");
    return new Execution(context.registry.program(callable.pool.module.name), {...context.options, arena: context.memory,
      moduleContext: context, module: callable.pool.module, retainResult: true, entryCall: {callable, arguments: args}});
  }
  get state() { return this.#state; }
  get result() {
    if (this.#state !== "completed") throw new TypeError("Execution has no completed result.");
    return this.#result;
  }
  get error() { return this.#error; }
  snapshot() { return Object.freeze({state: this.#state, ...this.#machine.snapshot()}); }
  #release() {
    if (!this.#claimed) { this.#machine.close(); return; }
    const stack = activeExecutions.get(this.#machine.memory);
    if (stack?.at(-1) !== this) throw new TypeError("Executions must release in arena order.");
    try { this.#machine.close(); }
    finally { stack.pop(); this.#claimed = false; if (!stack.length) activeExecutions.delete(this.#machine.memory); }
  }
  park() {
    if (this.#state !== "paused") throw new TypeError("Only a paused execution can park.");
    const owners = activeExecutions.get(this.#machine.memory);
    if (owners?.at(-1) !== this) throw new TypeError("Execution does not own the active arena scopes.");
    this.#parked = this.#machine.memory.parkScopes(this.#boundary);
    owners.pop(); if (!owners.length) activeExecutions.delete(this.#machine.memory);
    this.#claimed = false; this.#state = "parked";
    return this.snapshot();
  }
  #restore(owners) {
    this.#boundary = this.#machine.memory.scopeDepth;
    this.#machine.memory.restoreScopes(this.#parked); this.#parked = null;
    owners.push(this); activeExecutions.set(this.#machine.memory, owners); this.#claimed = true;
  }
  advance(instructions = 1) {
    if (!["ready", "paused", "parked"].includes(this.#state)) throw new TypeError("Execution cannot advance from " + this.#state + ".");
    if (!Number.isSafeInteger(instructions) || instructions < 1 || instructions > 1000000) throw new TypeError("Invalid execution quantum.");
    const owners = activeExecutions.get(this.#machine.memory) || [];
    if (owners.length && owners.at(-1) !== this)
      throw new TypeError("A paused execution owns this arena.");
    const initial = this.#state === "ready";
    if (this.#state === "parked") this.#restore(owners);
    if (initial) { this.#boundary = this.#machine.memory.scopeDepth; owners.push(this); activeExecutions.set(this.#machine.memory, owners); this.#claimed = true; }
    this.#state = "running";
    try {
      if (initial) this.#machine.start();
      for (let count = 0; count < instructions && !this.#machine.done(); count++) this.#machine.step();
      if (this.#machine.done()) {
        this.#result = this.#machine.result(); this.#release(); this.#state = "completed";
      } else this.#state = "paused";
      return this.snapshot();
    } catch (error) {
      this.#error = error;
      try { this.#release(); } finally { this.#state = "failed"; }
      throw error;
    }
  }
  drain() {
    if (this.#draining || !["ready", "paused", "parked"].includes(this.#state)) throw new TypeError("Execution cannot drain from " + this.#state + ".");
    this.#draining = true;
    try { do { this.advance(1000000); } while (this.#state === "paused"); return this.result; }
    finally { this.#draining = false; }
  }
  close() {
    if (this.#state === "running") throw new TypeError("Cannot close a running execution.");
    if (this.#state === "closed") return;
    if (this.#state === "parked") {
      const owners = activeExecutions.get(this.#machine.memory) || [];
      if (owners.at(-1)?.state === "running") throw new TypeError("Cannot close a parked execution during running host callbacks.");
      this.#restore(owners);
    }
    this.#release();
    this.#state = "closed";
  }
}

export function execute(program, options = {}) {
  const execution = new Execution(program, options);
  try { return execution.drain(); }
  finally { execution.close(); }
}
