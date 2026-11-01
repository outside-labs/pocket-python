import {dynamicImporter} from "./dynamic-imports.mjs";
import {dynamicEvaluator} from "./dynamic-evaluation.mjs";
import {dynamicCompiler} from "./dynamic-source.mjs";
import {NATIVE_SUBCLASS_BASES, CONTAINER_METHODS, CONTAINER_METHOD_NAMES} from "./class-values.mjs";
import {ARITHMETIC_SLOTS, ORDERING_SLOTS, CLASS_PROTOCOL_NAMES, NATIVE_PROTOCOL_KEYS, allowsClassSpecial} from "./class-policy.mjs";
import {VALUE_LIMITS, StringValue} from "./values.mjs";
import {RegistryError} from "./module-registry.mjs";
import {ModuleValue, FrameValue, FrameLocalsValue, Environment, SOURCE_BUILTINS, environmentCell, GeneratorValue, FunctionValue, CallArguments, Cell, CodeValue, SuperValue, BuiltinValue, AppendValue, ValueMethod, ExceptionValue, EXCEPTIONS, EXCEPTION_BASES, EXCEPTION_LAYOUTS, matchesException, isException, ClassValue, ClassNamespaceValue, DictionaryViewValue, NamespaceLookupCache, NamespaceLookupRequest, InstanceValue, BoundMethodValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue, ProtocolIteratorValue, NotImplementedValue} from "./function-objects.mjs";
import {completion as continuation, completionRoots, callTask, constructTask, unaryTask, valueTask, itemTask, attributeTask, instanceTask, subclassTask, sliceTask, containsTask, compareTask, dictionaryTask, dictionaryBuildTask, namespaceCreateTask, hierarchyTask, arithmeticTask, numericTask, consumeTask, operationRoots} from "./operations.mjs";

export class Raised { constructor(value) { this.value = value; } }

const NATIVE_COMPARISONS = Object.freeze({__eq__: "equal", __ne__: "not-equal",
  ...Object.fromEntries(Object.entries(ORDERING_SLOTS).map(([op, slots]) => [slots[0], op]))});
const NATIVE_ARITIES = Object.freeze({
  ...Object.fromEntries(["__eq__", "__ne__", "__lt__", "__le__", "__gt__", "__ge__", "__getattribute__", "__delattr__", "__getitem__", "__delitem__", "__contains__", "__delete__"].map(key => [key, [1, 1]])),
  ...Object.fromEntries(["__hash__", "__len__", "__bool__", "__iter__", "__next__", "__neg__", "__pos__", "__invert__", "__int__", "__float__", "__complex__", "__index__", "__abs__", "__bytes__", "__repr__", "__str__"].map(key => [key, [0, 0]])),
  ...Object.fromEntries(Object.values(ARITHMETIC_SLOTS).flatMap(stem => ["", "r", ...(stem === "divmod" ? [] : ["i"])].map(prefix => ["__" + prefix + stem + "__", stem === "pow" ? [1, 2] : [1, 1]]))),
  __get__: [1, 2], __set__: [2, 2], __setattr__: [2, 2], __setitem__: [2, 2],
  __round__: [0, 1], __dir__: [0, 0],
});

// Fixed phases of the existing machine. Python callbacks enter its ordinary
// frames; destinations use its block stack and single unwinder.
export function operationRuntime({state, memory, values, classes, moduleContext, maxDepth,
  allocate, mutate, python, nameError, addTrace, registryException, hard, charge, enter, bind, block, store, onOutput, setCell, load, loadName, builtinLookup, reflectFrame, generatorFrame, visibleFrame, classNamespace, classFallback, classModule, beginClass, enterClass, classQualification, classFirstline, classEnd, handlerType, raiseException, settle, resumeGenerator, yieldGenerator, delegateResult, injectGenerator}) {
  const compiler = dynamicCompiler({state, memory, values, classes, allocate, charge, python, hard});
  const evaluator = dynamicEvaluator({state, values, classes, allocate, enter, bind, loadName, classModule, compiler, python});
  const importer = dynamicImporter({state, moduleContext, values, classes, builtinLookup, python, hard});
  const userProtocol = value => classes.protocolObject(value);
  const exceptionDisplay = value => value instanceof ExceptionValue && (value.name === "KeyError" || value.nativeFields?.has("msg") || value.args.length > 1 ||
    value.args.length === 1 && !(value.args[0] === null || ["bigint", "boolean"].includes(typeof value.args[0]) || value.args[0] instanceof StringValue));
  const genericHash = value => value === null ? values.pythonHash(null) : typeof value === "boolean" || typeof value === "bigint" ? values.objectId(value) : values.identityHash(value);
  const methodCompare = (receiver, other, invert, site, after, depth) => {
    if (receiver.callable === other.callable) return valueTask(invert !== (receiver.receiver === other.receiver), site, after);
    return compareTask("equal", receiver.callable, other.callable, site,
      continuation("native-method-compare", {receiver, other, invert, depth, after}), depth);
  };
  const arithmeticOrder = (task, order, site) => arithmeticTask(task.operation, task.args, site, task.completion,
    task.depth, task.position, order, task.nativeInplace, task.active);
  classes.transactions = state.transactions;
  const resolveClassBases = (record, site) => {
    if (!record.originalBases && record.bases.every(base => classes.isType(base))) return beginClass(record, site);
    if (!record.originalBases) {
      const originalBases = values.tuple(record.bases); state.temporaries.push(originalBases);
      record = {...record, originalBases, resolved: [], position: 0, changed: false};
    }
    while (record.position < record.bases.length) {
      const base = record.bases[record.position];
      if (!classes.isType(base) && (base instanceof InstanceValue || base instanceof FunctionValue || base instanceof MethodWrapperValue ||
          base instanceof ModuleValue || base instanceof SuperValue || classes.isPythonMethod(base)))
        return attributeTask(base, "__mro_entries__", site, continuation("class-base-lookup", record));
      record = {...record, resolved: [...record.resolved, base], position: record.position + 1};
    }
    if (record.resolved.length > 16) hard("BUDGET", "ExecutionLimitError", "Class base budget exceeded.");
    return beginClass({...record, bases: record.resolved, originalBases: record.changed ? record.originalBases : null}, site);
  };
  const prepareClass = (record, rawModule, site) => {
    const meta = record.metaclass;
    const factory = meta instanceof InstanceValue || meta instanceof FunctionValue || meta instanceof MethodWrapperValue;
    if (!factory && (!(meta instanceof ClassValue) || !classes.hasSlot(meta, "__prepare__") && !["__getattribute__", "__getattr__"].some(name => classes.hasAttributeHook(meta, name))))
      return enterClass(record, rawModule, site);
    const nameValue = values.string(Array.from(record.callable.pool.code.functions[record.callable.index].name, char => char.codePointAt(0)));
    state.temporaries.push(nameValue);
    const basesTuple = values.tuple(record.bases); state.temporaries.push(basesTuple);
    return attributeTask(meta, "__prepare__", site, continuation("class-prepare-lookup", {...record, rawModule, nameValue, basesTuple}));
  };
  const preparedClass = (record, prepared, site) => {
    const type = classes.checkingType(prepared);
    if (!values.isDict(prepared) && !(type && classes.hasSlot(type, "__getitem__"))) python("TypeError", "__prepare__() must return a mapping");
    state.temporaries.push(prepared);
    return enterClass({...record, prepared}, record.rawModule, site);
  };
  const count = tag => { state.transitions[tag] = (state.transitions[tag] || 0) + 1; };
  const display = value => {
    if (value instanceof NotImplementedValue) return "NotImplemented";
    if (value === null) return "None";
    if (typeof value === "boolean") return value ? "True" : "False";
    if (typeof value === "bigint") return value.toString();
    if (value instanceof ExceptionValue) return value.message;
    if (values.isBinary(value)) return values.text(values.repr(value));
    const text = values.text(value);
    if (text !== null) return text;
    hard("UNSUPPORTED", "UnsupportedOperationError", "Formatting this value is outside the function stage.");
  };
  const makeException = (name, args, type = null, newOnly = false) => {
    const scalar = args.length === 1 && (args[0] === null || ["bigint", "boolean"].includes(typeof args[0]) || args[0] instanceof StringValue);
    const value = allocate(ExceptionValue, name, args, scalar ? display(args[0]) : "", type);
    if (newOnly && name === "StopIteration") {
      state.temporaries.push(value);
      mutate(value, () => { value.stopValue = null; return () => { delete value.stopValue; }; });
    }
    return value;
  };
  const initializeException = (receiver, args, keywords, keywordValues, owner) => {
    const importing = ["ImportError", "ModuleNotFoundError"].includes(owner);
    const fields = ["NameError", "UnboundLocalError"].includes(owner) ? ["name"] : owner === "AttributeError" ? ["name", "obj"] : importing ? ["name", "path", "name_from"] : null;
    if (!fields && keywords.length) python("TypeError", "Exception initialization does not accept keywords");
    mutate(receiver, () => {
      const before = [receiver.args, receiver.argsTuple, receiver.message, receiver.messageArgs, receiver.stopValue];
      const hadValue = Object.hasOwn(receiver, "stopValue");
      if (receiver.name === "StopIteration") receiver.stopValue = owner === "StopIteration" ? args[0] ?? null : classes.exceptionValue(receiver);
      receiver.args = args; receiver.argsTuple = undefined; receiver.messageArgs = false;
      const first = args[0]; receiver.message = args.length === 1 && (first === null || ["bigint", "boolean"].includes(typeof first) || first instanceof StringValue) ? display(first) : "";
      return () => { [receiver.args, receiver.argsTuple, receiver.message, receiver.messageArgs, receiver.stopValue] = before; if (!hadValue) delete receiver.stopValue; };
    });
    // Structured initializers replace args before validating keywords. On a
    // keyword error, their old native fields remain intact.
    if (fields) {
      if (keywords.some(key => !fields.includes(key))) python("TypeError", "Invalid " + owner + " keyword argument");
      mutate(receiver, () => {
        const before = new Map(receiver.nativeFields);
        const boundaries = receiver.nativeFieldBoundaries;
        const present = receiver.attributeFields;
        for (const key of fields) receiver.nativeFields.set(key, keywords.includes(key) ? keywordValues[keywords.indexOf(key)] : null);
        if (owner === "AttributeError") receiver.attributeFields = (keywords.includes("name") ? 1 : 0) | (keywords.includes("obj") ? 2 : 0);
        if (importing) receiver.nativeFields.set("msg", args.length === 1 ? args[0] : null);
        receiver.nativeFieldBoundaries = undefined;
        return () => { receiver.nativeFields = before; receiver.nativeFieldBoundaries = boundaries; receiver.attributeFields = present; };
      });
    }
    if (matchesException(owner, "SyntaxError") && args.length) mutate(receiver, () => {
      const before = receiver.nativeFields.get("msg");
      const boundary = receiver.nativeFieldBoundaries?.delete("msg");
      receiver.nativeFields.set("msg", args[0]);
      return () => { receiver.nativeFields.set("msg", before); if (boundary) receiver.nativeFieldBoundaries.add("msg"); };
    });
  };
  const syntaxDetails = (receiver, args, site, after, depth, result) => args.length === 2 ?
    consumeTask("syntax-details", args[1], site, continuation("syntax-details", {receiver, result, after}), depth) : valueTask(result, site, after);
  const syntaxMessage = (value, site, after, depth) => {
    if (value.nativeFieldBoundaries?.has("msg")) return exceptionString(value, site, after, depth);
    if (++depth > maxDepth) python("RecursionError", "maximum exception formatting depth exceeded");
    state.temporaries.push(value);
    const raw = classes.payload(value.nativeFields.get("filename")), line = value.nativeFields.get("lineno");
    let filename = null;
    if (raw instanceof StringValue) {
      charge(raw.points.length);
      filename = values.string(raw.points.slice(raw.points.lastIndexOf(47) + 1)); state.temporaries.push(filename);
    }
    const haveLine = typeof line === "bigint";
    if (filename === null && !haveLine) return unaryTask("str", value.nativeFields.get("msg"), site, after, depth);
    // The deterministic source profile uses POSIX separators and a signed
    // 64-bit C long. Native message callbacks run after these fields are read.
    const number = haveLine ? line < -(1n << 63n) || line > (1n << 63n) - 1n ? -1n : line : null;
    const text = " (" + (filename === null ? "" : values.text(filename)) +
      (haveLine ? (filename === null ? "" : ", ") + "line " + number.toString() : "") + ")";
    const suffix = values.string(Array.from(text, char => char.codePointAt(0))); state.temporaries.push(suffix);
    return unaryTask("str", value.nativeFields.get("msg"), site, continuation("syntax-message", {receiver: value, suffix, after}), depth);
  };
  const exceptionString = (value, site, after, depth, importMessage = false) => {
    if (++depth > maxDepth) python("RecursionError", "maximum exception formatting depth exceeded");
    if (importMessage && !value.nativeFieldBoundaries?.has("msg")) {
      const message = value.nativeFields.get("msg");
      if (message instanceof StringValue) return valueTask(message, site, after);
    }
    if (value.args.length > 1) hard("UNSUPPORTED", "UnsupportedOperationError", "Multiple exception argument displays remain under #127");
    return value.args.length ? unaryTask(value.name === "KeyError" ? "repr" : "str", value.args[0], site, after, depth) :
      valueTask(values.string(Array.from(value.message, char => char.codePointAt(0))), site, after);
  };
  const write = text => {
    if (moduleContext) { moduleContext.write(text, hard); return; }
    if ((state.outputLength += text.length) > 65536) hard("BUDGET", "ExecutionLimitError", "Output budget exceeded.");
    state.outputLeases.push(memory.external(32 + 2 * text.length)); onOutput(text);
  };
  const numericNames = new Set(["range","int","float","complex","abs","round","bin","oct","hex","chr","ord","pow","divmod"]);
  const optimizedBindings = () => {
    const inline = frame => ["<listcomp>", "<dictcomp>", "<setcomp>"].includes(frame.fn.name);
    let index = state.frames.length - 1;
    const overlays = [];
    while (index > 0 && inline(state.frames[index])) overlays.unshift(state.frames[index--]);
    // Module/class comprehensions have an isolated optimized namespace. Their
    // containing live mapping is never substituted with a snapshot.
    const frame = state.frames[index].fn.kind === "function" ? state.frames[index] : overlays.shift() || state.frames[index];
    if (frame.fn.kind !== "function")
      hard("UNSUPPORTED", "UnsupportedOperationError", "This scope requires its own live or comprehension namespace contract.");
    for (const block of frame.fn.blocks) for (const instruction of block.instructions) {
      charge(1);
    }
    const cells = new Map([...frame.locals, ...frame.closure]);
    const targetCells = new Set();
    // Each inlined group hides its nested target slots. A referenced free cell
    // is a different binding and survives until this loop binds the name.
    for (const overlay of overlays) for (const name of overlay.fn.namespace || overlay.fn.locals) {
      charge(name.length + 1);
      if (!name.startsWith("@source:")) {
        const local = overlay.locals.get(name);
        if (local) targetCells.add(local);
        cells.set(name, local || overlay.closure.get(name) || frame.closure.get(name));
      }
    }
    const iteratorName = frame.fn.name === "<genexpr>" ? frame.fn.params.posonly[0] : null;
    const cellNames = [...(frame.fn.namespaceCells || []), ...frame.closure.keys()];
    const ordered = (frame.fn.namespace || frame.fn.locals).filter(name => !cellNames.includes(name) || targetCells.has(cells.get(name)));
    return [...new Set([...ordered, ...cellNames])]
      .map(name => [name === iteratorName ? ".0" : name, cells.get(name)]).filter(([name, cell]) => {
      charge(name.length + 1); return cell?.bound && !name.startsWith("@source:");
    });
  };
  const moduleMissing = (record, site) => {
    if (record.mode === "import") {
      const frame = state.frames.at(-1);
      let result;
      try { result = moduleContext.planAttribute(record.receiver, record.name, true, frame.pool.module.name, record.skipNamespace); }
      catch (error) { if (error instanceof RegistryError && error.code === "IMPORT") throw new Raised(registryException(error)); throw error; }
      if (result.kind === "load") { state.pendingImport = {plan: result.plan, inheritedException: frame.activeException}; return null; }
      return valueTask(result.value, site, record.after);
    }
    python("AttributeError", "module has no attribute " + record.name);
  };
  const moduleHook = (record, site, found, hook) => {
    if (found) return callTask(hook, [record.key], [], [], site,
      continuation("module-missing", record), record.depth);
    if (record.name === "__dir__") return valueTask(allocate(ValueMethod, record.receiver, "module.__dir__"), site, record.after);
    return moduleMissing(record, site);
  };
  const moduleEntry = (record, site, found, value) => {
    if (found) return valueTask(value, site, record.after);
    if (record.name === "__class__") return valueTask(classes.typeOf(record.receiver), site, record.after);
    if (NATIVE_PROTOCOL_KEYS.includes(record.name)) {
      const entry = classes.nativeProtocolEntry(classes.builtin("module"), record.name);
      if (entry.found) return valueTask(classes.bindAttribute(entry.value, record.receiver, classes.typeOf(record.receiver)).value, site, record.after);
    }
    if (record.mode === "native-get") return moduleMissing(record, site);
    if (record.name === "__dir__") return valueTask(allocate(ValueMethod, record.receiver, "module.__dir__"), site, record.after);
    const environment = record.receiver.environment;
    if (environment.dictionary !== null) {
      const key = values.string(Array.from("__getattr__", char => char.codePointAt(0))); state.temporaries.push(key);
      return dictionaryTask(environment.dictionary, key, site, continuation("module-hook", record), record.depth, "probe");
    }
    const hook = environmentCell(environment, "__getattr__");
    return moduleHook(record, site, !!hook?.bound, hook?.value);
  };
  const moduleDirectory = (record, found, hook, site) => {
    if (found) return callTask(hook, [], [], [], site, record.after, record.depth);
    const environment = record.receiver.environment;
    const names = environment.dictionary !== null ? environment.dictionary.entries.map(entry => entry.key) :
      [...environment.order].filter(name => environment.cells.get(name)?.bound).map(name => values.string(Array.from(name, char => char.codePointAt(0))));
    state.temporaries.push(...names);
    return valueTask(values.list(names), site, record.after);
  };
  const nativeModuleDirectory = (receiver, site, after, depth) => {
    const environment = receiver.environment, record = {receiver, depth, after};
    if (environment.dictionary !== null) {
      const key = values.string(Array.from("__dir__", char => char.codePointAt(0))); state.temporaries.push(key);
      return dictionaryTask(environment.dictionary, key, site, continuation("module-native-dir", record), depth, "probe");
    }
    const hook = environmentCell(environment, "__dir__"); return moduleDirectory(record, !!hook?.bound, hook?.value, site);
  };
  const namespaceSnapshot = bindings => {
    const result = values.dict([]); state.temporaries.push(result);
    for (const [name, cell] of bindings) {
      const key = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(key);
      values.set(result, key, cell.value);
    }
    return result;
  };
  const sortedDirectory = result => {
    state.temporaries.push(result);
    for (const item of result.items) {
      charge(1);
      if (!values.isString(item)) hard("UNSUPPORTED", "UnsupportedOperationError", "Non-string directory entries require a separate ordering contract.");
    }
    const items = [...result.items];
    items.sort((left, right) => values.less(left, right) ? -1 : values.less(right, left) ? 1 : 0);
    return values.list(items);
  };
  const sequenceScan = (record, site) => {
    const receiver = classes.payload(record.receiver);
    while (record.position < receiver.items.length && BigInt(record.position) < record.stop) {
      charge(1);
      const candidate = receiver.items[record.position];
      if (candidate !== record.key) return compareTask("equal", candidate, record.key, site,
        continuation("sequence-scan-equal", {...record, candidate}), record.depth);
      if (record.name === "index") return valueTask(values.int(BigInt(record.position)), site, record.after);
      record = {...record, position: record.position + 1, count: record.count + 1};
    }
    if (record.name === "index") python("ValueError", "Sequence index value not found");
    return valueTask(values.int(BigInt(record.count)), site, record.after);
  };
  const bindNamed = (labels, args, keywords, keywordValues) => {
    if (args.length > labels.length) python("TypeError", "Too many positional arguments");
    const bound = new Map(labels.slice(0, args.length).map((name, index) => [name, args[index]]));
    for (let index = 0; index < keywords.length; index++) {
      const name = keywords[index];
      if (!labels.includes(name) || bound.has(name)) python("TypeError", "Invalid or duplicate keyword argument");
      bound.set(name, keywordValues[index]);
    }
    return bound;
  };
  const bindNumeric = (name, args, keywords, keywordValues) => {
    if (name === "range") {
      if (args.length < 1 || args.length > 3 || keywords.length) python("TypeError", "range() requires one to three positional arguments");
      return args;
    }
    if (["int","float"].includes(name)) {
      if (args.length + keywords.length > (name === "int" ? 2 : 1) ||
          keywords.some(key => name !== "int" || key !== "base") || keywords.length && args.length !== 1)
        python("TypeError", name + "() received invalid arguments");
      return [...args,...keywordValues];
    }
    const labels = name === "complex" ? ["real","imag"] : name === "pow" ? ["base","exp","mod"] :
      name === "round" ? ["number","ndigits"] : name === "divmod" ? ["x","y"] : ["value"];
    if (args.length > labels.length) python("TypeError", name + "() received too many arguments");
    const bound = new Map(labels.slice(0,args.length).map((label,index)=>[label,args[index]]));
    for (let index=0;index<keywords.length;index++) {
      const key=keywords[index];
      if (!["complex","pow","round"].includes(name) || !labels.includes(key) || bound.has(key)) python("TypeError", name + "() received an invalid keyword");
      bound.set(key,keywordValues[index]);
    }
    if (name === "complex") return bound.has('imag') ? [bound.has('real') ? bound.get('real') : 0n,bound.get('imag')] : bound.has('real') ? [bound.get('real')] : [];
    const required = name === "pow" || name === "divmod" ? 2 : 1;
    if (labels.slice(0,required).some(label=>!bound.has(label))) python("TypeError", name + "() is missing a required argument");
    return labels.map(label=>bound.has(label) ? bound.get(label) : null);
  };
  const builtin = (callable, args, keywords) => {
    count("builtin:" + callable.name);
    if (["NameError", "UnboundLocalError", "AttributeError", "ImportError", "ModuleNotFoundError", "StopIteration"].includes(callable.name) && state.frames.at(-1).pool.code.version >= 4) {
      const positional = args.slice(0, args.length - keywords.length), keywordValues = args.slice(positional.length);
      const value = makeException(callable.name, positional); state.temporaries.push(value);
      initializeException(value, positional, keywords, keywordValues, callable.name);
      return value;
    }
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
      if (state.frames.at(-1).pool.code.version < 4) {
        if (args.length > 1) hard("UNSUPPORTED", "UnsupportedOperationError", "Multiple exception arguments require the modern source profile under #124");
        return allocate(ExceptionValue, callable.name, args, args.length ? display(args[0]) : "");
      }
      if (["UnicodeEncodeError", "UnicodeDecodeError", "UnicodeTranslateError", "SyntaxError", "IndentationError", "TabError"].includes(callable.name) && args.length > 1)
        hard("UNSUPPORTED", "UnsupportedOperationError", "Structured exception constructors remain under #124");
      // Preserve the safe scalar diagnostic without running a user protocol.
      return makeException(callable.name, args);
    }
    if (callable.name === "print") {
      const text = args.map(display).join(" ") + "\n";
      write(text); return null;
    }
    if (moduleContext && callable.name === "isinstance") {
      if (args.length !== 2) python("TypeError", "isinstance expected 2 arguments, got " + args.length);
      if (state.frames.at(-1).pool.code.version === 5) return classes.isinstance(args[0], args[1]);
      const type = args[1];
      if (type instanceof ClassValue) return classes.isinstance(args[0], type);
      if (type instanceof BuiltinValue && type.name === "memoryview") return values.isView(args[0]);
      if (type instanceof BuiltinValue && ["bytes", "bytearray"].includes(type.name))
        return values.isBinary(args[0]) && args[0].mutable === (type.name === "bytearray");
      if (type instanceof BuiltinValue && ["set", "frozenset"].includes(type.name))
        return values.isSet(args[0]) && args[0].frozen === (type.name === "frozenset");
      if (values.numeric && type instanceof BuiltinValue && ["list", "tuple", "range"].includes(type.name)) return values.isSequenceType(args[0], type.name);
      if (values.numeric && type instanceof BuiltinValue && ["int", "float", "complex", "bool"].includes(type.name)) return values.isPrimitive(args[0], type.name);
      if (type instanceof BuiltinValue && type.name === "str") return values.isString(args[0]);
      if (type instanceof BuiltinValue && Object.hasOwn(EXCEPTIONS, type.name)) return args[0] instanceof ExceptionValue && matchesException(args[0].name, type.name);
      hard("UNSUPPORTED", "UnsupportedOperationError", "isinstance supports str and the adopted exception classes in this profile.");
    }
    if (callable.name === "issubclass") {
      if (args.length !== 2) python("TypeError", "issubclass requires two arguments.");
      return classes.subclass(args[0], args[1]);
    }
    if (callable.name === "type") {
      if (args.length !== 1) python("TypeError", "type requires one or three arguments");
      return classes.typeOf(args[0]);
    }
    if (callable.name === "str" && args.length === 0) return values.string([]);
    if (args.length !== 1) python("TypeError", callable.name + "() requires one argument in this profile");
    if (callable.name === "str" && values.text(args[0]) !== null) return args[0];
    if (callable.name === "str" && args[0] instanceof ExceptionValue && args[0].args.length === 1 && args[0].args[0] instanceof StringValue) return args[0].args[0];
    return callable.name === "len" ? values.unary("len", args[0]) : values.string(Array.from(display(args[0]), char => char.codePointAt(0)));
  };
  const lengthResult = value => {
    if (typeof value !== "bigint" && typeof value !== "boolean") python("TypeError", "__len__() must return an adopted integer");
    if (typeof value === "boolean") value = values.int(BigInt(value));
    if (value < 0n) python("ValueError", "__len__() should return >= 0");
    if (value > 9223372036854775807n) python("OverflowError", "length exceeds the signed-64-bit maximum");
    return value;
  };
  const nativeAttributeName = value => {
    const name = values.text(value);
    if (name === null) python("TypeError", "attribute name must be string, not '" + classes.typeOf(value).name + "'");
    if (name.length > 256) hard("BUDGET", "ExecutionLimitError", "Attribute name budget exceeded.");
    return name;
  };
  const bindingRecovery = (value, completion, site) => {
    while (["init", "relay"].includes(completion?.kind)) completion = completion.after;
    if (value.name !== "AttributeError" || !completion?.fallback) return null;
    const {operation, receiver, after, depth, missing} = completion.fallback;
    if (operation === "iter-indexed") return unaryTask(operation, receiver, site, after, depth);
    if (operation === "hash-unhashable") return unaryTask(operation, receiver, site, after, depth);
    if (operation === "arithmetic-next") return valueTask(moduleContext.builtin("NotImplemented", () => allocate(NotImplementedValue)), site, after);
    if (operation === "contains-search") return containsTask(receiver, completion.fallback.key, site, after, depth, true);
    if (operation === "compare-next") {
      const {left, right, comparison, position} = completion.fallback;
      return compareTask(comparison, left, right, site, after, depth, position);
    }
    if (operation === "repr-default") return unaryTask(operation, receiver, site, after, depth);
    // Optional lookup suppresses binding AttributeError, never a method-body error.
    return missing === "length" ? unaryTask(operation, receiver, site, after, depth, true) :
      valueTask(operation !== "not", site, after, depth);
  };
  const exhaust = iterator => mutate(iterator, () => {
    const before = [iterator.source, iterator.sentinel, iterator.exhausted];
    iterator.source = null; iterator.sentinel = null; iterator.exhausted = true;
    return () => { [iterator.source, iterator.sentinel, iterator.exhausted] = before; };
  });
  const consumeNext = (name, iterator, result, site, after, depth) => {
    const task = unaryTask("next", iterator, site, continuation("consume-next", {name, receiver: iterator, result, after, depth}), depth);
    state.temporaries = operationRoots(task); return task;
  };
  const consumeFinish = (name, result, site, after) => {
    state.temporaries.push(result);
    const value = name === "bytes" ? values.binaryValue(result.items) : ["tuple", "syntax-details"].includes(name) ? values.tuple(result.items) :
      ["bytearray", "list", "set", "frozenset", "set-update"].includes(name) ? result : name === "all";
    state.temporaries.push(value); return valueTask(value, site, after);
  };
  const directoryNext = (record, site) => {
    state.temporaries.push(record.receiver, record.iterator);
    const result = values.list([]); state.temporaries.push(result);
    return consumeNext("list", record.iterator, result, site, record.after, record.depth);
  };
  const directoryHint = (record, site) => {
    state.temporaries.push(record.receiver, record.iterator);
    const depth = record.depth + 1;
    if (depth > maxDepth) python("RecursionError", "maximum directory hint dispatch depth exceeded");
    const plan = classes.special(record.receiver, "__length_hint__");
    if (!plan) return directoryNext(record, site);
    const next = {...record, depth};
    return plan.kind === "value" ? callTask(plan.value, [], [], [], site, continuation("dir-hint-call", next), depth) :
      callTask(plan.callable, plan.args, [], [], site, continuation("dir-hint-bound", next), depth);
  };
  const directoryCount = value => {
    const length = lengthResult(value);
    if (length > BigInt(VALUE_LIMITS.items)) hard("BUDGET", "ExecutionLimitError", "Directory length hint exceeds the sequence budget.");
  };
  const directorySort = (record, site) => {
    const {receiver, after, depth} = record;
    state.temporaries.push(receiver);
    let {index, lower, upper} = record;
    while (index < receiver.items.length) {
      if (lower < upper) return compareTask("less", receiver.items[index], receiver.items[Math.floor((lower + upper) / 2)], site,
        continuation("dir-compare", {receiver, index, lower, upper, depth, after}), depth);
      // The private copy keeps the candidate at index throughout comparison
      // callbacks. Insert after equal peers to preserve their original order.
      charge(index - lower + 1);
      if (lower !== index) mutate(receiver, () => {
        const before = receiver.items.slice(lower, index + 1), item = receiver.items[index];
        for (let position = index; position > lower; position--) receiver.items[position] = receiver.items[position - 1];
        receiver.items[lower] = item;
        return () => { for (let offset = 0; offset < before.length; offset++) receiver.items[lower + offset] = before[offset]; };
      });
      index++; lower = 0; upper = index;
    }
    return valueTask(receiver, site, after);
  };
  const nativeDirectoryNext = (record, site) => {
    state.temporaries.push(record.receiver, record.result);
    const names = classes.directoryNames(record.receiver);
    while (record.position < names.length) {
      const name = names[record.position], key = typeof name === "string" ? values.string(Array.from(name, char => char.codePointAt(0))) : name;
      state.temporaries.push(key);
      const next = {...record, position: record.position + 1};
      if (values.dictionaryNeedsProtocol(record.result, key))
        return dictionaryTask(record.result, key, site, continuation("native-dir-merge", next), record.depth, "set", null);
      values.set(record.result, key, null); record = next;
    }
    return valueTask(values.list(record.result.entries.map(entry => entry.key)), site, record.after);
  };
  const methodDirectory = (record, dictionary, site) => {
    state.temporaries.push(record.receiver, dictionary);
    const result = values.isDict(dictionary) ? values.copyDictionary(dictionary) : values.dict([]);
    state.temporaries.push(result);
    return nativeDirectoryNext({...record, result, position: 0}, site);
  };
  const classDirectoryNext = (record, site) => {
    state.temporaries.push(record.receiver, record.result, record.owner, ...record.pending, ...record.names.filter(name => typeof name !== "string"));
    while (true) {
      if (record.owner === null || record.position === record.names.length) {
        if (record.owner !== null) {
          const bases = record.owner instanceof BuiltinValue ? [] : record.owner.bases;
          charge(bases.length + 1);
          record = {...record, pending: [...bases, ...record.pending]};
        }
        if (!record.pending.length) return valueTask(values.list(record.result.entries.map(entry => entry.key)), site, record.after);
        if (record.pending.length > 1024) hard("BUDGET", "ExecutionLimitError", "Class directory traversal budget exceeded.");
        const [owner, ...pending] = record.pending;
        record = {...record, owner, pending, names: classes.ownClassDirectoryNames(owner), position: 0};
        state.temporaries.push(owner, ...pending, ...record.names.filter(name => typeof name !== "string"));
      }
      const name = record.names[record.position];
      const item = classes.classDirectoryEntry(record.owner, name);
      const stored = record.owner.namespaceEntries?.find(entry => typeof name === "string" ? values.text(entry.key) === name : entry.key === name);
      const key = stored?.key ?? (typeof name === "string" ? values.string(Array.from(name, char => char.codePointAt(0))) : name);
      state.temporaries.push(key, item);
      const next = {...record, position: record.position + 1};
      if (values.dictionaryNeedsProtocol(record.result, key))
        return dictionaryTask(record.result, key, site, continuation("class-dir-merge", next), record.depth, "set", item);
      values.set(record.result, key, item); record = next;
    }
  };
  const objectDirectoryDictionary = (record, dictionary, site) => {
    state.temporaries.push(record.receiver, dictionary);
    const result = values.isDict(dictionary) ? values.copyDictionary(dictionary) : values.dict([]);
    state.temporaries.push(result);
    return attributeTask(record.receiver, "__class__", site,
      continuation("object-dir-class", {...record, result}), record.depth);
  };
  const graphDirectoryVisit = (record, owner, site) => {
    charge(1);
    if (record.bases.length >= maxDepth) python("RecursionError", "maximum advertised directory recursion depth exceeded");
    if (record.visits >= 4096) hard("BUDGET", "ExecutionLimitError", "Advertised directory traversal budget exceeded");
    return attributeTask(owner, "__dict__", site,
      continuation("graph-dir-dict", {...record, owner, visits: record.visits + 1}), record.depth);
  };
  const graphDirectoryNext = (record, site) => {
    while (record.bases.length) {
      const source = record.bases.at(-1), [position, length] = record.positions.at(-1);
      if (position < length) {
        const positions = [...record.positions.slice(0, -1), [position + 1, length]];
        return itemTask(source, values.int(BigInt(position)), site,
          continuation("graph-dir-child", {...record, positions}), record.depth);
      }
      record = {...record, bases: record.bases.slice(0, -1), positions: record.positions.slice(0, -1)};
    }
    return valueTask(values.list(record.result.entries.map(entry => entry.key)), site, record.after);
  };
  const graphDirectoryBases = (record, site) => attributeTask(record.owner, "__bases__", site,
    continuation("graph-dir-bases", record), record.depth);
  const graphDirectoryCopy = (record, site) => {
    if (record.position === record.keys.items.length) return graphDirectoryBases(record, site);
    const key = record.keys.items[record.position];
    return itemTask(record.source, key, site, continuation("graph-dir-value", {...record, key}), record.depth);
  };
  const graphDirectory = (record, owner, site) => graphDirectoryVisit(
    {...record, owner, bases: [], positions: [], visits: 0}, owner, site);
  const basesWalk = (record, owner, site) => {
    charge(1);
    if (owner === record.type) return valueTask(true, site, record.after);
    if (record.level >= 1024) python("RecursionError", "maximum advertised base traversal depth exceeded");
    return attributeTask(owner, "__bases__", site, continuation("bases-walk", {...record, owner, level: record.level + 1}), record.depth);
  };
  const basesNext = (record, site) => record.pending.length ?
    basesWalk({...record, pending: record.pending.slice(1)}, record.pending[0], site) : valueTask(false, site, record.after);
  const argumentOwner = receiver => {
    if (!(receiver instanceof CallArguments)) hard("BYTECODE", "BytecodeError", "Call assembly requires its owned argument record.");
  };
  const appendArgument = (receiver, value) => {
    argumentOwner(receiver); charge(1);
    if (receiver.args.length >= 128) hard("BUDGET", "ExecutionLimitError", "Positional call argument budget exceeded.");
    state.temporaries.push(receiver, value);
    mutate(receiver, () => { receiver.args.push(value); return () => receiver.args.pop(); });
  };
  const appendKeyword = (receiver, key, value) => {
    argumentOwner(receiver); charge(key.length + 1);
    if (receiver.keywords.includes(key)) python("TypeError", "Call received multiple values for keyword argument '" + key + "'");
    if (receiver.keywords.length >= 128) hard("BUDGET", "ExecutionLimitError", "Keyword call argument budget exceeded.");
    state.temporaries.push(receiver, value);
    mutate(receiver, () => {
      receiver.keywords.push(key); receiver.keywordValues.push(value);
      return () => { receiver.keywords.pop(); receiver.keywordValues.pop(); };
    });
  };
  const expandArguments = (receiver, iterable, site) => {
    argumentOwner(receiver);
    const hintOwner = iterable instanceof ProtocolIteratorValue && iterable.kind === "indexed" ? iterable.source : iterable;
    if (userProtocol(hintOwner) && ["__len__", "__length_hint__"].some(slot => classes.hasSlot(classes.checkingType(hintOwner), slot)))
      hard("UNSUPPORTED", "UnsupportedOperationError", "User length hints require a separate construction stage.");
    return unaryTask("iter", iterable, site, continuation("call-star-iter", {receiver}));
  };
  const keywordMap = receiver => {
    argumentOwner(receiver);
    if (receiver.keywordMap !== null) return receiver.keywordMap;
    const result = values.dict([]); state.temporaries.push(receiver, result);
    for (let index = 0; index < receiver.keywords.length; index++) {
      const key = values.string(Array.from(receiver.keywords[index], char => char.codePointAt(0))); state.temporaries.push(key);
      values.set(result, key, receiver.keywordValues[index]);
    }
    mutate(receiver, () => {
      const before = [receiver.keywordMap, receiver.keywords, receiver.keywordValues];
      receiver.keywordMap = result; receiver.keywords = []; receiver.keywordValues = [];
      return () => { [receiver.keywordMap, receiver.keywords, receiver.keywordValues] = before; };
    });
    return result;
  };
  const checkMapping = record => {
    if (record.version !== null && record.mapping.version !== record.version)
      hard("UNSUPPORTED", "UnsupportedOperationError", "Structural source dictionary mutation during keyword expansion requires its restart stage.");
  };
  const mappingStorage = record => record.mode === "display" ? record.receiver : record.receiver.keywordMap;
  const mappingNext = (record, site) => {
    checkMapping(record);
    for (let position = record.position; position < record.keys.items.length; position++) {
      const key = record.keys.items[position], next = {...record, position, key, hash: null, item: null};
      if (record.mode === "display") {
        if (record.version === null) return itemTask(record.mapping, key, site, continuation("call-map-value", next));
        const item = record.mapping.entries[position].value;
        if (!values.dictionaryNeedsProtocol(record.receiver, key)) { values.set(record.receiver, key, item); continue; }
        return dictionaryTask(record.receiver, key, site, continuation("call-map-stored", next), 0, "set", item,
          values.dictionaryEntryHash(record.mapping.entries[position]));
      }
      const finish = continuation("call-map-hash", next);
      return record.version === null ? unaryTask("hash", key, site, finish) :
        valueTask(values.dictionaryEntryHash(record.mapping.entries[position]), site, finish);
    }
    return valueTask(record.receiver, site, record.after);
  };
  const keywordArgument = (receiver, name, item, site) => {
    argumentOwner(receiver);
    if (receiver.keywordMap === null) { appendKeyword(receiver, name, item); return valueTask(receiver, site); }
    const key = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(receiver, key, item);
    return unaryTask("hash", key, site, continuation("call-map-hash", {receiver, key, item, mode: "keyword"}));
  };
  const expandMapping = (receiver, mapping, site, mode = "mapping") => {
    if (mode === "display") {
      if (!values.isDict(receiver)) hard("BYTECODE", "BytecodeError", "Dictionary display requires its owned result.");
    } else keywordMap(receiver);
    state.temporaries.push(receiver, mapping);
    if (values.isDict(mapping)) {
      const keys = values.tuple(mapping.entries.map(entry => entry.key)); state.temporaries.push(keys);
      return mappingNext({receiver, mapping, keys, position: 0, version: mapping.version, mode, after: null}, site);
    }
    if (!userProtocol(mapping)) python("TypeError", "Argument after ** must be a mapping");
    let plan;
    try { plan = classes.read(mapping, "keys"); }
    catch (error) {
      if (!(error instanceof Raised) || error.value.name !== "AttributeError") throw error;
      python("TypeError", "Argument after ** must be a mapping");
    }
    const fields = {receiver, mapping, mode};
    return plan.kind === "value" ? callTask(plan.value, [], [], [], site, continuation("call-map-keys", fields)) :
      callTask(plan.callable, plan.args, [], [], site, continuation("call-map-lookup", fields));
  };
  const finishArguments = receiver => {
    argumentOwner(receiver);
    if (receiver.keywordMap === null) return [receiver.keywords, receiver.keywordValues];
    const keywords = [], items = [];
    for (const entry of receiver.keywordMap.entries) {
      charge(1);
      const key = values.text(entry.key);
      if (key === null) python("TypeError", "Keywords must be strings");
      keywords.push(key); items.push(entry.value);
    }
    return [keywords, items];
  };
  const duplicateKeyword = (receiver, key, site, after = null) => {
    const formatted = userProtocol(key) && ["__str__", "__repr__"].some(slot => classes.hasSlot(classes.checkingType(key), slot));
    return formatted ? unaryTask("str", key, site, continuation("call-duplicate-result", {receiver, key, after})) :
      unaryTask("call-keyword-duplicate", receiver, site, after);
  };
  const refuseHints = receiver => {
    const owner = receiver instanceof ProtocolIteratorValue && receiver.kind === "indexed" ? receiver.source : receiver;
    if (userProtocol(owner) && ["__len__", "__length_hint__"].some(slot => classes.hasSlot(classes.checkingType(owner), slot)))
      hard("UNSUPPORTED", "UnsupportedOperationError", "User length hints require a separate construction stage.");
  };
  const expandDisplay = (receiver, iterable, site) => {
    if (!values.isList(receiver)) hard("BYTECODE", "BytecodeError", "Sequence display requires its owned result.");
    refuseHints(iterable);
    return unaryTask("iter", iterable, site, continuation("display-iter", {receiver}));
  };
  const expandUnpack = (receiver, before, tail, site) => {
    if (tail !== null) refuseHints(receiver);
    const result = values.list([]); state.temporaries.push(result);
    return unaryTask("iter", receiver, site, continuation("unpack-iter", {receiver, result, before, tail}));
  };
  const unpackFinish = (record, site) => {
    const items = record.result.items;
    if (items.length < record.before + (record.tail ?? 0)) return unaryTask("unpack-short", record.result, site, record.after);
    let result;
    if (record.tail === null) result = values.tuple(items);
    else {
      const middle = values.list(items.slice(record.before, items.length - record.tail)); state.temporaries.push(middle);
      result = values.tuple([...items.slice(0, record.before), middle, ...(record.tail ? items.slice(-record.tail) : [])]);
    }
    state.temporaries.push(result); return valueTask(result, site, record.after);
  };
  const abstractNext = (record, site) => {
    const accessors = record.receiver instanceof PropertyValue ?
      [record.receiver.fget, record.receiver.fset, record.receiver.fdel] : [record.receiver.callable];
    for (let position = record.position; position < accessors.length; position++) {
      charge(1);
      const accessor = accessors[position];
      if (accessor === null || values.typeName(accessor) !== null) continue;
      return attributeTask(accessor, "__isabstractmethod__", site,
        continuation("abstract-lookup", {...record, position}), record.depth);
    }
    return valueTask(false, site, record.after);
  };
  const frameLookup = (receiver, key, operation, item, fallback, hasFallback, site, after) => {
    const dictionary = classes.frameKeys(receiver.frame);
    return dictionaryTask(dictionary, key, site, continuation("frame-lookup", {receiver, key, item, fallback, hasFallback, operation, phase: 0, after}), 0, "probe");
  };
  const frameLookupResult = (record, found, item, site) => {
    const {receiver, key, operation, after, phase} = record, frame = receiver.frame;
    const cell = phase === 0 && found ? item : record.cell;
    if (phase === 0 && found && ["delete", "pop"].includes(operation)) python("ValueError", "cannot remove local variables from FrameLocalsProxy");
    if (operation === "set") {
      if (cell) { setCell(cell, record.item); return valueTask(null, site, after); }
      return dictionaryTask(classes.frameExtras(frame), key, site, continuation("frame-write", {receiver, after}), 0, "set", record.item);
    }
    if (phase === 0) {
      if (found && cell.bound) { found = true; item = cell.value; }
      else if (frame.extras !== null) return dictionaryTask(frame.extras, key, site, continuation("frame-lookup", {...record, cell, phase: 1}), 0, ["delete", "pop"].includes(operation) ? "pop-probe" : "probe");
      else { found = false; item = null; }
    }
    if (operation === "contains") return valueTask(found, site, after);
    if (found) return valueTask(operation === "delete" ? null : item, site, after);
    if (operation === "setdefault") {
      if (cell) { setCell(cell, record.item); return valueTask(record.item, site, after); }
      return dictionaryTask(classes.frameExtras(frame), key, site, continuation("frame-write", {receiver, after}), 0, "set-default", record.item);
    }
    if (operation === "get" || operation === "pop" && record.hasFallback) return valueTask(record.fallback, site, after);
    python("KeyError", "Frame local key not found", [key]);
  };
  const frameEntries = receiver => [
    ...classes.frameKeys(receiver.frame).entries.filter(entry => entry.value.bound).map(entry => [entry.key, entry.value.value]),
    ...(receiver.frame.extras?.entries ?? []).map(entry => [entry.key, entry.value])];
  const frameSnapshotNext = (record, site) => record.position === record.keys.items.length ? valueTask(record.result, site, record.after) :
    frameLookup(record.receiver, record.keys.items[record.position], "read", null, null, false, site, continuation("frame-copy-value", record));
  const frameSnapshot = (receiver, site, after) => {
    const keys = values.list(frameEntries(receiver).map(([key]) => key)); state.temporaries.push(receiver, keys);
    const result = values.dict([]); state.temporaries.push(result);
    return frameSnapshotNext({receiver, result, keys, position: 0, after}, site);
  };
  const frameUpdateNext = (record, site) => record.position === record.keys.items.length ? valueTask(record.self ? record.receiver : null, site, record.after) :
    itemTask(record.source, record.keys.items[record.position], site, continuation("frame-update-get", record), 0, "get");
  const frameUpdate = (record, site) => {
    if (!(values.isDict(record.source) || record.source instanceof FrameLocalsValue)) python("TypeError", "update() argument must be dict or another FrameLocalsProxy");
    const keys = values.list(record.source instanceof FrameLocalsValue ? frameEntries(record.source).map(([key]) => key) : record.source.entries.map(entry => entry.key)); state.temporaries.push(keys);
    return frameUpdateNext({...record, keys, position: 0, after: continuation("frame-update-boundary", {receiver: record.receiver, inplace: record.self, context: state.frames.at(-1)?.activeException ?? null, after: record.after})}, site);
  };
  const functionEnter = (record, site) => {
    const bindings = new Map(record.keys.map((key, i) => [key, record.items[i]]));
    const fn = record.receiver.pool.code.functions[record.receiver.index], missing = fn.params.kwonly.filter(name => !bindings.has(name));
    if (missing.length) {
      const quoted = missing.map(name => "'" + name + "'"), names = quoted.length === 1 ? quoted[0] : quoted.length === 2 ? quoted.join(" and ") : quoted.slice(0, -1).join(", ") + ", and " + quoted.at(-1);
      python("TypeError", fn.qualname + "() missing " + missing.length + " required keyword-only argument" + (missing.length === 1 ? "" : "s") + ": " + names);
    }
    if (fn.blocks.some(block => block.instructions.some(([op]) => ["yield", "yield-from"].includes(op))))
      return valueTask(allocate(GeneratorValue, record.receiver, bindings), site, record.after);
    enter(record.receiver, bindings, site, record.after); return null;
  };
  const functionDefaultsNext = (record, site) => {
    if (record.position === record.names.length) return functionEnter(record, site);
    const key = values.string(Array.from(record.names[record.position], char => char.codePointAt(0))); state.temporaries.push(key);
    return dictionaryTask(record.dictionary, key, site, continuation("function-defaults", record), 0, "probe");
  };
  const wrapperKeys = ["__module__", "__name__", "__qualname__", "__doc__"];
  const wrapperNext = (record, site) => record.position === wrapperKeys.length ? valueTask(record.receiver, site, record.after) :
    attributeTask(record.receiver.callable, wrapperKeys[record.position], site, continuation("wrapper-metadata", record), record.depth);
  const propertyResult = (record, documentation, getterDoc, site) => valueTask(
    allocate(PropertyValue, ...record.accessors, record.receiver?.propertyName, documentation, getterDoc), site, record.after);
  const propertyTask = (parts, receiver, site, after, depth) => {
    const accessors = parts.slice(0, 3), document = parts[3], getter = accessors[0];
    const record = {receiver, accessors, after};
    if (document !== null) return propertyResult(record, document, false, site);
    if (getter === null) return propertyResult(record, null, false, site);
    if (getter instanceof FunctionValue) return propertyResult(record, getter.documentation, getter.documentation !== null, site);
    if (getter instanceof PropertyValue) return propertyResult(record, getter.documentation, getter.documentation === undefined ? null : getter.documentation !== null, site);
    let callable = getter;
    while (callable instanceof BoundMethodValue) { charge(1); callable = callable.callable; }
    if (getter instanceof BoundMethodValue && callable instanceof FunctionValue)
      return propertyResult(record, callable.documentation, callable.documentation !== null, site);
    if (++depth > maxDepth) python("RecursionError", "maximum property documentation lookup depth exceeded");
    return attributeTask(getter, "__doc__", site, continuation("property-documentation", record), depth);
  };
  const propertyDiagnostic = (record, site) => {
    const type = classes.typeOf(record.target);
    const qualification = type.identityQualname ?? values.string(Array.from(type.qualname ?? type.name, char => char.codePointAt(0)));
    state.temporaries.push(qualification);
    const next = {...record, qualification, phase: record.found ? "name" : "qualification"};
    return unaryTask("repr", record.found ? record.name : qualification, site, continuation("property-diagnostic", next), record.depth);
  };
  const attributeFailure = (value, receiver, key, site, after = null, trace = false) => {
    if (!isException(value, "AttributeError") || value.attributeFields !== 0) return null;
    state.temporaries.push(value, receiver);
    if (trace) addTrace(value, site);
    if (typeof key === "string") key = values.string(Array.from(key, char => char.codePointAt(0)));
    state.temporaries.push(key);
    mutate(value, () => {
      const before = value.nativeFieldBoundaries;
      value.nativeFieldBoundaries = undefined;
      return () => { value.nativeFieldBoundaries = before; };
    });
    return attributeTask(value, "name", site, continuation("attribute-context-name", {receiver, error: value, after}), 0, "set", null, null, key);
  };
  const recover = (value, completion, site, trace = false) => {
    const binding = bindingRecovery(value, completion, site);
    if (binding) return binding;
    for (let current = completion; current; current = current.after) {
      if (current.kind === "attribute-context") {
        const enriched = attributeFailure(value, current.receiver, current.key, site, current.after, trace);
        if (enriched) return enriched;
      }
      if (current.kind === "property-diagnostic" && current.phase === "lookup" && value.name === "AttributeError")
        return propertyDiagnostic({...current, found: false, name: null}, site);
      if (current.kind === "property-diagnostic") {
        const binding = bindingRecovery(value, current.after, site);
        if (binding) return binding;
      }
      if (current.kind === "arithmetic-order" && value.name === "AttributeError" && ["right", "left"].includes(current.phase))
        return arithmeticOrder(current.task, current.phase === "left", site);
      if (current.kind === "namespace-lookup" && current.phase < 0)
        return valueTask(values.tuple([false, null]), site, current);
      if (current.kind === "namespace-build" && current.field === "protocol" &&
          !["__slots__", "__new__", "__init_subclass__", "__class_getitem__", "__eq__", "__hash__"].includes(CLASS_PROTOCOL_NAMES[current.task.protocolIndex]))
        return valueTask(values.tuple([false, null]), site, current);
      if (current.kind === "module-missing" && value.name === "AttributeError" && current.mode === "import") return moduleMissing(current, site);
      if (current.kind === "dir-length" && value.name === "TypeError") return directoryHint(current, site);
      if (current.kind === "dir-hint-call" && value.name === "TypeError") return directoryNext(current, site);
      if (current.kind === "object-dir-dictionary" && value.name === "AttributeError") return objectDirectoryDictionary(current, null, site);
      if (current.kind === "object-dir-class" && value.name === "AttributeError")
        return valueTask(values.list(current.result.entries.map(entry => entry.key)), site, current.after);
      if (current.kind === "graph-dir-dict" && value.name === "AttributeError") return graphDirectoryBases(current, site);
      if (current.kind === "graph-dir-bases" && value.name === "AttributeError") return graphDirectoryNext(current, site);
      if (["bases-check", "bases-class"].includes(current.kind) && value.name === "AttributeError")
        python("TypeError", "type checking requires a class or an object with tuple __bases__");
      if (current.kind === "bases-instance" && value.name === "AttributeError") return valueTask(false, site, current.after);
      if (current.kind === "class-prepare-lookup" && value.name === "AttributeError") return valueTask(values.dict([]), site, continuation("class-prepare-result", current));
      if (current.kind === "import-fromlist-path" && value.name === "AttributeError") return importer.done(current, site);
      if (current.kind === "import-next" && isException(value, "StopIteration")) return importer.exhausted(current, site);
      if (current.kind === "import-member" && value.name === "AttributeError") return importer.missing(current, site);
      if (current.kind === "import-all-probe" && value.name === "AttributeError") return importer.next(current, site);
      if (current.kind === "class-mapping-name" && value.name === "KeyError") return valueTask(null, site, continuation("class-mapping-fallback", current));
      if (current.kind === "class-mapping-delete" && value.name === "KeyError") return unaryTask("class-delete-missing", current.receiver, site, current.after);
      if (current.kind === "class-base-lookup" && value.name === "AttributeError")
        return valueTask(null, site, continuation("class-base-missing", current));
      if (current.kind === "bases-walk" && value.name === "AttributeError") return basesNext(current, site);
      if (current.kind === "method-dir-dictionary" && value.name === "AttributeError") return methodDirectory(current, null, site);
      if (current.kind === "global-mapping-name" && value.name === "KeyError") {
        const result = builtinLookup(state.frames.at(-1), current.name, site, current.after); return result.task || valueTask(result.value, site, current.after);
      }
      if (current.kind === "builtin-mapping-name" && value.name === "KeyError") {
        if (current.name === "__import__" && current.after?.kind === "import-statement-call") python("ImportError", "name '" + current.name + "' is not defined");
        nameError("name '" + current.name + "' is not defined", current.name);
      }
      if (current.kind === "vars-result" && value.name === "AttributeError") return unaryTask("vars-missing", current.receiver, site, current.after);
      if (current.kind === "instance-entry" && current.operation !== "get" && value.name === "KeyError")
        return callTask(classes.builtin("instance-attribute-missing"), [current.receiver, current.key], [], [], site, current.after, current.depth);
      if (current.kind === "property-name" && value.name === "AttributeError") return unaryTask("property-name-missing", current.receiver, site, current.after);
      if (current.kind === "frame-update-boundary" && !value.frameUpdateFailure) {
        const failure = allocate(ExceptionValue, current.inplace ? "SystemError" : "TypeError", [], current.inplace ? "Native frame locals in-place union returned a result with an exception set" : "update() argument must be dict or another FrameLocalsProxy"); state.temporaries.push(failure);
        failure.frameUpdateFailure = true; mutate(failure, () => { failure.context = current.inplace ? value : current.context; return () => { failure.context = null; }; });
        throw new Raised(failure);
      }
      if (current.kind.startsWith("hierarchy-")) { current.transaction.rollback(); hierarchyDone(current.transaction); }
      if (current.kind === "native-doc-result" && current.ignoreAttribute && value.name === "AttributeError") return valueTask(null, site, current.after);
      if (current.kind === "wrapper-metadata" && value.name === "AttributeError") return wrapperNext({...current, position: current.position + 1}, site);
      if (current.kind === "property-documentation" && value.name === "AttributeError") return propertyResult(current, null, false, site);
      if (current.kind === "abstract-lookup" && value.name === "AttributeError")
        return abstractNext({...current, position: current.position + 1}, site);
      if (current.kind === "advertised-instance" && value.name === "AttributeError") return valueTask(false, site, current.after);
      if (current.kind === "advertised-super" && value.name === "AttributeError") return unaryTask("super-invalid", current.receiver, site, current.after);
      if (current.kind === "attribute-fallback" && value.name === "AttributeError")
        return attributeTask(current.receiver, current.name, site, current.after, current.depth, "fallback", current.key, current.hook);
      if (current.kind === "attribute-result" && value.name === "AttributeError") return valueTask(current.mode === "hasattr" ? false : current.default, site, current.after);
      if (current.kind === "exception-note-get" && value.name === "AttributeError") {
        const result = values.list([]); state.temporaries.push(result);
        return attributeTask(current.receiver, "__notes__", site, continuation("exception-note-store", {...current, result}), current.depth, "set", null, null, result);
      }
      if (current.kind === "delegate-bind" && value.name === "AttributeError") return unaryTask("delegate-raise", current.receiver, site);
      if (current.kind.startsWith("call-map-") && (value.name === "AttributeError" || value.name === "KeyError" && current.mode !== "display"))
        return value.name === "KeyError" ? duplicateKeyword(current.receiver, value.args[0] ?? current.key, site, current.after) :
          unaryTask("call-mapping-required", current.receiver, site, current.after);
      if (current.kind === "indexed-result" && (value.name === "IndexError" || isException(value, "StopIteration")) ||
          current.kind === "callable-result" && isException(value, "StopIteration")) {
        exhaust(current.receiver);
        return unaryTask("iterator-stop", current.receiver, site, current.after);
      }
      if (!isException(value, "StopIteration")) continue;
      if (current.kind === "delegate-next") return valueTask(classes.exceptionValue(value), site, continuation("delegate-return", {receiver: current.receiver}));
      if (current.kind === "next-default") return valueTask(current.default, site, current.after);
      if (current.kind === "for-next") return valueTask(null, site, continuation("for-exhausted"));
      if (current.kind === "search-next") return valueTask(false, site, current.after);
      if (current.kind === "display-next") return valueTask(current.receiver, site, current.after);
      if (["unpack-next", "unpack-rest-next"].includes(current.kind)) return unpackFinish(current, site);
      if (current.kind === "call-star-next") return valueTask(current.receiver, site, current.after);
      if (current.kind === "consume-next") return consumeFinish(current.name, current.result, site, current.after);
    }
    return null;
  };
  const deliver = (value, completion, site) => {
    try { return deliverValue(value, completion, site); }
    catch (error) {
      // Returned protocol values can fail validation after the callback frame
      // exits. They use the same owned recovery destination as body errors.
      const recovery = error instanceof Raised && recover(error.value, completion, site);
      if (!recovery) throw error;
      return recovery;
    }
  };
  const deliverValue = (value, completion, site) => {
    if (completion?.kind === "syntax-details") {
      const items = value.items;
      if (items.length < 4 || items.length > 7) python("TypeError", "SyntaxError details require four to seven values");
      mutate(completion.receiver, () => {
        const before = new Map(completion.receiver.nativeFields);
        const boundaries = completion.receiver.nativeFieldBoundaries && new Set(completion.receiver.nativeFieldBoundaries);
        for (const [index, key] of ["filename", "lineno", "offset", "text", "end_lineno", "end_offset", "_metadata"].entries()) {
          completion.receiver.nativeFields.set(key, items[index] ?? null);
          completion.receiver.nativeFieldBoundaries?.delete(key);
        }
        return () => { completion.receiver.nativeFields = before; completion.receiver.nativeFieldBoundaries = boundaries; };
      });
      if (items.length === 5) python("TypeError", "end_offset must be provided when end_lineno is provided");
      return valueTask(completion.result, site, completion.after);
    }
    if (completion?.kind === "attribute-context-name")
      return attributeTask(completion.error, "obj", site, continuation("attribute-context-object", completion), 0, "set", null, null, completion.receiver);
    if (completion?.kind === "attribute-context-object")
      return unaryTask("attribute-error", completion.error, site, completion.after);
    while (["init", "relay", "attribute-context", "subclass-result", "vars-result", "property-name", "attribute-fallback", "protocol-result", "format-result", "index-result", "item-result"].includes(completion?.kind)) {
      count("deliver:" + completion.kind);
      if (completion.kind === "init") {
        if (value !== null) python("TypeError", "__init__() should return None");
        value = completion.instance;
      } else if (completion.kind === "subclass-result") value = completion.receiver;
      else if (completion.kind === "item-result") value = null;
      else if (completion.kind === "index-result") {
        if (typeof value !== "bigint" && typeof value !== "boolean") python("TypeError", "__index__ returned a non-integer value");
        if (typeof value === "boolean") value = values.int(BigInt(value));
      } else if (completion.kind === "format-result") {
        if (!values.isString(classes.payload(value))) python("TypeError", completion.slot + " returned non-string (type " + classes.typeOf(value).name + ")");
      } else if (completion.kind === "protocol-result") {
        if (completion.slot === "__bool__") {
          if (typeof value !== "boolean") python("TypeError", "__bool__() should return bool");
        } else {
          if (userProtocol(value)) return unaryTask("index", value, site, completion, completion.depth);
          value = lengthResult(value);
        }
        if (completion.operation !== "len") {
          if (completion.slot === "__len__") value = value !== 0n;
          if (completion.operation === "not") value = !value;
        }
      }
      completion = completion.after;
    }
    if (completion?.kind === "syntax-message")
      return valueTask(values.binary("add", classes.payload(value), completion.suffix), site, completion.after);
    if (completion?.kind === "proxy-get") return valueTask(value.items[0] ? value.items[1] : completion.fallback, site, completion.after);
    if (completion?.kind === "view-item") {
      const [found, item] = values.comparisonSequence(value);
      if (!found) return valueTask(false, site, completion.after);
      const needle = completion.key.items[1];
      return item === needle ? valueTask(true, site, completion.after) :
        compareTask("equal", item, needle, site, continuation("contains-result", completion), completion.depth);
    }
    if (completion?.kind === "dict-union") return unionNext(completion, site);
    if (completion?.kind === "namespace-build") {
      let task = completion.task;
      const field = completion.field;
      if (field === "slots") {
        const [found, item] = values.comparisonSequence(value);
        if (!found) return namespaceCreateTask({...task, slotsDone: true}, site, task.completion, task.depth);
        if (values.isString(item)) return namespaceCreateTask({...task, slotsDone: true, slotNames: [item]}, site, task.completion, task.depth);
        return unaryTask("iter", item, site, continuation("namespace-build", {task, field: "slot-iterator"}), task.depth);
      }
      if (field === "slot-iterator") {
        const result = values.list([]); state.temporaries.push(result);
        return consumeNext("list", value, result, site, continuation("namespace-build", {task, field: "slot-items"}), task.depth);
      }
      if (field === "slot-items") return namespaceCreateTask({...task, slotsDone: true, slotNames: value.items}, site, task.completion, task.depth);
      if (field === "protocol") {
        const [found, key] = values.comparisonSequence(value), name = CLASS_PROTOCOL_NAMES[task.protocolIndex];
        let protocolNames = task.protocolNames || [];
        if (found && values.needsOwnedHash(key)) {
          const metaclass = task.bases.some(base => base instanceof BuiltinValue && base.name === "type" || classes.isMetaclass(base));
          protocolNames = [...protocolNames, name];
          const position = task.dictionary.entries.findIndex(entry => entry.key === key), entry = task.dictionary.entries[position];
          if (["__new__", "__init_subclass__", "__class_getitem__"].includes(name) && entry.value instanceof FunctionValue) {
            const wrapper = allocate(MethodWrapperValue, name === "__new__" ? "staticmethod" : "classmethod", entry.value);
            state.temporaries.push(wrapper);
            values.commitDictionary(task.dictionary, key, wrapper, values.dictionaryEntryHash(entry), position);
          }
        }
        return namespaceCreateTask({...task, protocolNames, protocolIndex: task.protocolIndex + 1}, site, task.completion, task.depth);
      }
      if (["qualname", "cell", "dictcell", "module"].includes(field)) {
        const [found, item] = values.comparisonSequence(value);
        if (field === "qualname" && found) {
          const name = values.text(item); if (name === null) python("TypeError", "type __qualname__ must be a str");
          task = {...task, qualname: name};
        } else if (["cell", "dictcell"].includes(field) && found) {
          if (!(item instanceof Cell)) python("TypeError", field === "cell" ? "__classcell__ must be a cell" : "__classdictcell__ must be a cell");
          task = {...task, [field]: item};
        } else if (field === "module") {
          task = {...task, moduleFound: found, moduleObject: found ? item : task.defaultModule};
        }
      }
      return namespaceCreateTask({...task, phase: task.phase + 1}, site, task.completion, task.depth);
    }
    if (completion?.kind === "namespace-lookup") {
      const [found, key] = values.comparisonSequence(value);
      const cache = completion.cache, entry = {owner: completion.owner, name: completion.name, dictionary: completion.dictionary,
        version: completion.dictionary.version, phase: completion.phase, found, key};
      if (cache.entries.length >= 1024) hard("BUDGET", "ExecutionLimitError", "Attribute lookup phase budget exceeded");
      mutate(cache, () => { cache.entries.push(entry); return () => cache.entries.pop(); });
      return Object.freeze({...completion.task, lookupCache: cache});
    }
    if (completion?.kind === "function-capture") {
      if (value.items[0]) classes.functionMetadata(completion.receiver, "builtins", value.items[1] instanceof ModuleValue ? value.items[1].environment : value.items[1]);
      return valueTask(completion.receiver, site, completion.after);
    }
    if (completion?.kind === "function-defaults") {
      const keys = [...completion.keys], items = [...completion.items];
      if (value.items[0]) { keys.push(completion.names[completion.position]); items.push(value.items[1]); }
      return functionDefaultsNext({...completion, keys, items, position: completion.position + 1}, site);
    }
    if (["global-mapping-name", "builtin-mapping-name"].includes(completion?.kind)) return valueTask(value, site, completion.after);
    if (completion?.kind === "builtin-name") {
      if (!value.items[0]) {
        if (completion.name === "__import__" && completion.after?.kind === "import-statement-call") python("ImportError", "name '" + completion.name + "' is not defined");
        nameError("name '" + completion.name + "' is not defined", completion.name);
      }
      return valueTask(value.items[1], site, completion.after);
    }
    if (completion?.kind === "name-stored") return null;
    if (completion?.kind === "class-module") return prepareClass(completion, value, site);
    if (completion?.kind === "class-qualname") return classQualification();
    if (completion?.kind === "class-firstline") return classFirstline();
    if (completion?.kind === "class-end") return classEnd({...completion});
    if (completion?.kind === "handler-type") return handlerType(completion, value, site);
    if (completion?.kind === "module-delete") {
      if (!value.items[0]) python("AttributeError", "module has no attribute " + completion.name);
      return valueTask(null, site, completion.after);
    }
    if (completion?.kind === "class-name") {
      if (value.items[0]) return valueTask(value.items[1], site, completion.after);
      const frame = state.frames.at(-1);
      if (frame.closure.has(completion.name) && !frame.fn.locals.includes(completion.name) && !frame.fn.globals?.includes(completion.name)) return valueTask(load(frame, completion.name), site, completion.after);
      const dictionary = frame.callable.globals.dictionary;
      if (dictionary === null || frame.callable.globals.dictionaryIdentity) {
        const result = loadName(frame, completion.name, site, completion.after, true);
        return result.task ?? valueTask(result.value, site, completion.after);
      }
      const key = values.string(Array.from(completion.name, char => char.codePointAt(0))); state.temporaries.push(key);
      return dictionaryTask(dictionary, key, site, continuation("global-name", {receiver: dictionary, name: completion.name, after: completion.after}), 0, "probe");
    }
    if (["global-name", "global-delete"].includes(completion?.kind)) {
      const [found, item] = value.items;
      if (completion.kind === "global-delete") {
        if (!found) nameError("name '" + completion.name + "' is not defined", completion.name);
        return null;
      }
      if (found) return valueTask(item, site, completion.after);
      const result = builtinLookup(state.frames.at(-1), completion.name, site, completion.after);
      return result.task ?? valueTask(result.value, site, completion.after);
    }
    if (completion?.kind === "store-body") { block(state.frames.at(-1), completion.body); return null; }
    if (completion?.kind === "resume-control") { settle({kind: completion.signal, value: completion.value}); return null; }
    if (completion?.kind === "module-entry") return moduleEntry(completion, site, value.items[0], value.items[1]);
    if (completion?.kind === "module-hook") return moduleHook(completion, site, value.items[0], value.items[1]);
    if (completion?.kind === "module-dir") return callTask(value, [], [], [], site, continuation("dir-result", completion), completion.depth);
    if (completion?.kind === "module-native-dir") return moduleDirectory(completion, value.items[0], value.items[1], site);
    if (completion?.kind === "module-missing") return valueTask(value, site, completion.after);
    if (completion?.kind === "mro-result") return unaryTask("iter", value, site, continuation("mro-iter", completion));
    if (completion?.kind === "mro-iter") {
      const after = continuation("mro-sequence", completion);
      if (userProtocol(value)) return valueTask(value, site, continuation("dir-iter", {receiver: value, depth: 0, after}));
      const result = values.list([]); state.temporaries.push(value, result);
      return consumeNext("list", value, result, site, after, 0);
    }
    if (completion?.kind === "mro-sequence") {
      const type = completion.type;
      classes.validateMro(type, value.items);
      mutate(type, () => {
        const previous = type.mro; type.mro = Object.freeze([...value.items]); type.mroPending = false;
        return () => { type.mro = previous; type.mroPending = true; };
      });
      return finalizeType(completion, site);
    }
    if (completion?.kind === "class-prepare-lookup") return callTask(value, [completion.nameValue, completion.basesTuple], completion.keywords, completion.keywordValues, site, continuation("class-prepare-result", completion));
    if (completion?.kind === "class-prepare-result") return preparedClass(completion, value, site);
    if (completion?.kind === "class-body-module") return classModule(value);
    if (completion?.kind === "class-mapping-fallback") return classFallback(completion.name, site, completion.after);
    if (completion?.kind === "class-mapping-name") return valueTask(value, site, completion.after);
    if (completion?.kind === "class-mapping-delete") return valueTask(null, site, completion.after);
    if (completion?.kind === "class-mapping-dir-call") return callTask(value, [], [], [], site, continuation("class-mapping-dir-result", completion));
    if (completion?.kind === "class-mapping-dir-result") return consumeTask("list", value, site, continuation("dir-sort", completion));
    if (completion?.kind === "class-base-missing") return resolveClassBases({...completion, resolved: [...completion.resolved, completion.bases[completion.position]], position: completion.position + 1}, site);
    if (completion?.kind === "class-base-lookup") return callTask(value, [completion.originalBases], [], [], site, continuation("class-base-result", completion));
    if (completion?.kind === "class-base-result") {
      if (!values.isSequenceType(value, "tuple")) python("TypeError", "__mro_entries__ must return a tuple");
      return resolveClassBases({...completion, resolved: [...completion.resolved, ...value.items], position: completion.position + 1, changed: true}, site);
    }
    if (completion?.kind === "raise-value") return raiseException(value, completion.cause, completion.explicit, site, true);
    if (completion?.kind === "raise-cause") return raiseException(completion.receiver, value, true, site, true, true);
    if (completion?.kind === "exception-note-get" || completion?.kind === "exception-note-store") {
      const result = completion.kind === "exception-note-store" ? completion.result : classes.payload(value);
      if (!values.isList(result)) python("TypeError", "Cannot add note: __notes__ is not a list");
      values.append(result, completion.note);
      return valueTask(null, site, completion.after);
    }
    if (completion?.kind === "exception-args") {
      const receiver = completion.receiver;
      mutate(receiver, () => {
        const before = [receiver.args, receiver.argsTuple, receiver.message, receiver.stopValue, receiver.messageArgs];
        const hadValue = Object.hasOwn(receiver, "stopValue");
        if (receiver.name === "StopIteration") receiver.stopValue = classes.exceptionValue(receiver);
        receiver.args = value.items; receiver.argsTuple = value; receiver.messageArgs = false;
        const first = value.items[0];
        receiver.message = value.items.length === 1 && (first === null || ["bigint", "boolean"].includes(typeof first) || first instanceof StringValue) ? display(first) : "";
        return () => { [receiver.args, receiver.argsTuple, receiver.message, receiver.stopValue, receiver.messageArgs] = before; if (!hadValue) delete receiver.stopValue; };
      });
      return valueTask(null, site, completion.after);
    }
    if (completion?.kind === "wrapper-metadata") {
      const key = values.string(Array.from(wrapperKeys[completion.position], char => char.codePointAt(0))); state.temporaries.push(key, value);
      values.set(classes.functionDictionary(completion.receiver), key, value);
      return wrapperNext({...completion, position: completion.position + 1}, site);
    }
    if (["frame-write", "frame-update-boundary"].includes(completion?.kind)) return valueTask(value, site, completion.after);
    if (completion?.kind === "frame-update-get") return frameLookup(completion.receiver, completion.keys.items[completion.position], "set", value, null, false, site, continuation("frame-update-map", completion));
    if (completion?.kind === "frame-update-map") return frameUpdateNext({...completion, position: completion.position + 1}, site);
    if (completion?.kind === "frame-copy-value") return dictionaryTask(completion.result, completion.keys.items[completion.position], site, continuation("frame-snapshot", {...completion, position: completion.position + 1}), 0, "set", value);
    if (completion?.kind === "frame-lookup") return frameLookupResult(completion, value.items[0], value.items[1], site);
    if (completion?.kind === "frame-snapshot") return frameSnapshotNext(completion, site);
    if (completion?.kind === "frame-result") {
      const {action, task, after} = completion;
      if (action === "keys") return valueTask(values.list(value.entries.map(entry => entry.key)), site, after);
      if (action === "values") return valueTask(values.list(value.entries.map(entry => entry.value)), site, after);
      if (action === "items") {
        const items = value.entries.map(entry => { const item = values.tuple([entry.key, entry.value]); state.temporaries.push(item); return item; });
        return valueTask(values.list(items), site, after);
      }
      if (action === "local-dir") return valueTask(values.list(value.entries.map(entry => entry.key)), site, continuation("dir-sort", {receiver: value, depth: 0, after}));
      if (action === "task") {
        if (task.kind === "compare") return compareTask(task.operation, task.left instanceof FrameLocalsValue ? value : task.left, task.left instanceof FrameLocalsValue ? task.right : value, site, task.completion, task.depth);
        if (task.kind === "call") return callTask(task.callable, task.args.map(arg => arg === completion.receiver ? value : arg), task.keywords, task.keywordValues, site, task.completion, task.depth);
        if (task.kind === "arithmetic") return arithmeticTask(task.operation, task.args.map((arg, index) => index === task.args.findIndex(item => item instanceof FrameLocalsValue) ? value : arg), site, task.completion, task.depth);
        return unaryTask(task.operation, value, site, task.completion, task.depth);
      }
      if (action === "reverse") return valueTask(values.list(value.entries.map(entry => entry.key).reverse()), site, after);
      throw new TypeError("Invalid frame snapshot destination");
    }
    if (completion?.kind === "property-documentation") return propertyResult(completion, value, value !== null, site);
    if (completion?.kind === "advertised-instance")
      return valueTask(classes.isType(value) && classes.subclass(value, completion.type), site, completion.after);
    if (completion?.kind === "descriptor-qualification") {
      const name = values.text(classes.payload(value));
      if (name === null) python("TypeError", "Type __qualname__ is not a string");
      const result = values.string(Array.from(name + "." + completion.receiver.nativeKey, char => char.codePointAt(0)));
      classes.functionMetadata(completion.receiver, "qualifiedName", result);
      return valueTask(result, site, completion.after);
    }
    if (completion?.kind === "native-method-qualname") {
      const text = values.text(value);
      if (text === null) python("TypeError", "native method qualification requires a string __qualname__");
      return valueTask(values.string(Array.from(text + "." + completion.receiver.callable.name.slice(5), char => char.codePointAt(0))), site, completion.after);
    }
    if (completion?.kind === "bases-check") {
      if (!values.isSequenceType(value, "tuple")) python("TypeError", "type checking requires tuple __bases__");
      return attributeTask(completion.type, "__bases__", site, continuation("bases-class", completion), completion.depth);
    }
    if (completion?.kind === "bases-class") {
      if (!values.isSequenceType(value, "tuple")) python("TypeError", "type checking requires tuple __bases__");
      return completion.mode === "instance" ? attributeTask(completion.receiver, "__class__", site, continuation("bases-instance", completion), completion.depth) :
        basesWalk(completion, completion.receiver, site);
    }
    if (completion?.kind === "bases-instance") return basesWalk(completion, value, site);
    if (completion?.kind === "bases-walk") {
      const pending = values.isSequenceType(value, "tuple") ? [...value.items, ...completion.pending] : completion.pending;
      if (pending.length > 4096) hard("BUDGET", "ExecutionLimitError", "Advertised base traversal budget exceeded");
      return basesNext({...completion, pending}, site);
    }
    if (completion?.kind === "abstract-lookup") return unaryTask("truth", value, site,
      continuation("abstract-truth", completion), completion.depth);
    if (completion?.kind === "abstract-truth") return value ? valueTask(true, site, completion.after) :
      abstractNext({...completion, position: completion.position + 1}, site);
    if (completion?.kind === "check-result") return unaryTask("truth", value, site,
      continuation("check-truth", completion), completion.depth);
    if (completion?.kind === "check-truth") return valueTask(value, site, completion.after);
    if (completion?.kind === "advertised-super")
      return valueTask(classes.superProxy(completion.type, completion.receiver, value), site, completion.after);
    if (["instance-tuple", "subclass-tuple"].includes(completion?.kind)) {
      if (value || completion.position === completion.type.items.length) return valueTask(value, site, completion.after);
      charge(1);
      const next = completion.kind === "subclass-tuple" ? subclassTask : instanceTask;
      return next(completion.receiver, completion.type.items[completion.position], site,
        continuation(completion.kind, {...completion, position: completion.position + 1}), completion.depth, completion.nesting + 1);
    }
    if (completion?.kind === "native-repeat") {
      const payload = completion.receiver.nativePayload;
      const result = completion.inplace ? values.inplace("multiply", payload, value) : values.binary("multiply", payload, value);
      return valueTask(result === payload && completion.inplace ? completion.receiver : result, site, completion.after);
    }
    if (completion?.kind === "list-index") {
      const {receiver: original, name, item, after} = completion, receiver = classes.payload(original);
      const maximum = (1n << 63n) - 1n;
      if (value < -maximum - 1n || value > maximum)
        python("OverflowError", "Python int too large to convert to an index");
      const length = BigInt(receiver.items.length);
      let index = value < 0n ? value + length : value;
      if (name === "insert") {
        if (receiver.items.length >= VALUE_LIMITS.items) hard("BUDGET", "ExecutionLimitError", "Container length budget exceeded");
        index = index < 0n ? 0n : index > length ? length : index;
      } else if (index < 0n || index >= length) python("IndexError", "pop index out of range");
      charge(receiver.items.length + 1);
      const items = [...receiver.items], result = name === "insert" ? null : items[Number(index)];
      state.temporaries.push(result);
      if (name === "insert") items.splice(Number(index), 0, item); else items.splice(Number(index), 1);
      mutate(receiver, () => { const before = receiver.items; receiver.items = items; return () => { receiver.items = before; }; });
      return valueTask(result, site, after);
    }
    if (completion?.kind === "dictionary-pop") {
      const [found, item] = values.comparisonSequence(value);
      if (!found && completion.missing) python("KeyError", "Dictionary key not found", [completion.key]);
      return valueTask(found ? item : completion.fallback, site, completion.after);
    }
    if (completion?.kind === "sequence-bound") {
      const {receiver, key, position, depth, after} = completion, maximum = (1n << 63n) - 1n;
      const bounds = completion.bounds.map((bound, index) => index === position ? value < -maximum - 1n ? -maximum - 1n : value > maximum ? maximum : value : bound);
      if (position === 0) return unaryTask("index", bounds[1], site,
        continuation("sequence-bound", {...completion, bounds, position: 1}), depth);
      const length = BigInt(classes.payload(receiver).items.length);
      const [start, stop] = bounds.map(bound => bound < 0n ? bound + length < 0n ? 0n : bound + length : bound);
      return sequenceScan({receiver, key, name: "index", position: Number(start), stop, count: 0, candidate: null, depth, after}, site);
    }
    if (completion?.kind === "sequence-scan-equal") return unaryTask("truth", value, site, continuation("sequence-scan-truth", completion), completion.depth);
    if (completion?.kind === "sequence-scan-truth") {
      if (value && completion.name === "index") return valueTask(values.int(BigInt(completion.position)), site, completion.after);
      return sequenceScan({...completion, position: completion.position + 1, count: completion.count + (value ? 1 : 0)}, site);
    }
    if (completion?.kind === "native-bytes-init") {
      const receiver = completion.receiver.nativePayload;
      values.checkBufferResize(receiver);
      mutate(receiver, () => { const items = receiver.items; receiver.items = [...value.items]; return () => { receiver.items = items; }; });
      return valueTask(null, site, completion.after);
    }
    if (completion?.kind === "hierarchy-result") return unaryTask("iter", value, site, continuation("hierarchy-iter", completion));
    if (completion?.kind === "hierarchy-iter") {
      const after = continuation("hierarchy-sequence", completion);
      if (userProtocol(value)) return valueTask(value, site, continuation("dir-iter", {receiver: value, depth: 0, after}));
      const result = values.list([]); state.temporaries.push(value, result); return consumeNext("list", value, result, site, after, 0);
    }
    if (completion?.kind === "hierarchy-sequence") {
      const {transaction, type} = completion;
      if (type.mro === completion.before) {
        classes.validateMro(type, value.items);
        const entry = transaction.snapshots.find(item => item.type === type);
        mutate(type, () => {
          const previous = [type.mro, type.storage, type.typeLayout], installed = entry.installed;
          type.mro = Object.freeze([...value.items]); type.storage = classes.derivedStorage(type, type.bases); type.typeLayout = type.storage.family === "type";
          entry.installed = type.mro;
          return () => { [type.mro, type.storage, type.typeLayout] = previous; entry.installed = installed; };
        });
      }
      if (type === transaction.type && type.bases !== transaction.bases) return hierarchyTask(transaction, [], site, completion.after);
      return hierarchyTask(transaction, [...classes.subclasses(type).filter(item => item instanceof ClassValue), ...completion.pending], site, completion.after);
    }
    if (completion?.kind === "native-doc-result") return valueTask(null, site, completion.after);
    if (completion?.kind === "native-reinit") {
      const original = completion.receiver;
      classes.functionMetadata(original, "nativePayload", value);
      if (value instanceof PropertyValue) {
        const document = value.documentation; state.temporaries.push(document);
        classes.functionMetadata(value, "documentation", null);
        return attributeTask(original, "__doc__", site, continuation("native-doc-result", {receiver: original, ignoreAttribute: !value.getterDoc, after: completion.after}), 0, "set", null, null, document);
      }
      return valueTask(null, site, completion.after);
    }
    if (completion?.kind === "native-property-copy") {
      const copy = classes.payload(value), original = classes.payload(completion.receiver);
      if (copy instanceof PropertyValue) classes.mutate(copy, "__name__", original.propertyName, original.propertyName === undefined);
      return valueTask(value, site, completion.after);
    }
    if (completion?.kind === "property-diagnostic") {
      if (completion.phase === "lookup") return propertyDiagnostic({...completion, name: value, found: true}, site);
      const rendered = classes.payload(value);
      if (completion.phase === "name") return unaryTask("repr", completion.qualification, site,
        continuation("property-diagnostic", {...completion, phase: "qualification", renderedName: rendered}), completion.depth);
      const message = "property " + (completion.found ? values.text(completion.renderedName) + " " : "") +
        "of " + values.text(rendered) + " object has no " + completion.operation;
      const owned = values.string(Array.from(message, char => char.codePointAt(0))); state.temporaries.push(owned);
      python("AttributeError", values.text(owned));
    }
    if (completion?.kind === "native-new") {
      if (!(completion.type instanceof ClassValue)) return valueTask(value, site, completion.after);
      const instance = classes.instance(completion.type, value); state.temporaries.push(instance);
      if (value instanceof ModuleValue) classes.functionMetadata(instance, "attributes", values.environmentDictionary(value.environment));
      if (value instanceof MethodWrapperValue) classes.functionMetadata(value, "attributes", classes.instanceDictionary(instance));
      return valueTask(instance, site, completion.after);
    }
    if (completion?.kind === "new-result") {
      state.temporaries.push(value, ...completionRoots(completion));
      if (!classes.subclass(classes.typeOf(value), completion.type)) return valueTask(value, site, completion.after);
      return initialize(value, completion.args, completion.keywords, completion.keywordValues, site, completion.after, completion.depth, true);
    }
    if (completion?.kind === "class-created") {
      if (value instanceof ClassValue) {
        if (!completion.cell.bound) python("RuntimeError", "__class__ cell was not propagated to type.__new__");
        if (completion.cell.value !== value) python("TypeError", "__class__ cell refers to a different class");
      }
      return valueTask(value, site, completion.after);
    }
    if (completion?.kind === "arithmetic-order") {
      const record = completion, original = record.task;
      if (record.phase === "right") return attributeTask(classes.checkingType(original.args[0]),
        "__r" + ARITHMETIC_SLOTS[original.operation] + "__", site,
        continuation("arithmetic-order", {...record, phase: "left", candidate: value}), original.depth);
      if (record.phase === "left") return compareTask("not-equal", value, record.candidate, site,
        continuation("arithmetic-order", {...record, phase: "compare"}), original.depth);
      if (record.phase === "compare") return unaryTask("truth", value, site,
        continuation("arithmetic-order", {...record, phase: "truth"}), original.depth);
      return arithmeticOrder(original, value, site);
    }
    if (completion?.kind === "native-not-equal") return value instanceof NotImplementedValue ? valueTask(value, site, completion.after) :
      unaryTask("not", value, site, completion.after);
    if (completion?.kind === "native-method-hash") return valueTask(values.hashResult(value ^ genericHash(completion.receiver.receiver)), site, completion.after);
    if (completion?.kind === "native-method-compare") return completion.truth ?
      valueTask(completion.invert !== (value && completion.receiver.receiver === completion.other.receiver), site, completion.after) :
      unaryTask("truth", value, site, continuation("native-method-compare", {...completion, truth: true}), completion.depth);
    if (completion?.kind === "arithmetic-result") {
      if (!(value instanceof NotImplementedValue)) return valueTask(value, site, completion.after);
      const inplace = completion.operation.startsWith("inplace-");
      return arithmeticTask(inplace ? completion.operation.slice(8) : completion.operation, completion.args, site, completion.after,
        completion.depth, inplace ? 0 : completion.position, inplace ? null : completion.order, inplace || completion.nativeInplace, inplace ? null : completion.active);
    }
    if (completion?.kind === "arithmetic-index") {
      const args = [...completion.args]; args[completion.position] = value;
      return valueTask(completion.operation.startsWith("inplace-") ? values.inplace(completion.operation.slice(8), ...args) : values.binary(completion.operation, ...args), site, completion.after);
    }
    if (completion?.kind === "attribute-write") return valueTask(null, site, completion.after);
    if (completion?.kind === "function-entry") {
      const result = value.items[0] ? value.items[1] : classes.functionMissing(completion.receiver, values.text(completion.key), completion.operation);
      return valueTask(result, site, completion.after);
    }
    if (completion?.kind === "instance-entry") {
      if (completion.operation === "set") return valueTask(null, site, completion.after);
      if (value.items[0]) return valueTask(value.items[1], site, completion.after);
      const fallback = completion.operation === "get" ? {found: completion.found, value: completion.fallback, skipNative: completion.skipNative} : {found: false, skipNative: true};
      const plan = classes.instanceMissing(completion.receiver, values.text(completion.key), fallback);
      return plan.kind === "value" ? valueTask(plan.value, site, completion.after) :
        callTask(plan.callable, plan.args, [], [], site, completion.after, completion.depth);
    }
    if (completion?.kind === "attribute-result") return valueTask(completion.mode === "hasattr" ? true : value, site, completion.after);
    if (completion?.kind === "delegate-bind") return callTask(value, completion.args, [], [], site, completion.after);
    if (completion?.kind.startsWith("delegate-")) return delegateResult(completion.kind, value, site);
    count("deliver:" + (completion?.kind ?? "stack"));
    if (completion?.kind === "display-insert") return valueTask(completion.receiver, site, completion.after);
    if (completion?.kind === "display-iter") return unaryTask("next", value, site,
      continuation("display-next", {receiver: completion.receiver, iterator: value, after: completion.after}));
    if (completion?.kind === "display-next") {
      state.temporaries.push(value); values.append(completion.receiver, value);
      return unaryTask("next", completion.iterator, site, continuation("display-next", completion));
    }
    if (completion?.kind === "unpack-iter") {
      if (completion.tail !== null) refuseHints(value);
      const fields = {...completion, iterator: value, sourceIterator: value};
      return completion.tail !== null && completion.before === 0 ? unaryTask("iter", value, site, continuation("unpack-rest-iter", fields)) :
        unaryTask("next", value, site, continuation("unpack-next", fields));
    }
    if (completion?.kind === "unpack-rest-iter") return unaryTask("next", value, site,
      continuation("unpack-rest-next", {...completion, iterator: value}));
    if (completion?.kind === "unpack-next") {
      if (completion.tail === null && completion.result.items.length === completion.before) python("ValueError", "Too many values to unpack");
      state.temporaries.push(value); values.append(completion.result, value);
      if (completion.tail !== null && completion.result.items.length === completion.before)
        return unaryTask("iter", completion.iterator, site, continuation("unpack-rest-iter", completion));
      return unaryTask("next", completion.iterator, site, continuation("unpack-next", completion));
    }
    if (completion?.kind === "unpack-rest-next") {
      state.temporaries.push(value); values.append(completion.result, value);
      return unaryTask("next", completion.iterator, site, continuation("unpack-rest-next", completion));
    }
    if (completion?.kind === "call-duplicate-result") python("TypeError", "Call received multiple values for keyword argument '" + values.text(value) + "'");
    if (completion?.kind === "call-map-lookup") return callTask(value, [], [], [], site, continuation("call-map-keys", completion));
    if (completion?.kind === "call-map-keys") return consumeTask("list", value, site, continuation("call-map-sequence", completion));
    if (completion?.kind === "call-map-sequence") return mappingNext({...completion, keys: value, position: 0}, site);
    if (completion?.kind === "call-map-hash") {
      checkMapping(completion);
      return dictionaryTask(completion.receiver.keywordMap, completion.key, site,
        continuation("call-map-probe", {...completion, hash: value}), 0, "contains", null, value);
    }
    if (completion?.kind === "call-map-probe") {
      checkMapping(completion);
      if (value) return duplicateKeyword(completion.receiver, completion.key, site, completion.after);
      if (completion.receiver.keywordMap.entries.length >= 128) hard("BUDGET", "ExecutionLimitError", "Keyword call argument budget exceeded.");
      if (completion.mode === "keyword" || completion.version !== null) {
        const item = completion.mode === "keyword" ? completion.item : completion.mapping.entries[completion.position].value;
        return dictionaryTask(completion.receiver.keywordMap, completion.key, site,
          continuation("call-map-stored", completion), 0, "set", item, completion.hash);
      }
      return itemTask(completion.mapping, completion.key, site, continuation("call-map-value", completion));
    }
    if (completion?.kind === "call-map-value") {
      if (completion.mode === "display" && !values.dictionaryNeedsProtocol(completion.receiver, completion.key)) {
        state.temporaries.push(value); values.set(completion.receiver, completion.key, value);
        return mappingNext({...completion, position: completion.position + 1}, site);
      }
      return unaryTask("hash", completion.key, site, continuation("call-map-insert", {...completion, item: value}));
    }
    if (completion?.kind === "call-map-insert") return dictionaryTask(mappingStorage(completion), completion.key, site,
      continuation("call-map-stored", completion), 0, "set", completion.item, value);
    if (completion?.kind === "call-map-stored") return completion.mode === "keyword" ? valueTask(completion.receiver, site, completion.after) :
      mappingNext({...completion, position: completion.position + 1}, site);
    if (completion?.kind === "call-star-iter") return unaryTask("next", value, site,
      continuation("call-star-next", {receiver: completion.receiver, iterator: value, after: completion.after}));
    if (completion?.kind === "call-star-next") {
      appendArgument(completion.receiver, value);
      return unaryTask("next", completion.iterator, site, continuation("call-star-next", completion));
    }
    if (completion?.kind === "object-dir-dictionary") return objectDirectoryDictionary(completion, value, site);
    if (completion?.kind === "object-dir-class")
      return classes.isType(value) && !(value instanceof ClassValue && (value.metaclass !== null || classes.lookupMayCallback(value))) ?
        classDirectoryNext({...completion, owner: null, pending: [value], names: [], position: 0}, site) : graphDirectory(completion, value, site);
    if (completion?.kind === "graph-dir-dict") return valueTask(value, site, continuation("graph-dir-ready", completion));
    if (completion?.kind === "graph-dir-ready") {
      const source = value instanceof ClassNamespaceValue ? classes.namespaceDictionary(value.owner) : value;
      state.temporaries.push(source);
      if (values.isDict(source)) {
        const keys = values.list(source.entries.map(entry => entry.key)); state.temporaries.push(keys);
        return graphDirectoryCopy({...completion, source, keys, position: 0}, site);
      }
      if (source === null || values.typeName(source) !== null && !(source instanceof FrameLocalsValue)) python("AttributeError", "advertised class dictionary has no keys method");
      return attributeTask(source, "keys", site, continuation("graph-dir-keys", {...completion, source}), completion.depth);
    }
    if (completion?.kind === "graph-dir-keys") return callTask(value, [], [], [], site, continuation("graph-dir-call", completion), completion.depth);
    if (completion?.kind === "graph-dir-call") return consumeTask("list", value, site, continuation("graph-dir-copy", completion), completion.depth);
    if (completion?.kind === "graph-dir-copy") return graphDirectoryCopy({...completion, keys: value, position: 0}, site);
    if (completion?.kind === "graph-dir-value")
      return dictionaryTask(completion.result, completion.key, site, continuation("graph-dir-store", completion), completion.depth, "set", value);
    if (completion?.kind === "graph-dir-store") return graphDirectoryCopy({...completion, position: completion.position + 1}, site);
    if (completion?.kind === "graph-dir-bases") {
      if (values.isDict(value) || value instanceof ClassNamespaceValue || value instanceof FrameLocalsValue) python("TypeError", "advertised bases must be a sequence");
      return unaryTask("len", value, site, continuation("graph-dir-length", {...completion, source: value}), completion.depth);
    }
    if (completion?.kind === "graph-dir-length") {
      const length = lengthResult(value);
      if (length > 1024n) hard("BUDGET", "ExecutionLimitError", "Advertised directory base sequence budget exceeded");
      return graphDirectoryNext({...completion, bases: [...completion.bases, completion.source], positions: [...completion.positions, [0, Number(length)]]}, site);
    }
    if (completion?.kind === "graph-dir-child") return graphDirectoryVisit(completion, value, site);
    if (completion?.kind === "class-dir-merge") return classDirectoryNext(completion, site);
    if (completion?.kind === "method-dir-dictionary") return methodDirectory(completion, value, site);
    if (completion?.kind === "native-dir-merge") return nativeDirectoryNext(completion, site);
    if (completion?.kind === "dir-result") {
      const after = continuation("dir-sort", {receiver: value, depth: completion.depth, after: completion.after});
      return userProtocol(value) ? unaryTask("iter", value, site,
        continuation("dir-iter", {receiver: value, depth: completion.depth, after}), completion.depth) :
        consumeTask("list", value, site, after, completion.depth);
    }
    if (completion?.kind === "dir-iter") {
      state.temporaries.push(value);
      const record = {...completion, iterator: value};
      return classes.hasSlot(classes.checkingType(completion.receiver), "__len__") ? unaryTask("len", completion.receiver, site,
        continuation("dir-length", record), completion.depth) : directoryHint(record, site);
    }
    if (completion?.kind === "dir-length") {
      directoryCount(value); return directoryNext(completion, site);
    }
    if (completion?.kind === "dir-hint-bound")
      return callTask(value, [], [], [], site, continuation("dir-hint-call", completion), completion.depth);
    if (completion?.kind === "dir-hint-call")
      return valueTask(value, site, continuation("dir-hint-value", completion));
    if (completion?.kind === "dir-hint-value") {
      // __len__ rejects every negative value before its size conversion;
      // __length_hint__ performs the signed-size conversion first.
      if (typeof value === "bigint" && value < -9223372036854775808n)
        python("OverflowError", "directory length hint is below the signed-64-bit minimum");
      if (!(value instanceof NotImplementedValue)) directoryCount(value);
      return directoryNext(completion, site);
    }
    if (completion?.kind === "dir-sort") {
      if (completion.receiver instanceof FunctionValue && value.items.every(item => values.isString(item)))
        return valueTask(sortedDirectory(value), site, completion.after);
      return directorySort({receiver: value, index: 1, lower: 0, upper: 1, depth: completion.depth, after: completion.after}, site);
    }
    if (completion?.kind === "dir-compare")
      return unaryTask("truth", value, site, continuation("dir-truth", completion), completion.depth);
    if (completion?.kind === "dir-truth") {
      const middle = Math.floor((completion.lower + completion.upper) / 2);
      return directorySort({...completion, ...(value ? {upper: middle} : {lower: middle + 1})}, site);
    }
    if (completion?.kind === "consume-iter") return consumeNext(completion.name, value, completion.result, site, completion.after, completion.depth);
    if (completion?.kind === "consume-next") {
      const {name, receiver, result, after, depth} = completion;
      state.temporaries.push(value);
      if (["list", "tuple", "syntax-details"].includes(name)) {
        values.append(result, value); return consumeNext(name, receiver, result, site, after, depth);
      }
      if (values.isSet(result)) return dictionaryTask(result.storage, value, site,
        continuation("consume-stored", completion), depth, "set", null);
      if (values.isBinary(result)) return unaryTask("index", value, site, continuation("consume-byte", completion), depth);
      return unaryTask("truth", value, site, continuation("consume-truth", {name, receiver, result, after, depth}), depth);
    }
    if (completion?.kind === "consume-stored") return consumeNext(completion.name, completion.receiver,
      completion.result, site, completion.after, completion.depth);
    if (completion?.kind === "consume-byte") {
      values.appendByte(completion.result, value);
      return consumeNext(completion.name, completion.receiver, completion.result, site, completion.after, completion.depth);
    }
    if (completion?.kind === "binary-count") return valueTask(values.binaryCount(value, completion.mutable), site, completion.after);
    if (completion?.kind === "binary-result") {
      if (!values.isBinary(value) || value.mutable) python("TypeError", "__bytes__ returned a non-bytes value");
      return valueTask(value, site, completion.after);
    }
    if (completion?.kind === "binary-member") return valueTask(values.contains(value, completion.receiver), site, completion.after);
    if (completion?.kind === "byte-assignment") return valueTask(values.set(completion.receiver, completion.key, value), site, completion.after);
    if (completion?.kind === "consume-truth") {
      const {name, receiver, result, after, depth} = completion;
      if (value === (name === "any")) return valueTask(value, site, after);
      return consumeNext(name, receiver, result, site, after, depth);
    }
    if (["numeric-result","numeric-index"].includes(completion?.kind)) {
      const {name,args,position,slot,after,depth} = completion;
      if (completion.kind === "numeric-result") {
        if (["__abs__","__round__"].includes(slot)) return valueTask(value,site,after);
        if (["__int__","__index__"].includes(slot)) {
          if (typeof value !== "bigint" && typeof value !== "boolean") python("TypeError",slot + " returned a non-integer value");
          if (typeof value === "boolean") value = values.int(BigInt(value));
        } else if (slot === "__float__" && !values.isPrimitive(value,"float") || slot === "__complex__" && !values.isComplex(value))
          python("TypeError",slot + " returned an invalid numeric value");
      }
      const converted = args.map((argument,index)=>index === position ? value : argument);
      return numericTask(name,converted,site,after,depth,["complex", "range"].includes(name) ? position+1 : 0);
    }
    if (completion?.kind === "hash-result") return valueTask(values.hashResult(value), site, completion.after);
    if (completion?.kind === "sequence-hash") return hashNext(completion.receiver, completion.position + 1,
      values.combineHash(completion.hash, value), site, completion.after, completion.depth);
    if (completion?.kind === "dict-hash") return dictionaryTask(completion.receiver, completion.key, site, completion.after,
      completion.depth, completion.operation, completion.item, value);
    if (completion?.kind === "dict-key") return unaryTask("truth", value, site, continuation("dict-truth", completion), completion.depth);
    if (completion?.kind === "dict-truth") {
      if (completion.receiver.namespace && (completion.receiver.version !== completion.version ||
          completion.receiver.entries[completion.position]?.key !== completion.candidate))
        return dictionaryTask(completion.receiver, completion.key, site, completion.after, completion.depth,
          completion.operation, completion.item, completion.hash);
      checkDictionaryCandidate(completion);
      return value ? finishDictionary(completion, site, completion.position) :
        dictionaryTask(completion.receiver, completion.key, site, completion.after, completion.depth,
          completion.operation, completion.item, completion.hash, completion.position + 1);
    }
    if (completion?.kind === "dict-build") return dictionaryBuildTask(completion.receiver, completion.parts, site,
      completion.after, completion.depth, completion.position + 2);
    if (completion?.kind === "dict-pair") {
      checkDictionaryComparison(completion);
      const [found, other] = values.comparisonSequence(value);
      if (!found) return valueTask(completion.operation === "not-equal", site, completion.after);
      if (completion.value === other) return dictionaryNext(completion, site, completion.position + 1);
      if (completion.depth >= maxDepth) python("RecursionError", "maximum dictionary comparison depth exceeded");
      return compareTask("equal", completion.value, other, site, continuation("dict-value", completion), completion.depth + 1);
    }
    if (completion?.kind === "dict-value") return unaryTask("truth", value, site, continuation("dict-value-truth", completion), completion.depth);
    if (completion?.kind === "dict-value-truth") {
      checkDictionaryComparison(completion);
      return value ? dictionaryNext(completion, site, completion.position + 1) :
        valueTask(completion.operation === "not-equal", site, completion.after);
    }
    if (["compare-result", "ne-result"].includes(completion?.kind)) {
      const {operation, left, right, position, depth, after} = completion;
      if (value instanceof NotImplementedValue) return compareTask(operation, left, right, site, after, depth, position + 1);
      return completion.kind === "ne-result" ? unaryTask("not", value, site, after, depth) : valueTask(value, site, after);
    }
    if (completion?.kind === "sequence-item") return unaryTask("truth", value, site,
      continuation("sequence-truth", completion), completion.depth);
    if (completion?.kind === "sequence-truth") return value ? sequenceNext(completion, site, completion.position + 1) :
      sequenceDifferent(completion, site);
    if (completion?.kind === "search-equal") return unaryTask("truth", value, site, continuation("search-truth", completion), completion.depth);
    if (completion?.kind === "search-truth") return value ? valueTask(true, site, completion.after) :
      searchNext(completion.receiver, completion.key, site, completion.after, completion.depth);
    if (completion?.kind === "sentinel-equal") return unaryTask("truth", value, site, continuation("sentinel-truth", completion), completion.depth);
    if (completion?.kind === "sentinel-truth") {
      if (!value) return valueTask(completion.value, site, completion.after);
      exhaust(completion.receiver); return unaryTask("iterator-stop", completion.receiver, site, completion.after);
    }
    if (completion?.kind === "contains-result") return unaryTask("truth", value, site, completion.after, completion.depth);
    if (completion?.kind === "search-iter") return searchNext(value, completion.key, site, completion.after, completion.depth);
    if (completion?.kind === "search-next") {
      state.temporaries.push(value);
      if (value === completion.key) return valueTask(true, site, completion.after);
      return compareTask("equal", value, completion.key, site, continuation("search-equal", completion), completion.depth);
    }
    if (completion?.kind === "iter-result") {
      if (!(values.isIterator(value) || userProtocol(value) && classes.hasSlot(classes.checkingType(value), "__next__")))
        python("TypeError", "__iter__ returned a non-iterator");
      return valueTask(value, site, completion.after);
    }
    if (completion?.kind === "indexed-result") {
      const iterator = completion.receiver, before = iterator.index, index = values.int(before + 1n);
      state.temporaries.push(value);
      mutate(iterator, () => { iterator.index = index; return () => { iterator.index = before; }; });
      return valueTask(value, site, completion.after);
    }
    if (completion?.kind === "callable-result") {
      const iterator = completion.receiver;
      if (iterator.exhausted || value === iterator.sentinel) {
        exhaust(iterator); return unaryTask("iterator-stop", iterator, site, completion.after);
      }
      return compareTask("equal", iterator.sentinel, value, site,
        continuation("sentinel-equal", {receiver: iterator, value, after: completion.after, depth: 0}));
    }
    if (completion?.kind === "next-default") return valueTask(value, site, completion.after);
    if (["for-iter", "for-next", "for-exhausted"].includes(completion?.kind)) {
      const frame = state.frames.at(-1), task = frame.tasks.at(-1);
      if (completion.kind === "for-iter") {
        task.iterator = value; task.phase = "body";
        return unaryTask("next", value, task.site, continuation("for-next"));
      }
      if (completion.kind === "for-exhausted") { frame.tasks.pop(); block(frame, task.otherwise); }
      else {
        const writing = store(frame, task.target, value, true, continuation("store-body", {body: task.body}));
        if (writing) return writing;
        block(frame, task.body);
      }
      return null;
    }
    if (completion?.kind === "index-key") return itemTask(completion.receiver, value, site, completion.after, completion.depth, completion.operation, completion.item);
    if (completion?.kind === "slice-index") {
      const parts = [...completion.parts]; parts[[2, 0, 1][completion.position]] = value;
      return sliceNext(completion.receiver, parts, completion.position, site, completion.after, completion.depth, completion.operation, completion.item);
    }
    if (completion?.kind?.startsWith("import-")) return importer.resume(completion, value, site);
    if (completion?.kind === "exec-return") return valueTask(null, site, completion.after);
    if (["eval-locals", "eval-builtins-probe", "eval-builtins-default", "eval-builtins-stored"].includes(completion?.kind)) return evaluator.resume(completion, value, site);
    if (completion?.kind === "single-display") { write(values.text(value) + "\n"); return valueTask(null, site, completion.after); }
    if (completion?.kind === "compile-argument") return compiler.converted(completion, value, site);
    if (completion?.kind === "print-argument") return printNext(completion.args, completion.index + 1,
      site, completion.after, completion.depth, values.text(value));
    if (completion?.kind === "optional-truth") return unaryTask(completion.operation, value, site,
      completion.after, completion.depth);
    if (completion?.kind === "invoke") return callTask(value, completion.args, completion.keywords,
      completion.keywordValues, site, completion.after, completion.depth);
    if (completion?.kind === "notify") return notifyNext(completion.type, completion.entries, completion.index, site, completion.after, completion.keywords, completion.keywordValues);
    if (completion?.kind === "condition") {
      const frame = state.frames.at(-1), task = frame.tasks.at(-1);
      if (completion.control === "if") block(frame, value ? completion.body : completion.otherwise);
      else if (completion.control === "jump") { if (!value) task.pc = completion.target; }
      else if (completion.control === "while") {
        if (!value) { frame.tasks.pop(); block(frame, task.otherwise); }
        else { task.phase = "body"; block(frame, task.body); }
      }
      return null;
    }
    state.frames.at(-1).tasks.at(-1).stack.push(completion?.kind === "discard" ? null : value);
    return null;
  };
  const hashNext = (receiver, position, hash, site, after, depth) => {
    const parts = values.hashParts(receiver);
    if (position === parts.length) return valueTask(values.hashResult(BigInt.asIntN(64, hash ^ BigInt(parts.length))), site, after);
    charge(1);
    return unaryTask("hash", parts[position], site, continuation("sequence-hash", {receiver, position, hash, depth, after}), depth + 1);
  };
  const finalizeType = (record, site) => {
    const {type, entries, cell, dictcell, keywords, keywordValues, after} = record;
    if (cell) setCell(cell, type);
    if (dictcell) setCell(dictcell, classes.namespaceDictionary(type));
    return notifyNext(type, entries, 0, site, after, keywords, keywordValues);
  };
  const finishType = (type, entries, site, after, keywords, keywordValues, cell = null, dictcell = null) => {
    const record = {type, entries, cell, dictcell, keywords, keywordValues, after};
    if (!type.mroPending) return finalizeType(record, site);
    const item = classes.lookup(type.metaclass, "mro");
    if (!item.found) python("AttributeError", "mro");
    const plan = classes.bindAttribute(item.value, type, type.metaclass);
    const target = continuation("mro-result", record);
    return plan.kind === "value" ? callTask(plan.value, [], [], [], site, target) :
      callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: target, depth: 0}));
  };
  const notifyNext = (type, entries, index, site, after = null, keywords = [], keywordValues = []) => Object.freeze({
    kind: "notify", type, entries, index, site, completion: after, keywords, keywordValues, depth: 0});
  const notifyPlan = (type, entries, index, site, after = null, keywords = [], keywordValues = []) => {
    state.temporaries.push(type, ...entries.flatMap(entry => typeof entry[0] === "string" ? [entry[1]] : entry), ...keywordValues);
    while (index < entries.length) {
      charge(1);
      count("notify-entry");
      const [name, value] = entries[index++];
      // Keep the name rooted while planning a bound callback can allocate.
      const stored = typeof name === "string" ? (type.namespaceDictionary?.entries.find(entry => values.text(entry.key) === name)?.key ?? type.namespaceEntries?.find(entry => values.text(entry.key) === name)?.key) : name;
      const nameValue = stored ?? values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(nameValue);
      if (typeof name === "string" && (userProtocol(value) || value instanceof PropertyValue)) classes.rememberNamespaceKey(type, name, nameValue);
      const plan = classes.notification(value, type, nameValue);
      if (!plan) continue;
      return callTask(plan.callable, plan.args, [], [], site,
        plan.kind === "bind-call" ? continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], depth: 0,
          after: continuation("notify", {type, entries, index, keywords, keywordValues, after})}) :
          continuation("notify", {type, entries, index, keywords, keywordValues, after}));
    }
    const plan = classes.subclassNotification(type, keywords.length > 0);
    if (plan) {
      const finish = continuation("subclass-result", {receiver: type, after});
      return plan.kind === "value" ? callTask(plan.value, [], keywords, keywordValues, site, finish) :
        callTask(plan.callable, plan.args, [], [], site,
          continuation("invoke", {args: [], keywords, keywordValues, depth: 0, after: finish}));
    }
    return deliver(type, after, site);
  };
  const initialize = (instance, args, keywords, keywordValues, site, after, depth, customNew = false) => {
    if (classes.lookupMayCallback(instance)) return Object.freeze({...callTask(instance, args, keywords, keywordValues, site, after, depth), kind: "initialize", customNew});
    return initializePlan(instance, args, keywords, keywordValues, site, after, depth, customNew);
  };
  const initializePlan = (instance, args, keywords, keywordValues, site, after, depth, customNew = false) => {
    const type = instance instanceof InstanceValue ? instance.type : classes.typeOf(instance);
    let initializer = classes.lookup(type, "__init__", instance instanceof ExceptionValue || instance instanceof ClassValue || instance.nativePayload !== undefined && ["list", "dict", "set", "bytearray", "property", "staticmethod", "classmethod", "module", "super"].includes(type.storage.family));
    if (instance instanceof ClassValue && classes.isMetaclass(type) && !classes.hasSlot(type, "__init__") && initializer.value instanceof BuiltinValue && initializer.value.name === "object.__init__")
      initializer = {found: true, value: classes.builtin("type.__init__")};
    if (!initializer.found) {
      if (!customNew && (args.length || keywords.length)) python("TypeError", instance.type.name + "() takes no arguments");
      return valueTask(instance, site, after);
    }
    // The native type-call slot invokes its initializer directly, even when
    // a custom MRO hides the type required by the public wrapper descriptor.
    if (instance instanceof ClassValue && initializer.value instanceof BuiltinValue && initializer.value.name === "type.__init__")
      return callTask(classes.builtin("native-type-init"), [instance, ...args], keywords, keywordValues, site,
        continuation("init", {instance, after}), depth);
    const plan = customNew ? classes.bindAttribute(initializer.value, instance, type) : classes.read(instance, "__init__");
    const target = continuation("init", {instance, after});
    return plan.kind === "value" ? callTask(plan.value, args, keywords, keywordValues, site, target, depth) :
      callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args, keywords, keywordValues, after: target, depth}), depth);
  };
  const printNext = (args, index, site, after, depth, prefix = "") => {
    state.temporaries.push(...args);
    let text = prefix;
    for (; index < args.length; index++) {
      if (index) text += " ";
      if (userProtocol(args[index]) || exceptionDisplay(args[index])) {
        if (text) write(text);
        return unaryTask("str", args[index], site, continuation("print-argument", {args, index, depth, after}), depth);
      }
      const part = display(args[index]);
      if (text.length + part.length > 65536) hard("BUDGET", "ExecutionLimitError", "Output budget exceeded.");
      text += part;
    }
    write(text + "\n"); return deliver(null, after, site);
  };
  const sliceNext = (receiver, parts, position, site, after, depth, operation = "get", item = null) => {
    if (operation !== "get" && values.isView(receiver)) {
      values.liveView(receiver);
      if (receiver.readonly) python("TypeError", "cannot modify read-only memory");
      hard("UNSUPPORTED", "UnsupportedOperationError", "Buffer slice mutation requires a later value stage.");
    }
    if (operation !== "get" && values.isBinary(receiver)) {
      if (!receiver.mutable) python("TypeError", "bytes object does not support item assignment");
      hard("UNSUPPORTED", "UnsupportedOperationError", "Bytearray resizing and slice mutation require a later value stage.");
    }
    state.temporaries.push(receiver, ...parts, ...(operation === "set" ? [item] : []));
    if (!values.isSequence(receiver)) python("TypeError", "Slicing requires an adopted sequence");
    if (operation !== "get" && !values.isList(receiver)) python("TypeError", "Slice mutation requires a list");
    for (; position < 3; position++) {
      charge(1);
      const index = [2, 0, 1][position], value = parts[index];
      if (userProtocol(value)) return unaryTask("index", value, site,
        continuation("slice-index", {receiver, parts, position, after, depth, operation, item}), depth);
      if (value !== null && typeof value !== "bigint" && typeof value !== "boolean") python("TypeError", "slice indices must be integers or None");
      if (index === 2 && (value === 0n || value === false)) python("ValueError", "slice step cannot be zero");
    }
    return valueTask(operation === "get" ? values.slice(receiver, ...parts) :
      values.mutateSlice(receiver, ...parts, item, operation === "delete"), site, after, depth);
  };
  const searchNext = (receiver, key, site, after, depth) => {
    const task = unaryTask("next", receiver, site, continuation("search-next", {receiver, key, after, depth}), depth);
    // Transfer to the next closed owner before discarding previous search items.
    // A long native-iterator search must not retain every compared value.
    state.temporaries = operationRoots(task);
    return task;
  };
  const sequenceNext = (record, site, position = 0) => {
    const {left, right, operation, after, depth} = record;
    const a = values.comparisonSequence(left), b = values.comparisonSequence(right);
    while (position < a.length && position < b.length) {
      charge(1);
      if (a[position] === b[position]) { position++; continue; }
      if (depth >= maxDepth) python("RecursionError", "maximum comparison depth exceeded");
      return compareTask("equal", a[position], b[position], site,
        continuation("sequence-item", {left, right, operation, position, after, depth}), depth + 1);
    }
    return sequenceLength(record, site);
  };
  const sequenceLength = (record, site) => {
    const {left, right, operation, after} = record;
    const a = values.comparisonSequence(left), b = values.comparisonSequence(right), equal = a.length === b.length;
    return valueTask(operation === "equal" ? equal : operation === "not-equal" ? !equal :
      values.binary(operation, BigInt(a.length), BigInt(b.length)), site, after);
  };
  const sequenceDifferent = (record, site) => {
    const {left, right, operation, position, depth, after} = record;
    if (["equal", "not-equal"].includes(operation)) return valueTask(operation === "not-equal", site, after);
    const a = values.comparisonSequence(left), b = values.comparisonSequence(right);
    // Equality and its truth callback may have changed either list. Select the
    // current unequal pair only after those callbacks, as the native list does.
    if (position >= a.length || position >= b.length) return sequenceLength(record, site);
    return compareTask(operation, a[position], b[position], site, after, depth + 1);
  };
  const checkDictionaryCandidate = record => {
    if (record.receiver.version !== record.version || record.receiver.entries[record.position]?.key !== record.candidate)
      hard("UNSUPPORTED", "UnsupportedOperationError", "Structural dictionary mutation during key comparison requires its restart stage.");
  };
  const finishDictionary = (record, site, position) => {
    const {receiver, key, item, hash, operation, completion: destination} = record, after = record.after ?? destination ?? null;
    const found = position >= 0;
    if (operation === "contains") return valueTask(found, site, after);
    if (["remove-probe", "pop-probe"].includes(operation)) {
      const value = found && operation === "pop-probe" ? receiver.entries[position].value : null;
      state.temporaries.push(value);
      if (found) values.commitDictionary(receiver, key, null, hash, position, true);
      return valueTask(values.tuple([found, value]), site, after);
    }
    if (operation === "probe-entry") return valueTask(values.tuple([found, found ? receiver.entries[position].key : null]), site, after);
    if (operation === "set-default") return valueTask(found ? receiver.entries[position].value : (values.commitDictionary(receiver, key, item, hash, position), item), site, after);
    if (operation === "probe") return valueTask(values.tuple([found, found ? receiver.entries[position].value : null]), site, after);
    if (operation === "set") return valueTask(values.commitDictionary(receiver, key, item, hash, position), site, after);
    if (operation === "discard" && !found) return valueTask(null, site, after);
    if (!found) python("KeyError", "Dictionary key not found", [key]);
    return valueTask(operation === "get" ? receiver.entries[position].value :
      values.commitDictionary(receiver, key, null, hash, position, true), site, after);
  };
  const checkDictionaryComparison = record => {
    if (!(record.left.namespace && record.right.namespace) && (record.left.version !== record.version || record.right.version !== record.otherVersion))
      hard("UNSUPPORTED", "UnsupportedOperationError", "Structural mutation during dictionary equality requires its restart stage.");
  };
  const dictionaryNext = (record, site, position = 0) => {
    const {left, right, operation, after, depth, version, otherVersion} = record;
    checkDictionaryComparison(record);
    if (left.namespace && record.serial !== undefined && record.serial !== null) position = values.dictionaryPosition(left, record.serial + 1);
    if (position < 0 || position >= left.entries.length) return valueTask(operation === "equal", site, after);
    const entry = left.entries[position];
    return dictionaryTask(right, entry.key, site,
      continuation("dict-pair", {left, right, value: entry.value, operation, after, depth, version, otherVersion, position,
        serial: left.namespace ? entry.position : null}), depth,
      "probe", null, values.dictionaryEntryHash(entry));
  };
  const proxyRelay = (left, right, after) => continuation("relay", {receiver: left, after: continuation("relay", {receiver: right, after})});
  const unionNext = (record, site) => {
    const {left, right, result, size, depth, after} = record;
    state.temporaries.push(left, right, result);
    if (right.entries.length !== size) python("RuntimeError", "dict mutated during update");
    const position = values.dictionaryPosition(right, record.serial + 1), entry = position < 0 ? null : right.entries[position];
    if (!entry) return valueTask(result, site, after);
    return dictionaryTask(result, entry.key, site, continuation("dict-union", {...record, serial: entry.position}), depth,
      "set", entry.value, values.dictionaryEntryHash(entry));
  };
  const hierarchyDone = transaction => {
    transaction.active = false;
    const index = state.transactions.indexOf(transaction); if (index >= 0) state.transactions.splice(index, 1);
  };
  const hierarchyNext = (transaction, pending, site, after) => {
    if (!pending.length || !transaction.active) { hierarchyDone(transaction); return valueTask(null, site, after); }
    const [type, ...tail] = pending;
    let entry = transaction.snapshots.find(item => item.type === type);
    if (!entry) {
      entry = {type, bases: type.bases, mro: type.mro, storage: type.storage, typeLayout: type.typeLayout, installed: null};
      mutate(transaction, () => { transaction.snapshots.push(entry); return () => transaction.snapshots.pop(); });
    }
    const storage = classes.derivedStorage(type, type.bases);
    mutate(type, () => { const previous = type.storage; type.storage = storage; return () => { type.storage = previous; }; });
    const record = {transaction, type, before: type.mro, pending: tail, after};
    const item = type.metaclass ? classes.lookup(type.metaclass, "mro") : {found: false};
    if (item.found && !(item.value instanceof BuiltinValue && item.value.name === "type.mro")) {
      const plan = classes.bindAttribute(item.value, type, type.metaclass);
      return plan.kind === "value" ? callTask(plan.value, [], [], [], site, continuation("hierarchy-result", record)) :
        callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], depth: 0, after: continuation("hierarchy-result", record)}));
    }
    const result = values.list(classes.defaultMro(type)); state.temporaries.push(result);
    return valueTask(result, site, continuation("hierarchy-sequence", record));
  };
  const dispatch = task => {
    while (task) {
      classes.lookupCache = task.lookupCache || null;
      count("dispatch:" + task.kind);
      let {callable, args, keywords, keywordValues, site, completion, depth} = task;
      try {
        if (task.kind === "hierarchy-next") {
          state.temporaries = operationRoots(task);
          try { task = hierarchyNext(task.transaction, task.pending, site, completion); }
          catch (error) { if (!(error instanceof NamespaceLookupRequest)) { task.transaction.rollback(); hierarchyDone(task.transaction); } throw error; }
          continue;
        }
        if (task.kind === "namespace-create") {
          state.temporaries = operationRoots(task);
          const {phase, dictionary} = task;
          const probe = (name, field, operation = "pop-probe", item = null) => {
            const key = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(key, item);
            const after = continuation("namespace-build", {task, field});
            if (!dictionary.ownedKeys) {
              const index = values.find(dictionary, key), found = index >= 0, value = found ? dictionary.entries[index].value : null;
              state.temporaries.push(value);
              if (operation === "pop-probe") { if (found) values.remove(dictionary, key); return valueTask(values.tuple([found, value]), site, after); }
              if (operation === "probe") return valueTask(values.tuple([found, value]), site, after);
              if (!found) values.set(dictionary, key, item);
              return valueTask(found ? value : item, site, after);
            }
            return dictionaryTask(dictionary, key, site, after, depth, operation, item);
          };
          if (phase === 0) { task = probe("__qualname__", "qualname"); continue; }
          if (phase === 1) { task = probe("__module__", "module", "probe"); continue; }
          if (phase === 2) { task = task.moduleFound ? namespaceCreateTask({...task, phase: 3}, site, completion, depth) : probe("__module__", "stored", "set-default", task.moduleObject); continue; }
          if (phase === 3) { task = probe("__classcell__", "cell"); continue; }
          if (phase === 4) { task = probe("__classdictcell__", "dictcell"); continue; }
          if (phase === 5) {
            let protocolIndex = task.protocolIndex ?? 0;
            while (protocolIndex < CLASS_PROTOCOL_NAMES.length && !values.callbackKeyMayMatch(dictionary, CLASS_PROTOCOL_NAMES[protocolIndex])) protocolIndex++;
            if (protocolIndex < CLASS_PROTOCOL_NAMES.length) {
              const name = CLASS_PROTOCOL_NAMES[protocolIndex], key = values.string(Array.from(name, char => char.codePointAt(0)));
              state.temporaries.push(key);
              task = dictionaryTask(dictionary, key, site, continuation("namespace-build", {task: {...task, protocolIndex}, field: "protocol"}), depth, "probe-entry"); continue;
            }
            const namespace = new Map(dictionary.entries.map(entry => [values.text(entry.key) ?? entry.key, entry.value]));
            if (!task.slotsDone && (namespace.has("__slots__") || task.protocolNames?.includes("__slots__"))) { task = probe("__slots__", "slots", "probe"); continue; }
            const type = classes.create(task.name, task.qualname ?? task.name, values.text(task.moduleObject) ?? task.module, task.bases, namespace, classes.builtin("object"),
              {dynamic: task.dynamic, metaclass: task.metaclass ?? null, firstLine: task.firstLine ?? null,
                staticAttributes: task.staticAttributes ?? null, namespaceEntries: dictionary.entries, protocolNames: task.protocolNames, slotNames: task.slotNames ?? null});
            state.temporaries.push(type);
            // Wrap source __new__/__init_subclass__ once, preserving their stored keys.
            for (const entry of dictionary.entries) {
              const key = values.text(entry.key); if (["__new__", "__init_subclass__"].includes(key) && type.namespace.has(key)) entry.value = type.namespace.get(key);
            }
            classes.installNamespaceDictionary(type, dictionary);
            classes.installStorage(type);
            task = namespaceCreateTask({...task, type, phase: 6}, site, completion, depth); continue;
          }
          if (phase === 6 || phase === 7) {
            const name = phase === 6 ? "__dict__" : "__weakref__";
            const ownStorage = phase === 6 ? task.type.storage.ownDict : task.type.storage.ownWeak;
            task = ownStorage ? probe(name, "stored", "set-default", classes.namespaceDescriptor(task.type, name, "getset_descriptor")) :
              namespaceCreateTask({...task, phase: phase + 1}, site, completion, depth); continue;
          }
          if (phase === 8) { task = probe("__doc__", "stored", "set-default", null); continue; }
          if (phase === 9 && task.type.automaticHash) { task = probe("__hash__", "stored", "set-default", null); continue; }
          task = finishType(task.type, dictionary.entries.map(entry => [entry.key, entry.value]), site, completion, keywords, keywordValues, task.cell, task.dictcell); continue;
        }
        if (task.kind === "notify") {
          task = notifyPlan(task.type, task.entries, task.index, site, completion, keywords, keywordValues); continue;
        }
        if (task.kind === "initialize") {
          state.temporaries = operationRoots(task);
          task = initializePlan(task.callable, args, keywords, keywordValues, site, completion, depth, task.customNew); continue;
        }
        if (task.kind === "unary" && task.operation === "super-invalid") {
          state.temporaries = operationRoots(task);
          python("TypeError", "super receiver must be an instance or subtype of its first argument");
        }
        if (["instance", "subclass"].includes(task.kind)) {
          state.temporaries = operationRoots(task);
          const {receiver, type, nesting} = task;
          const subclass = task.kind === "subclass", next = subclass ? subclassTask : instanceTask;
          const slot = subclass ? "__subclasscheck__" : "__instancecheck__", tuple = subclass ? "subclass-tuple" : "instance-tuple";
          if (values.isSequenceType(type, "tuple")) {
            if (nesting >= 32) hard("BUDGET", "ExecutionLimitError", "Class-info tuple nesting budget exceeded");
            if (!type.items.length) { task = valueTask(false, site, completion); continue; }
            charge(1);
            task = next(receiver, type.items[0], site,
              continuation(tuple, {receiver, type, position: 1, nesting, depth, after: completion}), depth, nesting + 1);
            continue;
          }
          if (!task.native && classes.customCheck(type, slot)) {
            if (!subclass && classes.typeOf(receiver) === type) { task = valueTask(true, site, completion); continue; }
            if (++depth > maxDepth) python("RecursionError", "maximum type-check dispatch depth exceeded");
            const plan = classes.bindCheck(type, slot);
            const target = continuation("check-result", {receiver, type, depth, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, [receiver], [], [], site, target, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [receiver], keywords: [], keywordValues: [], after: target, depth}), depth);
            continue;
          }
          if (subclass && classes.isType(receiver) && classes.isType(type)) { task = valueTask(classes.subclass(receiver, type), site, completion); continue; }
          if (subclass || !classes.isType(type)) {
            task = attributeTask(subclass ? receiver : type, "__bases__", site,
              continuation(subclass ? "bases-check" : "bases-class", {receiver, type, mode: subclass ? "subclass" : "instance", depth, after: completion}), depth); continue;
          }
          if (classes.subclass(classes.typeOf(receiver), type)) { task = valueTask(true, site, completion); continue; }
          if (!classes.needsAdvertised(receiver)) { task = valueTask(false, site, completion); continue; }
          task = attributeTask(receiver, "__class__", site, continuation("advertised-instance", {receiver, type, after: completion}), depth);
          continue;
        }
        if (task.kind === "attribute") {
          if (task.receiver instanceof ModuleValue && task.receiver.type && task.operation === "import") {
            task = attributeTask(task.receiver, task.name, site, continuation("module-missing", {receiver: task.receiver, name: task.name, mode: "import", skipNamespace: true, after: completion}), depth);
            continue;
          }
          if (task.receiver instanceof ModuleValue && !task.receiver.type) {
            state.temporaries = operationRoots(task);
            const {receiver, name, operation} = task, environment = receiver.environment;
            const writing = ["set", "delete", "native-set", "native-delete"].includes(operation);
            if (name === "__dict__") {
              if (writing) python("AttributeError", "readonly attribute");
              task = valueTask(values.environmentDictionary(environment), site, completion); continue;
            }
            if (name === "__class__") {
              if (writing) { task = valueTask(classes.reassignClass(receiver, task.item, operation.includes("delete")), site, completion); continue; }
              task = valueTask(classes.classAttribute(receiver), site, completion); continue;
            }
            const key = task.key || values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(key);
            if (writing) {
              if (environment.dictionary !== null) {
                task = dictionaryTask(environment.dictionary, key, site, operation.includes("delete") ?
                  continuation("module-delete", {receiver, name, after: completion}) : completion, depth,
                  operation.includes("delete") ? "remove-probe" : "set", task.item); continue;
              }
              if (operation.includes("delete")) {
                const cell = environment.cells.get(name);
                if (!cell?.bound) python("AttributeError", "module has no attribute " + name);
                setCell(cell, null, false); environment.order.delete(name);
              } else moduleContext.binding(environment, name, task.item);
              task = valueTask(null, site, completion); continue;
            }
            const record = {receiver, key, name, mode: operation === "import" ? "import" : operation === "native-get" ? "native-get" : "get", depth, after: completion};
            if (environment.dictionary !== null) { task = dictionaryTask(environment.dictionary, key, site, continuation("module-entry", record), depth, "probe"); continue; }
            const cell = environment.cells.get(name);
            task = moduleEntry(record, site, !!cell?.bound, cell?.value); continue;
          }
          state.temporaries = operationRoots(task);
          const {receiver, name, operation} = task;
          const writing = ["set", "delete", "native-set", "native-delete"].includes(operation), removing = operation.endsWith("delete");
          const advertisedWrite = writing && name === "__class__" && userProtocol(receiver) && classes.hasSlot(classes.checkingType(receiver), "__class__");
          const identityWrite = writing && classes.isPythonMethod(receiver) && ["__name__", "__qualname__", "__module__"].includes(name);
          if (!(receiver instanceof ModuleValue && name === "__path__" || receiver instanceof FrameValue || receiver instanceof FrameLocalsValue || receiver instanceof GeneratorValue || receiver instanceof FunctionValue || classes.isPythonMethod(receiver) || (receiver instanceof InstanceValue || receiver instanceof ClassValue) && name === "__dict__" || (writing ? advertisedWrite || identityWrite || allowsClassSpecial(name, "mutate") : allowsClassSpecial(name, "attribute") || ["__class__", "__name__", "__qualname__", "__module__", "__bases__", "__mro__"].includes(name))))
            hard("UNSUPPORTED", "UnsupportedOperationError", "This special attribute is outside classes-source/1.");
          const key = task.key ?? values.string(Array.from(name, char => char.codePointAt(0)));
          state.temporaries.push(key);
          if (writing) completion = continuation("attribute-write", {receiver, after: completion});
          if (operation === "get" && classes.hasAttributeHook(receiver, "__getattr__")) {
            const hook = classes.lookup(classes.checkingType(receiver), "__getattr__");
            if (hook.found) completion = continuation("attribute-fallback", {receiver, name, key, hook: hook.value, depth, after: completion});
          }
          state.temporaries.push(...completionRoots(completion));
          let plan;
          if (["set", "delete"].includes(operation) && classes.hasAttributeHook(receiver, removing ? "__delattr__" : "__setattr__"))
            plan = classes.special(receiver, removing ? "__delattr__" : "__setattr__");
          else if (operation === "fallback") plan = classes.bindAttribute(task.hook, receiver, classes.checkingType(receiver));
          else if (operation === "get" && classes.hasAttributeHook(receiver, "__getattribute__"))
            plan = classes.special(receiver, "__getattribute__");
          else {
            plan = writing ? classes.write(receiver, name, task.item, removing, key) : classes.read(receiver, name, operation === "native-get", key);
            task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site,
              plan.kind === "bind-call" ? continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], after: completion, depth}) : completion, depth);
            continue;
          }
          if (++depth > maxDepth) python("RecursionError", "maximum attribute dispatch depth exceeded");
          const target = continuation("relay", {receiver, after: completion});
          const hookArgs = writing && !removing ? [key, task.item] : [key];
          task = plan.kind === "value" ? callTask(plan.value, hookArgs, [], [], site, target, depth) :
            callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: hookArgs, keywords: [], keywordValues: [], after: target, depth}), depth);
          continue;
        }
        if (task.kind === "unary" && task.operation === "delegate-raise") { injectGenerator(task.value); return; }
        if (task.kind === "unary" && task.operation === "attribute-error") throw new Raised(task.value);
        if (task.kind === "unary" && task.operation === "unpack-short") {
          state.temporaries = operationRoots(task); python("ValueError", "Not enough values to unpack");
        }
        if (task.kind === "unary" && task.operation === "class-delete-missing") python("NameError", "name is not defined in class namespace");
        if (task.kind === "unary" && ["call-keyword-duplicate", "call-mapping-required"].includes(task.operation)) {
          state.temporaries = operationRoots(task);
          python("TypeError", task.operation === "call-keyword-duplicate" ? "Call received multiple values for a keyword argument" : "Argument after ** must be a mapping");
        }
        if (task.kind === "arithmetic") {
          state.temporaries = operationRoots(task);
          const [left, right, modulus = null] = args, inplace = task.operation.startsWith("inplace-"), operation = inplace ? task.operation.slice(8) : task.operation;
          if (operation === "bit-or" && (left instanceof FrameLocalsValue || right instanceof FrameLocalsValue)) {
            if (inplace && left instanceof FrameLocalsValue) {
              if (values.isDict(right) || right instanceof FrameLocalsValue) { task = frameUpdate({receiver: left, source: right, self: true, after: completion}, site); continue; }
              task = arithmeticTask("bit-or", args, site, completion, depth, 0, null, true); continue;
            }
            if (left instanceof FrameLocalsValue && (values.isDict(right) || right instanceof FrameLocalsValue) || right instanceof FrameLocalsValue && values.isDict(left)) {
              const receiver = left instanceof FrameLocalsValue ? left : right;
              task = frameSnapshot(receiver, site, continuation("frame-result", {action: "task", task, receiver})); continue;
            }
          }

          if (operation === "bit-or" && (left instanceof ClassNamespaceValue || right instanceof ClassNamespaceValue)) {
            if (inplace && left instanceof ClassNamespaceValue) python("TypeError", "mappingproxy does not support in-place union");
            if (left instanceof ClassNamespaceValue || !userProtocol(left) || task.position > 0) {
              const a = left instanceof ClassNamespaceValue ? values.classNamespaceDictionary(left) : left;
              const b = right instanceof ClassNamespaceValue ? values.classNamespaceDictionary(right) : right;
              task = arithmeticTask("bit-or", [a, b], site, proxyRelay(left, right, completion), depth); continue;
            }
          }
          const stem = ARITHMETIC_SLOTS[operation], ordinary = "__" + stem + "__", reflected = "__r" + stem + "__";
          const active = task.active ?? [left, right].reduce((mask, receiver, index) => mask | (userProtocol(receiver) &&
            [ordinary, reflected].some(slot => classes.lookup(classes.checkingType(receiver), slot).found) ? 1 << index : 0), 0);
          if (!inplace && task.order === null && userProtocol(left) && userProtocol(right) &&
              classes.checkingType(left) !== classes.checkingType(right) && classes.checkingType(right).mro.includes(classes.checkingType(left)) &&
              [left, right].every(receiver => [ordinary, reflected].some(slot => classes.hasSlot(classes.checkingType(receiver), slot)))) {
            if (++depth > maxDepth) python("RecursionError", "maximum arithmetic priority depth exceeded");
            const original = arithmeticTask(task.operation, args, site, completion, depth, task.position, null, task.nativeInplace, active);
            task = attributeTask(classes.checkingType(right), reflected, site,
              continuation("arithmetic-order", {task: original, phase: "right", after: completion}), depth); continue;
          }
          const rightFirst = task.order ?? (userProtocol(left) && userProtocol(right) && classes.checkingType(left) !== classes.checkingType(right) &&
            classes.checkingType(right).mro.includes(classes.checkingType(left)) && classes.lookup(classes.checkingType(right), reflected).found &&
            (!classes.lookup(classes.checkingType(left), reflected).found || classes.lookup(classes.checkingType(right), reflected).value !== classes.lookup(classes.checkingType(left), reflected).value));
          const candidates = inplace ? [[left, "__i" + stem + "__", right]] : rightFirst ?
            [[right, reflected, left], [left, ordinary, right]] : [[left, ordinary, right], [right, reflected, left]];
          let position = task.position, plan = null;
          for (; position < candidates.length; position++) {
            charge(1);
            const [receiver, slot] = candidates[position];
            if (!userProtocol(receiver) || !inplace && !(active & (receiver === left && slot === ordinary ? 1 : 2)) ||
                !inplace && slot === reflected && userProtocol(left) && userProtocol(right) && classes.checkingType(left) === classes.checkingType(right)) continue;
            plan = classes.special(receiver, slot); if (plan) break;
          }
          if (plan) {
            if (++depth > maxDepth) python("RecursionError", "maximum implicit arithmetic dispatch depth exceeded");
            const hookArgs = [candidates[position][2], ...(operation === "power" && modulus !== null ? [modulus] : [])];
            const finish = continuation("arithmetic-result", {operation: task.operation, args, position: position + 1, order: rightFirst, active, nativeInplace: task.nativeInplace, depth, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, hookArgs, [], [], site, finish, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: hookArgs, keywords: [], keywordValues: [], after: finish, depth,
                fallback: inplace ? null : {operation: "arithmetic-next", after: finish, depth}}), depth);
            continue;
          }
          if (inplace) { task = arithmeticTask(operation, args, site, completion, depth, 0, null, true); continue; }
          // A native number slot can also be selected through the modulus. A
          // source type with either power override uses the shared Python slot.
          if (operation === "power" && modulus !== null) {
            if (!args.some(value => ["int", "bool", "float", "complex"].includes(values.typeName(classes.payload(value))) &&
                (!userProtocol(value) || ![ordinary, reflected].some(slot => classes.hasSlot(classes.checkingType(value), slot)))))
              python("TypeError", "unsupported operands for ternary power");
            task = valueTask(values.numericCall("pow", args.map(value => classes.payload(value))), site, completion); continue;
          }
          if (task.nativeInplace && operation === "add" && values.isList(left) && userProtocol(right)) {
            const iterator = classes.lookup(classes.checkingType(right), "__iter__");
            if (iterator.found ? iterator.value !== null : classes.lookup(classes.checkingType(right), "__getitem__").found)
              hard("UNSUPPORTED", "UnsupportedOperationError", "List += with a user iterable requires its own sequence stage.");
          }
          if (operation === "multiply") {
            const repeatable = value => values.isString(value) || values.isBinary(value) || values.isList(value) || values.isSequenceType(value, "tuple");
            const count = repeatable(left) && userProtocol(right) ? 1 : repeatable(right) && userProtocol(left) ? 0 : -1;
            if (count >= 0 && classes.lookup(classes.checkingType(args[count]), "__index__").found) {
              task = unaryTask("index", args[count], site, continuation("arithmetic-index", {operation: task.nativeInplace ? "inplace-" + operation : operation, args, position: count, order: rightFirst, nativeInplace: task.nativeInplace, depth, after: completion}), depth); continue;
            }
          }
          if (operation === "bit-or" && values.isDict(left) && values.isDict(right)) {
            values.enableNamespace(left); values.enableNamespace(right);
            const result = values.copyDictionary(left); state.temporaries.push(result);
            task = unionNext({left, right, result, size: right.entries.length, serial: -1, after: completion, depth}, site); continue;
          }
          if (classes.payload(left) !== left || classes.payload(right) !== right) {
            task = valueTask(values.binary(operation, classes.payload(left), classes.payload(right)), site, proxyRelay(left, right, completion)); continue;
          }
          python("TypeError", "unsupported operands for " + operation);
        }
        if (task.kind === "consume") {
          state.temporaries = operationRoots(task);
          const {name, receiver} = task, building = ["list", "tuple", "syntax-details"].includes(name);
          const hintOwner = receiver instanceof ProtocolIteratorValue && receiver.kind === "indexed" ? receiver.source : receiver;
          if (name !== "syntax-details" && (building || name === "bytes") && userProtocol(hintOwner) &&
              ["__len__", "__length_hint__"].some(slot => (hintOwner.nativePayload === undefined ? classes.lookup(classes.checkingType(hintOwner), slot).found : classes.hasSlot(classes.checkingType(hintOwner), slot))))
            hard("UNSUPPORTED", "UnsupportedOperationError", "User length hints require a separate construction stage.");
          const result = task.result ?? (building ? values.list([]) : ["bytes", "bytearray"].includes(name) ? values.binaryValue([], true) :
            ["set", "frozenset"].includes(name) ? values.newSet(name === "frozenset") : null);
          state.temporaries.push(result);
          task = unaryTask("iter", receiver, site, continuation("consume-iter", {name, receiver, result, after: completion, depth}), depth);
          continue;
        }
        if (task.kind === "numeric") {
          state.temporaries = operationRoots(task);
          const name = task.name;
          if (["pow", "divmod"].includes(name) && args.some(userProtocol)) {
            task = arithmeticTask(name === "pow" ? "power" : "divmod", args.slice(0, name === "pow" && args[2] !== null ? 3 : 2), site, completion, depth); continue;
          }
          let position = task.position;
          if (name === "range") {
            while (position < args.length && !userProtocol(args[position])) {
              if (!["bigint", "boolean"].includes(typeof args[position])) python("TypeError", "range() argument cannot be interpreted as an integer");
              position++;
            }
            task = position === args.length ? valueTask(values.range(args), site, completion) :
              unaryTask("index", args[position], site, continuation("numeric-index", {name, args, position, depth, after: completion}), depth);
            continue;
          }
          if (name === "complex" && args.length === 2 && values.isString(args[0])) python("TypeError", "complex() first argument cannot be a string with two arguments");
          if (name === "round" && !userProtocol(args[0]) && !values.isPrimitive(args[0],"int") && !values.isPrimitive(args[0],"float"))
            python("TypeError", "round() argument has no numeric type slot");
          if (name === "int" && args.length === 2) {
            if (userProtocol(args[1])) {
              task = unaryTask("index",args[1],site,continuation("numeric-index",{name,args,position:1,depth,after:completion}),depth); continue;
            }
            task = deliver(values.realConstructor(name,args,true),completion,site); continue;
          }
          if (["bin","oct","hex","chr"].includes(name) && userProtocol(args[0]) ||
              name === "round" && !userProtocol(args[0]) && userProtocol(args[1])) {
            position = name === "round" ? 1 : 0;
            task = unaryTask("index",args[position],site,continuation("numeric-index",{name,args,position,depth,after:completion}),depth); continue;
          }
          if (name === "complex") while (position < args.length && !userProtocol(args[position])) position++;
          const receiver = args[position];
          if (userProtocol(receiver) && ["int","float","complex","abs","round"].includes(name)) {
            charge(1);
            if (++depth > maxDepth) python("RecursionError","maximum implicit numeric dispatch depth exceeded");
            const slots = name === "int" ? ["__int__","__index__"] : name === "float" ? ["__float__","__index__"] :
              name === "complex" ? (position === 0 ? ["__complex__","__float__","__index__"] : ["__float__","__index__"]) : [name === "abs" ? "__abs__" : "__round__"];
            let plan,slot;
            for (slot of slots) { plan = classes.special(receiver,slot); if (plan) break; }
            if (!plan) python("TypeError",name + "() argument has no adopted numeric type slot");
            const hookArgs = name === "round" && args[1] !== null ? [args[1]] : [];
            const finish = continuation("numeric-result",{name,args,position,slot,depth,after:completion});
            task = plan.kind === "value" ? callTask(plan.value,hookArgs,[],[],site,finish,depth) :
              callTask(plan.callable,plan.args,[],[],site,continuation("invoke",{args:hookArgs,keywords:[],keywordValues:[],after:finish,depth}),depth);
            continue;
          }
          let result;
          if (["int","float"].includes(name)) result = values.realConstructor(name,args);
          else if (name === "complex") result = values.complexConstructor(args);
          else if (name === "divmod") {
            const quotient = values.binary("floor-divide",args[0],args[1]);state.temporaries.push(quotient);
            const remainder = values.binary("modulo",args[0],args[1]);state.temporaries.push(remainder);
            result = values.tuple([quotient,remainder]);
          } else result = values.numericCall(name,args);
          task = deliver(result,completion,site); continue;
        }
        if (task.kind === "dict-build") {
          state.temporaries = operationRoots(task);
          task = task.position >= task.parts.length ? valueTask(task.receiver, site, completion) :
            dictionaryTask(task.receiver, task.parts[task.position], site, continuation("dict-build", {receiver: task.receiver,
              parts: task.parts, position: task.position, depth, after: completion}), depth, "set", task.parts[task.position + 1]);
          continue;
        }
        if (task.kind === "dict") {
          state.temporaries = operationRoots(task);
          if (task.hash === null) { task = unaryTask("hash", task.key, site, continuation("dict-hash", {...task, after: completion}), depth); continue; }
          let position = task.position;
          for (; position < task.receiver.entries.length; position++) {
            charge(1);
            const entry = task.receiver.entries[position];
            if (values.dictionaryEntryHash(entry) !== task.hash) continue;
            if (entry.key === task.key) break;
            if (depth >= maxDepth) python("RecursionError", "maximum dictionary key comparison depth exceeded");
            const finish = continuation("dict-key", {...task, position, version: task.receiver.version, candidate: entry.key, after: completion});
            task = compareTask("equal", entry.key, task.key, site, finish, depth + 1); break;
          }
          if (task.kind === "compare") continue;
          task = finishDictionary(task, site, position < task.receiver.entries.length ? position : -1); continue;
        }
        if (task.kind === "compare") {
          state.temporaries.push(...operationRoots(task));
          let {left, right} = task;
          const {operation, position} = task;
          if (classes.isPythonMethod(left) && classes.isPythonMethod(right) && ["equal", "not-equal"].includes(operation)) {
            task = methodCompare(left, right, operation === "not-equal", site, completion, depth); continue;
          }
          if (left instanceof FrameLocalsValue && right instanceof FrameLocalsValue && ["equal", "not-equal"].includes(operation)) {
            task = valueTask(operation === "equal" ? left.frame === right.frame : left.frame !== right.frame, site, completion); continue;
          }
          if (left instanceof FrameLocalsValue && values.isDict(right) || right instanceof FrameLocalsValue && values.isDict(left)) {
            const receiver = left instanceof FrameLocalsValue ? left : right;
            task = frameSnapshot(receiver, site, continuation("frame-result", {action: "task", task, receiver})); continue;
          }
          const ordering = Object.hasOwn(ORDERING_SLOTS, operation);
          if (left instanceof ClassNamespaceValue || right instanceof ClassNamespaceValue) {
            if (left instanceof ClassNamespaceValue || !userProtocol(left) || position > 0) {
              const a = left instanceof ClassNamespaceValue ? values.classNamespaceDictionary(left) : left;
              const b = right instanceof ClassNamespaceValue ? values.classNamespaceDictionary(right) : right;
              if (values.isDict(a)) values.enableNamespace(a);
              if (values.isDict(b)) values.enableNamespace(b);
              task = compareTask(operation, a, b, site, proxyRelay(left, right, completion), depth); continue;
            }
          }
          if (!ordering && values.isSet(left) && values.isSet(right)) { left = left.storage; right = right.storage; }
          if (!(userProtocol(left) || userProtocol(right))) {
            if (values.sameSequenceKind(left, right)) {
              const a = values.comparisonSequence(left), b = values.comparisonSequence(right);
              task = !ordering && a.length !== b.length ? valueTask(operation === "not-equal", site, completion) :
                sequenceNext({left, right, operation, after: completion, depth}, site); continue;
            }
            if (values.isSlice(left) || values.isSlice(right)) {
              if (ordering) python("TypeError", "Ordering is not supported between these values");
              task = deliver(operation === "not-equal", completion, site); continue;
            }
            if (!ordering && values.isDict(left) && values.isDict(right)) {
              task = left.entries.length !== right.entries.length ? valueTask(operation === "not-equal", site, completion) :
                dictionaryNext({left, right, operation, after: completion, depth, version: left.version, otherVersion: right.version}, site); continue;
            }
            task = deliver(values.binary(operation, left, right), completion, site); continue;
          }
          const reflected = userProtocol(left) && userProtocol(right) && classes.checkingType(left) !== classes.checkingType(right) && classes.checkingType(right).mro.includes(classes.checkingType(left));
          const candidates = reflected ? [[right, left, 1], [left, right, 0]] : [[left, right, 0], [right, left, 1]];
          if (position >= candidates.length) {
            if (ordering) python("TypeError", "Ordering is not supported between these values");
            task = deliver(operation === "equal" ? left === right : left !== right, completion, site); continue;
          }
          const [receiver, other, direction] = candidates[position];
          if (!userProtocol(receiver)) { task = compareTask(operation, left, right, site, completion, depth, position + 1); continue; }
          if (depth >= maxDepth) python("RecursionError", "maximum implicit comparison dispatch depth exceeded");
          const fallback = {operation: "compare-next", comparison: operation, left, right, position: position + 1, after: completion, depth};
          let plan, invert = false;
          try {
            plan = classes.special(receiver, ordering ? ORDERING_SLOTS[operation][direction] : operation === "equal" ? "__eq__" : "__ne__");
            if (!plan && operation === "not-equal") { invert = true; plan = classes.special(receiver, "__eq__"); }
          } catch (error) {
            const recovery = error instanceof Raised && bindingRecovery(error.value, {fallback}, site);
            if (!recovery) throw error;
            task = recovery; continue;
          }
          if (!plan) {
            task = !ordering && receiver === other ? valueTask(operation === "equal", site, completion) :
              compareTask(operation, left, right, site, completion, depth, position + 1); continue;
          }
          const finish = continuation(invert ? "ne-result" : "compare-result", {operation, left, right, position, depth, after: completion});
          task = plan.kind === "value" ? callTask(plan.value, [other], [], [], site, finish, depth + 1) :
            callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [other], keywords: [], keywordValues: [], after: finish, depth: depth + 1, fallback}), depth + 1);
          continue;
        }
        if (task.kind === "contains") {
          if (task.receiver instanceof FrameLocalsValue) { task = frameLookup(task.receiver, task.key, "contains", null, null, false, site, completion); continue; }

          state.temporaries.push(...operationRoots(task));
          let {receiver, key} = task;
          if (receiver instanceof DictionaryViewValue) {
            if (receiver.kind === 0) { task = dictionaryTask(receiver.dictionary, key, site, continuation("relay", {receiver, after: completion}), depth, "contains"); continue; }
            if (receiver.kind === 2) {
              if (!values.isSequenceType(key, "tuple") || key.items.length !== 2) { task = valueTask(false, site, completion); continue; }
              task = dictionaryTask(receiver.dictionary, key.items[0], site, continuation("view-item", {receiver, key, depth, after: completion}), depth, "probe"); continue;
            }
            task = unaryTask("iter", receiver, site, continuation("search-iter", {receiver, key, after: completion, depth}), depth); continue;
          }
          if (receiver instanceof ClassNamespaceValue) {
            task = dictionaryTask(values.classNamespaceDictionary(receiver), key, site, continuation("relay", {receiver, after: completion}), depth, "contains"); continue;
          }
          if (values.isBinary(receiver) && userProtocol(key)) {
            task = unaryTask("index", key, site, continuation("binary-member", {receiver, after: completion}), depth); continue;
          }
          if (values.isSet(receiver)) {
            key = values.setLookupKey(key); state.temporaries.push(key);
            task = dictionaryTask(receiver.storage, key, site, completion, depth, "contains"); continue;
          }
          if (values.dictionaryNeedsProtocol(receiver, key)) { task = dictionaryTask(receiver, key, site, completion, depth, "contains"); continue; }
          if (task.search || values.isIterator(receiver) || values.isView(receiver) || values.isRange(receiver) && userProtocol(key)) {
            task = unaryTask("iter", receiver, site, continuation("search-iter", {receiver, key, after: completion, depth}), depth); continue;
          }
          if (!userProtocol(receiver)) {
            if (values.comparisonSequence(receiver) !== null) { task = containsTask(receiver, key, site, completion, depth, true); continue; }
            task = deliver(values.contains(key, receiver), completion, site); continue;
          }
          charge(1);
          if (++depth > maxDepth) python("RecursionError", "maximum implicit membership dispatch depth exceeded");
          const fallback = {operation: "contains-search", receiver, key, after: completion, depth};
          let plan;
          try { plan = classes.special(receiver, "__contains__"); }
          catch (error) {
            const recovery = error instanceof Raised && bindingRecovery(error.value, {fallback}, site);
            if (!recovery) throw error;
            task = recovery; continue;
          }
          if (!plan) { task = containsTask(receiver, key, site, completion, depth, true); continue; }
          const finish = continuation("contains-result", {receiver, key, after: completion, depth});
          task = plan.kind === "value" ? callTask(plan.value, [key], [], [], site, finish, depth) :
            callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [key], keywords: [], keywordValues: [], after: finish, depth, fallback}), depth);
          continue;
        }
        if (task.kind === "item" || task.kind === "slice") {
          state.temporaries.push(...operationRoots(task));
          const {receiver, operation, item} = task;
          if (receiver instanceof FrameLocalsValue) {
            const key = task.kind === "slice" ? values.sliceKey(...task.parts) : task.key; state.temporaries.push(key);
            task = frameLookup(receiver, key, operation === "get" ? "read" : operation, item, null, false, site, completion); continue;
          }
          if (receiver instanceof ClassNamespaceValue) {
            if (operation !== "get") python("TypeError", "Class namespace views do not support item mutation");
            if (task.kind === "slice") hard("UNSUPPORTED", "UnsupportedOperationError", "Slice namespace keys require their own stage.");
            task = dictionaryTask(values.classNamespaceDictionary(receiver), task.key, site, continuation("relay", {receiver, after: completion}), depth); continue;
          }
          if (values.isView(receiver)) {
            values.liveView(receiver);
            if (operation === "delete" || operation === "set" && receiver.readonly) python("TypeError", "cannot modify this memoryview");
          }
          if (task.kind === "slice") {
            if (userProtocol(receiver)) {
              const key = values.sliceKey(...task.parts); state.temporaries.push(key);
              task = itemTask(receiver, key, site, completion, depth, operation, item);
            } else task = sliceNext(receiver, task.parts, 0, site, completion, depth, operation, item);
            continue;
          }
          const {key} = task;
          if (values.dictionaryNeedsProtocol(receiver, key)) { task = dictionaryTask(receiver, key, site, completion, depth, operation, item); continue; }
          if (userProtocol(receiver)) {
            charge(1);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit item dispatch depth exceeded");
            const slot = {get: "__getitem__", set: "__setitem__", delete: "__delitem__"}[operation];
            const plan = classes.special(receiver, slot);
            if (!plan) python("TypeError", "Instance has no " + slot + " type slot");
            const finish = continuation(operation === "get" ? "relay" : "item-result", {receiver, after: completion});
            const args = operation === "set" ? [key, item] : [key];
            if (plan.kind === "value") task = callTask(plan.value, args, [], [], site, finish, depth);
            else task = callTask(plan.callable, plan.args, [], [], site,
              continuation("invoke", {args, keywords: [], keywordValues: [], after: finish, depth}), depth);
          } else if (values.isSlice(key) && (operation === "get" ? values.isSequence(receiver) : values.isList(receiver) || values.isView(receiver) || values.isBinary(receiver))) {
            task = sliceTask(receiver, [key.start, key.stop, key.step], site, completion, depth, operation, item);
          } else if (userProtocol(key) && values.isSequence(receiver)) {
            task = unaryTask("index", key, site, continuation("index-key", {receiver, key, after: completion, depth, operation, item}), depth);
          } else if (operation === "set" && (values.isBinary(receiver) && receiver.mutable || values.isView(receiver) && !receiver.readonly) && userProtocol(item)) {
            task = unaryTask("index", item, site, continuation("byte-assignment", {receiver, key, after: completion}), depth);
          } else task = deliver(operation === "get" ? values.binary("getitem", receiver, key) :
            operation === "set" ? values.set(receiver, key, item) : values.binary("dict-delete", receiver, key), completion, site);
          continue;
        }
        if (task.kind === "value") { task = deliver(task.value, completion, site); continue; }
        if (task.kind === "unary") {
          if (task.value instanceof FrameLocalsValue && ["len", "truth", "not", "iter"].includes(task.operation)) {
            const entries = frameEntries(task.value); state.temporaries.push(...entries.flat());
            if (task.operation === "iter") { const keys = values.list(entries.map(([key]) => key)); state.temporaries.push(keys); task = valueTask(values.iterator(keys), site, completion); }
            else task = valueTask(task.operation === "len" ? values.int(BigInt(entries.length)) : task.operation === "not" ? entries.length === 0 : entries.length !== 0, site, completion);
            continue;
          }

          const {operation, value, optionalLength} = task;
          if (operation === "index" && typeof value?.nativePayload === "bigint") { task = valueTask(value.nativePayload, site, continuation("relay", {receiver: value, after: completion})); continue; }
          state.temporaries.push(...operationRoots(task));
          if (operation === "vars-missing") python("TypeError", "vars() argument must have a __dict__ attribute");
          if (operation === "property-name-missing") python("AttributeError", "'property' object has no attribute '__name__'");
          if (["hash", "hash-unhashable"].includes(operation)) {
            if (operation === "hash-unhashable") python("TypeError", "unhashable type");
            if (classes.isPythonMethod(value)) {
              if (depth >= maxDepth) python("RecursionError", "maximum method hash depth exceeded");
              task = unaryTask("hash", value.callable, site, continuation("native-method-hash", {receiver: value, after: completion}), depth + 1); continue;
            }
            if (values.hashParts(value) !== null && values.needsOwnedHash(value)) {
              if (depth >= maxDepth) python("RecursionError", "maximum sequence hash depth exceeded");
              task = hashNext(value, 0, 14695981039346656037n, site, completion, depth); continue;
            }
            if (!userProtocol(value)) { task = deliver(values.pythonHash(value), completion, site); continue; }
            if (++depth > maxDepth) python("RecursionError", "maximum implicit hash dispatch depth exceeded");
            const fallback = {operation: "hash-unhashable", receiver: value, after: completion, depth};
            let plan;
            try { plan = classes.special(value, "__hash__"); }
            catch (error) {
              const recovery = error instanceof Raised && bindingRecovery(error.value, {fallback}, site);
              if (!recovery) throw error;
              task = recovery; continue;
            }
            if (!plan || plan.kind === "value" && plan.value === null) python("TypeError", "unhashable type");
            const finish = continuation("hash-result", {receiver: value, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, finish, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth, fallback}), depth);
            continue;
          }
          if (["iter", "iter-indexed", "next", "iterator-stop"].includes(operation)) {
            if (operation === "iterator-stop") python("StopIteration", "");
            if (value instanceof GeneratorValue) {
              if (operation === "iter") { task = deliver(value, completion, site); continue; }
              resumeGenerator(value, "send", null, site, completion); return;
            }
            if (value instanceof ProtocolIteratorValue) {
              if (operation === "iter") { task = deliver(value, completion, site); continue; }
              if (value.exhausted) python("StopIteration", "");
              const finish = continuation(value.kind === "indexed" ? "indexed-result" : "callable-result", {receiver: value, after: completion});
              task = value.kind === "indexed" ? itemTask(value.source, value.index, site, finish, depth) :
                callTask(value.source, [], [], [], site, finish, depth);
              continue;
            }
            if (!userProtocol(value)) { task = deliver(values.unary(operation, value), completion, site); continue; }
            charge(1);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit iteration dispatch depth exceeded");
            if (operation === "iter-indexed") {
              if (!classes.lookup(classes.checkingType(value), "__getitem__").found) python("TypeError", "Instance is not iterable");
              task = deliver(allocate(ProtocolIteratorValue, "indexed", value), completion, site); continue;
            }
            const slot = operation === "iter" ? "__iter__" : "__next__";
            const fallback = operation === "iter" ? {operation: "iter-indexed", receiver: value, after: completion, depth} : null;
            let plan;
            try { plan = classes.special(value, slot); }
            catch (error) {
              const recovery = error instanceof Raised && bindingRecovery(error.value, {fallback}, site);
              if (!recovery) throw error;
              task = recovery; continue;
            }
            if (!plan) {
              if (operation === "next") python("TypeError", "Instance is not an iterator");
              task = unaryTask("iter-indexed", value, site, completion, depth); continue;
            }
            const finish = continuation(operation === "iter" ? "iter-result" : "relay", {receiver: value, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, finish, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth, fallback}), depth);
            continue;
          }
          if (operation === "index") {
            if (!userProtocol(value)) {
              if (typeof value !== "bigint" && typeof value !== "boolean") python("TypeError", "An integer index is required");
              task = deliver(typeof value === "boolean" ? values.int(BigInt(value)) : value, completion, site); continue;
            }
            charge(1);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit index dispatch depth exceeded");
            const plan = classes.special(value, "__index__");
            if (!plan) python("TypeError", "Instance has no integer-index type slot");
            const finish = continuation("index-result", {receiver: value, after: completion});
            if (plan.kind === "value") task = callTask(plan.value, [], [], [], site, finish, depth);
            else task = callTask(plan.callable, plan.args, [], [], site,
              continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth}), depth);
            continue;
          }
          if (["repr", "str", "repr-default"].includes(operation)) {
            if (operation === "repr-default") hard("UNSUPPORTED", "UnsupportedOperationError", "Default object representations require a later formatting stage.");
            if (operation === "str" && value instanceof ExceptionValue && !value.type) {
              if (matchesException(value.name, "SyntaxError")) { task = syntaxMessage(value, site, completion, depth); continue; }
              task = exceptionString(value, site, completion, depth, matchesException(value.name, "ImportError")); continue;
            }
            if (!userProtocol(value)) {
              const result = operation === "repr" ? values.repr(value) :
                values.text(value) !== null ? value : values.string(Array.from(display(value), char => char.codePointAt(0)));
              task = deliver(result, completion, site); continue;
            }
            charge(1);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit formatting dispatch depth exceeded");
            let slot = operation === "repr" ? "__repr__" : "__str__", plan;
            try {
              plan = classes.special(value, slot);
              if (!plan && slot === "__str__") { slot = "__repr__"; plan = classes.special(value, slot); }
            } catch (error) {
              if (!(error instanceof Raised) || slot !== "__repr__" || error.value.name !== "AttributeError") throw error;
              task = unaryTask("repr-default", value, site, completion, depth); continue;
            }
            if (!plan) { task = unaryTask("repr-default", value, site, completion, depth); continue; }
            const finish = continuation("format-result", {receiver: value, slot, after: completion});
            if (plan.kind === "value") task = callTask(plan.value, [], [], [], site, finish, depth);
            else task = callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [],
              keywordValues: [], after: finish, depth, fallback: slot === "__repr__" ?
                {operation: "repr-default", receiver: value, after: completion, depth} : null}), depth);
            continue;
          }
          if (userProtocol(value) && ["negative", "positive", "invert"].includes(operation)) {
            const slot = {negative: "__neg__", positive: "__pos__", invert: "__invert__"}[operation], plan = classes.special(value, slot);
            if (!plan) python("TypeError", "bad operand type for unary " + operation);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit arithmetic dispatch depth exceeded");
            const finish = continuation("relay", {receiver: value, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, finish, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth}), depth); continue;
          }
          if (!userProtocol(value) || !["len", "truth", "not"].includes(operation)) {
            task = deliver(values.unary(operation, value), completion, site); continue;
          }
          charge(1);
          if (!optionalLength && ++depth > maxDepth) python("RecursionError", "maximum implicit protocol dispatch depth exceeded");
          let slot = operation === "len" || optionalLength ? "__len__" : "__bool__";
          const fallback = operation === "len" ? null : {operation, receiver: value, after: completion, depth,
            missing: optionalLength ? "true" : "length"};
          let plan;
          try { plan = classes.special(value, slot); }
          catch (error) {
            const recovery = error instanceof Raised && bindingRecovery(error.value, {fallback}, site);
            if (!recovery) throw error;
            task = recovery; continue;
          }
          if (!plan && slot === "__bool__") { slot = "__len__"; plan = classes.special(value, slot); }
          if (!plan) {
            if (operation === "len") python("TypeError", "Instance has no length type slot");
            task = deliver(operation !== "not", completion, site); continue;
          }
          const finish = optionalLength ? continuation("optional-truth", {operation, receiver: value, after: completion, depth}) :
            continuation("protocol-result", {operation, slot, receiver: value, after: completion, depth});
          if (plan.kind === "value") task = callTask(plan.value, [], [], [], site, finish, depth);
          else task = callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [],
            keywordValues: [], after: finish, depth, fallback: slot === "__bool__" || optionalLength ? fallback : null}), depth);
          continue;
        }
        state.temporaries.push(...operationRoots(task));
        if (callable instanceof BoundMethodValue || callable instanceof MethodWrapperValue && callable.kind === "staticmethod" || classes.isInstance(callable)) {
          charge(1);
          if (classes.isInstance(callable)) {
            if (++depth > maxDepth) python("RecursionError", "maximum implicit call dispatch depth exceeded");
            const plan = classes.special(callable, "__call__");
            if (!plan) python("TypeError", "Instance has no callable type slot");
            completion = continuation("relay", {after: completion, receiver: callable});
            if (plan.kind === "value") task = callTask(plan.value, args, keywords, keywordValues, site, completion, depth);
            else task = callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args, keywords, keywordValues, after: completion, depth}), depth);
          } else {
            if (callable instanceof BoundMethodValue) args = [callable.receiver, ...args];
            task = callTask(callable.callable, args, keywords, keywordValues, site, completion, depth);
          }
          continue;
        }
        if (callable instanceof PropertyAccessorValue) {
          if (args.length !== 1 || keywords.length) python("TypeError", "Property accessor copy requires one positional value.");
          task = propertyTask(classes.propertyCopyArguments(callable.property, callable.name, args[0]), callable.property, site, completion, depth); continue;
        }
        if (callable instanceof ClassValue) {
          if (task.kind !== "construct" && callable.metaclass && classes.hasSlot(callable.metaclass, "__call__")) {
            if (++depth > maxDepth) python("RecursionError", "maximum metaclass call dispatch depth exceeded");
            const item = classes.lookup(callable.metaclass, "__call__"), plan = classes.bindAttribute(item.value, callable, callable.metaclass);
            const target = continuation("relay", {receiver: callable, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, args, keywords, keywordValues, site, target, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args, keywords, keywordValues, after: target, depth}), depth);
            continue;
          }
          if (classes.hasSlot(callable, "__new__") || classes.isMetaclass(callable) || NATIVE_SUBCLASS_BASES.includes(classes.layoutFamily(callable))) {
            if (++depth > maxDepth) python("RecursionError", "maximum constructor dispatch depth exceeded");
            let item = classes.lookup(callable, "__new__");
            if (classes.isMetaclass(callable) && !classes.hasSlot(callable, "__new__") && item.value instanceof BuiltinValue && item.value.name === "object.__new__")
              item = {found: true, value: classes.builtin("type.__new__")};
            const plan = classes.bindAttribute(item.value, null, callable);
            const target = continuation("new-result", {type: callable, args, keywords, keywordValues, after: completion, depth});
            const positional = [callable, ...args];
            task = plan.kind === "value" ? callTask(plan.value, positional, keywords, keywordValues, site, target, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: positional, keywords, keywordValues, after: target, depth}), depth);
            continue;
          }
          const instance = classes.instance(callable); state.temporaries.push(instance);
          task = initialize(instance, args, keywords, keywordValues, site, completion, depth); continue;
        }
        if (callable instanceof FunctionValue) {
          const bindings = bind(callable, args, keywords, keywordValues);
          if (bindings.pendingDefaults) {
            task = functionDefaultsNext({receiver: callable, dictionary: callable.keywordDefaults, names: bindings.pendingDefaults,
              keys: [...bindings.keys()], items: [...bindings.values()], position: 0, after: completion}, site);
            if (task === null) return;
            continue;
          }
          if (callable.pool.code.functions[callable.index].blocks.some(block => block.instructions.some(([op]) => ["yield", "yield-from"].includes(op)))) {
            task = deliver(allocate(GeneratorValue, callable, bindings), completion, site); continue;
          }
          enter(callable, bindings, site, completion); return;
        }
        if (callable instanceof BuiltinValue) {
          if (["eval", "exec"].includes(callable.name)) { task = evaluator.start(callable.name, args, keywords, keywordValues, site, completion); continue; }
          if (callable.name === "__import__") { task = importer.start(args, keywords, keywordValues, site, completion); continue; }
          if (callable.name === "compile") { task = compiler.start(args, keywords, keywordValues, site, completion); continue; }
          if (matchesException(callable.name, "SyntaxError") && state.frames.at(-1).pool.code.version >= 4) {
            count("builtin:" + callable.name);
            const receiver = makeException(callable.name, args); state.temporaries.push(receiver);
            initializeException(receiver, args, keywords, keywordValues, callable.name);
            task = syntaxDetails(receiver, args, site, completion, depth, receiver); continue;
          }
          if (["getset_descriptor", "member_descriptor"].includes(callable.nativeKind)) python("TypeError", "Storage descriptor objects are not callable");
          const nativeKind = callable.nativeKind ?? classes.nativeDescriptorKind(callable);
          const descriptor = callable.nativeOwner ? callable : nativeKind === null ? null :
            {nativeOwner: classes.builtin(callable.name.split(".")[0]), nativeKey: callable.name.slice(callable.name.indexOf(".") + 1), nativeKind};
          if (["method_descriptor", "wrapper_descriptor", "classmethod_descriptor"].includes(nativeKind)) {
            if (!args.length) {
              const owner = descriptor.nativeOwner.root ? "object" : descriptor.nativeOwner.name;
              python("TypeError", nativeKind === "wrapper_descriptor" ? "descriptor '" + descriptor.nativeKey + "' of '" + owner + "' object needs an argument" :
                "unbound method " + owner + "." + descriptor.nativeKey + "() needs an argument");
            }
            classes.namespaceDescriptorValid(descriptor, args[0], nativeKind === "classmethod_descriptor");
          }
          const nativeOwner = callable.nativeOwner instanceof BuiltinValue ? callable.nativeOwner.name : callable.name.split(".")[0];
          const nativeName = callable.nativeKey ?? callable.name.slice(callable.name.indexOf(".") + 1);
          if (EXCEPTION_BASES.includes(nativeOwner)) {
            if (nativeName === "add_note") {
              if (args.length !== 2 || keywords.length || !(args[0] instanceof ExceptionValue)) python("TypeError", "add_note() takes one positional note argument");
              if (!(classes.payload(args[1]) instanceof StringValue)) python("TypeError", "note must be a str");
              task = attributeTask(args[0], "__notes__", site, continuation("exception-note-get", {receiver: args[0], note: args[1], depth, after: completion}), depth); continue;
            }
            if (nativeName === "__new__") {
              const type = args[0];
              if (!classes.isType(type) || !classes.subclass(type, classes.builtin(nativeOwner))) python("TypeError", nativeOwner + ".__new__ requires a subtype receiver");
              const bases = classes.mro(type).filter(base => base instanceof BuiltinValue && EXCEPTION_BASES.includes(base.name));
              let solid = type instanceof ClassValue ? type.storage.solid : type;
              while (solid instanceof ClassValue && !solid.root) { charge(1); solid = solid.storage.baseSolid; }
              const base = bases.find(base => EXCEPTION_LAYOUTS[base.name] === solid?.name) ?? (solid instanceof BuiltinValue && EXCEPTION_BASES.includes(solid.name) ? solid : bases[0]);
              task = valueTask(makeException(base.name, args.slice(1), type instanceof ClassValue ? type : null, true), site, completion); continue;
            }
            if (nativeName === "__init__") {
              if (!(args[0] instanceof ExceptionValue)) python("TypeError", "Exception initialization requires an exception receiver");
              initializeException(args[0], args.slice(1), keywords, keywordValues, nativeOwner);
              if (matchesException(nativeOwner, "SyntaxError")) { task = syntaxDetails(args[0], args.slice(1), site, completion, depth, null); continue; }
              task = valueTask(null, site, completion); continue;
            }
            if (nativeName === "__str__") {
              if (args.length !== 1 || keywords.length || !(args[0] instanceof ExceptionValue)) python("TypeError", "Exception __str__ requires one receiver");
              task = matchesException(nativeOwner, "SyntaxError") ? syntaxMessage(args[0], site, completion, depth) :
                exceptionString(args[0], site, completion, depth, nativeOwner === "ImportError"); continue;
            }
            if (nativeName === "__repr__") hard("UNSUPPORTED", "UnsupportedOperationError", "Default exception repr remains under #127");
          }
          const containerOwner = callable instanceof ValueMethod && CONTAINER_METHOD_NAMES.has(nativeName) ? values.typeName(classes.payload(callable.receiver)) : nativeOwner;
          if (CONTAINER_METHODS[containerOwner]?.includes(nativeName)) {
            const original = callable instanceof ValueMethod ? callable.receiver : args[0];
            const receiver = classes.payload(original), rest = callable instanceof ValueMethod ? args : args.slice(1);
            if (containerOwner === "dict") {
              if (["keys", "values", "items"].includes(nativeName)) {
                if (keywords.length || rest.length) python("TypeError", nativeName + "() takes no arguments");
                values.enableNamespace(receiver);
                task = valueTask(values.dictionaryView(receiver, ["keys", "values", "items"].indexOf(nativeName), original), site, completion); continue;
              }
              if (keywords.length || rest.length < 1 || rest.length > 2) python("TypeError", "Invalid " + nativeName + " arguments");
              const fallback = rest.length === 2 ? rest[1] : null;
              if (nativeName === "pop" && !receiver.entries.length) {
                if (rest.length === 1) python("KeyError", "Dictionary key not found", [rest[0]]);
                task = valueTask(fallback, site, completion); continue;
              }
              values.enableNamespace(receiver);
              task = nativeName === "setdefault" ? dictionaryTask(receiver, rest[0], site,
                continuation("relay", {receiver: original, after: completion}), depth, "set-default", fallback) :
                dictionaryTask(receiver, rest[0], site, nativeName === "get" ?
                  continuation("proxy-get", {receiver: original, fallback, after: completion}) :
                  continuation("dictionary-pop", {receiver: original, key: rest[0], fallback, missing: rest.length === 1, after: completion}),
                depth, nativeName === "get" ? "probe" : "pop-probe");
              continue;
            }
            if (nativeName === "extend") {
              if (keywords.length || rest.length !== 1) python("TypeError", "extend() takes one positional iterable");
              const source = classes.payload(rest[0]) === receiver ? values.list(receiver.items) : rest[0];
              state.temporaries.push(source);
              values.checkConstructionHint(source);
              task = consumeTask("list", source, site,
                continuation("item-result", {receiver: original, after: completion}), depth, receiver); continue;
            }
            if (["count", "index"].includes(nativeName)) {
              if (keywords.length || rest.length < 1 || rest.length > (nativeName === "index" ? 3 : 1))
                python("TypeError", "Invalid " + nativeName + " arguments");
              task = nativeName === "count" ? sequenceScan({receiver: original, key: rest[0], name: nativeName,
                position: 0, stop: (1n << 63n) - 1n, count: 0, candidate: null, depth, after: completion}, site) :
                unaryTask("index", rest.length > 1 ? rest[1] : 0n, site,
                  continuation("sequence-bound", {receiver: original, key: rest[0], bounds: [0n, rest.length > 2 ? rest[2] : (1n << 63n) - 1n], position: 0, depth, after: completion}), depth);
              continue;
            }
            if (["insert", "pop"].includes(nativeName)) {
              if (keywords.length || (nativeName === "insert" ? rest.length !== 2 : rest.length > 1))
                python("TypeError", "Invalid " + nativeName + " arguments");
              task = unaryTask("index", rest.length ? rest[0] : -1n, site,
                continuation("list-index", {receiver: original, name: nativeName, item: rest[1] ?? null, after: completion}), depth); continue;
            }
            if (keywords.length || rest.length) python("TypeError", nativeName + "() takes no arguments");
            const finish = continuation("relay", {receiver: original, after: completion});
            charge(receiver.items.length);
            if (nativeName === "copy") task = valueTask(values.list(receiver.items), site, finish);
            else {
              const items = nativeName === "clear" ? [] : [...receiver.items].reverse();
              mutate(receiver, () => { const before = receiver.items; receiver.items = items; return () => { receiver.items = before; }; });
              task = valueTask(null, site, finish);
            }
            continue;
          }
          if (["property-no-getter", "property-no-setter", "property-no-deleter"].includes(callable.name)) {
            if (++depth > maxDepth) python("RecursionError", "maximum property diagnostic depth exceeded");
            const receiver = args[0], record = {receiver, target: args[1], operation: callable.name.slice("property-no-".length), phase: "lookup", depth, after: completion};
            if (receiver.propertyName !== undefined || receiver.fget === null) {
              task = propertyDiagnostic({...record, found: receiver.propertyName !== undefined, name: receiver.propertyName ?? null}, site); continue;
            }
            task = attributeTask(receiver.fget, "__name__", site, continuation("property-diagnostic", record), depth); continue;
          }
          if (callable.name === "method" && !callable.nativeKind || nativeOwner === "method" && nativeName === "__new__") {
            const operands = nativeName === "__new__" ? args.slice(1) : args;
            if (nativeName === "__new__" && args[0] !== classes.builtin("method")) python("TypeError", "method.__new__ requires the method type");
            if (keywords.length) python("TypeError", "method() takes no keyword arguments");
            if (operands.length !== 2) python("TypeError", "method expected 2 arguments, got " + operands.length);
            if (!classes.callable(operands[0])) python("TypeError", "first argument must be callable");
            if (operands[1] === null) python("TypeError", "instance must not be None");
            task = valueTask(allocate(BoundMethodValue, operands[0], operands[1], true), site, completion); continue;
          }
          if (nativeKind === "wrapper_descriptor" && NATIVE_ARITIES[nativeName]) {
            const [minimum, maximum] = NATIVE_ARITIES[nativeName], count = args.length - 1;
            if (keywords.length) python("TypeError", "wrapper " + nativeName + "() takes no keyword arguments");
            if (count < minimum || count > maximum) {
              const bound = minimum === maximum ? "" : count < minimum ? "at least " : "at most ";
              const expected = count < minimum ? minimum : maximum;
              python("TypeError", (minimum === maximum ? "expected " : nativeName + " expected ") + bound + expected +
                " argument" + (expected === 1 ? "" : "s") + ", got " + count);
            }
          }
          if (nativeKind === "method_descriptor" && (["__getitem__", "__round__", "__dir__", "__set_name__"].includes(nativeName) || nativeOwner === "property" && ["getter", "setter", "deleter"].includes(nativeName))) {
            const count = args.length - 1;
            if (keywords.length) python("TypeError", (nativeName === "__set_name__" ? nativeName : nativeOwner + "." + nativeName) + "() takes no keyword arguments");
            if (nativeName === "__getitem__" && count !== 1) python("TypeError", nativeOwner + ".__getitem__() takes exactly one argument (" + count + " given)");
            if (nativeOwner === "property" && ["getter", "setter", "deleter"].includes(nativeName) && count !== 1)
              python("TypeError", "property." + nativeName + "() takes exactly one argument (" + count + " given)");
            if (nativeName === "__dir__" && count !== 0) python("TypeError", nativeOwner + ".__dir__() takes no arguments (" + count + " given)");
            if (nativeName === "__round__" && count > 1) python("TypeError", "__round__ expected at most 1 argument, got " + count);
            if (nativeName === "__set_name__" && count !== 2) python("TypeError", "__set_name__() takes 2 positional arguments but " + count + " were given");
          }
          if (nativeOwner === "object" && nativeName === "__str__") {
            task = unaryTask("repr", args[0], site, completion, depth); continue;
          }
          if (nativeOwner === "cell" && nativeName === "__new__") {
            if (args[0] !== classes.builtin("cell")) python("TypeError", "cell.__new__ requires the cell type");
            task = callTask(classes.builtin("cell"), args.slice(1), keywords, keywordValues, site, completion, depth); continue;
          }
          if (callable.name === "function" && !callable.nativeKind)
            hard("UNSUPPORTED", "UnsupportedOperationError", "Backend function construction is outside the finite verified source-code interface.");
          if (nativeName === "__call__" && ["function", "method", "builtin_function_or_method", "method-wrapper", "method_descriptor", "wrapper_descriptor", "classmethod_descriptor"].includes(nativeOwner)) {
            if (!args.length) python("TypeError", "Native call wrapper requires a receiver");
            task = callTask(args[0], args.slice(1), keywords, keywordValues, site, completion, depth); continue;
          }
          if (nativeOwner === "method" && nativeName === "__get__") {
            if (keywords.length || args.length < 2 || args.length > 3) python("TypeError", "__get__ received invalid arguments");
            if (args[1] === null && (args[2] ?? null) === null) python("TypeError", "__get__(None, None) is invalid");
            task = valueTask(args[0], site, completion); continue;
          }
          const nativeComparison = NATIVE_COMPARISONS[nativeName];
          if (nativeComparison && ["object", "method", "builtin_function_or_method", "method-wrapper", "cell", "code"].includes(nativeOwner)) {
            if (keywords.length || args.length !== 2) python("TypeError", nativeName + " takes one argument");
            const [receiver, other] = args, equality = ["equal", "not-equal"].includes(nativeComparison);
            const notImplemented = () => valueTask(moduleContext.builtin("NotImplemented", () => allocate(NotImplementedValue)), site, completion);
            if (nativeOwner === "object") {
              if (nativeName === "__eq__") task = receiver === other ? valueTask(true, site, completion) : notImplemented();
              else if (nativeName === "__ne__") {
                if (userProtocol(receiver)) {
                  const plan = classes.special(receiver, "__eq__");
                  const after = continuation("native-not-equal", {receiver, after: completion});
                  task = !plan ? receiver === other ? valueTask(false, site, completion) : notImplemented() : plan.kind === "value" ?
                    callTask(plan.value, [other], [], [], site, after, depth) : callTask(plan.callable, plan.args, [], [], site,
                      continuation("invoke", {args: [other], keywords: [], keywordValues: [], after, depth}), depth);
                } else {
                  const entry = classes.nativeEntry(classes.typeOf(receiver), "__eq__");
                  task = entry.found && entry.value.name !== "object.__eq__" ? callTask(entry.value, args, [], [], site,
                    continuation("native-not-equal", {receiver, after: completion}), depth) : receiver === other ? valueTask(false, site, completion) : notImplemented();
                }
              } else task = notImplemented();
            } else if (!equality || classes.typeOf(receiver) !== classes.typeOf(other)) task = notImplemented();
            else if (nativeOwner === "method") task = methodCompare(receiver, other, nativeComparison === "not-equal", site, completion, depth);
            else if (nativeOwner === "cell") {
              task = receiver.bound && other.bound ? compareTask(nativeComparison, receiver.value, other.value, site, completion, depth) :
                valueTask(nativeComparison === "equal" ? receiver.bound === other.bound : receiver.bound !== other.bound, site, completion);
            } else task = valueTask(nativeComparison === "equal" ? values.equal(receiver, other) : !values.equal(receiver, other), site, completion);
            continue;
          }
          if (nativeName === "__hash__" && ["method", "builtin_function_or_method", "method-wrapper", "code", "NoneType"].includes(nativeOwner)) {
            if (keywords.length || args.length !== 1) python("TypeError", "__hash__ takes no arguments");
            task = nativeOwner === "method" ? unaryTask("hash", args[0].callable, site,
              continuation("native-method-hash", {receiver: args[0], after: completion}), depth) : valueTask(values.pythonHash(args[0]), site, completion); continue;
          }
          if (["__iter__", "__next__"].includes(nativeName) && (nativeOwner === "generator" || nativeOwner.endsWith("iterator"))) {
            if (keywords.length || args.length !== 1) python("TypeError", nativeName + " takes no arguments");
            task = unaryTask(nativeName === "__iter__" ? "iter" : "next", args[0], site, completion, depth); continue;
          }
          if (nativeOwner === "method" && nativeName === "__getattribute__") {
            const name = nativeAttributeName(args[1]);
            const plan = classes.read(args[0], name, false, args[1]);
            task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site,
              plan.kind === "bind-call" ? continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], after: completion, depth}) : completion, depth); continue;
          }
          if (nativeOwner === "super" && nativeName === "__getattribute__") {
            const name = nativeAttributeName(args[1]);
            const plan = classes.superAttribute(args[0], name);
            task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site,
              plan.kind === "bind-call" ? continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], after: completion, depth}) : completion, depth); continue;
          }
          if (nativeOwner === "super" && nativeName === "__get__") {
            const receiver = classes.payload(args[0]);
            task = args[1] === null || receiver.self !== null ? valueTask(args[0], site, completion) :
              callTask(classes.typeOf(args[0]), [receiver.thisclass, args[1]], [], [], site, completion, depth); continue;
          }
          if (nativeOwner === "module" && ["__getattribute__", "__setattr__", "__delattr__"].includes(nativeName) && classes.nativeModule(args[0])) {
            const name = nativeAttributeName(args[1]);
            if (classes.isInstance(args[0])) {
              const plan = nativeName === "__getattribute__" ? classes.read(args[0], name, false, args[1]) : classes.write(args[0], name, args[2] ?? null, nativeName === "__delattr__", args[1]);
              task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site,
                plan.kind === "bind-call" ? continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], after: completion, depth}) : completion, depth); continue;
            }
            task = attributeTask(args[0], name, site, completion, depth, nativeName === "__getattribute__" ? "get" : nativeName === "__setattr__" ? "native-set" : "native-delete", args[1], null, args[2] ?? null); continue;
          }
          if (["property", "staticmethod", "classmethod", "module", "super"].includes(nativeOwner) && callable.name.includes(".")) {
            const original = args[0], raw = classes.payload(original), rest = args.slice(1);
            if (nativeName === "__new__") {
              if (!classes.isType(original) || !classes.subclass(original, classes.builtin(nativeOwner))) python("TypeError", "Native __new__ requires a matching subtype");
              const payload = nativeOwner === "property" ? allocate(PropertyValue) : ["staticmethod", "classmethod"].includes(nativeOwner) ?
                allocate(MethodWrapperValue, nativeOwner, null) : nativeOwner === "module" ? allocate(ModuleValue, "", false, allocate(Environment)) : allocate(SuperValue, null, null, null);
              state.temporaries.push(payload);
              task = valueTask(payload, site, continuation("native-new", {type: original, after: completion})); continue;
            }
            if (classes.isInstance(original) && (original.nativePayload !== undefined || original instanceof ModuleValue)) {
              const finish = continuation("relay", {receiver: original, after: completion});
              if (nativeName === "__init__") {
                if (nativeOwner === "property") {
                  const parts = classes.propertyArguments(rest, keywords, keywordValues);
                  const payload = allocate(PropertyValue, ...parts.slice(0, 3), undefined, parts[3]); state.temporaries.push(payload);
                  classes.functionMetadata(original, "nativePayload", payload);
                  task = propertyTask(parts, null, site, continuation("native-reinit", {receiver: original, after: completion}), depth); continue;
                }
                if (["staticmethod", "classmethod"].includes(nativeOwner)) {
                  if (rest.length !== 1 || keywords.length) python("TypeError", nativeOwner + " requires one callable");
                  const payload = allocate(MethodWrapperValue, nativeOwner, rest[0]); state.temporaries.push(payload);
                  classes.functionMetadata(payload, "attributes", classes.instanceDictionary(original));
                  classes.functionMetadata(original, "nativePayload", payload);
                  task = wrapperNext({receiver: payload, position: 0, depth, after: continuation("item-result", {receiver: original, after: completion})}, site); continue;
                }
                if (nativeOwner === "module") {
                  const bound = bindNamed(["name", "doc"], rest, keywords, keywordValues), name = values.text(bound.get("name"));
                  if (name === null) python("TypeError", "module name must be a string");
                  const dictionary = classes.instanceDictionary(original);
                  const pairs = [["__name__", bound.get("name")], ["__doc__", bound.get("doc") ?? null], ["__package__", null], ["__loader__", null], ["__spec__", null]];
                  for (const [key, item] of pairs) { const label = values.string(Array.from(key, char => char.codePointAt(0))); state.temporaries.push(label); values.set(dictionary, label, item); }
                  task = valueTask(null, site, finish); continue;
                }
                task = callTask(classes.builtin("super"), rest, keywords, keywordValues, site, continuation("native-reinit", {receiver: original, after: completion}), depth); continue;
              }
              if (nativeOwner === "property" && nativeName === "__get__" && rest[0] === null) {
                if (keywords.length || rest.length < 1 || rest.length > 2) python("TypeError", "property.__get__ received invalid arguments");
                task = valueTask(original, site, finish); continue;
              }
              if (nativeOwner === "property" && ["getter", "setter", "deleter"].includes(nativeName)) {
                if (keywords.length || rest.length !== 1) python("TypeError", "property copy takes one argument");
                task = callTask(original.type, classes.propertyCopyArguments(raw, nativeName, rest[0]), [], [], site, continuation("native-property-copy", {receiver: original, after: completion}), depth); continue;
              }
              if (nativeOwner === "staticmethod" && nativeName === "__call__") {
                task = callTask(raw.callable, rest, keywords, keywordValues, site, finish, depth); continue;
              }
              if (nativeOwner === "super" && nativeName === "__get__") {
                if (keywords.length || rest.length < 1 || rest.length > 2) python("TypeError", "super.__get__ received invalid arguments");
                task = raw.self !== null || rest[0] === null ? valueTask(original, site, finish) : callTask(original.type, [raw.thisclass, rest[0]], [], [], site, finish, depth); continue;
              }
              if (["__get__", "__set__", "__delete__", "__set_name__"].includes(nativeName)) {
                task = callTask(callable, [raw, ...rest], keywords, keywordValues, site, finish, depth); continue;
              }
              if (["__getattribute__", "__setattr__", "__delattr__"].includes(nativeName)) {
                const writing = nativeName !== "__getattribute__", remove = nativeName === "__delattr__";
                if (keywords.length || rest.length !== (writing && !remove ? 2 : 1)) python("TypeError", "Invalid native attribute arguments");
                const name = values.text(rest[0]); if (name === null) python("TypeError", "Attribute name must be a string");
                task = !writing && name === "__class__" ? valueTask(original.type, site, finish) : attributeTask(raw, name, site, finish, depth, writing ? remove ? "native-delete" : "native-set" : "native-get", null, null, rest[1]); continue;
              }
              if (nativeOwner === "module" && nativeName === "__dir__") { if (rest.length || keywords.length) python("TypeError", "__dir__ takes no arguments"); task = nativeModuleDirectory(raw, site, finish, depth); continue; }
            }
          }
          if (callable.name === "native-module-missing") {
            const receiver = classes.nativeModule(args[0]);
            task = moduleEntry({receiver, key: args[1], name: values.text(args[1]), mode: "get", depth, after: continuation("relay", {receiver: args[0], after: completion})}, site, false, null); continue;
          }
          if ((NATIVE_SUBCLASS_BASES.includes(nativeOwner) || ["bool", "range", "slice", "memoryview", "NoneType", "NotImplementedType"].includes(nativeOwner)) && callable.name.includes(".") &&
              (nativeName === "__new__" || args[0] instanceof InstanceValue && args[0].nativePayload !== undefined || NATIVE_PROTOCOL_KEYS.includes(nativeName) || nativeOwner === "list" && nativeName === "append")) {
            if (nativeName === "__new__") {
              if (!args.length || !classes.isType(args[0]) || !classes.subclass(args[0], classes.builtin(nativeOwner))) python("TypeError", nativeOwner + ".__new__ requires a subtype receiver");
              task = callTask(classes.builtin(nativeOwner), ["list", "dict", "set", "bytearray"].includes(nativeOwner) ? [] : args.slice(1), ["list", "dict", "set", "bytearray"].includes(nativeOwner) ? [] : keywords, ["list", "dict", "set", "bytearray"].includes(nativeOwner) ? [] : keywordValues, site,
                continuation("native-new", {type: args[0], after: completion}), depth); continue;
            }
            const original = args[0], receiver = classes.payload(original), rest = args.slice(1), operands = rest.map(item => classes.payload(item));
            const finish = continuation("relay", {receiver: original, after: completion});
            if (nativeName === "__init__" && ["list", "dict", "set", "bytearray"].includes(nativeOwner)) {
              if (nativeOwner === "dict") {
                if (rest.length || keywords.length) hard("UNSUPPORTED", "UnsupportedOperationError", "Populated dictionary constructors remain #116");
                task = valueTask(null, site, finish); continue;
              }
              if (nativeOwner === "bytearray" && rest.length && (rest.length > 1 || keywords.length || typeof classes.payload(rest[0]) === "bigint" || values.isBinary(classes.payload(rest[0])))) {
                task = callTask(classes.builtin("bytearray"), rest, keywords, keywordValues, site,
                  continuation("native-bytes-init", {receiver: original, after: completion}), depth); continue;
              }
              if (keywords.length || rest.length > 1) python("TypeError", nativeOwner + ".__init__ takes at most one iterable");
              if (nativeOwner === "set") values.clearSet(receiver);
              else {
                if (nativeOwner === "bytearray") values.checkBufferResize(receiver);
                mutate(receiver, () => { const items = receiver.items; receiver.items = []; return () => { receiver.items = items; }; });
              }
              task = rest.length ? consumeTask(nativeOwner === "set" ? "set-update" : nativeOwner, rest[0], site,
                continuation("item-result", {receiver: original, after: completion}), depth, receiver) : valueTask(null, site, finish); continue;
            }
            if (["__setitem__", "__delitem__"].includes(nativeName)) {
              if (keywords.length || rest.length !== (nativeName === "__setitem__" ? 2 : 1)) python("TypeError", nativeName + " received invalid arguments");
              task = itemTask(receiver, rest[0], site, finish, depth, nativeName === "__setitem__" ? "set" : "delete", rest[1] ?? null); continue;
            }
            if (["__iadd__", "__imul__", "__isub__", "__iand__", "__ior__", "__ixor__"].includes(nativeName)) {
              if (keywords.length || rest.length !== 1) python("TypeError", nativeName + " takes one argument");
              const op = {__iadd__: "add", __imul__: "multiply", __isub__: "subtract", __iand__: "bit-and", __ior__: "bit-or", __ixor__: "bit-xor"}[nativeName];
              if (op === "multiply" && userProtocol(operands[0])) { task = unaryTask("index", operands[0], site, continuation("native-repeat", {receiver: original, inplace: true, after: completion}), depth); continue; }
              const result = values.inplace(op, receiver, operands[0]);
              task = valueTask(result === receiver ? original : result, site, finish); continue;
            }
            if (nativeName === "append" && nativeOwner === "list") {
              if (keywords.length || rest.length !== 1) python("TypeError", "append takes one argument");
              task = valueTask(values.append(receiver, rest[0]), site, finish); continue;
            }
            const notImplemented = () => valueTask(moduleContext.builtin("NotImplemented", () => allocate(NotImplementedValue)), site, finish);
            const unary = {__len__: "len", __bool__: "truth", __iter__: "iter", __hash__: "hash", __neg__: "negative", __pos__: "positive", __invert__: "invert", __index__: "index", __repr__: "repr", __str__: "str"}[nativeName];
            if (unary) {
              if (keywords.length || rest.length) python("TypeError", nativeName + " takes no arguments");
              task = unaryTask(unary, receiver, site, finish, depth); continue;
            }
            const numeric = {__int__: "int", __float__: "float", __complex__: "complex", __abs__: "abs", __round__: "round"}[nativeName];
            if (numeric) {
              if (keywords.length || rest.length > (numeric === "round" ? 1 : 0)) python("TypeError", nativeName + " received invalid arguments");
              task = callTask(classes.builtin(numeric), [receiver, ...rest], [], [], site, finish, depth); continue;
            }
            if (nativeName === "__bytes__") {
              if (keywords.length || rest.length) python("TypeError", "__bytes__ takes no arguments");
              task = valueTask(receiver, site, finish); continue;
            }
            if (nativeName === "__getitem__") {
              if (keywords.length || rest.length !== 1) python("TypeError", "__getitem__ takes one argument");
              task = itemTask(receiver, rest[0], site, finish, depth); continue;
            }
            if (nativeName === "__contains__") {
              if (keywords.length || rest.length !== 1) python("TypeError", "__contains__ takes one argument");
              task = containsTask(receiver, rest[0], site, finish, depth); continue;
            }
            const comparison = {__eq__: "equal", __ne__: "not-equal", __lt__: "less", __le__: "less-equal", __gt__: "greater", __ge__: "greater-equal"}[nativeName];
            if (comparison) {
              if (keywords.length || rest.length !== 1) python("TypeError", nativeName + " takes one argument");
              const leftType = values.typeName(receiver), rightType = values.typeName(operands[0]);
              const compatible = ["int", "bool"].includes(leftType) ? ["bool", "int"].includes(rightType) : leftType === "float" ? ["bool", "int", "float"].includes(rightType) : leftType === "complex" ? ["bool", "int", "float", "complex"].includes(rightType) :
                leftType === rightType || ["set", "frozenset"].includes(leftType) && ["set", "frozenset"].includes(rightType) || ["bytes", "bytearray", "memoryview"].includes(leftType) && ["bytes", "bytearray", "memoryview"].includes(rightType);
              if (!compatible) { task = notImplemented(); continue; }
              task = compareTask(comparison, receiver, operands[0], site, finish, depth); continue;
            }
            let arithmetic = null, reflected = false;
            for (const [operation, stem] of Object.entries(ARITHMETIC_SLOTS)) {
              if (nativeName === "__" + stem + "__" || nativeName === "__r" + stem + "__") { arithmetic = operation; reflected = nativeName === "__r" + stem + "__"; break; }
            }
            if (arithmetic) {
              if (keywords.length || rest.length < 1 || rest.length > (arithmetic === "power" ? 2 : 1)) python("TypeError", nativeName + " received invalid arguments");
              if (arithmetic === "multiply" && !["int", "float", "complex"].includes(nativeOwner) && userProtocol(operands[0])) { task = unaryTask("index", operands[0], site, continuation("native-repeat", {receiver: original, inplace: false, after: completion}), depth); continue; }
              const otherType = values.typeName(operands[0]);
              if (arithmetic === "power" && operands.length === 2 && operands[1] !== null) {
                if (nativeOwner === "int" && !["int", "bool"].includes(values.typeName(operands[1]))) { task = notImplemented(); continue; }
                if (nativeOwner === "float") python("TypeError", "pow() 3rd argument not allowed unless all arguments are integers");
                if (nativeOwner === "complex") python("ValueError", "complex modulo");
              }
              if (["int", "float", "complex"].includes(nativeOwner) && !(nativeOwner === "int" ? ["int", "bool"] : nativeOwner === "float" ? ["int", "bool", "float"] : ["int", "bool", "float", "complex"]).includes(otherType)) { task = notImplemented(); continue; }
              const inputs = reflected ? [operands[0], receiver, ...operands.slice(1)] : [receiver, ...operands];
              task = arithmetic === "divmod" || arithmetic === "power" && inputs.length === 3 ? numericTask(arithmetic === "power" ? "pow" : "divmod", inputs, site, finish, depth) : valueTask(values.binary(arithmetic, inputs[0], inputs[1]), site, finish); continue;
            }
            if (!nativeName.startsWith("__") && (values.isSet(receiver) || values.isString(receiver) && nativeName === "encode" || values.isBinary(receiver) && nativeName === "decode")) {
              if (values.isSet(receiver)) values.setMethod(receiver, nativeName);
              task = callTask(allocate(ValueMethod, receiver, nativeName), rest, keywords, keywordValues, site, finish, depth); continue;
            }
          }
          if (callable.name === "type.__subclasses__") {
            if (keywords.length || args.length !== 1 || !classes.isType(args[0])) python("TypeError", "__subclasses__ requires one type receiver");
            const roots = classes.subclasses(args[0]); state.temporaries.push(...roots);
            task = valueTask(values.list(roots), site, completion); continue;
          }
          if (callable.name === "assign-bases") {
            const {transaction, storage} = classes.beginBases(args[0], args[1], args[2]); state.temporaries.push(transaction);
            state.transactions.push(transaction);
            try {
              mutate(args[0], () => { const before = [args[0].bases, args[0].storage]; args[0].bases = transaction.bases; args[0].storage = storage; return () => { [args[0].bases, args[0].storage] = before; }; });
              task = hierarchyTask(transaction, [args[0]], site, completion);
            } catch (error) { transaction.rollback(); hierarchyDone(transaction); throw error; }
            continue;
          }
          if (callable.name === "module.__dir__") {
            const bound = callable instanceof ValueMethod, receiver = bound ? callable.receiver : args[0];
            if (!(receiver instanceof ModuleValue) || args.length !== (bound ? 0 : 1) || keywords.length) python("TypeError", "module.__dir__ requires one module receiver");
            const environment = receiver.environment;
            const record = {receiver, depth, after: completion};
            if (environment.dictionary !== null) {
              const key = values.string(Array.from("__dir__", char => char.codePointAt(0))); state.temporaries.push(key);
              task = dictionaryTask(environment.dictionary, key, site, continuation("module-native-dir", record), depth, "probe"); continue;
            }
            const hook = environmentCell(environment, "__dir__");
            task = moduleDirectory(record, !!hook?.bound, hook?.value, site); continue;
          }
          if (callable.name === "object.__init_subclass__") {
            if (args.length !== 1 || keywords.length || !classes.isType(args[0])) python("TypeError", "__init_subclass__ takes no arguments");
            task = valueTask(null, site, completion); continue;
          }
          if (callable.name === "isinstance" && (args.length === 2 && !classes.isType(args[1]) || classes.needsAdvertised(args[0]) || classes.customCheck(args[1], "__instancecheck__") ||
              state.frames.at(-1).pool.code.version === 5 && values.isSequenceType(args[1], "tuple"))) {
            if (keywords.length || args.length !== 2) python("TypeError", "isinstance requires two positional arguments");
            task = instanceTask(args[0], args[1], site, completion, depth); continue;
          }
          if (callable.name === "type.__instancecheck__") {
            if (keywords.length || args.length !== 2 || !classes.isType(args[0])) python("TypeError", "type.__instancecheck__ requires a type and instance");
            task = instanceTask(args[1], args[0], site, completion, depth, 0, true); continue;
          }
          if (callable.name === "issubclass") {
            if (keywords.length || args.length !== 2) python("TypeError", "issubclass requires two positional arguments");
            task = subclassTask(args[0], args[1], site, completion, depth); continue;
          }
          if (callable.name === "type.__subclasscheck__") {
            if (keywords.length || args.length !== 2 || !classes.isType(args[0])) python("TypeError", "type.__subclasscheck__ requires a type and subclass");
            task = subclassTask(args[1], args[0], site, completion, depth, 0, true); continue;
          }
          if (callable.name === "dict") {
            if (args[0] instanceof FrameLocalsValue) {
              if (args.length !== 1 || keywords.length) hard("UNSUPPORTED", "UnsupportedOperationError", "Expanded dict construction remains #116");
              task = frameSnapshot(args[0], site, completion); continue;
            }

            if (args.length || keywords.length) hard("UNSUPPORTED", "UnsupportedOperationError", "Populated dictionary constructors require their separate sequence stage.");
            task = valueTask(values.dict([]), site, completion); continue;
          }
          if (callable.name === "type.__call__") {
            if (!args.length || !classes.isType(args[0])) python("TypeError", "type.__call__ requires a type");
            task = constructTask(args[0], args.slice(1), keywords, keywordValues, site, completion, depth); continue;
          }
          if (callable.name === "type.__init__" || callable.name === "native-type-init") {
            if (!args.length || !classes.isType(args[0]) || args.length === 2 && keywords.length || ![2, 4].includes(args.length))
              python("TypeError", "type.__init__ requires one or three arguments after its receiver");
            task = valueTask(null, site, completion); continue;
          }
          if (callable.name === "type" && args.length === 3) {
            const target = continuation("new-result", {type: callable, args, keywords, keywordValues, after: completion, depth});
            task = callTask(classes.builtin("type.__new__"), [callable, ...args], keywords, keywordValues, site, target, depth); continue;
          }
          if (callable.name === "type.__new__") {
            if (args.length !== 4) python("TypeError", "type.__new__ requires a metaclass, name, bases and namespace");
            let [metaclass, nameValue, basesValue, namespaceValue] = args;
            if (!(metaclass instanceof BuiltinValue && metaclass.name === "type") && !classes.isMetaclass(metaclass)) python("TypeError", "type.__new__ requires a subtype of type");
            const name = values.text(nameValue);
            if (name === null || !values.isSequenceType(basesValue, "tuple") || !values.isDict(namespaceValue)) python("TypeError", "type requires a string name, tuple bases and dictionary namespace");
            if (name.length > 256 || basesValue.items.length > 16) hard("BUDGET", "ExecutionLimitError", "Class identity/base budget exceeded.");
            if (name.includes("\0")) python("ValueError", "type name must not contain null characters");
            const bases = basesValue.items, namespace = new Map();
            if (bases.some(base => !classes.isType(base))) python("TypeError", "type() doesn't support MRO entry resolution; use a class statement");
            for (const entry of namespaceValue.entries) {
              charge(1); const key = values.text(entry.key);
              if (key !== null && key.length > 256) hard("BUDGET", "ExecutionLimitError", "Class attribute name budget exceeded.");
              if (key !== null) classes.key(key); namespace.set(key ?? entry.key, entry.value);
            }
            const frame = state.frames.at(-1), currentModule = values.text(environmentCell(frame.callable.globals, "__name__")?.value) || "builtins";
            const module = namespace.has("__module__") ? values.text(namespace.get("__module__")) ?? currentModule : currentModule;
            const qualname = namespace.has("__qualname__") ? values.text(namespace.get("__qualname__")) : name;
            if (module === null || qualname === null) python("TypeError", "Class metadata requires strings");
            const cell = namespace.get("__classcell__"), dictcell = namespace.get("__classdictcell__"); namespace.delete("__classcell__"); namespace.delete("__classdictcell__");
            if (dictcell !== undefined && !(dictcell instanceof Cell)) python("TypeError", "__classdictcell__ must be a cell");
            if (cell !== undefined && !(cell instanceof Cell)) python("TypeError", "__classcell__ must be a cell");
            const selected = classes.selectMetaclass(bases, metaclass);
            if (selected !== metaclass && selected instanceof ClassValue && classes.hasSlot(selected, "__new__")) {
              if (++depth > maxDepth) python("RecursionError", "maximum metaclass construction depth exceeded");
              const item = classes.lookup(selected, "__new__"), plan = classes.bindAttribute(item.value, null, selected);
              const positional = [selected, nameValue, basesValue, namespaceValue];
              task = plan.kind === "value" ? callTask(plan.value, positional, keywords, keywordValues, site, completion, depth) :
                callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: positional, keywords, keywordValues, after: completion, depth}), depth);
              continue;
            }
            metaclass = selected;
            if (namespace.has("__slots__") || namespaceValue.entries.some(entry => values.needsOwnedHash(entry.key))) {
              const dictionary = values.copyDictionary(namespaceValue); state.temporaries.push(dictionary);
              const defaultModule = environmentCell(frame.callable.globals, "__name__")?.value ?? values.string(Array.from("builtins", char => char.codePointAt(0)));
              state.temporaries.push(defaultModule);
              task = namespaceCreateTask({name, qualname: name, module: currentModule, dictionary, defaultModule, bases,
                dynamic: true, metaclass: metaclass instanceof ClassValue ? metaclass : null, keywords, keywordValues}, site, completion, depth); continue;
            }
            const type = classes.create(name, qualname, module, bases, namespace, classes.builtin("object"),
              {dynamic: true, metaclass: metaclass instanceof ClassValue ? metaclass : null, namespaceEntries: namespaceValue.entries});
            state.temporaries.push(type);
            task = finishType(type, [...namespace], site, completion, keywords, keywordValues, cell, dictcell); continue;
          }
          if (classes.isType(callable) && !["FrameLocalsProxy", "cell", "code", "mappingproxy", "type", "super", "property", "staticmethod", "classmethod", "slice", "dict", "bool", "int", "float", "complex", "str", "list", "tuple", "range", "set", "frozenset", "bytes", "bytearray", "memoryview", ...Object.keys(EXCEPTIONS)].includes(callable.name)) {
            if (/^dict_(keys|values|items|(?:reverse)?(?:key|value|item)iterator)$/.test(callable.name)) python("TypeError", "cannot create dictionary view or iterator instances");
            if (["method_descriptor", "wrapper_descriptor", "getset_descriptor", "member_descriptor", "classmethod_descriptor"].includes(callable.name)) python("TypeError", "cannot create '" + callable.name + "' instances");
            if (["NoneType", "NotImplementedType"].includes(callable.name)) {
              if (args.length || keywords.length) python("TypeError", callable.name + " takes no arguments");
              task = valueTask(callable.name === "NoneType" ? null : moduleContext.builtin("NotImplemented", () => allocate(NotImplementedValue)), site, completion); continue;
            }
            hard("UNSUPPORTED", "UnsupportedOperationError", "Construction of reflected implementation types requires a separate stage.");
          }
          if (callable.name === "type.__prepare__") { task = valueTask(values.dict([]), site, completion); continue; }
          if (callable.name === "type.mro") {
            if (keywords.length || args.length !== 1 || !classes.isType(args[0]) || !classes.hasTypeNamespace(args[0]))
              python("TypeError", "type.mro requires one positional actual type");
            task = valueTask(values.list(classes.defaultMro(args[0])), site, completion); continue;
          }
          if (callable.name === "super") {
            if (keywords.length || args.length > 2) python("TypeError", "super received invalid arguments");
            let type = args[0], receiver = args[1] ?? null;
            if (!args.length) {
              const frame = state.frames.at(-1), first = [...frame.fn.params.posonly, ...frame.fn.params.positional][0];
              if (first === undefined) python("RuntimeError", "super(): no arguments");
              const parameter = frame.locals.get(first), cell = frame.closure.get("__class__");
              if (!parameter?.bound) python("RuntimeError", "super(): first argument was deleted");
              if (!cell?.bound || !classes.isType(cell.value)) python("RuntimeError", "super(): missing or invalid __class__ cell");
              type = cell.value; receiver = parameter.value;
            }
            if (!classes.isType(type)) python("TypeError", "super requires an adopted type");
            if (classes.needsAdvertised(receiver) && !(receiver instanceof ClassValue && classes.subclass(receiver, type)) && !classes.subclass(classes.typeOf(receiver), type)) {
              task = attributeTask(receiver, "__class__", site, continuation("advertised-super", {receiver, type, after: completion}), depth); continue;
            }
            task = valueTask(classes.superProxy(type, receiver), site, completion); continue;
          }
          if (callable.name === "object.__new__") {
            if (!args.length || !(args[0] instanceof ClassValue)) python("TypeError", "object.__new__ requires a type");
            const type = args[0];
            if (classes.layoutFamily(type) !== "object") python("TypeError", "object.__new__ cannot allocate a native layout");
            if ((args.length > 1 || keywords.length) && (classes.hasSlot(type, "__new__") || !classes.hasSlot(type, "__init__")))
              python("TypeError", "object.__new__ received extra arguments");
            task = valueTask(classes.instance(type), site, completion); continue;
          }
          if (callable.name === "object.__init__") {
            if (!args.length) python("TypeError", "object.__init__ requires an instance");
            const value = args[0];
            if ((args.length > 1 || keywords.length) && (!(value instanceof InstanceValue) ||
                classes.hasSlot(value.type, "__init__") || !classes.hasSlot(value.type, "__new__")))
              python("TypeError", "object.__init__ received extra arguments");
            task = valueTask(null, site, completion); continue;
          }
          if (["getset_descriptor.__set__", "getset_descriptor.__delete__", "member_descriptor.__set__", "member_descriptor.__delete__"].includes(callable.name)) {
            const setting = callable.name.endsWith(".__set__"), descriptor = args[0];
            if (keywords.length || args.length !== (setting ? 3 : 2) || !(descriptor instanceof BuiltinValue) || descriptor.nativeKind !== callable.name.split(".")[0]) python("TypeError", "Invalid native storage descriptor operation");
            const plan = classes.namespaceGetset(descriptor, args[1], setting ? "set" : "delete", args[2] ?? null);
            task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site, completion, depth); continue;
          }
          if (callable.name === "exception-set-args") {
            if (keywords.length || args.length !== 2 || !(args[0] instanceof ExceptionValue)) python("TypeError", "Invalid exception argument assignment");
            task = callTask(classes.builtin("tuple"), [args[1]], [], [], site, continuation("exception-args", {receiver: args[0], after: completion}), depth); continue;
          }
          if (callable.name === "namespace-getset") {
            if (keywords.length || args.length !== 2) python("TypeError", "Invalid native storage getter");
            const plan = classes.namespaceGetset(args[0], args[1]);
            task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site, completion, depth); continue;
          }
          if (["method_descriptor.__get__", "wrapper_descriptor.__get__", "getset_descriptor.__get__", "member_descriptor.__get__", "classmethod_descriptor.__get__"].includes(callable.name)) {
            if (keywords.length || args.length < 2 || args.length > 3) python("TypeError", "Native descriptor binding received invalid arguments");
            if (args[1] === null && (args[2] ?? null) === null) python("TypeError", "__get__(None, None) is invalid");
            if (args[0]?.nativeKind) {
              if (args[0].nativeKind !== callable.name.split(".")[0]) python("TypeError", "Descriptor binding requires the matching descriptor layout");
              const plan = classes.bindNamespaceDescriptor(args[0], args[1], args[2] ?? null);
              task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site, completion, depth); continue;
            }
            task = valueTask(classes.bindNativeDescriptor(callable.name.slice(0, callable.name.indexOf(".")), args[0], args[1]), site, completion); continue;
          }
          if (callable.name === "reversed" && args[0] instanceof FrameLocalsValue) {
            if (keywords.length || args.length !== 1) python("TypeError", "reversed() takes one positional argument");
            task = valueTask(values.list(frameEntries(args[0]).map(([key]) => key).reverse()), site, completion); continue;
          }
          if (callable.name === "FrameLocalsProxy" && !callable.nativeKind) {
            if (args.length !== 1 || keywords.length || !(args[0] instanceof FrameValue)) python("TypeError", "FrameLocalsProxy requires one frame argument");
            task = valueTask(allocate(FrameLocalsValue, args[0]), site, completion); continue;
          }
          if (callable.name === "generator-frame") { task = valueTask(generatorFrame(args[0]), site, completion); continue; }
          if (callable.name === "frame-locals") {
            const frame = args[0];
            task = valueTask(frame.raw.inlineFrames?.length ? allocate(FrameLocalsValue, frame) : frame.raw.dynamicNamespace ? classNamespace(frame.raw) : frame.raw.fn.kind === "module" ? values.environmentDictionary(frame.callable.globals) : frame.raw.fn.kind === "class" ? classNamespace(frame.raw) : allocate(FrameLocalsValue, frame), site, completion); continue;
          }
          if (callable.name.startsWith("FrameLocalsProxy.")) {
            const receiver = args[0], name = callable.name.slice("FrameLocalsProxy.".length);
            if (!(receiver instanceof FrameLocalsValue)) python("TypeError", "Frame locals operation requires its actual native receiver");
            if (["__or__", "__ror__", "__ior__"].includes(name)) {
              if (keywords.length || args.length !== 2) python("TypeError", name + " takes one positional argument");
              if (!(values.isDict(args[1]) || args[1] instanceof FrameLocalsValue)) { task = valueTask(moduleContext.builtin("NotImplemented", () => allocate(NotImplementedValue)), site, completion); continue; }
              if (name === "__ior__") task = frameUpdate({receiver, source: args[1], keywords: [], keywordValues: [], self: true, after: completion}, site);
              else task = arithmeticTask("bit-or", name === "__ror__" ? [args[1], receiver] : [receiver, args[1]], site, completion, depth);
              continue;
            }
            if (name === "update") {
              if (args.length !== 2 || keywords.length) python("TypeError", "update takes one positional argument");
              task = frameUpdate({receiver, source: args[1], keywords: [], keywordValues: [], self: false, after: completion}, site); continue;
            }
            if (["copy", "keys", "values", "items", "__iter__", "__reversed__", "__len__"].includes(name)) {
              if (args.length !== 1 || keywords.length) python("TypeError", name + " takes no arguments");
              if (name === "copy") { task = frameSnapshot(receiver, site, completion); continue; }
              const entries = frameEntries(receiver); state.temporaries.push(...entries.flat());
              if (name === "__len__") task = valueTask(values.int(BigInt(entries.length)), site, completion);
              else if (name === "values") task = valueTask(values.list(entries.map(([,value]) => value)), site, completion);
              else if (name === "items") {
                const items = entries.map(pair => { const item = values.tuple(pair); state.temporaries.push(item); return item; }); task = valueTask(values.list(items), site, completion);
              } else {
                const keys = values.list(entries.map(([key]) => key)); state.temporaries.push(keys);
                task = valueTask(name === "__iter__" ? values.iterator(keys) : name === "__reversed__" ? values.list([...keys.items].reverse()) : keys, site, completion);
              }
              continue;
            }
            if (["get", "pop", "setdefault", "__getitem__", "__setitem__", "__delitem__", "__contains__"].includes(name)) {
              const max = ["get", "pop", "setdefault", "__setitem__"].includes(name) ? 3 : 2;
              if (keywords.length || args.length < (name === "__setitem__" ? 3 : 2) || args.length > max) python("TypeError", name + " received invalid arguments");
              const operation = {__getitem__: "read", __setitem__: "set", __delitem__: "delete", __contains__: "contains"}[name] ?? name;
              task = frameLookup(receiver, args[1], operation, args[2] ?? null, args[2] ?? null, args.length === 3, site, completion); continue;
            }
            hard("UNSUPPORTED", "UnsupportedOperationError", "Frame locals native invocation " + name + " retains its finite namespace operation contract");
          }
          if (callable.name === "code" && !callable.nativeKind) hard("UNSUPPORTED", "UnsupportedOperationError", "Code creation requires independent verified source; CPython bytecode and raw code layouts are outside this interface");
          if (callable.name === "cell" && !callable.nativeKind) {
            if (keywords.length || args.length > 1) python("TypeError", "cell() accepts at most one positional argument");
            const cell = allocate(Cell); state.temporaries.push(cell);
            if (args.length) setCell(cell, args[0]);
            task = valueTask(cell, site, completion); continue;
          }
          if (callable.name === "function-builtins") {
            const namespace = args[0].builtins === undefined ? moduleContext.sourceBuiltins() : args[0].builtins;
            if (namespace instanceof Environment) {
              if (namespace === moduleContext.defaultBuiltins && namespace.dictionary === null) {
                for (const name of SOURCE_BUILTINS) {
                  charge(1);
                  const item = name === "__name__" ? values.string(Array.from("builtins", char => char.codePointAt(0))) : name === "object" ? moduleContext.builtin(name, () => classes.root()) :
                    name === "NotImplemented" ? moduleContext.builtin(name, () => allocate(NotImplementedValue)) : classes.builtin(name);
                  state.temporaries.push(item); moduleContext.binding(namespace, name, item);
                }
              }
              task = valueTask(values.environmentDictionary(namespace), site, completion);
            } else task = valueTask(namespace, site, completion);
            continue;
          }
          if (callable.name === "function.__get__") {
            if (!(args[0] instanceof FunctionValue)) python("TypeError", "Native function binding requires a Python function receiver");
            if (keywords.length || args.length < 2 || args.length > 3) python("TypeError", "Native function binding received invalid arguments");
            if (args[1] === null && (args[2] ?? null) === null) python("TypeError", "__get__(None, None) is invalid");
            task = valueTask(args[1] === null ? args[0] : allocate(BoundMethodValue, args[0], args[1], true), site, completion); continue;
          }
          if (callable.name === "property.__set_name__") {
            if (!(args[0] instanceof PropertyValue)) python("TypeError", "Native property notification requires a property receiver");
            if (keywords.length || args.length !== 3) python("TypeError", "Native property notification requires two positional arguments");
            task = valueTask(classes.mutate(args[0], "__name__", args[2]), site, completion); continue;
          }
          if (callable.name.startsWith("function-dictionary-")) {
            const [receiver, dictionary, key, item] = args, operation = callable.name.slice("function-dictionary-".length);
            if (!(receiver instanceof FunctionValue || receiver instanceof MethodWrapperValue) || !values.isDict(dictionary) || !values.isString(key) || args.length !== 4 || keywords.length)
              throw new TypeError("Invalid function dictionary operation.");
            const after = continuation("function-entry", {receiver, key, operation, after: completion});
            task = dictionaryTask(dictionary, key, site, operation === "set" ? continuation("relay", {receiver, after: completion}) : after,
              depth, operation === "get" ? "probe" : operation === "delete" ? "remove-probe" : "set", item); continue;
          }
          if (callable.name.startsWith("instance-dictionary-")) {
            const [receiver, dictionary, key, item, found, fallback, skipNative = false] = args, operation = callable.name.slice("instance-dictionary-".length);
            if (!classes.isInstance(receiver) || !values.isDict(dictionary) || !values.isString(key) || typeof found !== "boolean" || typeof skipNative !== "boolean" || ![6, 7].includes(args.length) || keywords.length)
              throw new TypeError("Invalid instance dictionary operation.");
            const after = continuation("instance-entry", {receiver, key, operation, found, fallback, skipNative, depth, after: completion});
            task = dictionaryTask(dictionary, key, site, after,
              depth, operation === "get" ? "probe" : operation === "delete" ? "remove-probe" : "set", item); continue;
          }
          if (callable.name === "instance-attribute-missing") {
            if (!classes.isInstance(args[0]) || !values.isString(args[1]) || args.length !== 2 || keywords.length)
              throw new TypeError("Invalid instance attribute failure.");
            classes.instanceMissing(args[0], values.text(args[1]), {found: false, skipNative: true});
          }
          if (callable.name === "method-attribute") {
            const [receiver, key] = args;
            if (!classes.isPythonMethod(receiver) || !values.isString(key) || args.length !== 2 || keywords.length)
              throw new TypeError("Invalid method attribute lookup.");
            if (++depth > maxDepth) python("RecursionError", "maximum method attribute lookup depth exceeded");
            task = attributeTask(receiver.callable, values.text(key), site,
              continuation("relay", {receiver, after: completion}), depth, "get", key); continue;
          }
          if (["method-abstract-marker", "method-documentation", "method-name", "method-qualname", "method-module"].includes(callable.name)) {
            const receiver = args[0];
            if (!(receiver instanceof BoundMethodValue) || keywords.length || args.length !== 1) throw new TypeError("Invalid method marker lookup.");
            if (++depth > maxDepth) python("RecursionError", "maximum method marker lookup depth exceeded");
            const attribute = callable.name === "method-documentation" ? "__doc__" : callable.name === "method-abstract-marker" ? "__isabstractmethod__" : "__" + callable.name.slice(7) + "__";
            task = attributeTask(receiver.callable, attribute, site,
              continuation("relay", {receiver, after: completion}), depth); continue;
          }
          if (callable.name === "descriptor-abstract") {
            const receiver = args[0];
            if (!(receiver instanceof PropertyValue || receiver instanceof MethodWrapperValue) || keywords.length || args.length !== 1) throw new TypeError("Invalid abstract-method flag lookup.");
            if (++depth > maxDepth) python("RecursionError", "maximum abstract-method flag lookup depth exceeded");
            task = abstractNext({receiver, position: 0, depth, after: completion}, site); continue;
          }
          if (callable.name === "property-name") {
            const receiver = args[0];
            if (!(receiver instanceof PropertyValue) || keywords.length || args.length !== 1) throw new TypeError("Invalid property name lookup.");
            if (receiver.fget === null || values.typeName(receiver.fget) !== null)
              python("AttributeError", "'property' object has no attribute '__name__'");
            if (++depth > maxDepth) python("RecursionError", "maximum property name lookup depth exceeded");
            task = attributeTask(receiver.fget, "__name__", site, continuation("property-name", {receiver, after: completion}), depth); continue;
          }
          if (["property.getter", "property.setter", "property.deleter"].includes(callable.name)) {
            const receiver = args[0];
            if (!(receiver instanceof PropertyValue)) python("TypeError", "Native property copy requires a property receiver");
            if (keywords.length || args.length !== 2) python("TypeError", "Native property copy requires one positional replacement");
            task = propertyTask(classes.propertyCopyArguments(receiver, callable.name.slice("property.".length), args[1]), receiver, site, completion, depth); continue;
          }
          if (["staticmethod.__get__", "classmethod.__get__"].includes(callable.name)) {
            const kind = callable.name.slice(0, callable.name.indexOf(".")), receiver = args[0];
            if (!(receiver instanceof MethodWrapperValue) || receiver.kind !== kind)
              python("TypeError", "Native method binding requires a matching wrapper receiver");
            if (keywords.length || args.length < 2 || args.length > 3)
              python("TypeError", "Native method binding received invalid arguments");
            if (args[1] === null && (args[2] ?? null) === null) python("TypeError", "__get__(None, None) is invalid");
            task = valueTask(kind === "staticmethod" ? receiver.callable :
              allocate(BoundMethodValue, receiver.callable, args[2] ?? classes.typeOf(args[1]), true), site, completion); continue;
          }
          if (["property.__get__", "property.__set__", "property.__delete__"].includes(callable.name)) {
            const reading = callable.name === "property.__get__", setting = callable.name === "property.__set__";
            if (!(args[0] instanceof PropertyValue)) python("TypeError", "Native property operation requires a property receiver");
            if (keywords.length || (reading ? args.length < 2 || args.length > 3 : args.length !== (setting ? 3 : 2)))
              python("TypeError", "Native property operation received invalid arguments");
            const receiver = args[0], target = args[1];
            if (reading && target === null) {
              if ((args[2] ?? null) === null) python("TypeError", "__get__(None, None) is invalid");
              task = valueTask(receiver, site, completion); continue;
            }
            const accessor = receiver[reading ? "fget" : setting ? "fset" : "fdel"];
            if (accessor === null) {
              task = callTask(classes.builtin("property-no-" + (reading ? "getter" : setting ? "setter" : "deleter")), [receiver, target], [], [], site, completion, depth); continue;
            }
            const after = reading ? continuation("relay", {receiver, after: completion}) :
              continuation("attribute-write", {receiver, after: completion});
            task = callTask(accessor, setting ? [target, args[2]] : [target], [], [], site, after, depth); continue;
          }
          if (["type.__getattribute__", "type.__setattr__", "type.__delattr__"].includes(callable.name)) {
            const writing = callable.name !== "type.__getattribute__", setting = callable.name === "type.__setattr__";
            if (keywords.length || args.length !== (setting ? 3 : 2)) python("TypeError", "Native type attribute operation received invalid arguments");
            if (!classes.isType(args[0])) python("TypeError", "Native type attribute operation requires a type receiver");
            const name = nativeAttributeName(args[1]);
            if (writing && args[0] instanceof BuiltinValue) python("TypeError", "Cannot mutate an immutable native type");
            task = attributeTask(args[0], name, site, completion, depth, setting ? "native-set" : writing ? "native-delete" : "native-get", args[1], null, args[2] ?? null); continue;
          }
          if (["object.__getattribute__", "object.__setattr__", "object.__delattr__"].includes(callable.name)) {
            const writing = callable.name !== "object.__getattribute__", setting = callable.name === "object.__setattr__";
            if (keywords.length || args.length !== (setting ? 3 : 2)) python("TypeError", "Native attribute operation received invalid arguments");
            const name = nativeAttributeName(args[1]);
            if (writing && args[0] instanceof ClassValue) python("TypeError", "object attribute mutation requires an ordinary instance");
            const identityLayout = ["__name__", "__qualname__", "__module__"].includes(name) && (args[0] instanceof FunctionValue || classes.isPythonMethod(args[0]));
            if (identityLayout && !writing && classes.isPythonMethod(args[0])) python("AttributeError", "Method identity metadata requires ordinary callable fallback.");
            task = attributeTask(args[0], name, site, completion, depth, setting ? "native-set" : writing ? "native-delete" : "native-get", args[1], null, args[2] ?? null); continue;
          }
          if (["getattr", "setattr", "delattr", "hasattr"].includes(callable.name)) {
            const name = callable.name, writing = name === "setattr" || name === "delattr";
            if (keywords.length || args.length < 2 || args.length > (name === "getattr" || name === "setattr" ? 3 : 2) || name === "setattr" && args.length !== 3)
              python("TypeError", name + "() received invalid arguments");
            const attribute = values.text(classes.payload(args[1]));
            if (attribute === null) python("TypeError", "attribute name must be string");
            if (attribute.length > 256) hard("BUDGET", "ExecutionLimitError", "Attribute name budget exceeded.");
            const receiver = args[0], optional = name === "hasattr" || name === "getattr" && args.length === 3;
            const target = writing ? continuation("attribute-write", {receiver, after: completion}) : optional ?
              continuation("attribute-result", {receiver, default: args[2] ?? null, mode: name, after: completion}) : completion;
            if (!writing) {
              const after = optional ? target : continuation("attribute-context", {receiver, key: args[1], after: target});
              task = attributeTask(receiver, attribute, site, after, depth, "get", args[1]); continue;
            }
            if (receiver instanceof ModuleValue) {
              task = attributeTask(receiver, attribute, site, target, depth, writing ? name === "setattr" ? "set" : "delete" : "get", args[1], null, args[2] ?? null); continue;
            }
            if (writing && (classes.lookupMayCallback(receiver) || classes.hasAttributeHook(receiver, name === "setattr" ? "__setattr__" : "__delattr__"))) {
              task = attributeTask(receiver, attribute, site, completion, depth, name === "setattr" ? "set" : "delete", args[1], null, args[2] ?? null); continue;
            }
            if (!writing &&
                (classes.lookupMayCallback(receiver) || classes.hasAttributeHook(receiver, "__getattribute__") || classes.hasAttributeHook(receiver, "__getattr__") || userProtocol(receiver) && attribute === "__class__" && classes.hasSlot(classes.checkingType(receiver), "__class__"))) {
              task = attributeTask(receiver, attribute, site, target, depth, "get", args[1]); continue;
            }
            let plan;
            try { plan = writing ? classes.write(receiver, attribute, args[2] ?? null, name === "delattr", args[1]) : classes.read(receiver, attribute, false, args[1]); }
            catch (error) {
              const recovery = error instanceof Raised && recover(error.value, target, site);
              if (!recovery) throw error;
              task = recovery; continue;
            }
            task = plan.kind === "value" ? valueTask(writing ? null : name === "hasattr" ? true : plan.value, site, completion) :
              callTask(plan.callable, plan.args, [], [], site,
                plan.kind === "bind-call" ? continuation("invoke", {args: plan.invokeArgs, keywords: [], keywordValues: [], after: target, depth}) : target, depth);
            continue;
          }
          if (callable instanceof ValueMethod && callable.receiver instanceof GeneratorValue) {
            if (keywords.length || args.length !== (callable.name === "close" || callable.name === "__iter__" || callable.name === "__next__" ? 0 : 1)) {
              if (callable.name === "throw" && args.length > 1) hard("UNSUPPORTED", "UnsupportedOperationError", "Multi-argument generator.throw requires a separate stage.");
              python("TypeError", "Invalid generator method arguments");
            }
            if (callable.name === "__iter__") { task = deliver(callable.receiver, completion, site); continue; }
            resumeGenerator(callable.receiver, callable.name === "__next__" ? "send" : callable.name, args[0] ?? null, site, completion); return;
          }
          if (callable instanceof ValueMethod && values.isView(callable.receiver)) {
            if (args.length || keywords.length) {
              if (callable.name === "tobytes" && args.length <= 1 && keywords.every(name => name === "order"))
                hard("UNSUPPORTED", "UnsupportedOperationError", "Buffer byte-order options require a later value stage.");
              python("TypeError", callable.name + "() requires no arguments");
            }
            const receiver = callable.receiver;
            if (callable.name === "release") { task = valueTask(values.releaseView(receiver), site, completion); continue; }
            values.liveView(receiver);
            const result = callable.name === "toreadonly" ? values.view(receiver, true) : callable.name === "tobytes" ?
              values.binaryValue(values.viewItems(receiver)) : values.list(values.viewItems(receiver).map(byte => values.int(BigInt(byte))));
            task = valueTask(result, site, completion); continue;
          }
          if (callable.name === "memoryview") {
            count("builtin:memoryview");
            const bound = bindNamed(["object"], args, keywords, keywordValues);
            if (!bound.has("object")) python("TypeError", "memoryview() requires an object argument");
            task = valueTask(values.view(bound.get("object")), site, completion); continue;
          }
          if (callable instanceof ValueMethod && ["encode", "decode"].includes(callable.name) &&
              (values.isString(callable.receiver) || values.isBinary(callable.receiver))) {
            const bound = bindNamed(["encoding", "errors"], args, keywords, keywordValues);
            task = valueTask(callable.name === "encode" ? values.encodeText(callable.receiver, bound.get("encoding"), bound.get("errors")) :
              values.decodeBinary(callable.receiver, bound.get("encoding"), bound.get("errors")), site, completion); continue;
          }
          if (["bytes", "bytearray"].includes(callable.name)) {
            count("builtin:" + callable.name);
            const bound = bindNamed(["source", "encoding", "errors"], args, keywords, keywordValues), source = bound.get("source"), mutable = callable.name === "bytearray";
            if (bound.has("encoding") || bound.has("errors")) {
              if (!values.isString(source) || !bound.has("encoding")) python("TypeError", "encoding/errors require a string source and encoding");
              task = valueTask(values.encodeText(source, bound.get("encoding"), bound.get("errors"), mutable), site, completion); continue;
            }
            if (!bound.has("source")) { task = valueTask(values.binaryValue([], mutable), site, completion); continue; }
            if (values.isString(source)) python("TypeError", "string argument without an encoding");
            if (values.isView(source)) { task = valueTask(values.binaryValue(values.viewItems(source), mutable), site, completion); continue; }
            if (values.isBinary(source)) { task = valueTask(!mutable && !source.mutable ? source : values.binaryValue(source.items, mutable), site, completion); continue; }
            if (userProtocol(source)) {
              const plan = !mutable ? classes.special(source, "__bytes__") : null;
              if (plan) {
                const finish = continuation("binary-result", {receiver: source, after: completion});
                task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, finish, depth) :
                  callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth}), depth);
                continue;
              }
              if (classes.lookup(classes.checkingType(source), "__index__").found) {
                task = unaryTask("index", source, site, continuation("binary-count", {receiver: source, mutable, after: completion}), depth); continue;
              }
            }
            task = ["bigint", "boolean"].includes(typeof source) ? valueTask(values.binaryCount(source, mutable), site, completion) :
              consumeTask(callable.name, source, site, completion, depth); continue;
          }
          if (callable instanceof ValueMethod && values.isSet(callable.receiver)) {
            const receiver = callable.receiver, name = callable.name;
            if (keywords.length || args.length !== (["add", "discard", "remove"].includes(name) ? 1 : 0))
              python("TypeError", name + "() received invalid arguments");
            if (name === "copy" || name === "clear") {
              task = valueTask(name === "copy" ? values.copySet(receiver) : values.clearSet(receiver), site, completion); continue;
            }
            const key = name === "add" ? args[0] : values.setLookupKey(args[0]); state.temporaries.push(key);
            task = dictionaryTask(receiver.storage, key, site, completion, depth,
              {add: "set", discard: "discard", remove: "delete"}[name], null); continue;
          }
          if (["set", "frozenset"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (args.length > 1 || keywords.length) python("TypeError", callable.name + "() accepts at most one positional iterable");
            if (values.isSet(args[0])) {
              task = valueTask(values.copySet(args[0], callable.name === "frozenset"), site, completion); continue;
            }
            task = args.length ? consumeTask(callable.name, args[0], site, completion, depth) :
              valueTask(values.newSet(callable.name === "frozenset"), site, completion); continue;
          }
          if (["list", "tuple"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (args.length > 1 || keywords.length) python("TypeError", callable.name + "() accepts at most one positional argument");
            const source = args[0];
            if (args.length && (source instanceof FrameLocalsValue || source instanceof GeneratorValue || userProtocol(source) || source instanceof ProtocolIteratorValue)) {
              task = consumeTask(callable.name, source, site, completion, depth); continue;
            }
            if (callable.name === "tuple" && values.isSequenceType(source, "tuple")) { task = valueTask(source, site, completion); continue; }
            if (args.length) values.checkConstructionHint(source);
            const result = values.list([]); state.temporaries.push(result);
            if (args.length) {
              const iterator = values.iterator(source); state.temporaries.push(iterator);
              while (true) {
                let item;
                try { item = values.next(iterator); }
                catch (error) { if (error instanceof Raised && isException(error.value, "StopIteration")) break; throw error; }
                state.temporaries.push(item); values.append(result, item); state.temporaries.pop();
              }
            }
            task = valueTask(callable.name === "tuple" ? values.tuple(result.items) : result, site, completion); continue;
          }
          if (["all", "any"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (args.length !== 1 || keywords.length) python("TypeError", callable.name + "() requires one positional iterable");
            task = consumeTask(callable.name, args[0], site, completion, depth); continue;
          }
          if (values.numeric && numericNames.has(callable.name)) {
            count("builtin:"+callable.name);
            task = numericTask(callable.name,bindNumeric(callable.name,args,keywords,keywordValues),site,completion,depth); continue;
          }
          if (callable.name === "id") {
            count("builtin:id");
            if (args.length !== 1 || keywords.length) python("TypeError", "id() requires one positional value");
            task = valueTask(values.objectId(args[0]), site, completion); continue;
          }
          if (callable.name === "type.__dir__") {
            if (args.length !== 1 || keywords.length || !classes.isType(args[0]))
              python("TypeError", "type.__dir__ requires one positional actual type");
            const receiver = args[0], result = values.dict([]); state.temporaries.push(receiver, result);
            if (receiver instanceof ClassValue && (receiver.metaclass !== null || classes.lookupMayCallback(receiver))) {
              task = graphDirectory({receiver, result, depth, after: completion}, receiver, site); continue;
            }
            task = classDirectoryNext({receiver, result, pending: [receiver], owner: null, names: [], position: 0, depth, after: completion}, site); continue;
          }
          if (callable.name === "object.__dir__") {
            if (args.length !== 1 || keywords.length) python("TypeError", "object.__dir__ requires one positional receiver");
            const receiver = args[0];
            if (receiver instanceof InstanceValue || classes.isType(receiver)) {
              task = attributeTask(receiver, "__dict__", site,
                continuation("object-dir-dictionary", {receiver, depth, after: completion}), depth); continue;
            }
            if (classes.isPythonMethod(receiver) || receiver instanceof SuperValue || receiver instanceof MethodWrapperValue || receiver instanceof ModuleValue) {
              task = attributeTask(receiver, "__dict__", site,
                continuation("method-dir-dictionary", {receiver, depth, after: completion}), depth); continue;
            }
            if (classes.hasFixedDirectory(receiver)) {
              const result = values.dict([]); state.temporaries.push(result);
              task = nativeDirectoryNext({receiver, result, position: 0, depth, after: completion}, site); continue;
            }
            if (!(receiver instanceof FunctionValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "Default directories for this layout require their own stage.");
            const dictionary = classes.functionDictionary(receiver); state.temporaries.push(dictionary);
            const result = values.copyDictionary(dictionary); state.temporaries.push(result);
            task = nativeDirectoryNext({receiver, result, position: 0, depth, after: completion}, site); continue;
          }
          if (callable.name === "descriptor-qualification") {
            task = attributeTask(args[0].nativeOwner, "__qualname__", site, continuation("descriptor-qualification", {receiver: args[0], after: completion}), depth); continue;
          }
          if (callable.name === "native-method-qualname") {
            task = attributeTask(args[0].receiver, "__qualname__", site, continuation("native-method-qualname", {receiver: args[0], after: completion}), depth); continue;
          }
          if (["mappingproxy", "mappingproxy.__new__"].includes(callable.name)) {
            let operands = callable.name.endsWith(".__new__") ? args.slice(1) : args;
            if (!operands.length && keywords.length === 1 && keywords[0] === "mapping") operands = keywordValues;
            else if (keywords.length) python("TypeError", "mappingproxy received invalid arguments");
            if (operands.length !== 1 || callable.name.endsWith(".__new__") && args[0] !== classes.builtin("mappingproxy")) python("TypeError", "mappingproxy requires one mapping");
            if (!(values.isDict(operands[0]) || operands[0] instanceof ClassNamespaceValue)) {
              if (operands[0] instanceof InstanceValue) hard("UNSUPPORTED", "UnsupportedOperationError", "General user mapping proxy construction is owned by #116.");
              python("TypeError", "mappingproxy requires a mapping");
            }
            if (values.isDict(operands[0])) values.enableNamespace(operands[0]);
            task = valueTask(allocate(ClassNamespaceValue, operands[0]), site, completion); continue;
          }
          if (callable.name.startsWith("mappingproxy.") || /^dict_(keys|values|items)\./.test(callable.name)) {
            const [receiver, other] = args, name = callable.name.slice(callable.name.indexOf(".") + 1);
            const proxy = receiver instanceof ClassNamespaceValue, view = receiver instanceof DictionaryViewValue;
            if (!(proxy || view)) python("TypeError", "Native mapping operation requires a matching receiver");
            const dictionary = proxy ? values.classNamespaceDictionary(receiver) : receiver.dictionary;
            if (["get", "__contains__", "__getitem__", "__eq__", "__ne__", "__lt__", "__le__", "__gt__", "__ge__", "__or__", "__ror__", "__ior__"].includes(name)) {
              if (name !== "get" && (args.length !== 2 || keywords.length)) python("TypeError", "Native mapping operation requires one argument");
              if (name === "__contains__") { task = containsTask(receiver, other, site, completion, depth); continue; }
              if (name === "__getitem__") { task = itemTask(receiver, other, site, completion, depth); continue; }
              if (name === "__ior__") python("TypeError", "mappingproxy does not support in-place union");
              const comparisons = {__eq__: "equal", __ne__: "not-equal", __lt__: "less", __le__: "less-equal", __gt__: "greater", __ge__: "greater-equal"};
              if (proxy && comparisons[name]) {
                if (values.isDict(other)) values.enableNamespace(other);
                task = compareTask(comparisons[name], dictionary, other instanceof ClassNamespaceValue ? values.classNamespaceDictionary(other) : other, site, proxyRelay(receiver, other, completion), depth); continue;
              }
              if (proxy && ["__or__", "__ror__"].includes(name)) {
                task = arithmeticTask("bit-or", name === "__or__" ? [dictionary, other] : [other, dictionary], site, proxyRelay(receiver, other, completion), depth); continue;
              }
            } else if (["keys", "values", "items", "copy", "__len__", "__iter__", "__reversed__", "__hash__"].includes(name)) {
              if (args.length !== 1 || keywords.length) python("TypeError", "Native mapping operation takes no arguments");
              if (name === "__hash__") python("TypeError", "unhashable type: 'dict'");
              const value = name === "copy" ? values.copyDictionary(dictionary) : name === "__len__" ? values.int(BigInt(dictionary.entries.length)) :
                ["keys", "values", "items"].includes(name) ? values.dictionaryView(dictionary, ["keys", "values", "items"].indexOf(name)) :
                values.dictionaryIterator(dictionary, proxy ? 0 : receiver.kind, name === "__reversed__", view ? receiver.owner ?? dictionary : dictionary);
              task = valueTask(value, site, completion); continue;
            }
            if (name !== "get") hard("UNSUPPORTED", "UnsupportedOperationError", "Native dictionary view API " + callable.name + " is owned by #116/#117.");
          }
          if (callable.name === "reversed") {
            if (args.length !== 1 || keywords.length) python("TypeError", "reversed requires one positional argument");
            const receiver = args[0];
            const dictionary = receiver instanceof ClassNamespaceValue ? values.classNamespaceDictionary(receiver) : receiver instanceof DictionaryViewValue ? receiver.dictionary : values.isDict(receiver) ? receiver : null;
            if (dictionary === null) hard("UNSUPPORTED", "UnsupportedOperationError", "General reversed protocols are owned by #116.");
            task = valueTask(values.dictionaryIterator(dictionary, receiver instanceof DictionaryViewValue ? receiver.kind : 0, true,
              receiver instanceof DictionaryViewValue ? receiver.owner ?? dictionary : dictionary), site, completion); continue;
          }
          if (callable.name === "mappingproxy.get") {
            const [receiver, key, fallback = null] = args;
            if (!(receiver instanceof ClassNamespaceValue) || args.length < 2 || args.length > 3 || keywords.length)
              python("TypeError", "get() requires one or two positional arguments");
            task = dictionaryTask(values.classNamespaceDictionary(receiver), key, site, continuation("proxy-get", {receiver, fallback, after: completion}), depth, "probe"); continue;
          }
          if (["locals", "vars", "dir"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (keywords.length || args.length > (callable.name === "locals" ? 0 : 1)) python("TypeError", callable.name + "() received invalid arguments");
            if (args.length) {
              const receiver = args[0];
              if (callable.name === "dir" && receiver?.nativePayload instanceof ModuleValue && !classes.hasSlot(receiver.type, "__dir__")) {
                task = callTask(classes.builtin("module.__dir__"), [receiver], [], [], site, continuation("dir-sort", {receiver, depth, after: completion}), depth); continue;
              }
              if (callable.name === "dir" && receiver instanceof ModuleValue) {
                task = attributeTask(receiver, "__dir__", site, continuation("module-dir", {receiver, depth, after: completion}), depth); continue;
              }
              if (callable.name === "vars") {
                if (!(receiver instanceof ExceptionValue || receiver instanceof ModuleValue || receiver instanceof InstanceValue || classes.isType(receiver) || receiver instanceof FunctionValue || receiver instanceof MethodWrapperValue || receiver instanceof SuperValue || classes.isPythonMethod(receiver))) {
                  if (values.typeName(receiver) !== null || receiver instanceof FrameValue || receiver instanceof GeneratorValue || receiver instanceof ProtocolIteratorValue ||
                      receiver instanceof BuiltinValue && !classes.isType(receiver)) python("TypeError", "vars() argument must have a __dict__ attribute");
                  hard("UNSUPPORTED", "UnsupportedOperationError", "This object's namespace requires a separate dictionary contract.");
                }
                task = attributeTask(receiver, "__dict__", site, continuation("vars-result", {receiver, after: completion}), depth); continue;
              }
              if (receiver instanceof FunctionValue || classes.hasFixedDirectory(receiver) || classes.isPythonMethod(receiver)) {
                const after = continuation("dir-sort", {receiver, depth, after: continuation("relay", {receiver, after: completion})});
                task = callTask(classes.builtin("object.__dir__"), [receiver], [], [], site, after, depth); continue;
              }
              const type = classes.checkingType(receiver);
              if (classes.isType(receiver) && (type === null || !classes.hasSlot(type, "__dir__"))) {
                const after = continuation("dir-sort", {receiver, depth, after: continuation("relay", {receiver, after: completion})});
                task = callTask(classes.builtin("type.__dir__"), [receiver], [], [], site, after, depth); continue;
              }
              if (receiver instanceof InstanceValue && !classes.hasSlot(type, "__dir__")) {
                const after = continuation("dir-sort", {receiver, depth, after: continuation("relay", {receiver, after: completion})});
                task = callTask(classes.builtin("object.__dir__"), [receiver], [], [], site, after, depth); continue;
              }
              if (type === null || !classes.hasSlot(type, "__dir__"))
                hard("UNSUPPORTED", "UnsupportedOperationError", "Default directories require their own namespace contract.");
              if (++depth > maxDepth) python("RecursionError", "maximum implicit directory dispatch depth exceeded");
              const plan = classes.bindAttribute(classes.lookup(type, "__dir__").value, receiver, type);
              const target = continuation("dir-result", {receiver, depth, after: completion});
              task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, target, depth) :
                callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: target, depth}), depth);
              continue;
            }
            const frame = state.frames.at(-1);
            if (frame.dynamicNamespace || frame.index === 0 || frame.fn.kind === "class") {
              const dictionary = frame.fn.kind === "class" || frame.dynamicNamespace ? classNamespace(frame) : values.environmentDictionary(frame.callable.globals);
              if (callable.name === "dir" && !values.isDict(dictionary)) {
                task = attributeTask(dictionary, "keys", site, continuation("class-mapping-dir-call", {receiver: dictionary, depth, after: completion})); continue;
              }
              task = callable.name === "dir" ? valueTask(values.list(dictionary.entries.map(entry => entry.key)), site, continuation("dir-sort", {receiver: dictionary, depth, after: completion})) :
                valueTask(dictionary, site, completion); continue;
            }
            const activeFrame = visibleFrame(state.frames.at(-1));
            if (activeFrame.reflector?.extras !== null && activeFrame.reflector?.extras !== undefined) {
              const proxy = allocate(FrameLocalsValue, activeFrame.reflector); state.temporaries.push(proxy);
              task = frameSnapshot(proxy, site, callable.name === "dir" ? continuation("frame-result", {action: "local-dir", receiver: proxy, after: completion}) : completion); continue;
            }
            const bindings = optimizedBindings();
            if (callable.name === "dir") {
              const names = [];
              for (const [name] of bindings) {
                const key = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(key); names.push(key);
              }
              task = valueTask(sortedDirectory(values.list(names)), site, completion);
            } else task = valueTask(namespaceSnapshot(bindings), site, completion);
            continue;
          }
          if (callable.name === "globals") {
            if (args.length || keywords.length) python("TypeError", "globals() takes no arguments");
            task = valueTask(values.environmentDictionary(state.frames.at(-1).callable.globals), site, completion); continue;
          }
          if (["hash", "object.__hash__"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (args.length !== 1 || keywords.length) python("TypeError", "hash requires one positional value");
            if (callable.name === "object.__hash__") {
              task = deliver(genericHash(args[0]), completion, site);
            } else task = unaryTask("hash", args[0], site, completion, depth);
            continue;
          }
          if (["iter", "next"].includes(callable.name) && state.frames.at(-1).pool.code.version >= 4) {
            count("builtin:" + callable.name);
            if (state.frames.at(-1).pool.code.version === 4 && args.length === 2 && !(callable.name === "next" && args[0] instanceof GeneratorValue))
              hard("UNSUPPORTED", "UnsupportedOperationError", "This two-argument primitive iteration form requires classes-source/1.");
            if (args.length < 1 || args.length > 2 || keywords.length) python("TypeError", callable.name + "() requires one or two positional arguments");
            if (callable.name === "iter" && args.length === 2) {
              if (!classes.callable(args[0])) python("TypeError", "iter() first argument must be callable");
              task = deliver(allocate(ProtocolIteratorValue, "callable", args[0], args[1]), completion, site); continue;
            }
            const finish = callable.name === "next" && args.length === 2 ?
              continuation("next-default", {receiver: args[0], default: args[1], after: completion}) : completion;
            task = unaryTask(callable.name, args[0], site, finish, depth); continue;
          }
          if (callable.name === "slice") {
            if (args.length < 1 || args.length > 3 || keywords.length) python("TypeError", "slice() requires one to three positional arguments");
            task = deliver(args.length === 1 ? values.sliceKey(null, args[0], null) : values.sliceKey(args[0], args[1], args[2] ?? null), completion, site); continue;
          }
          if (callable.name === "repr") {
            count("builtin:repr");
            if (args.length !== 1 || keywords.length) python("TypeError", "repr() requires one positional argument");
            task = unaryTask("repr", args[0], site, completion, depth); continue;
          }
          if (callable.name === "str" && args.length === 1 && !keywords.length && (userProtocol(args[0]) || exceptionDisplay(args[0]))) {
            count("builtin:str"); task = unaryTask("str", args[0], site, completion, depth); continue;
          }
          if (callable.name === "print" && !keywords.length && args.some(value => userProtocol(value) || exceptionDisplay(value))) {
            count("builtin:print"); task = printNext(args, 0, site, completion, depth); continue;
          }
          if (["len", "bool"].includes(callable.name) && args.length === 1 && !keywords.length) {
            task = unaryTask(callable.name === "bool" ? "truth" : "len", args[0], site, completion, depth); continue;
          }
          if (callable.name === "bool" && state.frames.at(-1).pool.code.version === 5 &&
              (args.length > 1 || keywords.length)) python("TypeError", "bool() accepts at most one positional argument");
          let value;
          if (callable.name === "property") {
            task = propertyTask(classes.propertyArguments(args, keywords, keywordValues), null, site, completion, depth); continue;
          }
          else if (["staticmethod", "classmethod"].includes(callable.name)) {
            if (args.length !== 1 || keywords.length) python("TypeError", callable.name + " requires one positional value.");
            if (++depth > maxDepth) python("RecursionError", "maximum wrapper metadata lookup depth exceeded");
            const receiver = allocate(MethodWrapperValue, callable.name, args[0]); state.temporaries.push(receiver);
            task = wrapperNext({receiver, position: 0, depth, after: completion}, site); continue;
          } else {
            if (callable.nativeKind) hard("UNSUPPORTED", "UnsupportedOperationError", "Native invocation " + callable.name + " is owned by " + classes.nativeInvocationOwner(callable) + ".");
            value = builtin(callable, [...args, ...keywordValues], keywords);
          }
          task = deliver(value, completion, site); continue;
        }
        python("TypeError", "Value is not callable in this profile");
      } catch (error) {
        if (error instanceof NamespaceLookupRequest) {
          state.temporaries.push(...operationRoots(task), error.owner, error.dictionary);
          const cache = task.lookupCache || allocate(NamespaceLookupCache); state.temporaries.push(cache);
          const key = values.string(Array.from(error.name, char => char.codePointAt(0))); state.temporaries.push(key);
          task = dictionaryTask(error.dictionary, key, site,
            continuation("namespace-lookup", {cache, task, owner: error.owner, name: error.name, dictionary: error.dictionary, phase: error.phase}), depth, "probe-entry");
          continue;
        }
        if (error instanceof RegistryError && error.code === "IMPORT") error = new Raised(registryException(error));
        const nativeFailure = error instanceof Raised && task.kind === "attribute" && task.operation === "native-get" &&
          attributeFailure(error.value, task.receiver, task.key ?? task.name, site, completion);
        const recovery = nativeFailure || error instanceof Raised && recover(error.value, completion, site);
        if (!recovery) throw error;
        task = recovery;
      }
    }
  };
  const call = (callable, args, keywords, keywordValues, site, completion = null) =>
    dispatch(callTask(callable, args, keywords, keywordValues, site, completion));
  return Object.freeze({dispatch, call, deliver, notifyNext, recover, attributeFailure, argumentOwner, appendArgument, appendKeyword, expandArguments, keywordArgument, expandMapping, finishArguments, expandDisplay, expandUnpack, resolveClassBases, prepareClass, importStatement: importer.statement});
}
