import {ARITHMETIC_SLOTS, NATIVE_PROTOCOL_KEYS, ORDERING_SLOTS} from "./class-policy.mjs";
import {verifyFunctions} from "./function-bytecode.mjs";
import {GeneratorValue, FrameValue, FrameLocalsValue, Cell, Environment, environmentCell, CodePool, CodeValue, ModuleValue, FunctionValue, CallArguments, BuiltinValue, AppendValue, ValueMethod, ExceptionValue, EXCEPTIONS, matchesException, ClassValue, ClassNamespaceValue, DictionaryViewValue, InstanceValue, BoundMethodValue, SuperValue, PropertyValue, MethodWrapperValue, ProtocolIteratorValue, NotImplementedValue} from "./function-objects.mjs";
import {ClassRuntime, CONTAINER_METHODS, CONTAINER_METHOD_NAMES} from "./class-values.mjs";
import {ValueRuntime, valueLayout, IteratorValue} from "./values.mjs";
import {MemoryArena} from "./memory.mjs";
import {ExecutionError} from "./vm.mjs";
import {isModuleContext} from "./module-context.mjs";
import {RegistryError} from "./module-registry.mjs";
import {completion as continuation, completionRoots, unaryTask, itemTask, attributeTask, sliceTask, containsTask, compareTask, dictionaryTask, dictionaryBuildTask, namespaceCreateTask, valueTask, arithmeticTask, consumeTask, controlRoots, retainTransfer} from "./operations.mjs";

import {Raised, operationRuntime} from "./operation-runtime.mjs";
class Unhandled { constructor(value) { this.value = value; } }
const builtinNames = new Set(["print", "str", "repr", "len", ...Object.keys(EXCEPTIONS)]);
const summary = (frame, cursor) => Object.freeze({function: frame.fn.name,
  location: cursor.block.source ? Object.freeze({filename: cursor.block.source.filename,
    ...(frame.pool.source ? {dynamic_source: true} : {}),
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
    transactions: [], temporaries: [], steps: 0, work: 0, outputLength: 0, current: null, result: null, rootLeave: null, pendingImport: null, importCompletion: null, importSite: null,
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
  const userProtocol = value => classes.protocolObject(value);
  const objectType = () => moduleContext.builtin("object", () => classes.root());
  const setCell = (cell, value, bound = true) => mutate(cell, () => {
    const before = [cell.value, cell.bound]; cell.value = value; cell.bound = bound;
    return () => { [cell.value, cell.bound] = before; };
  });
  const addCell = (environment, name, cell) => mutate(environment, () => {
    environment.cells.set(name, cell); return () => environment.cells.delete(name);
  });
  const block = (frame, id) => frame.tasks.push({type: "block", block: frame.fn.blocks[id], pc: 0, stack: []});
  const load = (frame, key, globalOnly = false, fallback = null) => {
    const global = globalOnly || frame.fn.globals?.includes(key), local = global ? null : frame.locals.get(key), classBody = frame.fn.kind === "class";
    const cell = global ? environmentCell(frame.callable.globals, key) : local?.bound ? local : classBody && local ? environmentCell(frame.callable.globals, key) :
      local || frame.closure.get(key) || environmentCell(frame.callable.globals, key);
    if (cell?.bound) return cell.value;
    if (!global && classBody && !frame.namespaceEnvironment && key === "__firstlineno__" && frame.namespaceOrder.has(key)) return values.int(BigInt(frame.fn.firstLine ?? frame.callsite?.location?.span[0] ?? 1));
    if (local && !classBody && frame.index !== 0) python("UnboundLocalError", "cannot access local variable '" + key + "' where it is not associated with a value");
    if (!global && frame.closure.has(key) && !(classBody && local)) python("NameError", "cannot access free variable '" + key + "' where it is not associated with a value in enclosing scope");
    if (fallback) return fallback();
    if (frame.pool.code.version === 5 && key === "object") return objectType();
    if (frame.pool.code.version === 5 && key === "NotImplemented") return moduleContext.builtin(key, () => allocate(NotImplementedValue));
    if (builtinNames.has(key) || (moduleContext && ["isinstance", "bool", "iter", "next"].includes(key)) ||
        (frame.pool.code.version >= 4 && ["memoryview", "bytes", "bytearray", "set", "frozenset", "all", "any", "list", "tuple", "range", "int", "float", "complex", "abs", "divmod", "pow", "round", "bin", "oct", "hex", "chr", "ord"].includes(key)) ||
        (frame.pool.code.version === 5 && ["__import__", "exec", "eval", "compile", "id", "globals", "locals", "vars", "dir", "dict", "super", "getattr", "setattr", "delattr", "hasattr", "type", "issubclass", "property", "staticmethod", "classmethod", "callable", "slice", "hash", "reversed"].includes(key))) {
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
  const classNamespace = frame => {
    if (frame.namespaceEnvironment) return frame.namespaceEnvironment.dictionary;
    const environment = allocate(Environment); state.temporaries.push(environment);
    if (frame.namespaceOrder.has("__firstlineno__") && !frame.locals.get("__firstlineno__")?.bound) {
      const first = allocate(Cell); state.temporaries.push(first); setCell(first, values.int(BigInt(frame.fn.firstLine ?? frame.callsite?.location?.span[0] ?? 1)));
      frame.locals.set("__firstlineno__", first);
    }
    environment.cells = frame.locals; environment.order = frame.namespaceOrder;
    const layout = valueLayout(environment); memory.resize(environment, layout.bytes, layout.children);
    const dictionary = values.environmentDictionary(environment);
    frame.namespaceEnvironment = environment; return dictionary;
  };
  const className = (frame, key) => (frame.fn.kind === "class" || frame.dynamicNamespace) && !frame.fn.globals?.includes(key) && !key.startsWith("@source:");
  const nameDictionary = (frame, key) => className(frame, key) && !frame.namespaceEnvironment && key === "__firstlineno__" && frame.namespaceOrder.has(key) ? null : className(frame, key) && frame.namespaceEnvironment ? frame.namespaceEnvironment.dictionary : !key.startsWith("@source:") && (frame.index === 0 || frame.fn.globals?.includes(key) ||
    !frame.locals.has(key) && !frame.closure.has(key)) ? frame.callable.globals.dictionaryIdentity ?? frame.callable.globals.dictionary : null;
  const store = (frame, key, value, bound = true, after = null) => {
    const environment = frame.callable.globals;
    if (className(frame, key) && !frame.fn.nonlocals?.includes(key) && frame.namespaceEnvironment) {
      const name = values.string(Array.from(key, char => char.codePointAt(0))); state.temporaries.push(name);
      const dictionary = frame.namespaceEnvironment.dictionary;
      if (!values.isDict(dictionary)) return itemTask(dictionary, name, state.current, after || continuation("name-stored"), 0, bound ? "set" : "delete", value);
      if (!dictionary.ownedKeys) {
        if (bound) values.set(dictionary, name, value);
        else { const index = values.find(dictionary, name); if (index >= 0) values.remove(dictionary, name); }
        return after ? valueTask(null, state.current, after) : null;
      }
      return dictionaryTask(frame.namespaceEnvironment.dictionary, name, state.current, after || continuation("name-stored"), 0, bound ? "set" : "discard", value);
    }
    if (!key.startsWith("@source:") && (frame.index === 0 || frame.fn.globals?.includes(key)) && environment.dictionary !== null) {
      const name = values.string(Array.from(key, char => char.codePointAt(0))); state.temporaries.push(name);
      return dictionaryTask(environment.dictionary, name, state.current, after || continuation("name-stored"), 0, bound ? "set" : "discard", value);
    }
    setCell(targetCell(frame, key, bound), value, bound);
    if (frame.index === 0 || frame.fn.globals?.includes(key)) { if (bound) environment.order.add(key); else environment.order.delete(key); }
    if (frame.namespaceOrder && frame.locals.has(key)) { if (bound) frame.namespaceOrder.add(key); else frame.namespaceOrder.delete(key); }
  };
  const builtinLookup = (frame, name, site, after = null) => {
    const namespace = frame.callable.builtins === undefined ? moduleContext?.defaultBuiltins : frame.callable.builtins;
    let dictionary = namespace instanceof Environment ? namespace.dictionary : namespace;
    if (namespace instanceof Environment && namespace !== moduleContext?.defaultBuiltins && dictionary === null) dictionary = values.environmentDictionary(namespace);
    if ((namespace === null || namespace === undefined) && frame.callable.builtins === undefined || dictionary === null && namespace instanceof Environment || frame.pool.code.version < 5)
      return {value: name === "__import__" && frame.pool.code.version === 5 ? nativeBuiltin(name) : load(frame, name, true)};
    const key = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(key);
    return {task: values.isDict(dictionary) ? dictionaryTask(dictionary, key, site, continuation("builtin-name", {receiver: dictionary, name, after}), 0, "probe") : itemTask(dictionary, key, site, continuation("builtin-mapping-name", {receiver: dictionary, name, after}))};
  };
  const loadName = (frame, name, site, after = null, globalOnly = false) => {
    const localNamespace = !globalOnly && className(frame, name);
    const dictionary = globalOnly ? frame.dynamicNamespace ? frame.callable.globals.dictionary : frame.callable.globals.dictionaryIdentity ?? frame.callable.globals.dictionary : nameDictionary(frame, name);
    if (dictionary === null || globalOnly && !frame.callable.globals.dictionary) {
      let result;
      const value = load(frame, name, globalOnly, () => { result = builtinLookup(frame, name, site, after); return null; });
      return result || (after ? {value, after} : {value});
    }
    const key = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(key);
    if (!localNamespace && dictionary instanceof InstanceValue && values.isDict(dictionary.nativePayload))
      return {task: itemTask(dictionary, key, site, continuation("global-mapping-name", {name, receiver: dictionary, after}))};
    if (localNamespace && !values.isDict(dictionary))
      return {task: itemTask(dictionary, key, site, continuation("class-mapping-name", {name, receiver: dictionary, after}))};
    if (localNamespace && !dictionary.ownedKeys) {
      const index = values.find(dictionary, key);
      if (index >= 0) return after ? {value: dictionary.entries[index].value, after} : {value: dictionary.entries[index].value};
    }
    return {task: dictionaryTask(dictionary, key, site, continuation(localNamespace && frame.namespaceEnvironment ? "class-name" : "global-name", {name, receiver: dictionary, after}), 0, "probe")};
  };
  const classFallback = (name, site, after = null) => {
    const frame = state.frames.at(-1); let fallback;
    if (frame.dynamicNamespace) { const result = loadName(frame, name, site, after, true); return result.task || valueTask(result.value, site, after); }
    const value = load(frame, name, false, () => { fallback = builtinLookup(frame, name, site, after); return null; });
    return fallback?.task || valueTask(fallback ? fallback.value : value, site, after);
  };
  const classModule = value => store(state.frames.at(-1), "__module__", value, true, continuation("class-qualname")) || classQualification();
  const classQualification = () => {
    const frame = state.frames.at(-1), value = values.string(Array.from(frame.fn.qualname, char => char.codePointAt(0))); state.temporaries.push(value);
    const writing = store(frame, "__qualname__", value, true, continuation("class-firstline"));
    return writing || classFirstline();
  };
  const classFirstline = () => {
    const frame = state.frames.at(-1);
    if (frame.namespaceEnvironment || frame.fn.globals?.includes("__firstlineno__") || frame.fn.nonlocals?.includes("__firstlineno__"))
      return store(frame, "__firstlineno__", values.int(BigInt(frame.fn.firstLine ?? frame.callsite?.location?.span[0] ?? 1)));
    frame.namespaceOrder.add("__firstlineno__"); return null;
  };
  const classEnd = record => {
    const frame = state.frames.at(-1);
    while (record.position < record.names.length) {
      const position = record.position++, name = record.names[position], item = record.items[position];
      const writing = store(frame, name, item, true, continuation("class-end", record));
      if (writing) return writing;
    }
    settle({kind: record.signal, value: record.value}); return null;
  };
  const beginClass = (record, site) => {
    const {bases, explicit, hasMeta} = record;
    classes.validateNamespace(bases, record.callable.pool.code.functions[record.callable.index].locals);
    const invalidMetaclass = hasMeta && !classes.isType(explicit) && !classes.callable(explicit);
    const metaclass = hasMeta ? classes.selectMetaclass(bases, explicit) :
      bases.length && !classes.isType(bases[0]) ? classes.selectMetaclass(bases, classes.typeOf(bases[0])) :
      bases.some(base => base instanceof ClassValue && base.metaclass !== null) ? classes.selectMetaclass(bases) : null;
    record = {...record, metaclass, invalidMetaclass};
    const resolved = loadName(state.frames.at(-1), "__name__", site, continuation("class-module", record));
    return resolved.task || prepareClass(record, resolved.value, site);
  };
  const enterClass = (record, rawModule, site) => {
    const module = values.text(rawModule) ?? record.callable.pool.module.name;
    enter(record.callable, new Map(), site, continuation("class", {...record, module}));
    const frame = state.frames.at(-1);
    if (record.prepared !== undefined) {
      const environment = allocate(Environment); state.temporaries.push(environment);
      mutate(environment, () => { environment.dictionary = record.prepared; return () => { environment.dictionary = null; }; });
      frame.namespaceEnvironment = environment;
      const resolved = loadName(frame, "__name__", site, continuation("class-body-module"));
      return resolved.task || classModule(resolved.value);
    }
    classNamespace(frame);
    return classModule(rawModule);
  };
  const handlerNext = (position, names, site) => {
    const frame = state.frames.at(-1), task = frame.tasks.at(-1), handlers = task.instruction[2];
    while (task.handlerIndex < handlers.length) {
      const [types, alias, body, span] = handlers[task.handlerIndex];
      if (position < types.length) {
        state.current = {...state.current, location: task.site ? {filename: task.site.filename, span} : null};
        const after = continuation("handler-type", {position, names});
        const result = loadName(frame, types[position], site, after);
        if (result.task) return result.task;
        return handlerType(after, result.value, site);
      }
      if (!types.length || names.some(name => matchesException(task.caught.name, name))) {
        task.phase = "handler"; task.alias = alias;
        const writing = alias ? store(frame, alias, task.caught, true, continuation("store-body", {body})) : null;
        if (writing) return writing;
        block(frame, body); return null;
      }
      task.handlerIndex++; position = 0; names = [];
    }
    task.phase = "unmatched"; settle({kind: "raise", value: task.caught}); return null;
  };
  const handlerType = (record, value, site) => {
    if (!(value instanceof BuiltinValue) || !Object.hasOwn(EXCEPTIONS, value.name))
      python("TypeError", "catching classes that do not inherit from BaseException is not allowed");
    return handlerNext(record.position + 1, [...record.names, value.name], site);
  };
  const bind = (callable, positional, keywordNames, keywordValues) => {
    const fn = callable.pool.code.functions[callable.index], constants = callable.pool.code.constants;
    const p = fn.params, ordered = [...p.posonly, ...p.positional], bindings = new Map();
    const defaults = Array.isArray(callable.positionalDefaults) ? callable.positionalDefaults : callable.positionalDefaults?.items ?? [];
    const keywordDefaults = callable.keywordDefaults;
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
      const range = defaults.length ? "from " + (ordered.length - defaults.length) + " to " + ordered.length : String(ordered.length);
      const kw = keywordNames.filter(key => p.kwonly.includes(key)).length;
      python("TypeError", label + " takes " + range + " positional argument" + (ordered.length === 1 && !defaults.length ? "" : "s") +
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
      const key = ordered[i], defaultIndex = i - ordered.length + defaults.length;
      if (!bindings.has(key) && defaultIndex >= 0) bindings.set(key, defaults[defaultIndex]);
    }
    missing(ordered.filter(key => !bindings.has(key)), "positional");
    if (keywordDefaults instanceof Map) {
      for (const key of p.kwonly) if (!bindings.has(key) && keywordDefaults.has(key)) bindings.set(key, keywordDefaults.get(key));
      missing(p.kwonly.filter(key => !bindings.has(key)), "keyword-only");
    } else if (keywordDefaults === null) missing(p.kwonly.filter(key => !bindings.has(key)), "keyword-only");
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
    if (values.isDict(keywordDefaults)) bindings.pendingDefaults = p.kwonly.filter(key => !bindings.has(key));
    return bindings;
  };
  const inlineFrame = frame => ["<listcomp>", "<dictcomp>", "<setcomp>"].includes(frame.fn.name);
  const visibleFrame = frame => { while (frame?.parent && inlineFrame(frame)) frame = frame.parent; return frame; };
  const invalidateFrame = frame => {
    frame.inlineVersion = (frame.inlineVersion ?? 0) + 1;
    if (frame.reflector) { frame.reflector.keys = null; frame.reflector.keyVersion = -1; }
  };
  const frameScope = (frame, roots) => {
    const leave = memory.enter(roots, {charge, fail: hard});
    return () => {
      if (frame.inlineParent) {
        const parent = frame.inlineParent;
        parent.inlineFrames = parent.inlineFrames.filter(item => item !== frame); invalidateFrame(parent);
      }
      if (frame.reflector) frame.reflector.raw = {fn: frame.fn, pool: frame.pool, index: frame.index, callable: frame.callable,
        locals: frame.locals, closure: frame.closure, namespaceOrder: frame.namespaceOrder, namespaceEnvironment: frame.namespaceEnvironment, dynamicNamespace: frame.dynamicNamespace,
        currentSite: frame.currentSite, inlineFrames: [], inlineVersion: frame.inlineVersion, active: false};
      leave();
    };
  };
  const enter = (callable, bindings, callsite = null, completion = null, executable = callable) => {
    if (state.frames.length >= Math.min(maxDepth, memory.limits.maxFrames - 1) || memory.stats().frames >= memory.limits.maxFrames) python("RecursionError", "maximum recursion depth exceeded");
    const fn = executable.pool.code.functions[executable.index];
    const saved = executable instanceof GeneratorValue ? executable.reflector : null;
    const frame = {fn, callable, pool: executable.pool, index: executable.index, closure: executable.closure,
      locals: saved?.locals ?? (executable.index === 0 ? callable.globals.cells : new Map()), reflector: saved, parent: state.frames.at(-1) ?? null,
      inlineFrames: [], inlineVersion: 0, inlineParent: null, currentSite: null, active: true,
      tasks: [], activeException: state.frames.at(-1)?.activeException || inheritedException, callsite,
      completion, namespaceOrder: fn.kind === "class" ? new Set() : null, returnInstruction: state.current?.instruction ?? null};
    frame.leave = frameScope(frame, () => [callable, ...(frame.pool === callable.pool ? [] : [frame.pool]),
      ...(frame.closure === callable.closure ? [] : frame.closure.values()), ...frame.locals.values(), ...(frame.activeException ? [frame.activeException] : []),
      ...frame.tasks.flatMap(controlRoots), ...(frame.namespaceEnvironment ? [frame.namespaceEnvironment] : []), ...(frame.generator ? [frame.generator] : []), ...(frame.reflector ? [frame.reflector] : []), ...completionRoots(frame.completion, true)]);
    state.frames.push(frame);
    // Keep the established cell allocation/root order; source local order is
    // independently carried by the verified function for namespace snapshots.
    const localNames = frame.pool.code.version === 5 && fn.kind === "function" ? [...fn.locals].sort() : fn.locals;
    for (const key of localNames) {
      let cell = frame.locals.get(key);
      if (!cell) {
        cell = allocate(Cell);
        if (frame.index === 0) addCell(callable.globals, key, cell); else frame.locals.set(key, cell);
      }
      if (!saved && bindings.has(key)) setCell(cell, bindings.get(key));
    }
    if (inlineFrame(frame) && frame.parent) { frame.inlineParent = visibleFrame(frame.parent); frame.inlineParent.inlineFrames.push(frame); invalidateFrame(frame.inlineParent); }
    if (saved) { saved.raw = frame; saved.back = frame.parent ? reflectFrame(frame.parent) : null; const layout = valueLayout(saved); memory.resize(saved, layout.bytes, layout.children); }
    block(frame, fn.body);
  };
  const reflectFrame = frame => {
    frame = visibleFrame(frame);
    if (frame.reflector) return frame.reflector;
    const back = frame.parent ? reflectFrame(frame.parent) : null; state.temporaries.push(back);
    const value = allocate(FrameValue, frame, back); state.temporaries.push(value); frame.reflector = value;
    return value;
  };
  const generatorFrame = generator => {
    if (generator.status === "closed") return null;
    if (generator.reflector) return generator.reflector;
    if (generator.frame) {
      const value = reflectFrame(generator.frame); generator.reflector = value;
      const layout = valueLayout(generator); memory.resize(generator, layout.bytes, layout.children); return value;
    }
    const fn = generator.pool.code.functions[generator.index], locals = new Map();
    const roots = [generator], leave = memory.enter(() => roots, {charge, fail: hard});
    try {
      for (const name of fn.locals) { const cell = allocate(Cell); roots.push(cell); if (generator.bindings.has(name)) setCell(cell, generator.bindings.get(name)); locals.set(name, cell); }
      const raw = {fn, pool: generator.pool, index: generator.index, callable: generator.callable, closure: generator.closure, locals, tasks: [], parent: null, active: false, currentSite: null};
      const value = allocate(FrameValue, raw); roots.push(value);
      mutate(generator, () => { const previous = generator.reflector; generator.reflector = value; return () => { generator.reflector = previous; }; });
      generator.bindings.clear(); return value;
    } finally { leave(); }
  };
  const {dispatch, call, deliver, notifyNext, recover, argumentOwner, appendArgument, appendKeyword, expandArguments, keywordArgument, expandMapping, finishArguments, expandDisplay, expandUnpack, resolveClassBases, prepareClass, importStatement} = operationRuntime({state, memory, values, classes,
    moduleContext, maxDepth, allocate, mutate, python, hard, charge, enter, bind, block, store, onOutput,
    setCell, load, loadName, builtinLookup, reflectFrame, generatorFrame, visibleFrame, classNamespace, classFallback, classModule, beginClass, enterClass, classQualification, classFirstline, classEnd, handlerType, settle: signal => settle(signal), resumeGenerator: (...args) => resumeGenerator(...args), yieldGenerator: value => yieldGenerator(value),
    delegateResult: (...args) => delegateResult(...args), injectGenerator: value => injectGenerator(value)});
  const leaveGenerator = (frame, status) => {
    const generator = frame.generator, completion = frame.completion;
    state.temporaries.push(generator, ...completionRoots(completion));
    frame.completion = null; frame.callsite = null;
    if (!frame.ownsException) frame.activeException = null;
    for (const task of frame.tasks) if (task.type === "try" && !task.previousOwned) task.previous = null;
    generator.status = status; generator.frame = frame;
    frame.active = false; frame.parent = null; if (frame.reflector) frame.reflector.back = null;
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
    if (userProtocol(iterator)) return classes.read(iterator, name);
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
      if (fresh && mode === "throw") addTrace(value, definitionSite(generator));
      if (generator.reflector) { generator.reflector.raw.active = false; generator.reflector.back = null; generator.reflector = null; }
      generator.status = "closed"; generator.callable = null; generator.closure = null; generator.bindings.clear();
      if (mode === "close") { dispatch(deliver(null, completion, site)); return; }
      if (mode === "throw") { addTrace(value, site); throw new Raised(value); }
      python("StopIteration", "");
    }
    state.temporaries.push(generator, value, ...completionRoots(completion));
    if (fresh) {
      enter(generator.callable, generator.bindings, site, completion, generator);
      generator.frame = state.frames.at(-1); generator.frame.generator = generator;
      generator.bindings.clear();
    } else {
      if (state.frames.length >= Math.min(maxDepth, memory.limits.maxFrames - 1)) python("RecursionError", "maximum recursion depth exceeded");
      const frame = generator.frame;
      const inherited = state.frames.at(-1)?.activeException || inheritedException;
      if (!frame.ownsException) frame.activeException = inherited;
      for (const task of frame.tasks) if (task.type === "try" && !task.previousOwned) task.previous = inherited;
      frame.completion = completion; frame.callsite = site; frame.returnInstruction = state.current?.instruction ?? null;
      frame.leave = frameScope(frame, () => [generator, frame.callable, ...frame.locals.values(), frame.activeException,
        ...frame.tasks.flatMap(controlRoots), ...(frame.reflector ? [frame.reflector] : []), ...completionRoots(frame.completion, true)]);
      state.frames.push(frame);
    }
    generator.status = "running";
    generator.frame.active = true; generator.frame.parent = state.frames.at(-2) ?? null;
    if (generator.reflector) { generator.reflector.raw = generator.frame; generator.reflector.back = generator.frame.parent ? reflectFrame(generator.frame.parent) : null; const layout = valueLayout(generator.reflector); memory.resize(generator.reflector, layout.bytes, layout.children); }
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
          if (task.phase === "iterable" && (signal.value instanceof GeneratorValue || userProtocol(signal.value) || signal.value instanceof ProtocolIteratorValue)) {
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
          const writing = store(frame, task.target, item, true, continuation("store-body", {body: task.body}));
          if (writing) dispatch(writing); else block(frame, task.body); return;
        }
        if (task.type === "try") {
          const [, body, handlers, otherwise, final] = task.instruction;
          void body;
          if (task.phase === "body" && signal.kind === "raise") {
            task.phase = "matching"; task.caught = signal.value; frame.activeException = signal.value; frame.ownsException = true;
            if (frame.callable.globals.dictionary !== null || frame.namespaceEnvironment) {
              task.handlerIndex = 0; const matching = handlerNext(0, [], state.current);
              if (matching) dispatch(matching); return;
            }
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
              if (task.alias) {
                const writing = store(frame, task.alias, signal.value, true, continuation("store-body", {body: clause[2]}));
                if (writing) { dispatch(writing); return; }
              }
              block(frame, clause[2]); return;
            }
          } else if (task.phase === "body" && signal.kind === "normal" && otherwise !== null) {
            task.phase = "else"; block(frame, otherwise); return;
          }
          if (task.phase === "handler") {
            if (task.alias) {
              const alias = task.alias; task.alias = null;
              const writing = store(frame, alias, null, false, continuation("resume-control", {signal: signal.kind, value: signal.value}));
              if (writing) { dispatch(writing); return; }
            }
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
        frame.active = false; if (frame.reflector) frame.reflector.back = null;
        generator.reflector = null;
        generator.status = "closed"; generator.frame = null; generator.callable = null; generator.closure = null; generator.bindings.clear();
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
      frame.active = false;
      state.temporaries = [returned, frame.callable];
      const parent = state.frames.at(-2);
      if (!parent && frame.completion === null) {
        if (signal.kind !== "raise" && module && !entryCall && !frame.packagePublished) {
          frame.packagePublished = true;
          const parts = module.name.split("."), owner = moduleContext.module(parts.slice(0, -1).join("."));
          if (owner?.environment.dictionary !== null && owner) {
            dispatch(attributeTask(owner, parts.at(-1), state.current, continuation("resume-control", {signal: signal.kind, value: returned}), 0, "set", null, null, module)); return;
          }
        }
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
        if (!parent) throw new Unhandled(returned);
        addTrace(returned, frame.callsite);
        frame.leave(); state.frames.pop();
        continue;
      }
      if (frame.completion?.kind === "class") {
        const bodyDictionary = frame.namespaceEnvironment?.dictionary || (frame.completion.metaclass instanceof ClassValue ? classNamespace(frame) : null);
        const routed = name => frame.fn.globals?.includes(name) || frame.fn.nonlocals?.includes(name);
        if (!frame.namespaceFinished && (bodyDictionary || routed("__static_attributes__") || routed("__classcell__"))) {
          frame.namespaceFinished = true;
          const entries = [];
          if (bodyDictionary || routed("__static_attributes__")) {
            const names = (frame.fn.staticAttributes || []).map(name => {
              const value = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(value); return value;
            });
            const tuple = values.tuple(names); state.temporaries.push(tuple); entries.push(["__static_attributes__", tuple]);
          }
          if (bodyDictionary && frame.fn.blocks.some(block => block.instructions.some(([op]) => ["function", "function-defaults"].includes(op)))) {
            const cell = allocate(Cell); state.temporaries.push(cell); setCell(cell, bodyDictionary); entries.push(["__classdictcell__", cell]);
          }
          const cell = frame.locals.get("@source:class"); if (cell) entries.push(["__classcell__", cell]);
          if (frame.completion.originalBases) entries.push(["__orig_bases__", frame.completion.originalBases]);
          const pending = classEnd({names: entries.map(([name]) => name), items: entries.map(([,value]) => value), position: 0, signal: signal.kind, value: returned});
          if (pending) dispatch(pending); return;
        }
        const namespace = bodyDictionary && values.isDict(bodyDictionary) ? new Map(bodyDictionary.entries.map(entry => [values.text(entry.key) ?? entry.key, entry.value])
          .filter(([key]) => !["__classdictcell__", "__classcell__"].includes(key))) :
          new Map([...(bodyDictionary ? [] : frame.namespaceOrder)].filter(key => frame.locals.get(key)?.bound && !key.startsWith("@source:"))
            .map(key => [key, frame.locals.get(key).value]));
        const completion = frame.completion;
        state.temporaries.push(...namespace.values(), ...[...namespace.keys()].filter(key => typeof key !== "string"), ...(bodyDictionary ? [bodyDictionary] : []), ...completion.bases, ...(completion.keywordValues ?? []));
        if (completion.metaclass) state.temporaries.push(completion.metaclass);
        const classCell = frame.locals.get("@source:class");
        if (classCell) state.temporaries.push(classCell);
        state.current = {...frame.callsite, instruction: frame.returnInstruction};
        frame.leave(); state.frames.pop();
        if (completion.invalidMetaclass) python("TypeError", "Metaclass is not callable");
        if (completion.metaclass && !(completion.metaclass instanceof BuiltinValue && completion.metaclass.name === "type")) {
          const dictionary = bodyDictionary || values.dict([]); state.temporaries.push(dictionary);
          for (const [key, value] of bodyDictionary ? [] : [...namespace, ...(classCell ? [["__classcell__", classCell]] : [])]) {
            const name = typeof key === "string" ? values.string(Array.from(key, char => char.codePointAt(0))) : key; state.temporaries.push(name);
            values.set(dictionary, name, value);
          }
          const name = completion.nameValue || values.string(Array.from(frame.fn.name, char => char.codePointAt(0))); state.temporaries.push(name);
          const bases = completion.basesTuple || values.tuple(completion.bases); state.temporaries.push(bases);
          call(completion.metaclass, [name, bases, dictionary], completion.keywords ?? [], completion.keywordValues ?? [], frame.callsite,
            classCell ? continuation("class-created", {cell: classCell}) : null); return;
        }
        if (bodyDictionary) {
          const dictionary = values.copyDictionary(bodyDictionary); state.temporaries.push(dictionary);
          const defaultModule = values.string(Array.from(completion.module, char => char.codePointAt(0))); state.temporaries.push(defaultModule);
          dispatch(namespaceCreateTask({name: frame.fn.name, qualname: frame.fn.name, module: completion.module, dictionary, defaultModule,
            bases: completion.bases, dynamic: false, firstLine: frame.fn.firstLine ?? frame.callsite?.location?.span[0] ?? 1,
            staticAttributes: frame.fn.staticAttributes || [], keywords: completion.keywords ?? [], keywordValues: completion.keywordValues ?? []}, frame.callsite,
            classCell ? continuation("class-created", {cell: classCell}) : null)); return;
        }
        const qualification = namespace.has("__qualname__") ? values.text(namespace.get("__qualname__")) : frame.fn.name;
        if (qualification === null) python("TypeError", "type __qualname__ must be a str");
        const type = classes.create(frame.fn.name, qualification, completion.module, completion.bases, namespace, objectType(),
          {firstLine: (bodyDictionary ? namespace.has("__firstlineno__") : frame.namespaceOrder.has("__firstlineno__")) ? frame.fn.firstLine ?? frame.callsite?.location?.span[0] ?? 1 : null,
            staticAttributes: routed("__static_attributes__") ? null : frame.fn.staticAttributes || [], namespaceEntries: bodyDictionary?.entries || null});
        if (classCell) { state.temporaries.push(type, classCell); if (!routed("__classcell__")) setCell(classCell, type); }
        dispatch(notifyNext(type, [...namespace], 0, frame.callsite, classCell ? continuation("class-created", {cell: classCell}) : null, completion.keywords, completion.keywordValues)); return;
      }
      if (frame.fn.kind === "class" && frame.dynamicNamespace && !frame.namespaceFinished) {
        frame.namespaceFinished = true;
        const names = (frame.fn.staticAttributes || []).map(name => { const value = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(value); return value; });
        const tuple = values.tuple(names); state.temporaries.push(tuple);
        const cell = frame.locals.get("@source:class");
        const pending = classEnd({names: ["__static_attributes__", ...(cell ? ["__classcell__"] : [])], items: [tuple, ...(cell ? [cell] : [])], position: 0, signal: signal.kind, value: returned});
        if (pending) dispatch(pending); return;
      }
      const completion = frame.completion;
      retainTransfer(state.temporaries, [], completion);
      state.current = {...frame.callsite, instruction: frame.returnInstruction};
      frame.leave(); state.frames.pop(); dispatch(deliver(returned, completion, frame.callsite)); return;
    }
  };
  const start = () => {
    if (entryCall) state.temporaries.push(entryCall.callable);
    state.rootLeave = memory.enter(() => [state.pool, state.globals, inheritedException, ...state.builtins.values(), ...state.temporaries, ...state.transactions, ...completionRoots(state.importCompletion)], {charge, fail: hard});
    if (entryCall) {
      state.pool = entryCall.callable.pool; state.globals = module.environment;
      const args = entryCall.arguments.map(record => values.decode(record, {retain: value => state.temporaries.push(value)}));
      call(entryCall.callable, args, [], [], null);
      return;
    }
    state.pool = allocate(CodePool, verified.code, verified.bytes, module);
    state.globals = module ? module.environment : allocate(Environment);
    if (module) mutate(module, () => { const before = module.pool; module.pool = state.pool; return () => { module.pool = before; }; });
    const entry = allocate(FunctionValue, state.pool, 0, state.globals, new Map(), null, undefined);
    state.temporaries = [entry]; enter(entry, new Map());
  };
  const step = () => {
    if (moduleContext) moduleContext.tick(hard);
    else if (++state.steps > maxSteps) hard("BUDGET", "ExecutionLimitError", "Instruction budget exceeded.");
    charge(1); state.temporaries = []; classes.lookupCache = null; memory.collect();
    const frame = state.frames.at(-1), cursor = frame.tasks.at(-1), stack = cursor.stack;
    state.current = {...summary(frame, cursor), instruction: cursor.pc};
    const [op, arg, extra, fourth, fifth] = cursor.block.instructions[cursor.pc++];
    state.current = {...summary(frame, cursor), instruction: cursor.pc - 1};
    state.temporaries = stack.slice();
    frame.currentSite = state.current.location;
    try {
      if (op === "const") stack.push(frame.pool.code.constants[arg]);
      else if (op === "load") {
        const result = loadName(frame, arg, summary(frame, cursor));
        if (result.task) dispatch(result.task); else stack.push(result.value);
      }
      else if (op === "store") { const task = store(frame, arg, stack.pop()); if (task) dispatch(task); }
      else if (op === "delete") {
        const dictionary = className(frame, arg) && !frame.fn.nonlocals?.includes(arg) && frame.namespaceEnvironment ? frame.namespaceEnvironment.dictionary :
          !arg.startsWith("@source:") && (frame.index === 0 || frame.fn.globals?.includes(arg)) ? frame.callable.globals.dictionaryIdentity ?? frame.callable.globals.dictionary : null;
        if (dictionary !== null) {
          const key = values.string(Array.from(arg, char => char.codePointAt(0))); state.temporaries.push(key);
          dispatch(values.isDict(dictionary) ? dictionaryTask(dictionary, key, summary(frame, cursor), continuation("global-delete", {name: arg, receiver: dictionary}), 0, "remove-probe") :
            itemTask(dictionary, key, summary(frame, cursor), continuation("class-mapping-delete", {name: arg, receiver: dictionary}), 0, "delete")); return;
        }
        if (frame.fn.kind === "class" && arg === "__firstlineno__" && !frame.namespaceEnvironment && frame.namespaceOrder.has(arg)) {
          frame.namespaceOrder.delete(arg); const cell = targetCell(frame, arg); if (cell?.bound) setCell(cell, null, false); return;
        }
        if (!targetCell(frame, arg)?.bound) {
          if (frame.fn.nonlocals?.includes(arg)) python("NameError", "cannot access free variable '" + arg + "' where it is not associated with a value in enclosing scope");
          if (frame.index === 0 || frame.fn.kind === "class" || frame.fn.globals?.includes(arg)) python("NameError", "name '" + arg + "' is not defined");
          python("UnboundLocalError", "cannot access local variable '" + arg + "' where it is not associated with a value");
        }
        store(frame, arg, null, false);
      }
      else if (op === "function" || op === "function-defaults" || op === "class" || op === "class-meta" || op === "class-keywords" || op === "class-expanded") {
        const owner = frame.pool;
        const closure = new Map(owner.code.functions[arg].free.map(key => [key,
          frame.fn.kind === "class" ? key === "__class__" && frame.locals.has("@source:class") ? frame.locals.get("@source:class") : frame.closure.get(key) : frame.locals.get(key) || frame.closure.get(key)]));
        const defaults = op === "function-defaults" ? stack.splice(stack.length - extra - fourth.length) : null;
        const inlined = ["<listcomp>", "<dictcomp>", "<setcomp>"].includes(owner.code.functions[arg].name);
        const builtinEntry = inlined ? null : environmentCell(frame.callable.globals, "__builtins__");
        const captured = inlined ? frame.callable.builtins : builtinEntry?.bound ? builtinEntry.value instanceof ModuleValue ? builtinEntry.value.environment : builtinEntry.value : undefined;
        const callable = allocate(FunctionValue, owner, arg, frame.callable.globals, closure, defaults, captured);
        if (op !== "class" && op !== "class-meta" && op !== "class-keywords" && op !== "class-expanded") {
          const dictionary = frame.callable.globals.dictionary;
          if (dictionary?.ownedKeys && !inlined) {
            state.temporaries.push(callable);
            const key = values.string(Array.from("__builtins__", char => char.codePointAt(0))); state.temporaries.push(key);
            dispatch(dictionaryTask(dictionary, key, summary(frame, cursor), continuation("function-capture", {receiver: callable}), 0, "probe"));
          } else stack.push(callable);
        }
        else {
          const expanded = op === "class-expanded" ? stack.pop() : null;
          const assembled = expanded ? finishArguments(expanded) : null;
          const keywordValues = expanded ? [...assembled[1]] : op === "class-keywords" ? stack.splice(stack.length - fourth.length) : [];
          const keywords = expanded ? [...assembled[0]] : op === "class-keywords" ? [...fourth] : [];
          const metaIndex = keywords.indexOf("metaclass"), hasMeta = op === "class-meta" || metaIndex !== -1;
          const explicit = op === "class-meta" ? stack.pop() : metaIndex === -1 ? undefined : keywordValues.splice(metaIndex, 1)[0];
          if (metaIndex !== -1) keywords.splice(metaIndex, 1);
          const bases = expanded ? expanded.args : stack.splice(stack.length - extra);
          state.temporaries.push(callable, ...bases, ...(hasMeta ? [explicit] : []), ...keywordValues);
          const pending = resolveClassBases({callable, bases, explicit, hasMeta, keywords, keywordValues}, summary(frame, cursor));
          if (pending) dispatch(pending);
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
        if (arg !== "__class__" && (values.isView(receiver) || values.isBinary(receiver) || values.isSet(receiver) || values.isSlice(receiver) || values.isComplex(receiver) || values.isRange(receiver))) python("AttributeError", "Value attributes are read-only");
        if (receiver instanceof ModuleValue || classes.lookupMayCallback(receiver) || classes.hasAttributeHook(receiver, op === "attribute-set" ? "__setattr__" : "__delattr__") ||
            userProtocol(receiver) && arg === "__class__" && classes.hasSlot(classes.checkingType(receiver), "__class__")) {
          dispatch(attributeTask(receiver, arg, summary(frame, cursor), null, 0, op === "attribute-set" ? "set" : "delete", null, null, value)); return;
        }
        const plan = classes.write(receiver, arg, value, op === "attribute-delete");
        if (plan.kind === "value") stack.push(plan.value);
        else {
          state.temporaries.push(plan.callable, ...plan.args, ...(plan.invokeArgs ?? []));
          const after = continuation("discard");
          call(plan.callable, plan.args, [], [], summary(frame, cursor), plan.kind === "bind-call" ?
            continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], after, depth: 0}) : after);
        }
      } else if (["import", "module-get", "import-from", "attribute-get"].includes(op)) {
        const owner = frame.pool.module;
        if (!owner || !moduleContext) hard("BYTECODE", "BytecodeError", "Module opcode has no verified registry owner.");
        if (op === "import") {
          if (frame.pool.code.version === 5 && fifth !== undefined) dispatch(importStatement(arg, extra, fifth, summary(frame, cursor)));
          else state.pendingImport = {plan: moduleContext.planLoad(owner.name, arg, extra, fourth), inheritedException: frame.activeException};
        }
        else {
          const receiver = stack.pop();
          if (op === "import-from" && frame.pool.code.version === 5 && !(receiver instanceof ModuleValue)) { dispatch(attributeTask(receiver, arg, summary(frame, cursor))); return; }
          if (receiver instanceof ModuleValue) {
            const environment = receiver.environment, cell = environment.cells.get(arg);
            if (frame.pool.code.version !== 5) {
              const result = moduleContext.planAttribute(receiver, arg, op === "import-from", owner.name);
              if (result.kind === "value") stack.push(result.value);
              else state.pendingImport = {plan: result.plan, inheritedException: frame.activeException};
            } else if (!receiver.type && environment.dictionary === null && cell?.bound && !["__dict__", "__class__"].includes(arg)) stack.push(cell.value);
            else if (!receiver.type && environment.dictionary === null && !environment.cells.get("__getattr__")?.bound && !["__dict__", "__class__", "__dir__"].includes(arg) && !NATIVE_PROTOCOL_KEYS.includes(arg)) {
              const result = moduleContext.planAttribute(receiver, arg, op === "import-from", owner.name);
              if (result.kind === "value") stack.push(result.value);
              else state.pendingImport = {plan: result.plan, inheritedException: frame.activeException};
            } else dispatch(attributeTask(receiver, arg, summary(frame, cursor), null, 0, op === "import-from" ? "import" : "get"));
          } else if (op === "attribute-get" &&
              (classes.lookupMayCallback(receiver) || classes.hasAttributeHook(receiver, "__getattribute__") || classes.hasAttributeHook(receiver, "__getattr__") || userProtocol(receiver) && arg === "__class__" && classes.hasSlot(classes.checkingType(receiver), "__class__")))
            dispatch(attributeTask(receiver, arg, summary(frame, cursor)));
          else if (op === "attribute-get" && arg === "__class__") stack.push(classes.classAttribute(receiver));
          else if (op === "attribute-get" && frame.pool.code.version === 5 && ["__dict__", "__bases__"].includes(arg) && values.typeName(receiver) !== null)
            dispatch(attributeTask(receiver, arg, summary(frame, cursor)));
          else if (["attribute-get", "module-get"].includes(op) && arg === "__dir__" && classes.hasFixedDirectory(receiver)) {
            if (frame.pool.code.version !== 5) hard("UNSUPPORTED", "UnsupportedOperationError", "Native directories require classes-source/1.");
            dispatch(attributeTask(receiver, arg, summary(frame, cursor)));
          } else if (op === "attribute-get" && frame.pool.code.version === 5 && classes.hasNativeProtocol(receiver, arg))
            dispatch(attributeTask(receiver, arg, summary(frame, cursor)));
          else if (receiver instanceof GeneratorValue) {
            if (["send", "throw", "close", "__iter__", "__next__"].includes(arg)) stack.push(allocate(ValueMethod, receiver, arg));
            else {
              if (frame.pool.code.version !== 5) hard("UNSUPPORTED", "UnsupportedOperationError", "Generator reflection requires classes-source/1");
              dispatch(attributeTask(receiver, arg, summary(frame, cursor)));
            }
          } else if (receiver instanceof ExceptionValue && arg === "value" && receiver.name === "StopIteration") stack.push(receiver.args[0] ?? null);
          else if (values.isComplex(receiver)) stack.push(values.complexAttribute(receiver, arg));
          else if (values.isRange(receiver)) stack.push(values.rangeAttribute(receiver, arg));
          else if (values.isSet(receiver)) { values.setMethod(receiver, arg); stack.push(allocate(ValueMethod, receiver, arg)); }
          else if (values.isView(receiver)) stack.push(values.viewMethod(arg) ? allocate(ValueMethod, receiver, arg) : values.viewAttribute(receiver, arg));
          else if (values.isBinary(receiver)) { values.binaryMethod(receiver, arg); stack.push(allocate(ValueMethod, receiver, arg)); }
          else if (arg === "encode" && values.isString(receiver)) stack.push(allocate(ValueMethod, receiver, arg));
          else if (op === "attribute-get" && values.isSlice(receiver)) stack.push(values.sliceAttribute(receiver, arg));
          else if (op === "attribute-get" && (receiver instanceof FrameValue || receiver instanceof FrameLocalsValue || receiver instanceof Cell || receiver instanceof CodeValue || receiver instanceof BuiltinValue || receiver instanceof SuperValue || receiver instanceof ClassValue || receiver instanceof ClassNamespaceValue || receiver instanceof DictionaryViewValue || receiver instanceof InstanceValue || receiver instanceof BoundMethodValue || receiver instanceof FunctionValue || receiver instanceof PropertyValue || receiver instanceof MethodWrapperValue)) {
            if (arg === "__get__" && frame.pool.code.version !== 5 &&
                (receiver instanceof FunctionValue || classes.nativeDescriptorKind(receiver) !== null))
              hard("UNSUPPORTED", "UnsupportedOperationError", "Explicit descriptor binding requires the class profile.");
            const plan = classes.read(receiver, arg);
            if (plan.kind === "value") stack.push(plan.value);
            else { state.temporaries.push(plan.callable, ...plan.args); call(plan.callable, plan.args, [], [], summary(frame, cursor)); }
          } else if (["module-get", "attribute-get"].includes(op) && CONTAINER_METHOD_NAMES.has(arg) && CONTAINER_METHODS[values.typeName(receiver)]?.includes(arg)) stack.push(allocate(ValueMethod, receiver, arg));
          else if (["module-get", "attribute-get"].includes(op) && arg === "append" && values.isList(receiver)) stack.push(allocate(AppendValue, receiver));
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
      } else if (op === "display") {
        const value = stack.pop();
        if (value !== null) dispatch(unaryTask("repr", value, summary(frame, cursor), continuation("single-display", {after: continuation("name-stored")})));
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
        if (op === "build-dict" && frame.pool.code.version === 5 && items.some((item, index) => index % 2 === 0 && values.needsOwnedHash(item)))
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
        if (receiver instanceof FrameLocalsValue || userProtocol(receiver) || userProtocol(key) || values.isSlice(key) || (values.isBinary(receiver) || values.isView(receiver)) && userProtocol(item) ||
            frame.pool.code.version === 5 && values.dictionaryNeedsProtocol(receiver, key))
          dispatch(itemTask(receiver, key, summary(frame, cursor), null, 0, "set", item));
        else stack.push(values.set(receiver, key, item));
      } else if (op === "dict-delete" && (stack.at(-2) instanceof FrameLocalsValue || userProtocol(stack.at(-2)) || userProtocol(stack.at(-1)) || values.isSlice(stack.at(-1)) ||
          frame.pool.code.version === 5 && values.dictionaryNeedsProtocol(stack.at(-2), stack.at(-1)))) {
        const key = stack.pop(); dispatch(itemTask(stack.pop(), key, summary(frame, cursor), null, 0, "delete"));
      }
      else if (op === "slice") {
        const step = stack.pop(), stop = stack.pop(), start = stack.pop(), receiver = stack.pop();
        if (receiver instanceof FrameLocalsValue || [receiver, start, stop, step].some(value => userProtocol(value)))
          dispatch(sliceTask(receiver, [start, stop, step], summary(frame, cursor)));
        else stack.push(values.slice(receiver, start, stop, step));
      } else if (op === "getitem" && (stack.at(-2) instanceof FrameLocalsValue || stack.at(-2) instanceof ClassNamespaceValue || userProtocol(stack.at(-2)) || userProtocol(stack.at(-1)) || values.isSlice(stack.at(-1)) ||
          frame.pool.code.version === 5 && values.dictionaryNeedsProtocol(stack.at(-2), stack.at(-1)))) {
        const key = stack.pop(); dispatch(itemTask(stack.pop(), key, summary(frame, cursor)));
      }
      else if (["truth", "not", "len", "negative", "positive", "invert", "iter", "next"].includes(op))
        dispatch(unaryTask(op, stack.pop(), summary(frame, cursor)));
      else if (op === "contains" && (frame.pool.code.version === 5 || stack.at(-1) instanceof GeneratorValue || stack.at(-1) instanceof DictionaryViewValue) &&
          (stack.at(-1) instanceof FrameLocalsValue || stack.at(-1) instanceof DictionaryViewValue || stack.at(-1) instanceof ClassNamespaceValue || stack.at(-1) instanceof GeneratorValue || userProtocol(stack.at(-1)) || stack.at(-1) instanceof IteratorValue || stack.at(-1) instanceof ProtocolIteratorValue ||
           values.hasUserEquality(stack.at(-1)) || values.hasUserEquality(stack.at(-2)) ||
           values.dictionaryNeedsProtocol(stack.at(-1), stack.at(-2)))) {
        const receiver = stack.pop(); dispatch(containsTask(receiver, stack.pop(), summary(frame, cursor)));
      }
      else if (frame.pool.code.version === 5 &&
          (["equal", "not-equal"].includes(op) && (values.hasUserEquality(stack.at(-2)) || values.hasUserEquality(stack.at(-1))) ||
           Object.hasOwn(ORDERING_SLOTS, op) && (values.hasUserEquality(stack.at(-2)) || values.hasUserEquality(stack.at(-1))))) {
        const right = stack.pop(); dispatch(compareTask(op, stack.pop(), right, summary(frame, cursor)));
      }
      else if (Object.hasOwn(ARITHMETIC_SLOTS, op.startsWith("inplace-") ? op.slice(8) : op) &&
          (stack.at(-2) instanceof FrameLocalsValue || stack.at(-1) instanceof FrameLocalsValue || stack.at(-2) instanceof ClassNamespaceValue || stack.at(-1) instanceof ClassNamespaceValue || userProtocol(stack.at(-2)) || userProtocol(stack.at(-1)))) {
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
    for (const transaction of [...state.transactions].reverse()) transaction.rollback();
    state.transactions.length = 0;
    while (state.frames.length) {
      const frame = state.frames.pop(); frame.active = false;
      if (frame.generator) { const generator = frame.generator; if (frame.reflector) frame.reflector.back = null; generator.status = "closed"; generator.frame = null; generator.reflector = null; generator.callable = null; generator.closure = null; generator.bindings.clear(); }
      frame.tasks.length = 0; frame.leave();
    }
    for (const release of state.outputLeases) release(false);
    state.outputLeases.length = 0;
    state.rootLeave?.(); state.rootLeave = null;
    state.pool = null; state.globals = null; state.temporaries = []; state.builtins.clear(); state.pendingImport = null; state.importCompletion = null; state.importSite = null;
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
    resume: value => {
      if (state.importCompletion === null) { state.frames.at(-1).tasks.at(-1).stack.push(value); return; }
      const after = state.importCompletion, site = state.importSite;
      state.temporaries.push(value, ...completionRoots(after)); state.importCompletion = null; state.importSite = null;
      try { dispatch(deliver(value, after, site)); } catch (error) { handle(error); }
    },
    resumeError: (error, lease = null) => {
      state.importCompletion = null; state.importSite = null;
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
      } else {
        this.#machine.memory.collect([], {cleanup: true, validateOnly: true});
        this.#state = "paused";
      }
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
