import {verifyFunctions} from "./function-bytecode.mjs";
import {Cell, Environment, CodePool, ModuleValue, FunctionValue, BuiltinValue, AppendValue, ExceptionValue, EXCEPTIONS, matchesException, ClassValue, InstanceValue, BoundMethodValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue} from "./function-objects.mjs";
import {ClassRuntime} from "./class-values.mjs";
import {ValueRuntime, valueLayout} from "./values.mjs";
import {MemoryArena} from "./memory.mjs";
import {ExecutionError} from "./vm.mjs";
import {isModuleContext} from "./module-context.mjs";
import {RegistryError} from "./module-registry.mjs";

class Raised { constructor(value) { this.value = value; } }
const exceptionLeases = new WeakMap();
export function releaseException(error) {
  const record = exceptionLeases.get(error);
  if (record) { exceptionLeases.delete(error); record.lease.release(false); }
}
const builtinNames = new Set(["print", "str", "len", ...Object.keys(EXCEPTIONS)]);
const summary = (frame, cursor) => Object.freeze({function: frame.fn.name,
  location: cursor.block.source ? Object.freeze({filename: cursor.block.source.filename,
    span: cursor.block.source.spans[Math.max(0, cursor.pc - 1)]}) : null});

export function execute(program, {maxSteps = 10_000, maxWork = 1_000_000, maxDepth = 48,
  shouldCancel = null, memoryLimits = {}, arena = null, retainResult = false, onOutput = () => {},
  moduleContext = null, module = null, inheritedException = null} = {}) {
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
  const frames = [], outputLeases = [], builtins = new Map();
  const execution = {};
  let pool = null, globals = null, temporaries = [], steps = 0, work = 0, outputLength = 0, current = null, result = null;
  const hard = (code, name, message) => {
    const error = new ExecutionError(code, name, message, current?.instruction ?? null, null);
    error.location = current?.location || null;
    throw error;
  };
  const charge = amount => {
    if (moduleContext) { moduleContext.charge(amount, hard); return; }
    if ((work += amount) > maxWork) hard("BUDGET", "ExecutionLimitError", "Value work budget exceeded.");
    if (shouldCancel?.()) hard("CANCELLED", "ExecutionCancelled", "Execution cancelled.");
  };
  const rootLeave = memory.enter(() => [pool, globals, inheritedException, ...builtins.values(), ...temporaries], {charge, fail: hard});
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
    const active = frames.at(-1)?.activeException;
    mutate(error, () => {
      error.context = active && active !== error ? active : null;
      if (current) error.traceback.push(Object.freeze({function: current.function, location: current.location}));
      return () => { error.context = null; error.traceback = []; };
    });
    return error;
  };
  const python = (name, message) => { throw new Raised(exception(name, message)); };
  const values = new ValueRuntime({memory, charge, fail: (name, message, code = "PYTHON") => {
    if (["PYTHON", "ZERO_DIVISION"].includes(code)) python(name, message);
    hard(code, name, message);
  }});
  const classes = new ClassRuntime({memory, charge, values, fail: values.fail});
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
    const local = frame.locals.get(key), classBody = frame.fn.kind === "class";
    const cell = local?.bound ? local : classBody && local ? frame.callable.globals.cells.get(key) :
      local || frame.closure.get(key) || frame.callable.globals.cells.get(key);
    if (cell?.bound) return cell.value;
    if (local && !classBody && frame.callable.index !== 0) python("UnboundLocalError", "cannot access local variable '" + key + "' where it is not associated with a value");
    if (frame.closure.has(key) && !(classBody && local)) python("NameError", "cannot access free variable '" + key + "' where it is not associated with a value in enclosing scope");
    if (frame.callable.pool.code.version === 5 && key === "object") return objectType();
    if (builtinNames.has(key) || (moduleContext && ["isinstance", "bool", "iter", "next"].includes(key)) ||
        (frame.callable.pool.code.version === 5 && ["type", "issubclass", "property", "staticmethod", "classmethod", "callable"].includes(key))) {
      if (moduleContext) return moduleContext.builtin(key, () => allocate(BuiltinValue, key));
      if (!builtins.has(key)) builtins.set(key, allocate(BuiltinValue, key));
      return builtins.get(key);
    }
    python("NameError", "name '" + key + "' is not defined");
  };
  const store = (frame, key, value, bound = true) => {
    setCell(frame.locals.get(key), value, bound);
    if (frame.namespaceOrder) { if (bound) frame.namespaceOrder.add(key); else frame.namespaceOrder.delete(key); }
  };
  const bind = (callable, positional, keywordNames, keywordValues) => {
    const fn = callable.pool.code.functions[callable.index], constants = callable.pool.code.constants;
    const p = fn.params, ordered = [...p.posonly, ...p.positional], bindings = new Map();
    const label = fn.qualname + "()";
    positional.slice(0, ordered.length).forEach((value, index) => bindings.set(ordered[index], value));
    const positionalOnly = keywordNames.filter(key => p.posonly.includes(key));
    keywordNames.forEach((key, index) => {
      if (positionalOnly.length) python("TypeError", label + " got some positional-only arguments passed as keyword arguments: '" + positionalOnly.join(", ") + "'");
      if (!p.positional.includes(key) && !p.kwonly.includes(key)) python("TypeError", label + " got an unexpected keyword argument '" + key + "'");
      if (bindings.has(key)) python("TypeError", label + " got multiple values for argument '" + key + "'");
      bindings.set(key, keywordValues[index]);
    });
    if (positional.length > ordered.length) {
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
      if (!bindings.has(key) && defaultIndex >= 0) bindings.set(key, constants[p.defaults[defaultIndex]]);
    }
    missing(ordered.filter(key => !bindings.has(key)), "positional");
    for (const key of p.kwonly) {
      if (!bindings.has(key) && Object.hasOwn(p.kwdefaults, key)) bindings.set(key, constants[p.kwdefaults[key]]);
    }
    missing(p.kwonly.filter(key => !bindings.has(key)), "keyword-only");
    return bindings;
  };
  const enter = (callable, bindings, callsite = null, completion = null) => {
    if (frames.length >= Math.min(maxDepth, memory.limits.maxFrames - 1) || memory.stats().frames >= memory.limits.maxFrames) python("RecursionError", "maximum recursion depth exceeded");
    const fn = callable.pool.code.functions[callable.index];
    const frame = {fn, callable, closure: callable.closure, locals: callable.index === 0 ? callable.globals.cells : new Map(),
      tasks: [], activeException: frames.at(-1)?.activeException || inheritedException, callsite,
      completion, namespaceOrder: fn.kind === "class" ? new Set() : null, returnInstruction: current?.instruction ?? null};
    frame.leave = memory.enter(() => [callable, ...frame.locals.values(), ...(frame.activeException ? [frame.activeException] : []),
      ...frame.tasks.flatMap(task => task.type === "block" ? task.stack :
        [task.iterator ?? null, task.pending?.value ?? null, task.caught ?? null, task.previous ?? null]),
      ...(completion?.bases || []), ...(completion?.instance ? [completion.instance] : []), ...(completion?.roots || [])], {charge, fail: hard});
    frames.push(frame);
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
  const display = value => {
    if (value === null) return "None";
    if (typeof value === "boolean") return value ? "True" : "False";
    if (typeof value === "bigint") return value.toString();
    if (value instanceof ExceptionValue) return value.message;
    const text = values.text(value);
    if (text !== null) return text;
    hard("UNSUPPORTED", "UnsupportedOperationError", "Formatting this value is outside the function stage.");
  };
  const builtin = (callable, args, keywords) => {
    if (keywords.length) python("TypeError", callable.name + "() does not accept keywords in this profile");
    if (callable.name === "callable") {
      if (args.length !== 1) python("TypeError", "callable() requires one positional argument.");
      return classes.callable(args[0]);
    }
    if (callable instanceof AppendValue) {
      if (args.length !== 1) python("TypeError", "append() requires one argument in this profile");
      return values.binary("append", callable.receiver, args[0]);
    }
    if (moduleContext && ["bool", "iter", "next"].includes(callable.name)) {
      if (callable.name === "bool" && args.length === 0) return false;
      if (args.length !== 1) hard("UNSUPPORTED", "UnsupportedOperationError", "This builtin call form is outside the source profile.");
      return values.unary({bool: "truth", iter: "iter", next: "next"}[callable.name], args[0]);
    }
    if (Object.hasOwn(EXCEPTIONS, callable.name)) {
      if (args.length > 1) hard("UNSUPPORTED", "UnsupportedOperationError", "Multiple exception arguments require the later repr profile.");
      return allocate(ExceptionValue, callable.name, args, args.length ? display(args[0]) : "");
    }
    if (callable.name === "print") {
      const text = args.map(display).join(" ") + "\n";
      if (moduleContext) { moduleContext.write(text, hard); return null; }
      if ((outputLength += text.length) > 65536) hard("BUDGET", "ExecutionLimitError", "Output budget exceeded.");
      outputLeases.push(memory.external(32 + 2 * text.length)); onOutput(text); return null;
    }
    if (moduleContext && callable.name === "isinstance") {
      if (args.length !== 2) python("TypeError", "isinstance expected 2 arguments, got " + args.length);
      const type = args[1];
      if (type instanceof ClassValue) return classes.isinstance(args[0], type);
      if (type instanceof BuiltinValue && type.name === "str") return values.isString(args[0]);
      if (type instanceof BuiltinValue && Object.hasOwn(EXCEPTIONS, type.name)) return args[0] instanceof ExceptionValue && matchesException(args[0].name, type.name);
      hard("UNSUPPORTED", "UnsupportedOperationError", "isinstance supports str and the adopted exception classes in this profile.");
    }
    if (callable.name === "issubclass") {
      if (args.length !== 2) python("TypeError", "issubclass requires two arguments.");
      return classes.subclass(args[0], args[1]);
    }
    if (callable.name === "type") {
      if (args.length !== 1 || !(args[0] instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "type supports one user instance in C1.");
      return args[0].type;
    }
    if (args.length !== 1) python("TypeError", callable.name + "() requires one argument in this profile");
    return callable.name === "len" ? values.unary("len", args[0]) : values.string(Array.from(display(args[0]), char => char.codePointAt(0)));
  };
  const callTask = (callable, args, keywords, keywordValues, site, completion = null, depth = 0) =>
    ({callable, args, keywords, keywordValues, site, completion, depth});
  const deliver = (value, completion, site) => {
    while (["init", "relay"].includes(completion?.kind)) {
      if (completion.kind === "init") {
        if (value !== null) python("TypeError", "__init__() should return None");
        value = completion.instance;
      }
      completion = completion.after;
    }
    if (completion?.kind === "invoke") return callTask(value, completion.args, completion.keywords,
      completion.keywordValues, site, completion.after, completion.depth);
    if (completion?.kind === "notify") return notifyNext(completion.type, completion.entries, completion.index, site);
    frames.at(-1).tasks.at(-1).stack.push(completion?.kind === "discard" ? null : value);
    return null;
  };
  const notifyNext = (type, entries, index, site) => {
    temporaries.push(type, ...entries.map(entry => entry[1]));
    while (index < entries.length) {
      charge(1);
      const [name, value] = entries[index++];
      // Keep the name rooted while planning a bound callback can allocate.
      const nameValue = values.string(Array.from(name, char => char.codePointAt(0))); temporaries.push(nameValue);
      const plan = classes.notification(value, type, nameValue);
      if (!plan) continue;
      return callTask(plan.callable, plan.args, [], [], site,
        {kind: "notify", type, entries, index, roots: [type, ...entries.map(entry => entry[1])]});
    }
    return deliver(type, null, site);
  };
  const dispatch = task => {
    while (task) {
      let {callable, args, keywords, keywordValues, site, completion, depth} = task;
      temporaries.push(callable, ...args, ...keywordValues, ...(completion?.roots || []));
      if (callable instanceof BoundMethodValue || callable instanceof MethodWrapperValue && callable.kind === "staticmethod" || callable instanceof InstanceValue) {
        charge(1);
        if (++depth > maxDepth) python("RecursionError", "maximum call dispatch depth exceeded");
        if (callable instanceof InstanceValue) {
          const plan = classes.special(callable, "__call__");
          if (!plan) python("TypeError", "Instance has no callable type slot");
          completion = {kind: "relay", after: completion, roots: [callable, ...(completion?.roots || [])]};
          if (plan.kind === "value") task = callTask(plan.value, args, keywords, keywordValues, site, completion, depth);
          else task = callTask(plan.callable, plan.args, [], [], site, {kind: "invoke", args, keywords, keywordValues,
            after: completion, depth, roots: [...args, ...keywordValues, ...completion.roots]}, depth);
        } else {
          if (callable instanceof BoundMethodValue) args = [callable.receiver, ...args];
          task = callTask(callable.callable, args, keywords, keywordValues, site, completion, depth);
        }
        continue;
      }
      if (callable instanceof PropertyAccessorValue) {
        if (args.length !== 1 || keywords.length) python("TypeError", "Property accessor copy requires one positional value.");
        const fields = [callable.property.fget, callable.property.fset, callable.property.fdel];
        fields[{getter: 0, setter: 1, deleter: 2}[callable.name]] = args[0];
        task = deliver(allocate(PropertyValue, ...fields), completion, site); continue;
      }
      if (callable instanceof ClassValue) {
        const instance = classes.instance(callable); temporaries.push(instance);
        const initializer = classes.lookup(callable, "__init__");
        if (!initializer.found) {
          if (args.length || keywords.length) python("TypeError", callable.name + "() takes no arguments");
          task = deliver(instance, completion, site); continue;
        }
        const method = classes.get(instance, "__init__");
        task = callTask(method, args, keywords, keywordValues, site,
          {kind: "init", instance, after: completion, roots: [instance, ...(completion?.roots || [])]}, depth); continue;
      }
      if (callable instanceof FunctionValue) { enter(callable, bind(callable, args, keywords, keywordValues), site, completion); return; }
      if (callable instanceof BuiltinValue) {
        let value;
        if (callable.name === "property") value = classes.property(args, keywords, keywordValues);
        else if (["staticmethod", "classmethod"].includes(callable.name)) {
          if (args.length !== 1 || keywords.length) python("TypeError", callable.name + " requires one positional value.");
          value = allocate(MethodWrapperValue, callable.name, args[0]);
        } else value = builtin(callable, [...args, ...keywordValues], keywords);
        task = deliver(value, completion, site); continue;
      }
      python("TypeError", "Value is not callable in this profile");
    }
  };
  const call = (callable, args, keywords, keywordValues, site, completion = null) =>
    dispatch(callTask(callable, args, keywords, keywordValues, site, completion));
  const unhandled = value => {
    const error = new ExecutionError("PYTHON", value.name, value.message, current?.instruction ?? null, null);
    // Copy diagnostics without exporting unleased VM objects or frame locals.
    error.traceback = value.traceback.map(frame => ({function: frame.function, location: frame.location}));
    error.location = error.traceback.at(-1)?.location || null;
    error.context = value.context ? {type: value.context.name, message: value.context.message} : null;
    if (moduleContext) exceptionLeases.set(error, {lease: memory.pin([value]), owner: execution});
    throw error;
  };
  const settle = signal => {
    while (frames.length) {
      const frame = frames.at(-1);
      if (frame.tasks.at(-1)?.type === "block") frame.tasks.pop();
      while (frame.tasks.length) {
        const task = frame.tasks.at(-1);
        if (task.type === "block") {
          if (signal.kind === "normal") return;
          frame.tasks.pop(); continue;
        }
        if (task.type === "while" || task.type === "for") {
          if (signal.kind === "break") { frame.tasks.pop(); signal = {kind: "normal"}; continue; }
          if (!["normal", "continue"].includes(signal.kind)) { frame.tasks.pop(); continue; }
          if (task.type === "while") {
            if (task.phase === "test" && signal.kind === "normal") {
              if (!values.truth(signal.value)) { frame.tasks.pop(); block(frame, task.otherwise); return; }
              task.phase = "body"; block(frame, task.body); return;
            }
            task.phase = "test"; block(frame, task.test); return;
          }
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
            task.phase = "matching"; task.caught = signal.value; frame.activeException = signal.value;
            const clause = handlers.find(([types, , , span]) => {
              current = {...current, location: task.site ? {filename: task.site.filename, span} : null};
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
            frame.activeException = task.previous;
          }
          if (task.phase === "finally") {
            if (signal.kind === "normal") signal = task.pending;
            frame.activeException = task.previous; frame.tasks.pop(); continue;
          }
          if (final !== null) {
            task.pending = signal; task.phase = "finally";
            frame.activeException = signal.kind === "raise" ? signal.value : task.previous;
            block(frame, final); return;
          }
          frame.activeException = task.previous; frame.tasks.pop(); continue;
        }
        hard("BYTECODE", "BytecodeError", "Unknown control record.");
      }
      if (["break", "continue"].includes(signal.kind)) hard("BYTECODE", "BytecodeError", "Loop control outside a loop.");
      const returned = signal.kind === "normal" ? null : signal.value;
      temporaries = [returned, frame.callable];
      const parent = frames.at(-2);
      if (!parent) {
        if (signal.kind === "raise") unhandled(returned);
        result = retainResult ? memory.pin([returned]) : returned;
        frame.leave(); frames.pop(); return;
      }
      if (signal.kind === "raise") {
        addTrace(returned, frame.callsite);
        frame.leave(); frames.pop();
        continue;
      }
      if (frame.completion?.kind === "class") {
        const namespace = new Map([...frame.namespaceOrder].filter(key => frame.locals.get(key).bound && !key.startsWith("@source:"))
          .map(key => [key, frame.locals.get(key).value]));
        const completion = frame.completion;
        temporaries.push(...namespace.values(), ...completion.bases);
        current = {...frame.callsite, instruction: frame.returnInstruction};
        frame.leave(); frames.pop();
        const type = classes.create(frame.fn.name, frame.fn.qualname, completion.module, completion.bases, namespace, objectType());
        dispatch(notifyNext(type, [...namespace], 0, frame.callsite)); return;
      }
      const completion = frame.completion;
      temporaries.push(...(completion?.roots || []));
      current = {...frame.callsite, instruction: frame.returnInstruction};
      frame.leave(); frames.pop(); dispatch(deliver(returned, completion, frame.callsite)); return;
    }
  };
  try {
    pool = allocate(CodePool, verified.code, verified.bytes, module);
    globals = module ? module.environment : allocate(Environment);
    if (module) mutate(module, () => { const before = module.pool; module.pool = pool; return () => { module.pool = before; }; });
    const entry = allocate(FunctionValue, pool, 0, globals, new Map());
    temporaries = [entry]; enter(entry, new Map());
    while (frames.length) {
      if (moduleContext) moduleContext.tick(hard);
      else if (++steps > maxSteps) hard("BUDGET", "ExecutionLimitError", "Instruction budget exceeded.");
      charge(1); temporaries = []; memory.collect();
      const frame = frames.at(-1), cursor = frame.tasks.at(-1), stack = cursor.stack;
      current = {...summary(frame, cursor), instruction: cursor.pc};
      const [op, arg, extra, fourth, fifth] = cursor.block.instructions[cursor.pc++];
      current = {...summary(frame, cursor), instruction: cursor.pc - 1};
      temporaries = stack.slice();
      try {
        if (op === "const") stack.push(frame.callable.pool.code.constants[arg]);
        else if (op === "load") stack.push(load(frame, arg));
        else if (op === "store") store(frame, arg, stack.pop());
        else if (op === "delete") {
          if (!frame.locals.get(arg).bound) {
            if (frame.callable.index === 0) python("NameError", "name '" + arg + "' is not defined");
            python("UnboundLocalError", "cannot access local variable '" + arg + "' where it is not associated with a value");
          }
          store(frame, arg, null, false);
        }
        else if (op === "function" || op === "class") {
          const owner = frame.callable.pool;
          const closure = new Map(owner.code.functions[arg].free.map(key => [key,
            frame.fn.kind === "class" ? frame.closure.get(key) : frame.locals.get(key) || frame.closure.get(key)]));
          const callable = allocate(FunctionValue, owner, arg, frame.callable.globals, closure);
          if (op === "function") stack.push(callable);
          else {
            const bases = stack.splice(stack.length - extra), name = values.text(frame.callable.globals.cells.get("__name__")?.value);
            temporaries.push(callable);
            if (name === null) hard("UNSUPPORTED", "UnsupportedOperationError", "Class module metadata requires text in C1.");
            enter(callable, new Map(), summary(frame, cursor), {kind: "class", bases, module: name});
            store(frames.at(-1), "__module__", values.string(Array.from(name, char => char.codePointAt(0))));
            store(frames.at(-1), "__qualname__", values.string(Array.from(owner.code.functions[arg].qualname, char => char.codePointAt(0))));
          }
        } else if (op === "call") {
          const kwargs = stack.splice(stack.length - extra.length), args = stack.splice(stack.length - arg), callable = stack.pop();
          call(callable, args, extra, kwargs, summary(frame, cursor));
        } else if (["attribute-set", "attribute-delete"].includes(op)) {
          const value = op === "attribute-set" ? stack.pop() : null;
          const plan = classes.write(stack.pop(), arg, value, op === "attribute-delete");
          if (plan.kind === "value") stack.push(plan.value);
          else { temporaries.push(plan.callable, ...plan.args); call(plan.callable, plan.args, [], [], summary(frame, cursor), {kind: "discard"}); }
        } else if (["import", "module-get", "import-from", "attribute-get"].includes(op)) {
          const owner = frame.callable.pool.module;
          if (!owner || !moduleContext) hard("BYTECODE", "BytecodeError", "Module opcode has no verified registry owner.");
          const invoke = (target, unit) => execute(unit, {...moduleContext.options, arena: memory, moduleContext, module: target,
            inheritedException: frame.activeException});
          if (op === "import") stack.push(moduleContext.load(owner.name, arg, extra, fourth, invoke));
          else {
            const receiver = stack.pop();
            if (op === "attribute-get" && (receiver instanceof ClassValue || receiver instanceof InstanceValue || receiver instanceof BoundMethodValue || receiver instanceof FunctionValue || receiver instanceof PropertyValue || receiver instanceof MethodWrapperValue)) {
              const plan = classes.read(receiver, arg);
              if (plan.kind === "value") stack.push(plan.value);
              else { temporaries.push(plan.callable, ...plan.args); call(plan.callable, plan.args, [], [], summary(frame, cursor)); }
            } else stack.push(["module-get", "attribute-get"].includes(op) && arg === "append" && values.isList(receiver) ? allocate(AppendValue, receiver) :
              moduleContext.attribute(receiver, arg, op === "import-from", owner.name, invoke));
          }
        } else if (op === "if") block(frame, values.truth(stack.pop()) ? arg : extra);
        else if (op === "while") { frame.tasks.push({type: "while", phase: "test", test: arg, body: extra, otherwise: fourth}); block(frame, arg); }
        else if (op === "for") { frame.tasks.push({type: "for", phase: "iterable", target: arg, body: fourth, otherwise: fifth, iterator: null}); block(frame, extra); }
        else if (op === "try") {
          frame.tasks.push({type: "try", phase: "body", instruction: cursor.block.instructions[cursor.pc - 1], previous: frame.activeException,
            caught: null, pending: null, alias: null, site: current.location}); block(frame, arg);
        } else if (["end", "return", "break", "continue"].includes(op)) {
          settle({kind: op === "end" ? "normal" : op, value: op === "return" || cursor.block.kind === "expression" ? stack.pop() : null});
        } else if (op === "raise" || op === "reraise") {
          let value = op === "raise" ? stack.pop() : frame.activeException;
          if (!value) python("RuntimeError", "No active exception to reraise");
          if (value instanceof BuiltinValue && Object.hasOwn(EXCEPTIONS, value.name)) value = allocate(ExceptionValue, value.name, [], "");
          if (!(value instanceof ExceptionValue)) python("TypeError", "exceptions must derive from BaseException");
          if (op === "raise") {
            addTrace(value, {function: current.function, location: current.location});
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
        else if (op === "jump-if-false") { if (!values.truth(stack.pop())) cursor.pc = arg; }
        else if (["build-list", "build-tuple", "build-dict"].includes(op)) {
          const items = stack.splice(stack.length - arg * (op === "build-dict" ? 2 : 1));
          stack.push(op === "build-dict" ? values.dict(Array.from({length: arg}, (_, index) => items.slice(index * 2, index * 2 + 2))) :
            op === "build-list" ? values.list(items) : values.tuple(items));
        } else if (op === "setitem") { const item = stack.pop(), key = stack.pop(); stack.push(values.set(stack.pop(), key, item)); }
        else if (op === "slice") { const step = stack.pop(), stop = stack.pop(), start = stack.pop(); stack.push(values.slice(stack.pop(), start, stop, step)); }
        else if (["truth", "not", "len", "negative", "positive", "iter", "next"].includes(op)) stack.push(values.unary(op, stack.pop()));
        else { const right = stack.pop(), left = stack.pop(); stack.push(op.startsWith("inplace-") ? values.inplace(op.slice(8), left, right) : values.binary(op, left, right)); }
      } catch (error) {
        const forwarded = exceptionLeases.get(error);
        if (forwarded && forwarded.owner !== execution) {
          const value = forwarded.lease.get()[0]; temporaries.push(value); releaseException(error);
          addTrace(value, {function: current.function, location: current.location}); error = new Raised(value);
        } else if (error instanceof RegistryError && error.code === "IMPORT") error = new Raised(exception(error.name, error.message));
        else if (error instanceof RegistryError && error.code === "UNSUPPORTED") hard(error.code, error.name, error.message);
        if (!(error instanceof Raised)) throw error;
        // Handler matching or iterator setup can itself raise while unwinding.
        let pending = error;
        while (true) {
          try { temporaries.push(pending.value); settle({kind: "raise", value: pending.value}); break; }
          catch (next) { if (!(next instanceof Raised)) throw next; pending = next; }
        }
      }
    }
    return result;
  } finally {
    while (frames.length) frames.pop().leave();
    for (const release of outputLeases) release(false);
    rootLeave();
    if (arena === null) memory.close();
  }
}
