import {FunctionValue, BuiltinValue, AppendValue, ExceptionValue, EXCEPTIONS, matchesException, ClassValue, InstanceValue, BoundMethodValue, PropertyValue, MethodWrapperValue, PropertyAccessorValue, ProtocolIteratorValue, NotImplementedValue} from "./function-objects.mjs";
import {completion as continuation, callTask, unaryTask, valueTask, itemTask, sliceTask, containsTask, compareTask, dictionaryTask, dictionaryBuildTask, operationRoots} from "./operations.mjs";

export class Raised { constructor(value) { this.value = value; } }

// Fixed phases of the existing machine. Python callbacks enter its ordinary
// frames; destinations use its block stack and single unwinder.
export function operationRuntime({state, memory, values, classes, moduleContext, maxDepth,
  allocate, mutate, python, hard, charge, enter, bind, block, store, onOutput}) {
  const count = tag => { state.transitions[tag] = (state.transitions[tag] || 0) + 1; };
  const display = value => {
    if (value instanceof NotImplementedValue) return "NotImplemented";
    if (value === null) return "None";
    if (typeof value === "boolean") return value ? "True" : "False";
    if (typeof value === "bigint") return value.toString();
    if (value instanceof ExceptionValue) return value.message;
    const text = values.text(value);
    if (text !== null) return text;
    hard("UNSUPPORTED", "UnsupportedOperationError", "Formatting this value is outside the function stage.");
  };
  const write = text => {
    if (moduleContext) { moduleContext.write(text, hard); return; }
    if ((state.outputLength += text.length) > 65536) hard("BUDGET", "ExecutionLimitError", "Output budget exceeded.");
    state.outputLeases.push(memory.external(32 + 2 * text.length)); onOutput(text);
  };
  const builtin = (callable, args, keywords) => {
    count("builtin:" + callable.name);
    if (values.numeric && callable.name === "complex") {
      const positional = args.length - keywords.length, bound = new Map(["real","imag"].slice(0,positional).map((key,index)=>[key,args[index]]));
      if (args.length > 2) python("TypeError", "complex() takes at most two arguments");
      for (let index=0;index<keywords.length;index++) {
        const key=keywords[index];
        if (!["real","imag"].includes(key) || bound.has(key)) python("TypeError", "complex() received an invalid keyword");
        bound.set(key,args[positional+index]);
      }
      const operands = bound.has('imag') ? [bound.has('real') ? bound.get('real') : 0n,bound.get('imag')] : bound.has('real') ? [bound.get('real')] : [];
      if (operands.some(value=>value instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "User complex conversions require the conversion callback stage.");
      return values.complexConstructor(operands);
    }
    if (values.numeric && ["int", "float"].includes(callable.name)) {
      const positional = args.length - keywords.length;
      if (args.length > (callable.name === "int" ? 2 : 1) || keywords.some(key => callable.name !== "int" || key !== "base") ||
          keywords.length && positional !== 1) python("TypeError", callable.name + "() received invalid arguments");
      if (args.some(value => value instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "Numeric constructors require the conversion callback stage for user instances.");
      return values.realConstructor(callable.name, args, callable.name === "int" && args.length === 2);
    }
    if (values.numeric && ["abs", "divmod", "pow", "round", "bin", "oct", "hex", "chr", "ord"].includes(callable.name)) {
      const name = callable.name, labels = name === "pow" ? ["base", "exp", "mod"] : name === "round" ? ["number", "ndigits"] : name === "divmod" ? ["x", "y"] : ["value"];
      const positional = args.length - keywords.length, required = name === "pow" || name === "divmod" ? 2 : 1;
      if (positional > labels.length) python("TypeError", name + "() received too many arguments");
      const bound = new Map(labels.slice(0, positional).map((label, index) => [label, args[index]]));
      for (let index = 0; index < keywords.length; index++) {
        const key = keywords[index];
        if (!["pow", "round"].includes(name) || !labels.includes(key) || bound.has(key)) python("TypeError", name + "() received an invalid keyword");
        bound.set(key, args[positional + index]);
      }
      if (labels.slice(0, required).some(label => !bound.has(label))) python("TypeError", name + "() is missing a required argument");
      const operands = labels.map(label => bound.has(label) ? bound.get(label) : null);
      if (["bin", "oct", "hex", "chr"].includes(name) && operands[0] instanceof InstanceValue || name === "round" && operands[1] instanceof InstanceValue)
        hard("UNSUPPORTED", "UnsupportedOperationError", "Numeric index consumers require the conversion callback stage.");
      if (name === "divmod") {
        const quotient = values.binary("floor-divide", operands[0], operands[1]); state.temporaries.push(quotient);
        const remainder = values.binary("modulo", operands[0], operands[1]); state.temporaries.push(remainder);
        return values.tuple([quotient, remainder]);
      }
      return values.numericCall(name, operands);
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
      if (args.length > 1) hard("UNSUPPORTED", "UnsupportedOperationError", "Multiple exception arguments require the later repr profile.");
      return allocate(ExceptionValue, callable.name, args, args.length ? display(args[0]) : "");
    }
    if (callable.name === "print") {
      const text = args.map(display).join(" ") + "\n";
      write(text); return null;
    }
    if (moduleContext && callable.name === "isinstance") {
      if (args.length !== 2) python("TypeError", "isinstance expected 2 arguments, got " + args.length);
      const type = args[1];
      if (type instanceof ClassValue) return classes.isinstance(args[0], type);
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
      if (args.length !== 1 || !(args[0] instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "type supports one user instance in C1.");
      return args[0].type;
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
  const recover = (value, completion, site) => {
    const binding = bindingRecovery(value, completion, site);
    if (binding) return binding;
    for (let current = completion; current; current = current.after) {
      if (current.kind === "indexed-result" && ["IndexError", "StopIteration"].includes(value.name) ||
          current.kind === "callable-result" && value.name === "StopIteration") {
        exhaust(current.receiver);
        return unaryTask("iterator-stop", current.receiver, site, current.after);
      }
      if (value.name !== "StopIteration") continue;
      if (current.kind === "next-default") return valueTask(current.default, site, current.after);
      if (current.kind === "for-next") return valueTask(null, site, continuation("for-exhausted"));
      if (current.kind === "search-next") return valueTask(false, site, current.after);
    }
    return null;
  };
  const deliver = (value, completion, site) => {
    while (["init", "relay", "protocol-result", "format-result", "index-result", "item-result"].includes(completion?.kind)) {
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
    count("deliver:" + (completion?.kind ?? "stack"));
    if (completion?.kind === "hash-result") return valueTask(values.hashResult(value), site, completion.after);
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
      valueTask(completion.operation === "not-equal", site, completion.after);
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
    if (completion?.kind === "notify") return notifyNext(completion.type, completion.entries, completion.index, site);
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
  const notifyNext = (type, entries, index, site) => {
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
        continuation("notify", {type, entries, index}));
    }
    return deliver(type, null, site);
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
    const equal = a.length === b.length;
    return valueTask(operation === "equal" ? equal : !equal, site, after);
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
          const {left, right, operation, position} = task;
          if (!(left instanceof InstanceValue || right instanceof InstanceValue)) {
            if (values.sameSequenceKind(left, right)) {
              const a = values.comparisonSequence(left), b = values.comparisonSequence(right);
              task = a.length !== b.length ? valueTask(operation === "not-equal", site, completion) :
                sequenceNext({left, right, operation, after: completion, depth}, site); continue;
            }
            if (values.isDict(left) && values.isDict(right)) {
              task = left.entries.length !== right.entries.length ? valueTask(operation === "not-equal", site, completion) :
                dictionaryNext({left, right, operation, after: completion, depth, version: left.version, otherVersion: right.version}, site); continue;
            }
            task = deliver(values.binary(operation, left, right), completion, site); continue;
          }
          const reflected = left instanceof InstanceValue && right instanceof InstanceValue && left.type !== right.type && right.type.mro.includes(left.type);
          const candidates = reflected ? [[right, left], [left, right]] : [[left, right], [right, left]];
          if (position >= candidates.length) { task = deliver(operation === "equal" ? left === right : left !== right, completion, site); continue; }
          const [receiver, other] = candidates[position];
          if (!(receiver instanceof InstanceValue)) { task = compareTask(operation, left, right, site, completion, depth, position + 1); continue; }
          if (depth >= maxDepth) python("RecursionError", "maximum implicit comparison dispatch depth exceeded");
          const fallback = {operation: "compare-next", comparison: operation, left, right, position: position + 1, after: completion, depth};
          let plan, invert = false;
          try {
            plan = classes.special(receiver, operation === "equal" ? "__eq__" : "__ne__");
            if (!plan && operation === "not-equal") { invert = true; plan = classes.special(receiver, "__eq__"); }
          } catch (error) {
            const recovery = error instanceof Raised && bindingRecovery(error.value, {fallback}, site);
            if (!recovery) throw error;
            task = recovery; continue;
          }
          if (!plan) {
            task = receiver === other ? valueTask(operation === "equal", site, completion) :
              compareTask(operation, left, right, site, completion, depth, position + 1); continue;
          }
          const finish = continuation(invert ? "ne-result" : "compare-result", {operation, left, right, position, depth, after: completion});
          task = plan.kind === "value" ? callTask(plan.value, [other], [], [], site, finish, depth + 1) :
            callTask(plan.callable, plan.args, [], [], site, continuation("invoke", {args: [other], keywords: [], keywordValues: [], after: finish, depth: depth + 1, fallback}), depth + 1);
          continue;
        }
        if (task.kind === "contains") {
          state.temporaries.push(...operationRoots(task));
          const {receiver, key} = task;
          if (values.dictionaryNeedsProtocol(receiver, key)) { task = dictionaryTask(receiver, key, site, completion, depth, "contains"); continue; }
          if (task.search || values.isIterator(receiver)) {
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
          } else if (values.isSlice(key) && (operation === "get" ? values.isSequence(receiver) : values.isList(receiver))) {
            task = sliceTask(receiver, [key.start, key.stop, key.step], site, completion, depth, operation, item);
          } else if (key instanceof InstanceValue && values.isSequence(receiver)) {
            task = unaryTask("index", key, site, continuation("index-key", {receiver, key, after: completion, depth, operation, item}), depth);
          } else task = deliver(operation === "get" ? values.binary("getitem", receiver, key) :
            operation === "set" ? values.set(receiver, key, item) : values.binary("dict-delete", receiver, key), completion, site);
          continue;
        }
        if (task.kind === "value") { task = deliver(task.value, completion, site); continue; }
        if (task.kind === "unary") {
          const {operation, value, optionalLength} = task;
          state.temporaries.push(...operationRoots(task));
          if (["hash", "hash-unhashable"].includes(operation)) {
            if (operation === "hash-unhashable") python("TypeError", "unhashable type");
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
          const instance = classes.instance(callable); state.temporaries.push(instance);
          const initializer = classes.lookup(callable, "__init__");
          if (!initializer.found) {
            if (args.length || keywords.length) python("TypeError", callable.name + "() takes no arguments");
            task = deliver(instance, completion, site); continue;
          }
          const method = classes.get(instance, "__init__");
          task = callTask(method, args, keywords, keywordValues, site,
            continuation("init", {instance, after: completion}), depth); continue;
        }
        if (callable instanceof FunctionValue) { enter(callable, bind(callable, args, keywords, keywordValues), site, completion); return; }
        if (callable instanceof BuiltinValue) {
          if (["hash", "object.__hash__"].includes(callable.name)) {
            count("builtin:" + callable.name);
            if (args.length !== 1 || keywords.length) python("TypeError", "hash requires one positional value");
            if (callable.name === "object.__hash__") {
              if (!(args[0] instanceof InstanceValue)) hard("UNSUPPORTED", "UnsupportedOperationError", "The object hash descriptor supports user instances in this stage.");
              task = deliver(values.identityHash(args[0]), completion, site);
            } else task = unaryTask("hash", args[0], site, completion, depth);
            continue;
          }
          if (["iter", "next"].includes(callable.name) && state.frames.at(-1).callable.pool.code.version === 5) {
            count("builtin:" + callable.name);
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
  return Object.freeze({dispatch, call, deliver, notifyNext, recover});
}
