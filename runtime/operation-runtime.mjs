import {ARITHMETIC_SLOTS, ORDERING_SLOTS, allowsClassSpecial} from "./class-policy.mjs";
import {VALUE_LIMITS} from "./values.mjs";
import {GeneratorValue, FunctionValue, CallArguments, Cell, BuiltinValue, AppendValue, ValueMethod, ExceptionValue, EXCEPTIONS, matchesException, ClassValue, InstanceValue, BoundMethodValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue, ProtocolIteratorValue, NotImplementedValue} from "./function-objects.mjs";
import {completion as continuation, completionRoots, callTask, constructTask, unaryTask, valueTask, itemTask, attributeTask, instanceTask, subclassTask, sliceTask, containsTask, compareTask, dictionaryTask, dictionaryBuildTask, arithmeticTask, numericTask, consumeTask, operationRoots} from "./operations.mjs";

export class Raised { constructor(value) { this.value = value; } }

// Fixed phases of the existing machine. Python callbacks enter its ordinary
// frames; destinations use its block stack and single unwinder.
export function operationRuntime({state, memory, values, classes, moduleContext, maxDepth,
  allocate, mutate, python, hard, charge, enter, bind, block, store, onOutput, setCell, resumeGenerator, yieldGenerator, delegateResult, injectGenerator}) {
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
      write(text); return null;
    }
    if (moduleContext && callable.name === "isinstance") {
      if (args.length !== 2) python("TypeError", "isinstance expected 2 arguments, got " + args.length);
      if (state.frames.at(-1).callable.pool.code.version === 5) return classes.isinstance(args[0], args[1]);
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
    return callable.name === "len" ? values.unary("len", args[0]) : values.string(Array.from(display(args[0]), char => char.codePointAt(0)));
  };
  const lengthResult = value => {
    if (typeof value !== "bigint" && typeof value !== "boolean") python("TypeError", "__len__() must return an adopted integer");
    if (typeof value === "boolean") value = values.int(BigInt(value));
    if (value < 0n) python("ValueError", "__len__() should return >= 0");
    if (value > 9223372036854775807n) python("OverflowError", "length exceeds the signed-64-bit maximum");
    return value;
  };
  const bindingRecovery = (value, completion, site) => {
    while (["init", "relay"].includes(completion?.kind)) completion = completion.after;
    if (value.name !== "AttributeError" || !completion?.fallback) return null;
    const {operation, receiver, after, depth, missing} = completion.fallback;
    if (operation === "iter-indexed") return unaryTask(operation, receiver, site, after, depth);
    if (operation === "hash-unhashable") return unaryTask(operation, receiver, site, after, depth);
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
    const value = name === "bytes" ? values.binaryValue(result.items) : name === "tuple" ? values.tuple(result.items) :
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
    if (hintOwner instanceof InstanceValue && ["__len__", "__length_hint__"].some(slot => classes.lookup(hintOwner.type, slot).found))
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
    if (!(mapping instanceof InstanceValue)) python("TypeError", "Argument after ** must be a mapping");
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
    const formatted = key instanceof InstanceValue && ["__str__", "__repr__"].some(slot => classes.lookup(key.type, slot).found);
    return formatted ? unaryTask("str", key, site, continuation("call-duplicate-result", {receiver, key, after})) :
      unaryTask("call-keyword-duplicate", receiver, site, after);
  };
  const refuseHints = receiver => {
    const owner = receiver instanceof ProtocolIteratorValue && receiver.kind === "indexed" ? receiver.source : receiver;
    if (owner instanceof InstanceValue && ["__len__", "__length_hint__"].some(slot => classes.lookup(owner.type, slot).found))
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
  const recover = (value, completion, site) => {
    const binding = bindingRecovery(value, completion, site);
    if (binding) return binding;
    for (let current = completion; current; current = current.after) {
      if (current.kind === "dir-length" && value.name === "TypeError") return directoryHint(current, site);
      if (current.kind === "dir-hint-call" && value.name === "TypeError") return directoryNext(current, site);
      if (current.kind === "vars-result" && value.name === "AttributeError") return unaryTask("vars-missing", current.receiver, site, current.after);
      if (current.kind === "advertised-instance" && value.name === "AttributeError") return valueTask(false, site, current.after);
      if (current.kind === "advertised-super" && value.name === "AttributeError") return unaryTask("super-invalid", current.receiver, site, current.after);
      if (current.kind === "attribute-fallback" && value.name === "AttributeError")
        return attributeTask(current.receiver, current.name, site, current.after, current.depth, "fallback", current.key, current.hook);
      if (current.kind === "attribute-result" && value.name === "AttributeError") return valueTask(current.mode === "hasattr" ? false : current.default, site, current.after);
      if (current.kind === "delegate-bind" && value.name === "AttributeError") return unaryTask("delegate-raise", current.receiver, site);
      if (current.kind.startsWith("call-map-") && (value.name === "AttributeError" || value.name === "KeyError" && current.mode !== "display"))
        return value.name === "KeyError" ? duplicateKeyword(current.receiver, value.args[0] ?? current.key, site, current.after) :
          unaryTask("call-mapping-required", current.receiver, site, current.after);
      if (current.kind === "indexed-result" && ["IndexError", "StopIteration"].includes(value.name) ||
          current.kind === "callable-result" && value.name === "StopIteration") {
        exhaust(current.receiver);
        return unaryTask("iterator-stop", current.receiver, site, current.after);
      }
      if (value.name !== "StopIteration") continue;
      if (current.kind === "delegate-next") return valueTask(value.args[0] ?? null, site, continuation("delegate-return", {receiver: current.receiver}));
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
    while (["init", "relay", "vars-result", "attribute-fallback", "protocol-result", "format-result", "index-result", "item-result"].includes(completion?.kind)) {
      count("deliver:" + completion.kind);
      if (completion.kind === "init") {
        if (value !== null) python("TypeError", "__init__() should return None");
        value = completion.instance;
      } else if (completion.kind === "item-result") value = null;
      else if (completion.kind === "index-result") {
        if (typeof value !== "bigint" && typeof value !== "boolean") python("TypeError", "__index__ returned a non-integer value");
        if (typeof value === "boolean") value = values.int(BigInt(value));
      } else if (completion.kind === "format-result") {
        if (!values.isString(value)) python("TypeError", completion.slot + " returned a non-string value");
      } else if (completion.kind === "protocol-result") {
        if (completion.slot === "__bool__") {
          if (typeof value !== "boolean") python("TypeError", "__bool__() should return bool");
        } else {
          if (value instanceof InstanceValue) return unaryTask("index", value, site, completion, completion.depth);
          value = lengthResult(value);
        }
        if (completion.operation !== "len") {
          if (completion.slot === "__len__") value = value !== 0n;
          if (completion.operation === "not") value = !value;
        }
      }
      completion = completion.after;
    }
    if (completion?.kind === "advertised-instance")
      return valueTask(classes.isType(value) && classes.subclass(value, completion.type), site, completion.after);
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
    if (completion?.kind === "arithmetic-result") {
      if (!(value instanceof NotImplementedValue)) return valueTask(value, site, completion.after);
      const inplace = completion.operation.startsWith("inplace-");
      return arithmeticTask(inplace ? completion.operation.slice(8) : completion.operation, completion.args, site, completion.after,
        completion.depth, inplace ? 0 : completion.position, inplace ? null : completion.order, inplace || completion.nativeInplace);
    }
    if (completion?.kind === "arithmetic-index") {
      const args = [...completion.args]; args[completion.position] = value;
      return valueTask(completion.operation.startsWith("inplace-") ? values.inplace(completion.operation.slice(8), ...args) : values.binary(completion.operation, ...args), site, completion.after);
    }
    if (completion?.kind === "attribute-write") return valueTask(null, site, completion.after);
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
    if (completion?.kind === "dir-result") {
      const after = continuation("dir-sort", {receiver: value, depth: completion.depth, after: completion.after});
      return value instanceof InstanceValue ? unaryTask("iter", value, site,
        continuation("dir-iter", {receiver: value, depth: completion.depth, after}), completion.depth) :
        consumeTask("list", value, site, after, completion.depth);
    }
    if (completion?.kind === "dir-iter") {
      state.temporaries.push(value);
      const record = {...completion, iterator: value};
      return classes.hasSlot(completion.receiver.type, "__len__") ? unaryTask("len", completion.receiver, site,
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
    if (completion?.kind === "dir-sort")
      return directorySort({receiver: value, index: 1, lower: 0, upper: 1, depth: completion.depth, after: completion.after}, site);
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
      if (["list", "tuple"].includes(name)) {
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
      if (!(values.isIterator(value) || value instanceof InstanceValue && classes.lookup(value.type, "__next__").found))
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
      else { store(frame, task.target, value); block(frame, task.body); }
      return null;
    }
    if (completion?.kind === "index-key") return itemTask(completion.receiver, value, site, completion.after, completion.depth, completion.operation, completion.item);
    if (completion?.kind === "slice-index") {
      const parts = [...completion.parts]; parts[[2, 0, 1][completion.position]] = value;
      return sliceNext(completion.receiver, parts, completion.position, site, completion.after, completion.depth, completion.operation, completion.item);
    }
    if (completion?.kind === "print-argument") return printNext(completion.args, completion.index + 1,
      site, completion.after, completion.depth, values.text(value));
    if (completion?.kind === "optional-truth") return unaryTask(completion.operation, value, site,
      completion.after, completion.depth);
    if (completion?.kind === "invoke") return callTask(value, completion.args, completion.keywords,
      completion.keywordValues, site, completion.after, completion.depth);
    if (completion?.kind === "notify") return notifyNext(completion.type, completion.entries, completion.index, site, completion.after);
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
  const notifyNext = (type, entries, index, site, after = null) => {
    state.temporaries.push(type, ...entries.map(entry => entry[1]));
    while (index < entries.length) {
      charge(1);
      count("notify-entry");
      const [name, value] = entries[index++];
      // Keep the name rooted while planning a bound callback can allocate.
      const nameValue = values.string(Array.from(name, char => char.codePointAt(0))); state.temporaries.push(nameValue);
      const plan = classes.notification(value, type, nameValue);
      if (!plan) continue;
      return callTask(plan.callable, plan.args, [], [], site,
        continuation("notify", {type, entries, index, after}));
    }
    return deliver(type, after, site);
  };
  const initialize = (instance, args, keywords, keywordValues, site, after, depth, customNew = false) => {
    const type = instance instanceof InstanceValue ? instance.type : classes.typeOf(instance);
    const initializer = classes.lookup(type, "__init__", instance instanceof ClassValue);
    if (!initializer.found) {
      if (!customNew && (args.length || keywords.length)) python("TypeError", instance.type.name + "() takes no arguments");
      return valueTask(instance, site, after);
    }
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
      if (args[index] instanceof InstanceValue) {
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
      if (value instanceof InstanceValue) return unaryTask("index", value, site,
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
    if (operation === "probe") return valueTask(values.tuple([found, found ? receiver.entries[position].value : null]), site, after);
    if (operation === "set") return valueTask(values.commitDictionary(receiver, key, item, hash, position), site, after);
    if (operation === "discard" && !found) return valueTask(null, site, after);
    if (!found) python("KeyError", "Dictionary key not found");
    return valueTask(operation === "get" ? receiver.entries[position].value :
      values.commitDictionary(receiver, key, null, hash, position, true), site, after);
  };
  const checkDictionaryComparison = record => {
    if (record.left.version !== record.version || record.right.version !== record.otherVersion)
      hard("UNSUPPORTED", "UnsupportedOperationError", "Structural mutation during dictionary equality requires its restart stage.");
  };
  const dictionaryNext = (record, site, position = 0) => {
    const {left, right, operation, after, depth, version, otherVersion} = record;
    checkDictionaryComparison(record);
    if (position >= left.entries.length) return valueTask(operation === "equal", site, after);
    const entry = left.entries[position];
    return dictionaryTask(right, entry.key, site,
      continuation("dict-pair", {left, right, value: entry.value, operation, after, depth, version, otherVersion, position}), depth,
      "probe", null, values.dictionaryEntryHash(entry));
  };
  const dispatch = task => {
    while (task) {
      count("dispatch:" + task.kind);
      let {callable, args, keywords, keywordValues, site, completion, depth} = task;
      try {
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
          if (subclass) { task = valueTask(classes.subclass(receiver, type), site, completion); continue; }
          if (!classes.isType(type)) python("TypeError", "isinstance requires an adopted type");
          if (classes.subclass(classes.typeOf(receiver), type)) { task = valueTask(true, site, completion); continue; }
          if (!classes.needsAdvertised(receiver)) { task = valueTask(false, site, completion); continue; }
          task = attributeTask(receiver, "__class__", site, continuation("advertised-instance", {receiver, type, after: completion}), depth);
          continue;
        }
        if (task.kind === "attribute") {
          state.temporaries = operationRoots(task);
          const {receiver, name, operation} = task;
          const writing = ["set", "delete", "native-set", "native-delete"].includes(operation), removing = operation.endsWith("delete");
          if (!(writing ? allowsClassSpecial(name, "mutate") : allowsClassSpecial(name, "attribute") || name === "__class__"))
            hard("UNSUPPORTED", "UnsupportedOperationError", "This special attribute is outside classes-source/1.");
          const key = task.key ?? values.string(Array.from(name, char => char.codePointAt(0)));
          state.temporaries.push(key);
          if (writing) completion = continuation("attribute-write", {receiver, after: completion});
          if (operation === "get" && classes.hasSlot(receiver.type, "__getattr__")) {
            const hook = classes.lookup(receiver.type, "__getattr__").value;
            completion = continuation("attribute-fallback", {receiver, name, key, hook, depth, after: completion});
          }
          state.temporaries.push(...completionRoots(completion));
          let plan;
          if (["set", "delete"].includes(operation) && classes.hasSlot(receiver.type, removing ? "__delattr__" : "__setattr__"))
            plan = classes.special(receiver, removing ? "__delattr__" : "__setattr__");
          else if (operation === "fallback") plan = classes.bindAttribute(task.hook, receiver, receiver.type);
          else if (operation === "get" && classes.hasSlot(receiver.type, "__getattribute__"))
            plan = classes.special(receiver, "__getattribute__");
          else {
            plan = writing ? classes.write(receiver, name, task.item, removing) : classes.read(receiver, name);
            task = plan.kind === "value" ? valueTask(plan.value, site, completion) : callTask(plan.callable, plan.args, [], [], site, completion, depth);
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
        if (task.kind === "unary" && task.operation === "unpack-short") {
          state.temporaries = operationRoots(task); python("ValueError", "Not enough values to unpack");
        }
        if (task.kind === "unary" && ["call-keyword-duplicate", "call-mapping-required"].includes(task.operation)) {
          state.temporaries = operationRoots(task);
          python("TypeError", task.operation === "call-keyword-duplicate" ? "Call received multiple values for a keyword argument" : "Argument after ** must be a mapping");
        }
        if (task.kind === "arithmetic") {
          state.temporaries = operationRoots(task);
          const [left, right, modulus = null] = args, inplace = task.operation.startsWith("inplace-"), operation = inplace ? task.operation.slice(8) : task.operation;
          if (modulus instanceof InstanceValue) hard("UNSUPPORTED", "UnsupportedOperationError", "User modulus dispatch requires a separate power stage.");
          const stem = ARITHMETIC_SLOTS[operation], ordinary = "__" + stem + "__", reflected = "__r" + stem + "__";
          const rightFirst = task.order ?? (left instanceof InstanceValue && right instanceof InstanceValue && left.type !== right.type &&
            right.type.mro.includes(left.type) && classes.lookup(right.type, reflected).found &&
            (!classes.lookup(left.type, reflected).found || classes.lookup(right.type, reflected).value !== classes.lookup(left.type, reflected).value));
          const candidates = inplace ? [[left, "__i" + stem + "__", right]] : rightFirst ?
            [[right, reflected, left], [left, ordinary, right]] : [[left, ordinary, right], [right, reflected, left]];
          let position = task.position, plan = null;
          for (; position < candidates.length; position++) {
            charge(1);
            const [receiver, slot] = candidates[position];
            if (!(receiver instanceof InstanceValue) || !inplace && slot === reflected && left instanceof InstanceValue && right instanceof InstanceValue && left.type === right.type) continue;
            plan = classes.special(receiver, slot); if (plan) break;
          }
          if (plan) {
            if (++depth > maxDepth) python("RecursionError", "maximum implicit arithmetic dispatch depth exceeded");
            const hookArgs = [candidates[position][2], ...(operation === "power" && modulus !== null ? [modulus] : [])];
            const finish = continuation("arithmetic-result", {operation: task.operation, args, position: position + 1, order: rightFirst, nativeInplace: task.nativeInplace, depth, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, hookArgs, [], [], site, finish, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: hookArgs, keywords: [], keywordValues: [], after: finish, depth}), depth);
            continue;
          }
          if (inplace) { task = arithmeticTask(operation, args, site, completion, depth, 0, null, true); continue; }
          if (task.nativeInplace && operation === "add" && values.isList(left) && right instanceof InstanceValue) {
            const iterator = classes.lookup(right.type, "__iter__");
            if (iterator.found ? iterator.value !== null : classes.lookup(right.type, "__getitem__").found)
              hard("UNSUPPORTED", "UnsupportedOperationError", "List += with a user iterable requires its own sequence stage.");
          }
          if (operation === "multiply") {
            const repeatable = value => values.isString(value) || values.isBinary(value) || values.isList(value) || values.isSequenceType(value, "tuple");
            const count = repeatable(left) && right instanceof InstanceValue ? 1 : repeatable(right) && left instanceof InstanceValue ? 0 : -1;
            if (count >= 0 && classes.lookup(args[count].type, "__index__").found) {
              if (!(values.isBinary(args[1 - count]) || task.nativeInplace && values.isList(left)))
                hard("UNSUPPORTED", "UnsupportedOperationError", "Ordinary list/tuple/text repetition requires its separate sequence stage.");
              task = unaryTask("index", args[count], site, continuation("arithmetic-index", {operation: task.nativeInplace ? "inplace-" + operation : operation, args, position: count, order: rightFirst, nativeInplace: task.nativeInplace, depth, after: completion}), depth); continue;
            }
          }
          python("TypeError", "unsupported operands for " + operation);
        }
        if (task.kind === "consume") {
          state.temporaries = operationRoots(task);
          const {name, receiver} = task, building = ["list", "tuple"].includes(name);
          const hintOwner = receiver instanceof ProtocolIteratorValue && receiver.kind === "indexed" ? receiver.source : receiver;
          if ((building || name === "bytes") && hintOwner instanceof InstanceValue &&
              ["__len__", "__length_hint__"].some(slot => classes.lookup(hintOwner.type, slot).found))
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
          if (["pow", "divmod"].includes(name) && args.some(value => value instanceof InstanceValue)) {
            task = arithmeticTask(name === "pow" ? "power" : "divmod", args.slice(0, name === "pow" && args[2] !== null ? 3 : 2), site, completion, depth); continue;
          }
          let position = task.position;
          if (name === "range") {
            while (position < args.length && !(args[position] instanceof InstanceValue)) {
              if (!["bigint", "boolean"].includes(typeof args[position])) python("TypeError", "range() argument cannot be interpreted as an integer");
              position++;
            }
            task = position === args.length ? valueTask(values.range(args), site, completion) :
              unaryTask("index", args[position], site, continuation("numeric-index", {name, args, position, depth, after: completion}), depth);
            continue;
          }
          if (name === "complex" && args.length === 2 && values.isString(args[0])) python("TypeError", "complex() first argument cannot be a string with two arguments");
          if (name === "round" && !(args[0] instanceof InstanceValue) && !values.isPrimitive(args[0],"int") && !values.isPrimitive(args[0],"float"))
            python("TypeError", "round() argument has no numeric type slot");
          if (name === "int" && args.length === 2) {
            if (args[1] instanceof InstanceValue) {
              task = unaryTask("index",args[1],site,continuation("numeric-index",{name,args,position:1,depth,after:completion}),depth); continue;
            }
            task = deliver(values.realConstructor(name,args,true),completion,site); continue;
          }
          if (["bin","oct","hex","chr"].includes(name) && args[0] instanceof InstanceValue ||
              name === "round" && !(args[0] instanceof InstanceValue) && args[1] instanceof InstanceValue) {
            position = name === "round" ? 1 : 0;
            task = unaryTask("index",args[position],site,continuation("numeric-index",{name,args,position,depth,after:completion}),depth); continue;
          }
          if (name === "complex") while (position < args.length && !(args[position] instanceof InstanceValue)) position++;
          const receiver = args[position];
          if (receiver instanceof InstanceValue && ["int","float","complex","abs","round"].includes(name)) {
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
          const ordering = Object.hasOwn(ORDERING_SLOTS, operation);
          if (!ordering && values.isSet(left) && values.isSet(right)) { left = left.storage; right = right.storage; }
          if (!(left instanceof InstanceValue || right instanceof InstanceValue)) {
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
          const reflected = left instanceof InstanceValue && right instanceof InstanceValue && left.type !== right.type && right.type.mro.includes(left.type);
          const candidates = reflected ? [[right, left, 1], [left, right, 0]] : [[left, right, 0], [right, left, 1]];
          if (position >= candidates.length) {
            if (ordering) python("TypeError", "Ordering is not supported between these values");
            task = deliver(operation === "equal" ? left === right : left !== right, completion, site); continue;
          }
          const [receiver, other, direction] = candidates[position];
          if (!(receiver instanceof InstanceValue)) { task = compareTask(operation, left, right, site, completion, depth, position + 1); continue; }
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
          state.temporaries.push(...operationRoots(task));
          let {receiver, key} = task;
          if (values.isBinary(receiver) && key instanceof InstanceValue) {
            task = unaryTask("index", key, site, continuation("binary-member", {receiver, after: completion}), depth); continue;
          }
          if (values.isSet(receiver)) {
            key = values.setLookupKey(key); state.temporaries.push(key);
            task = dictionaryTask(receiver.storage, key, site, completion, depth, "contains"); continue;
          }
          if (values.dictionaryNeedsProtocol(receiver, key)) { task = dictionaryTask(receiver, key, site, completion, depth, "contains"); continue; }
          if (task.search || values.isIterator(receiver) || values.isView(receiver) || values.isRange(receiver) && key instanceof InstanceValue) {
            task = unaryTask("iter", receiver, site, continuation("search-iter", {receiver, key, after: completion, depth}), depth); continue;
          }
          if (!(receiver instanceof InstanceValue)) {
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
          if (values.isView(receiver)) {
            values.liveView(receiver);
            if (operation === "delete" || operation === "set" && receiver.readonly) python("TypeError", "cannot modify this memoryview");
          }
          if (task.kind === "slice") {
            if (receiver instanceof InstanceValue) {
              const key = values.sliceKey(...task.parts); state.temporaries.push(key);
              task = itemTask(receiver, key, site, completion, depth, operation, item);
            } else task = sliceNext(receiver, task.parts, 0, site, completion, depth, operation, item);
            continue;
          }
          const {key} = task;
          if (values.dictionaryNeedsProtocol(receiver, key)) { task = dictionaryTask(receiver, key, site, completion, depth, operation, item); continue; }
          if (receiver instanceof InstanceValue) {
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
          } else if (key instanceof InstanceValue && values.isSequence(receiver)) {
            task = unaryTask("index", key, site, continuation("index-key", {receiver, key, after: completion, depth, operation, item}), depth);
          } else if (operation === "set" && (values.isBinary(receiver) && receiver.mutable || values.isView(receiver) && !receiver.readonly) && item instanceof InstanceValue) {
            task = unaryTask("index", item, site, continuation("byte-assignment", {receiver, key, after: completion}), depth);
          } else task = deliver(operation === "get" ? values.binary("getitem", receiver, key) :
            operation === "set" ? values.set(receiver, key, item) : values.binary("dict-delete", receiver, key), completion, site);
          continue;
        }
        if (task.kind === "value") { task = deliver(task.value, completion, site); continue; }
        if (task.kind === "unary") {
          const {operation, value, optionalLength} = task;
          state.temporaries.push(...operationRoots(task));
          if (operation === "vars-missing") python("TypeError", "vars() argument must have a __dict__ attribute");
          if (["hash", "hash-unhashable"].includes(operation)) {
            if (operation === "hash-unhashable") python("TypeError", "unhashable type");
            if (values.hashParts(value) !== null && values.needsOwnedHash(value)) {
              if (depth >= maxDepth) python("RecursionError", "maximum sequence hash depth exceeded");
              task = hashNext(value, 0, 14695981039346656037n, site, completion, depth); continue;
            }
            if (!(value instanceof InstanceValue)) { task = deliver(values.pythonHash(value), completion, site); continue; }
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
            if (!(value instanceof InstanceValue)) { task = deliver(values.unary(operation, value), completion, site); continue; }
            charge(1);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit iteration dispatch depth exceeded");
            if (operation === "iter-indexed") {
              if (!classes.lookup(value.type, "__getitem__").found) python("TypeError", "Instance is not iterable");
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
            if (!(value instanceof InstanceValue)) {
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
            if (!(value instanceof InstanceValue)) {
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
          if (value instanceof InstanceValue && ["negative", "positive", "invert"].includes(operation)) {
            const slot = {negative: "__neg__", positive: "__pos__", invert: "__invert__"}[operation], plan = classes.special(value, slot);
            if (!plan) python("TypeError", "bad operand type for unary " + operation);
            if (++depth > maxDepth) python("RecursionError", "maximum implicit arithmetic dispatch depth exceeded");
            const finish = continuation("relay", {receiver: value, after: completion});
            task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, finish, depth) :
              callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth}), depth); continue;
          }
          if (!(value instanceof InstanceValue) || !["len", "truth", "not"].includes(operation)) {
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
        if (callable instanceof BoundMethodValue || callable instanceof MethodWrapperValue && callable.kind === "staticmethod" || callable instanceof InstanceValue) {
          charge(1);
          if (callable instanceof InstanceValue) {
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
          const fields = [callable.property.fget, callable.property.fset, callable.property.fdel];
          fields[{getter: 0, setter: 1, deleter: 2}[callable.name]] = args[0];
          task = deliver(allocate(PropertyValue, ...fields), completion, site); continue;
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
          if (classes.hasSlot(callable, "__new__") || classes.isMetaclass(callable)) {
            if (++depth > maxDepth) python("RecursionError", "maximum constructor dispatch depth exceeded");
            const item = classes.lookup(callable, "__new__"), plan = classes.bindAttribute(item.value, null, callable);
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
          if (callable.pool.code.functions[callable.index].blocks.some(block => block.instructions.some(([op]) => ["yield", "yield-from"].includes(op)))) {
            task = deliver(allocate(GeneratorValue, callable, bindings), completion, site); continue;
          }
          enter(callable, bindings, site, completion); return;
        }
        if (callable instanceof BuiltinValue) {
          if (callable.name === "isinstance" && (classes.needsAdvertised(args[0]) || classes.customCheck(args[1], "__instancecheck__") ||
              state.frames.at(-1).callable.pool.code.version === 5 && values.isSequenceType(args[1], "tuple"))) {
            if (keywords.length || args.length !== 2) python("TypeError", "isinstance requires two positional arguments");
            task = instanceTask(args[0], args[1], site, completion, depth); continue;
          }
          if (callable.name === "type.__instancecheck__") {
            if (keywords.length || args.length !== 2 || !classes.isType(args[0])) python("TypeError", "type.__instancecheck__ requires a type and instance");
            task = instanceTask(args[1], args[0], site, completion, depth, 0, true); continue;
          }
          if (callable.name === "issubclass" && (classes.customCheck(args[1], "__subclasscheck__") || values.isSequenceType(args[1], "tuple"))) {
            if (keywords.length || args.length !== 2) python("TypeError", "issubclass requires two positional arguments");
            task = subclassTask(args[0], args[1], site, completion, depth); continue;
          }
          if (callable.name === "type.__subclasscheck__") {
            if (keywords.length || args.length !== 2 || !classes.isType(args[0])) python("TypeError", "type.__subclasscheck__ requires a type and subclass");
            task = subclassTask(args[1], args[0], site, completion, depth, 0, true); continue;
          }
          if (callable.name === "dict") {
            if (args.length || keywords.length) hard("UNSUPPORTED", "UnsupportedOperationError", "Populated dictionary constructors require their separate sequence stage.");
            task = valueTask(values.dict([]), site, completion); continue;
          }
          if (callable.name === "type.__call__") {
            if (!args.length || !classes.isType(args[0])) python("TypeError", "type.__call__ requires a type");
            task = constructTask(args[0], args.slice(1), keywords, keywordValues, site, completion, depth); continue;
          }
          if (callable.name === "type.__init__") {
            if (!args.length || !classes.isType(args[0]) || keywords.length || ![2, 4].includes(args.length))
              python("TypeError", "type.__init__ requires one or three arguments after its receiver");
            task = valueTask(null, site, completion); continue;
          }
          if (callable.name === "type" && args.length === 3) {
            const target = continuation("new-result", {type: callable, args, keywords, keywordValues, after: completion, depth});
            task = callTask(classes.builtin("type.__new__"), [callable, ...args], keywords, keywordValues, site, target, depth); continue;
          }
          if (callable.name === "type.__new__") {
            if (keywords.length) hard("UNSUPPORTED", "UnsupportedOperationError", "Class creation keywords require their separate construction stage.");
            if (args.length !== 4) python("TypeError", "type.__new__ requires a metaclass, name, bases and namespace");
            let [metaclass, nameValue, basesValue, namespaceValue] = args;
            if (!(metaclass instanceof BuiltinValue && metaclass.name === "type") && !classes.isMetaclass(metaclass)) python("TypeError", "type.__new__ requires a subtype of type");
            const name = values.text(nameValue);
            if (name === null || !values.isSequenceType(basesValue, "tuple") || !values.isDict(namespaceValue)) python("TypeError", "type requires a string name, tuple bases and dictionary namespace");
            if (name.length > 256 || basesValue.items.length > 16) hard("BUDGET", "ExecutionLimitError", "Class identity/base budget exceeded.");
            if (name.includes("\0")) python("ValueError", "type name must not contain null characters");
            const bases = basesValue.items, namespace = new Map();
            for (const entry of namespaceValue.entries) {
              charge(1); const key = values.text(entry.key);
              if (key === null) hard("UNSUPPORTED", "UnsupportedOperationError", "Non-string class namespace keys require a separate construction stage.");
              if (key.length > 256) hard("BUDGET", "ExecutionLimitError", "Class attribute name budget exceeded.");
              classes.key(key); namespace.set(key, entry.value);
            }
            const frame = state.frames.at(-1), currentModule = values.text(frame.callable.globals.cells.get("__name__")?.value) || "builtins";
            const module = namespace.has("__module__") ? values.text(namespace.get("__module__")) : currentModule;
            const qualname = namespace.has("__qualname__") ? values.text(namespace.get("__qualname__")) : name;
            if (module === null || qualname === null) python("TypeError", "Class metadata requires strings");
            const cell = namespace.get("__classcell__"); namespace.delete("__classcell__");
            if (cell !== undefined && !(cell instanceof Cell)) python("TypeError", "__classcell__ must be a cell");
            const selected = classes.selectMetaclass(bases, metaclass);
            if (selected !== metaclass && selected instanceof ClassValue && classes.hasSlot(selected, "__new__")) {
              if (++depth > maxDepth) python("RecursionError", "maximum metaclass construction depth exceeded");
              const item = classes.lookup(selected, "__new__"), plan = classes.bindAttribute(item.value, null, selected);
              const positional = [selected, nameValue, basesValue, namespaceValue];
              task = plan.kind === "value" ? callTask(plan.value, positional, [], [], site, completion, depth) :
                callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: positional, keywords: [], keywordValues: [], after: completion, depth}), depth);
              continue;
            }
            metaclass = selected;
            const type = classes.create(name, qualname, module, bases, namespace, classes.builtin("object"),
              {dynamic: true, metaclass: metaclass instanceof ClassValue ? metaclass : null});
            state.temporaries.push(type);
            if (cell) setCell(cell, type);
            task = notifyNext(type, [...namespace], 0, site, completion); continue;
          }
          if (classes.isType(callable) && !["type", "super", "property", "staticmethod", "classmethod", "slice", "dict", "bool", "int", "float", "complex", "str", "list", "tuple", "range", "set", "frozenset", "bytes", "bytearray", "memoryview", ...Object.keys(EXCEPTIONS)].includes(callable.name)) {
            if (callable.name === "method_descriptor") python("TypeError", "cannot create 'method_descriptor' instances");
            if (["NoneType", "NotImplementedType"].includes(callable.name)) {
              if (args.length || keywords.length) python("TypeError", callable.name + " takes no arguments");
              task = valueTask(callable.name === "NoneType" ? null : moduleContext.builtin("NotImplemented", () => allocate(NotImplementedValue)), site, completion); continue;
            }
            hard("UNSUPPORTED", "UnsupportedOperationError", "Construction of reflected implementation types requires a separate stage.");
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
            if (classes.needsAdvertised(receiver) && !classes.subclass(receiver.type, type)) {
              task = attributeTask(receiver, "__class__", site, continuation("advertised-super", {receiver, type, after: completion}), depth); continue;
            }
            task = valueTask(classes.superProxy(type, receiver), site, completion); continue;
          }
          if (callable.name === "object.__new__") {
            if (!args.length || !(args[0] instanceof ClassValue)) python("TypeError", "object.__new__ requires a type");
            const type = args[0];
            if (classes.isMetaclass(type)) python("TypeError", "object.__new__ cannot allocate a type layout");
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
          if (["object.__getattribute__", "object.__setattr__", "object.__delattr__"].includes(callable.name)) {
            const writing = callable.name !== "object.__getattribute__", setting = callable.name === "object.__setattr__";
            if (keywords.length || args.length !== (setting ? 3 : 2)) python("TypeError", "Native attribute operation received invalid arguments");
            const name = values.text(args[1]);
            if (name === null) python("TypeError", "attribute name must be string");
            if (name.length > 256) hard("BUDGET", "ExecutionLimitError", "Attribute name budget exceeded.");
            if (writing && args[0] instanceof ClassValue) python("TypeError", "object attribute mutation requires an ordinary instance");
            if (!(args[0] instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "Native attribute access on further layouts requires a separate stage.");
            task = attributeTask(args[0], name, site, completion, depth, setting ? "native-set" : writing ? "native-delete" : "native-get", args[1], null, args[2] ?? null); continue;
          }
          if (["getattr", "setattr", "delattr", "hasattr"].includes(callable.name)) {
            const name = callable.name, writing = name === "setattr" || name === "delattr";
            if (keywords.length || args.length < 2 || args.length > (name === "getattr" || name === "setattr" ? 3 : 2) || name === "setattr" && args.length !== 3)
              python("TypeError", name + "() received invalid arguments");
            const attribute = values.text(args[1]);
            if (attribute === null) python("TypeError", "attribute name must be string");
            if (attribute.length > 256) hard("BUDGET", "ExecutionLimitError", "Attribute name budget exceeded.");
            const receiver = args[0], optional = name === "hasattr" || name === "getattr" && args.length === 3;
            const target = writing ? continuation("attribute-write", {receiver, after: completion}) : optional ?
              continuation("attribute-result", {receiver, default: args[2] ?? null, mode: name, after: completion}) : completion;
            if (writing && receiver instanceof InstanceValue && classes.hasSlot(receiver.type, name === "setattr" ? "__setattr__" : "__delattr__")) {
              task = attributeTask(receiver, attribute, site, completion, depth, name === "setattr" ? "set" : "delete", args[1], null, args[2] ?? null); continue;
            }
            if (!writing && receiver instanceof InstanceValue &&
                (classes.hasSlot(receiver.type, "__getattribute__") || classes.hasSlot(receiver.type, "__getattr__") || attribute === "__class__" && classes.hasSlot(receiver.type, "__class__"))) {
              task = attributeTask(receiver, attribute, site, target, depth, "get", args[1]); continue;
            }
            let plan;
            try { plan = writing ? classes.write(receiver, attribute, args[2] ?? null, name === "delattr") : classes.read(receiver, attribute); }
            catch (error) {
              const recovery = error instanceof Raised && recover(error.value, target, site);
              if (!recovery) throw error;
              task = recovery; continue;
            }
            task = plan.kind === "value" ? valueTask(writing ? null : name === "hasattr" ? true : plan.value, site, completion) :
              callTask(plan.callable, plan.args, [], [], site, target, depth);
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
            if (source instanceof InstanceValue) {
              const plan = !mutable ? classes.special(source, "__bytes__") : null;
              if (plan) {
                const finish = continuation("binary-result", {receiver: source, after: completion});
                task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, finish, depth) :
                  callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: finish, depth}), depth);
                continue;
              }
              if (classes.lookup(source.type, "__index__").found) {
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
            if (args.length && (source instanceof GeneratorValue || source instanceof InstanceValue || source instanceof ProtocolIteratorValue)) {
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
                catch (error) { if (error instanceof Raised && error.value.name === "StopIteration") break; throw error; }
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
          if (["locals", "vars", "dir"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (keywords.length || args.length > (callable.name === "locals" ? 0 : 1)) python("TypeError", callable.name + "() received invalid arguments");
            if (args.length) {
              const receiver = args[0];
              if (callable.name === "vars") {
                if (!(receiver instanceof InstanceValue)) {
                  if (values.typeName(receiver) !== null || receiver instanceof GeneratorValue || receiver instanceof ProtocolIteratorValue ||
                      receiver instanceof BuiltinValue && !classes.isType(receiver)) python("TypeError", "vars() argument must have a __dict__ attribute");
                  hard("UNSUPPORTED", "UnsupportedOperationError", "This object's namespace requires a separate dictionary contract.");
                }
                task = attributeTask(receiver, "__dict__", site, continuation("vars-result", {receiver, after: completion}), depth); continue;
              }
              const type = classes.checkingType(receiver);
              if (type === null || !classes.hasSlot(type, "__dir__"))
                hard("UNSUPPORTED", "UnsupportedOperationError", "Default directories require their own namespace contract.");
              if (++depth > maxDepth) python("RecursionError", "maximum implicit directory dispatch depth exceeded");
              const plan = classes.bindAttribute(classes.lookup(type, "__dir__").value, receiver, type);
              const target = continuation("dir-result", {receiver, depth, after: completion});
              task = plan.kind === "value" ? callTask(plan.value, [], [], [], site, target, depth) :
                callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [], keywords: [], keywordValues: [], after: target, depth}), depth);
              continue;
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
          if (callable.name === "globals")
            hard("UNSUPPORTED", "UnsupportedOperationError", "This namespace reflection form requires its adopted namespace contract.");
          if (["hash", "object.__hash__"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (args.length !== 1 || keywords.length) python("TypeError", "hash requires one positional value");
            if (callable.name === "object.__hash__") {
              if (!(args[0] instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "The object hash descriptor supports user instances in this stage.");
              task = deliver(values.identityHash(args[0]), completion, site);
            } else task = unaryTask("hash", args[0], site, completion, depth);
            continue;
          }
          if (["iter", "next"].includes(callable.name) && state.frames.at(-1).callable.pool.code.version >= 4) {
            count("builtin:" + callable.name);
            if (state.frames.at(-1).callable.pool.code.version === 4 && args.length === 2 && !(callable.name === "next" && args[0] instanceof GeneratorValue))
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
          if (callable.name === "str" && args.length === 1 && !keywords.length && args[0] instanceof InstanceValue) {
            count("builtin:str"); task = unaryTask("str", args[0], site, completion, depth); continue;
          }
          if (callable.name === "print" && !keywords.length && args.some(value => value instanceof InstanceValue)) {
            count("builtin:print"); task = printNext(args, 0, site, completion, depth); continue;
          }
          if (["len", "bool"].includes(callable.name) && args.length === 1 && !keywords.length) {
            task = unaryTask(callable.name === "bool" ? "truth" : "len", args[0], site, completion, depth); continue;
          }
          if (callable.name === "bool" && state.frames.at(-1).callable.pool.code.version === 5 &&
              (args.length > 1 || keywords.length)) python("TypeError", "bool() accepts at most one positional argument");
          let value;
          if (callable.name === "property") value = classes.property(args, keywords, keywordValues);
          else if (["staticmethod", "classmethod"].includes(callable.name)) {
            if (args.length !== 1 || keywords.length) python("TypeError", callable.name + " requires one positional value.");
            value = allocate(MethodWrapperValue, callable.name, args[0]);
          } else value = builtin(callable, [...args, ...keywordValues], keywords);
          task = deliver(value, completion, site); continue;
        }
        python("TypeError", "Value is not callable in this profile");
      } catch (error) {
        const recovery = error instanceof Raised && recover(error.value, completion, site);
        if (!recovery) throw error;
        task = recovery;
      }
    }
  };
  const call = (callable, args, keywords, keywordValues, site, completion = null) =>
    dispatch(callTask(callable, args, keywords, keywordValues, site, completion));
  return Object.freeze({dispatch, call, deliver, notifyNext, recover, argumentOwner, appendArgument, appendKeyword, expandArguments, keywordArgument, expandMapping, finishArguments, expandDisplay, expandUnpack});
}
