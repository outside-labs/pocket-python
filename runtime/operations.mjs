import {ARITHMETIC_SLOTS} from "./class-policy.mjs";
// Closed internal records. Root order and multiplicity implement the initial
// resource contract, including copied ancestor roots and the extra init root.
const records = new WeakSet(), roots = new WeakMap(), heights = new WeakMap();
const itemOperation = value => {
  if (!["get", "set", "delete"].includes(value)) throw new TypeError("Invalid item operation.");
  return value;
};
const dictionaryOperation = value => {
  if (!["get", "set", "set-default", "delete", "discard", "contains", "probe", "probe-entry", "remove-probe", "pop-probe"].includes(value)) throw new TypeError("Invalid dictionary operation.");
  return value;
};
const operands = values => {
  if (!Array.isArray(values) || values.length > 131072) throw new TypeError("Invalid operation operands.");
  return Object.freeze([...values]);
};
const numericName = value => {
  if (!["range","int","float","complex","abs","round","bin","oct","hex","chr","ord","pow","divmod"].includes(value)) throw new TypeError("Invalid numeric operation.");
  return value;
};
const numericPosition = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new TypeError("Invalid numeric operand position.");
  return value;
};
const consumerName = value => {
  if (!["list", "tuple", "all", "any", "set", "frozenset", "set-update", "bytes", "bytearray"].includes(value)) throw new TypeError("Invalid iterable consumer.");
  return value;
};
export function completion(kind, fields = {}) {
  const after = fields.after ?? null;
  if (after !== null && !records.has(after)) throw new TypeError("Invalid outer completion.");
  const height = 1 + (after === null ? 0 : heights.get(after));
  // At most three continuations per bounded implicit redirect (maxDepth 256).
  if (height > 1024) throw new TypeError("Operation continuation bound exceeded.");
  let record;
  switch (kind) {
    case "eval-locals": case "eval-builtins-probe": case "eval-builtins-default": case "eval-builtins-stored":
      record = {kind, source: fields.source, globals: fields.globals, locals: fields.locals, builtins: fields.builtins, key: fields.key, mode: fields.mode ?? "eval", closure: fields.closure ?? null, after}; break;
    case "import-argument": case "import-package": case "import-spec": case "import-spec-parent": case "import-name": case "import-path":
    case "import-fromlist-path": case "import-loaded": case "import-truth": case "import-iterator": case "import-next": case "import-member": case "import-all-probe": case "import-all": case "import-child-loaded":
    case "import-statement-locals": case "import-statement-call":
      record = {kind, name: fields.name, globals: fields.globals ?? null, locals: fields.locals ?? null, fromlist: fields.fromlist,
        level: fields.level, package: fields.package ?? null, target: fields.target ?? null, module: fields.module ?? null,
        iterator: fields.iterator ?? null, outer: fields.outer ?? null, recursive: fields.recursive ?? false, visits: fields.visits ?? 0, item: fields.item ?? null, after}; break;
    case "compile-argument": record = {kind, args: operands(fields.args), position: fields.position, after}; break;
    case "arithmetic-order":
      record = {kind, task: fields.task, phase: fields.phase, candidate: fields.candidate ?? null, after};
      if (!["right", "left", "compare", "truth"].includes(record.phase)) throw new TypeError("Invalid arithmetic priority phase.");
      break;
    case "graph-dir-dict": case "graph-dir-ready": case "graph-dir-keys": case "graph-dir-call": case "graph-dir-copy":
    case "graph-dir-value": case "graph-dir-store":
    case "graph-dir-bases": case "graph-dir-length": case "graph-dir-child":
      record = {kind, receiver: fields.receiver, result: fields.result, owner: fields.owner,
        bases: operands(fields.bases), positions: operands(fields.positions), visits: fields.visits,
        source: fields.source ?? null, keys: fields.keys ?? null, position: fields.position ?? 0,
        key: fields.key ?? null, depth: fields.depth, after};
      depthCheck(record.depth);
      if (record.bases.length > 256 || record.positions.length !== record.bases.length || !Number.isSafeInteger(record.visits))
        throw new TypeError("Invalid advertised directory traversal.");
      break;
    case "bases-check": case "bases-class": case "bases-instance": case "bases-walk":
      record = {kind, receiver: fields.receiver, type: fields.type, owner: fields.owner ?? null,
        pending: operands(fields.pending ?? []), level: fields.level ?? 0, mode: fields.mode, depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "native-method-qualname": case "descriptor-qualification": record = {kind, receiver: fields.receiver, after}; break;
    case "view-item": record = {kind, receiver: fields.receiver, key: fields.key, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "proxy-get": record = {kind, receiver: fields.receiver, fallback: fields.fallback, after}; break;
    case "dict-union":
      record = {kind, left: fields.left, right: fields.right, result: fields.result, serial: fields.serial, size: fields.size, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.serial) || record.serial < -1 || !Number.isSafeInteger(record.size) || record.size < 0 || record.size > 1024)
        throw new TypeError("Invalid dictionary union phase.");
      break;
    case "namespace-build": record = {kind, task: fields.task, field: fields.field}; break;
    case "namespace-lookup": record = {kind, cache: fields.cache, task: fields.task, owner: fields.owner, name: fields.name, dictionary: fields.dictionary, phase: fields.phase}; break;
    case "class-end": record = {kind, names: operands(fields.names), items: operands(fields.items), position: fields.position, signal: fields.signal, value: fields.value}; break;
    case "class-firstline":
    case "class-qualname": record = {kind}; break;
    case "class-base-missing": case "class-base-lookup": case "class-base-result":
      record = {kind, callable: fields.callable, bases: operands(fields.bases), originalBases: fields.originalBases,
        resolved: operands(fields.resolved), position: fields.position, changed: fields.changed,
        explicit: fields.explicit, hasMeta: fields.hasMeta, keywords: operands(fields.keywords), keywordValues: operands(fields.keywordValues)}; break;
    case "class-prepare-lookup": case "class-prepare-result":
      record = {kind, callable: fields.callable, bases: operands(fields.bases), originalBases: fields.originalBases,
        metaclass: fields.metaclass, invalidMetaclass: fields.invalidMetaclass, keywords: operands(fields.keywords), keywordValues: operands(fields.keywordValues),
        rawModule: fields.rawModule, nameValue: fields.nameValue, basesTuple: fields.basesTuple}; break;
    case "class-body-module": record = {kind}; break;
    case "class-module": record = {kind, originalBases: fields.originalBases, callable: fields.callable, bases: operands(fields.bases), metaclass: fields.metaclass, invalidMetaclass: fields.invalidMetaclass, keywords: operands(fields.keywords), keywordValues: operands(fields.keywordValues)}; break;
    case "handler-type": record = {kind, position: fields.position, names: operands(fields.names), after}; break;
    case "class-mapping-dir-call": case "class-mapping-dir-result":
      record = {kind, receiver: fields.receiver, depth: fields.depth, after}; break;
    case "global-mapping-name": case "builtin-mapping-name": case "class-mapping-fallback": case "class-mapping-name": case "class-mapping-delete": case "class-name": case "module-delete": case "global-name": case "global-delete": case "builtin-name":
      record = {kind, receiver: fields.receiver, name: fields.name, after}; break;
    case "store-body": record = {kind, body: fields.body, after}; break;
    case "resume-control": record = {kind, signal: fields.signal, value: fields.value, after}; break;
    case "module-entry": case "module-hook":
      record = {kind, receiver: fields.receiver, key: fields.key, name: fields.name, mode: fields.mode, depth: fields.depth, after}; break;
    case "module-native-dir": case "module-dir": record = {kind, receiver: fields.receiver, depth: fields.depth, after}; break;
    case "module-missing": record = {kind, receiver: fields.receiver, name: fields.name, mode: fields.mode, skipNamespace: fields.skipNamespace ?? false, after}; break;
    case "class": record = {kind, nameValue: fields.nameValue, basesTuple: fields.basesTuple, originalBases: fields.originalBases, bases: operands(fields.bases), module: fields.module,
      ...(fields.keywords?.length ? {keywords: operands(fields.keywords), keywordValues: operands(fields.keywordValues)} : {}),
      ...(fields.metaclass ? {metaclass: fields.metaclass} : {}), ...(fields.invalidMetaclass ? {invalidMetaclass: true} : {})}; break;
    case "class-created": record = {kind, cell: fields.cell, after}; break;
    case "init": record = {kind, instance: fields.instance, after}; break;
    case "hierarchy-result": case "hierarchy-iter": case "hierarchy-sequence": record = {kind, transaction: fields.transaction, type: fields.type, before: fields.before, pending: operands(fields.pending), after}; break;
    case "native-doc-result": record = {kind, receiver: fields.receiver, ignoreAttribute: fields.ignoreAttribute, after}; break;
    case "native-reinit": case "native-property-copy": record = {kind, receiver: fields.receiver, after}; break;
    case "native-repeat": record = {kind, receiver: fields.receiver, inplace: fields.inplace, after}; break;
    case "list-index": record = {kind, receiver: fields.receiver, name: fields.name, item: fields.item, after}; break;
    case "dictionary-pop": record = {kind, receiver: fields.receiver, key: fields.key, fallback: fields.fallback, missing: fields.missing, after}; break;
    case "sequence-bound": record = {kind, receiver: fields.receiver, key: fields.key, bounds: operands(fields.bounds), position: fields.position, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "sequence-scan-equal": case "sequence-scan-truth":
      record = {kind, receiver: fields.receiver, key: fields.key, name: fields.name, position: fields.position,
        count: fields.count, stop: fields.stop, candidate: fields.candidate, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "native-bytes-init": record = {kind, receiver: fields.receiver, after}; break;
    case "native-new": record = {kind, type: fields.type, after}; break;
    case "new-result":
      record = {kind, type: fields.type, args: operands(fields.args), keywords: operands(fields.keywords),
        keywordValues: operands(fields.keywordValues), depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "frame-update-get": case "frame-update-map":
      record = {kind, receiver: fields.receiver, source: fields.source, keys: fields.keys, position: fields.position, self: fields.self, after}; break;
    case "frame-lookup":
      record = {kind, receiver: fields.receiver, key: fields.key, item: fields.item, fallback: fields.fallback, hasFallback: fields.hasFallback,
        operation: fields.operation, cell: fields.cell ?? null, phase: fields.phase, after}; break;
    case "frame-snapshot": case "frame-copy-value": record = {kind, receiver: fields.receiver, result: fields.result, keys: fields.keys, position: fields.position, after}; break;
    case "frame-result": record = {kind, action: fields.action, task: fields.task ?? null, receiver: fields.receiver ?? null, after}; break;
    case "function-defaults":
      record = {kind, receiver: fields.receiver, dictionary: fields.dictionary, names: operands(fields.names), keys: operands(fields.keys), items: operands(fields.items), position: fields.position, after};
      break;
    case "frame-update-boundary": record = {kind, receiver: fields.receiver, inplace: fields.inplace, context: fields.context, after}; break;
    case "frame-write":
    case "function-capture":
    case "native-not-equal":
    case "native-method-hash":
    case "relay": case "subclass-result": case "vars-result": case "property-name": record = {kind, receiver: fields.receiver, after}; break;
    case "native-method-compare":
      record = {kind, receiver: fields.receiver, other: fields.other, invert: fields.invert === true, truth: fields.truth === true, depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "property-diagnostic":
      record = {kind, receiver: fields.receiver, target: fields.target, operation: fields.operation, phase: fields.phase,
        name: fields.name ?? null, found: fields.found === true, qualification: fields.qualification ?? null, renderedName: fields.renderedName ?? null, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!["getter", "setter", "deleter"].includes(record.operation) || !["lookup", "name", "qualification"].includes(record.phase)) throw new TypeError("Invalid property diagnostic phase.");
      break;
    case "function-entry":
      record = {kind, receiver: fields.receiver, key: fields.key, operation: itemOperation(fields.operation), after}; break;
    case "instance-entry":
      if (typeof fields.found !== "boolean") throw new TypeError("Invalid instance dictionary fallback.");
      record = {kind, receiver: fields.receiver, key: fields.key, operation: itemOperation(fields.operation),
        found: fields.found, fallback: fields.fallback, skipNative: fields.skipNative ?? false, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "wrapper-metadata":
      record = {kind, receiver: fields.receiver, position: fields.position, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.position) || record.position < 0 || record.position > 3) throw new TypeError("Invalid wrapper metadata position.");
      break;
    case "property-documentation":
      record = {kind, receiver: fields.receiver, accessors: operands(fields.accessors), after};
      if (record.accessors.length !== 3) throw new TypeError("Invalid property documentation operands.");
      break;
    case "abstract-lookup": case "abstract-truth":
      record = {kind, receiver: fields.receiver, position: fields.position, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.position) || record.position < 0 || record.position > 2)
        throw new TypeError("Invalid abstract-method flag position.");
      break;
    case "object-dir-class":
      record = {kind, receiver: fields.receiver, result: fields.result, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "class-dir-merge":
      record = {kind, receiver: fields.receiver, result: fields.result, owner: fields.owner,
        pending: operands(fields.pending), names: operands(fields.names), position: fields.position, depth: fields.depth, after};
      depthCheck(record.depth);
      if (record.pending.length > 1024 || record.names.length > 256 || record.names.some(name => name === undefined) ||
          !Number.isSafeInteger(record.position) || record.position < 0 || record.position > record.names.length)
        throw new TypeError("Invalid class directory traversal phase.");
      break;
    case "object-dir-dictionary": case "method-dir-dictionary":
      record = {kind, receiver: fields.receiver, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "native-dir-merge":
      record = {kind, receiver: fields.receiver, result: fields.result, position: fields.position, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.position) || record.position < 0 || record.position > 256)
        throw new TypeError("Invalid native directory merge position.");
      break;
    case "dir-result": case "dir-iter": case "dir-sort": record = {kind, receiver: fields.receiver, depth: fields.depth ?? 0, after}; depthCheck(record.depth); break;
    case "dir-length": case "dir-hint-bound": case "dir-hint-call": case "dir-hint-value":
      record = {kind, receiver: fields.receiver, iterator: fields.iterator, depth: fields.depth, after}; depthCheck(record.depth); break;
    case "dir-compare": case "dir-truth":
      record = {kind, receiver: fields.receiver, index: fields.index, lower: fields.lower, upper: fields.upper, depth: fields.depth, after};
      depthCheck(record.depth);
      if (![record.index, record.lower, record.upper].every(Number.isSafeInteger) || record.index < 1 || record.index > 1024 ||
          record.lower < 0 || record.lower > record.upper || record.upper > record.index)
        throw new TypeError("Invalid directory ordering phase.");
      break;
    case "exec-return": case "single-display": record = {kind, after}; break;
    case "item-result": record = {kind, receiver: fields.receiver, after}; break;
    case "index-result": record = {kind, receiver: fields.receiver, after}; break;
    case "hash-result": record = {kind, receiver: fields.receiver, after}; break;
    case "sequence-hash":
      record = {kind, receiver: fields.receiver, position: fields.position, hash: fields.hash, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.position) || record.position < 0 || record.position > 1024 || typeof record.hash !== "bigint")
        throw new TypeError("Invalid sequence hash continuation.");
      break;
    case "numeric-result": case "numeric-index":
      record = {kind, name:numericName(fields.name), args:operands(fields.args), position:numericPosition(fields.position), slot:fields.slot, depth:fields.depth, after};
      depthCheck(record.depth);
      if (record.args.length > 3 || record.position >= record.args.length || kind === "numeric-result" &&
          !["__int__","__float__","__complex__","__index__","__abs__","__round__"].includes(record.slot)) throw new TypeError("Invalid numeric continuation.");
      break;
    case "dict-hash": case "dict-key": case "dict-truth":
      record = {kind, receiver: fields.receiver, key: fields.key, item: fields.item, operation: dictionaryOperation(fields.operation), depth: fields.depth, after,
        hash: fields.hash ?? null, position: fields.position ?? 0, version: fields.version ?? 0, candidate: fields.candidate ?? null};
      depthCheck(record.depth);
      if (record.hash !== null && typeof record.hash !== "bigint" || kind !== "dict-hash" && record.hash === null ||
          !Number.isSafeInteger(record.position) || record.position < 0 || record.position > 1024 ||
          !Number.isSafeInteger(record.version) || record.version < 0) throw new TypeError("Invalid dictionary continuation phase.");
      break;
    case "dict-build":
      record = {kind, receiver: fields.receiver, parts: operands(fields.parts), position: fields.position, depth: fields.depth, after};
      depthCheck(record.depth);
      if (record.parts.length > 2048 || record.parts.length % 2 || !Number.isSafeInteger(record.position) || record.position < 0 || record.position >= record.parts.length || record.position % 2)
        throw new TypeError("Invalid dictionary build phase.");
      break;
    case "dict-pair": case "dict-value": case "dict-value-truth":
      record = {kind, left: fields.left, right: fields.right, value: fields.value, operation: fields.operation, position: fields.position, depth: fields.depth,
        version: fields.version, otherVersion: fields.otherVersion, serial: fields.serial ?? null, after};
      depthCheck(record.depth); comparisonCheck(record.operation, record.position);
      if (!Number.isSafeInteger(record.version) || record.version < 0 || !Number.isSafeInteger(record.otherVersion) || record.otherVersion < 0)
        throw new TypeError("Invalid dictionary comparison versions.");
      if (record.serial !== null && (!Number.isSafeInteger(record.serial) || record.serial < 0)) throw new TypeError("Invalid dictionary comparison position.");
      break;
    case "delegate-iter": case "delegate-next": case "delegate-return": case "delegate-close":
    case "iter-result": case "indexed-result": case "callable-result": record = {kind, receiver: fields.receiver, after}; break;
    case "next-default": record = {kind, receiver: fields.receiver, default: fields.default, after}; break;
    case "binary-result": case "binary-count": case "binary-member":
      record = {kind, receiver: fields.receiver, mutable: fields.mutable === true, after}; break;
    case "byte-assignment": record = {kind, receiver: fields.receiver, key: fields.key, after}; break;
    case "display-iter": case "display-next":
      record = {kind, receiver: fields.receiver, iterator: fields.iterator ?? null, after}; break;
    case "display-insert": record = {kind, receiver: fields.receiver, after}; break;
    case "unpack-iter": case "unpack-next": case "unpack-rest-iter": case "unpack-rest-next":
      record = {kind, receiver: fields.receiver, iterator: fields.iterator ?? null, sourceIterator: fields.sourceIterator ?? null, result: fields.result,
        before: fields.before, tail: fields.tail ?? null, after};
      if (!Number.isSafeInteger(record.before) || record.before < 0 || record.before > 128 ||
          record.tail !== null && (!Number.isSafeInteger(record.tail) || record.tail < 0 || record.before + record.tail + 1 > 128))
        throw new TypeError("Invalid unpacking phase.");
      break;
    case "call-duplicate-result": record = {kind, receiver: fields.receiver, key: fields.key, after}; break;
    case "call-map-lookup": case "call-map-keys": case "call-map-sequence": case "call-map-hash":
    case "call-map-probe": case "call-map-value": case "call-map-insert": case "call-map-stored":
      record = {kind, receiver: fields.receiver, mapping: fields.mapping ?? null, keys: fields.keys ?? null,
        key: fields.key ?? null, item: fields.item ?? null, hash: fields.hash ?? null, position: fields.position ?? 0,
        version: fields.version ?? null, mode: fields.mode ?? "mapping", after};
      if (!Number.isSafeInteger(record.position) || record.position < 0 || record.position > 1024 ||
          record.hash !== null && typeof record.hash !== "bigint" || !["mapping", "keyword", "display"].includes(record.mode) ||
          record.version !== null && (!Number.isSafeInteger(record.version) || record.version < 0)) throw new TypeError("Invalid mapping expansion phase.");
      break;
    case "call-star-iter": case "call-star-next":
      record = {kind, receiver: fields.receiver, iterator: fields.iterator ?? null, after}; break;
    case "consume-iter": case "consume-next": case "consume-truth": case "consume-stored": case "consume-byte":
      record = {kind, name: consumerName(fields.name), receiver: fields.receiver, result: fields.result ?? null, depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "contains-result": case "search-iter": case "search-next":
    case "search-equal": case "search-truth":
      record = {kind, receiver: fields.receiver, key: fields.key, after, depth: fields.depth}; depthCheck(record.depth); break;
    case "sentinel-equal": case "sentinel-truth":
      record = {kind, receiver: fields.receiver, value: fields.value, after, depth: fields.depth}; depthCheck(record.depth); break;
    case "compare-result": case "ne-result": case "sequence-item": case "sequence-truth":
      record = {kind, left: fields.left, right: fields.right, operation: fields.operation, position: fields.position, depth: fields.depth, after};
      depthCheck(record.depth); comparisonCheck(record.operation, record.position); break;
    case "for-iter": case "for-next": case "for-exhausted": record = {kind}; break;
    case "index-key": record = {kind, receiver: fields.receiver, key: fields.key, operation: itemOperation(fields.operation ?? "get"), item: fields.item ?? null, after, depth: fields.depth}; depthCheck(record.depth); break;
    case "slice-index":
      record = {kind, receiver: fields.receiver, parts: operands(fields.parts), position: fields.position, operation: itemOperation(fields.operation ?? "get"), item: fields.item ?? null, after, depth: fields.depth};
      depthCheck(record.depth);
      if (record.parts.length !== 3 || !Number.isSafeInteger(record.position) || record.position < 0 || record.position > 2)
        throw new TypeError("Invalid slice conversion position.");
      break;
    case "raise-value": record = {kind, cause: fields.cause, explicit: fields.explicit}; break;
    case "raise-cause": record = {kind, receiver: fields.receiver}; break;
    case "exception-args": record = {kind, receiver: fields.receiver, after}; break;
    case "exception-note-get": case "exception-note-store":
      record = {kind, receiver: fields.receiver, note: fields.note, result: fields.result ?? null, depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "format-result": record = {kind, receiver: fields.receiver, slot: fields.slot, after}; break;
    case "print-argument":
      record = {kind, args: operands(fields.args), index: fields.index, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.index) || record.index < 0 || record.index >= record.args.length)
        throw new TypeError("Invalid print position.");
      break;
    case "protocol-result": record = {kind, receiver: fields.receiver, operation: fields.operation, slot: fields.slot, depth: fields.depth ?? 0, after}; break;
    case "optional-truth": record = {kind, receiver: fields.receiver, operation: fields.operation, depth: fields.depth, after}; break;
    case "arithmetic-result": case "arithmetic-index":
      record = {kind, operation: fields.operation, args: operands(fields.args), position: fields.position, order: fields.order, active: fields.active ?? null, nativeInplace: fields.nativeInplace === true, depth: fields.depth, after};
      arithmeticCheck(record.operation, record.args, record.position, record.order, record.active); depthCheck(record.depth); break;
    case "attribute-write": record = {kind, receiver: fields.receiver, after}; break;
    case "advertised-instance": case "advertised-super": record = {kind, receiver: fields.receiver, type: fields.type, after}; break;
    case "check-result": case "check-truth":
      record = {kind, receiver: fields.receiver, type: fields.type, depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "instance-tuple": case "subclass-tuple": record = {kind, receiver: fields.receiver, type: fields.type, position: fields.position, nesting: fields.nesting, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.position) || record.position < 0 || record.position > 131072 ||
          !Number.isSafeInteger(record.nesting) || record.nesting < 0 || record.nesting > 32) throw new TypeError("Invalid class-info tuple phase.");
      break;
    case "attribute-fallback": record = {kind, receiver: fields.receiver, key: fields.key, name: fields.name, hook: fields.hook, depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "attribute-result": record = {kind, receiver: fields.receiver, default: fields.default, mode: fields.mode, after};
      if (!["getattr", "hasattr"].includes(record.mode)) throw new TypeError("Invalid attribute result mode."); break;
    case "delegate-bind": record = {kind, receiver: fields.receiver, args: operands(fields.args), after}; break;
    case "invoke": record = {kind, args: operands(fields.args), keywords: operands(fields.keywords),
      keywordValues: operands(fields.keywordValues), depth: fields.depth, fallback: fields.fallback ?? null, after}; break;
    case "mro-result": case "mro-iter": case "mro-sequence":
      record = {kind, type: fields.type, entries: Object.freeze(fields.entries.map(entry => Object.freeze([...entry]))),
        cell: fields.cell ?? null, dictcell: fields.dictcell ?? null, keywords: operands(fields.keywords), keywordValues: operands(fields.keywordValues), after}; break;
    case "notify": record = {kind, type: fields.type, entries: Object.freeze(fields.entries.map(entry => Object.freeze([...entry]))), index: fields.index,
      keywords: operands(fields.keywords ?? []), keywordValues: operands(fields.keywordValues ?? []), after};
      if (record.entries.length > 128) throw new TypeError("Invalid notification snapshot.");
      break;
    case "condition":
      if (!["if", "while", "jump"].includes(fields.control)) throw new TypeError("Invalid condition destination.");
      record = {kind, control: fields.control, body: fields.body, otherwise: fields.otherwise, target: fields.target}; break;
    case "name-stored": record = {kind}; break;
    case "discard": record = {kind}; break;
    default: throw new TypeError("Unknown operation completion: " + kind);
  }
  Object.freeze(record); records.add(record); heights.set(record, height);
  // Build once, using the exhaustive visitor. Do not deduplicate ancestors.
  roots.set(record, Object.freeze(visit(record)));
  return record;
}
function visit(record) {
  switch (record.kind) {
    case "graph-dir-dict": case "graph-dir-ready": case "graph-dir-keys": case "graph-dir-call": case "graph-dir-copy":
    case "graph-dir-value": case "graph-dir-store":
    case "graph-dir-bases": case "graph-dir-length": case "graph-dir-child":
      return [record.receiver, record.result, record.owner, ...record.bases, record.source, record.keys, record.key, ...completionRoots(record.after)];
    case "bases-check": case "bases-class": case "bases-instance": case "bases-walk":
      return [record.receiver, record.type, record.owner, ...record.pending, ...completionRoots(record.after)];
    case "native-method-qualname": case "descriptor-qualification": return [record.receiver, ...completionRoots(record.after)];
    case "view-item": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "proxy-get": return [record.receiver, record.fallback, ...completionRoots(record.after)];
    case "dict-union": return [record.left, record.right, record.result, ...completionRoots(record.after)];
    case "arithmetic-order": return [record.candidate, ...operationRoots(record.task)];
    case "namespace-build": return operationRoots(record.task);
    case "namespace-lookup": return [record.cache, record.owner, record.dictionary, ...operationRoots(record.task)];
    case "class-mapping-dir-call": case "class-mapping-dir-result":
    case "global-mapping-name": case "builtin-mapping-name": case "class-mapping-fallback": case "class-mapping-name": case "class-mapping-delete": case "class-name": case "module-delete": case "global-name": case "global-delete": case "builtin-name": case "module-missing": case "module-native-dir": case "module-dir": return [record.receiver, ...completionRoots(record.after)];
    case "class-end": return [...record.items, record.value];
    case "class-body-module": case "class-firstline": case "class-qualname": return [];
    case "class-prepare-lookup": case "class-prepare-result": return [record.callable, ...record.bases, record.originalBases ?? null, record.metaclass, ...record.keywordValues, record.rawModule, record.nameValue, record.basesTuple];
    case "class-base-missing": case "class-base-lookup": case "class-base-result": return [record.callable, ...record.bases, record.originalBases, ...record.resolved, ...(record.hasMeta ? [record.explicit] : []), ...record.keywordValues];
    case "class-module": return [record.callable, ...record.bases, ...(record.originalBases ? [record.originalBases] : []), record.metaclass, ...record.keywordValues];
    case "handler-type": return [...record.names, ...completionRoots(record.after)];
    case "store-body": return completionRoots(record.after);
    case "resume-control": return [record.value, ...completionRoots(record.after)];
    case "module-entry": case "module-hook": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "class": case "condition": case "name-stored": case "discard": case "for-iter": case "for-next": case "for-exhausted": return [];
    case "init": return [record.instance, ...completionRoots(record.after)];
    case "hierarchy-result": case "hierarchy-iter": case "hierarchy-sequence": return [record.transaction, record.type, ...record.before, ...record.pending, ...completionRoots(record.after)];
    case "native-doc-result":
    case "native-reinit": case "native-property-copy": return [record.receiver, ...completionRoots(record.after)];
    case "native-repeat": return [record.receiver, ...completionRoots(record.after)];
    case "list-index": return [record.receiver, record.item, ...completionRoots(record.after)];
    case "dictionary-pop": return [record.receiver, record.key, record.fallback, ...completionRoots(record.after)];
    case "sequence-bound": return [record.receiver, record.key, ...record.bounds, ...completionRoots(record.after)];
    case "sequence-scan-equal": case "sequence-scan-truth": return [record.receiver, record.key, record.candidate, record.stop, ...completionRoots(record.after)];
    case "native-bytes-init": return [record.receiver, ...completionRoots(record.after)];
    case "native-new": return [record.type, ...completionRoots(record.after)];
    case "eval-locals": case "eval-builtins-probe": case "eval-builtins-default": case "eval-builtins-stored": return [record.source, record.globals, record.locals, record.builtins, record.key, record.closure, ...completionRoots(record.after)];
    case "exec-return": case "single-display": return completionRoots(record.after);
    case "import-argument": case "import-package": case "import-spec": case "import-spec-parent": case "import-name": case "import-path":
    case "import-fromlist-path": case "import-loaded": case "import-truth": case "import-iterator": case "import-next": case "import-member": case "import-all-probe": case "import-all": case "import-child-loaded":
    case "import-statement-locals": case "import-statement-call": return [record.name, record.globals, record.locals, record.fromlist, record.module, record.iterator, record.outer, record.item, ...completionRoots(record.after)];
    case "compile-argument": return [...record.args.filter(item => typeof item !== "string"), ...completionRoots(record.after)];
    case "new-result": return [record.type, ...record.args, ...record.keywordValues, ...completionRoots(record.after)];
    case "class-created": return [record.cell, ...completionRoots(record.after)];
    case "frame-update-get": case "frame-update-map": return [record.receiver, record.source, record.keys, ...completionRoots(record.after)];
    case "frame-lookup": return [record.receiver, record.key, record.item, record.fallback, record.cell, ...completionRoots(record.after)];
    case "frame-snapshot": case "frame-copy-value": return [record.receiver, record.result, record.keys, ...completionRoots(record.after)];
    case "frame-result": return [record.receiver, ...(record.task ? operationRoots(record.task) : []), ...completionRoots(record.after)];
    case "function-defaults": return [record.receiver, record.dictionary, ...record.items, ...completionRoots(record.after)];
    case "frame-update-boundary": return [record.receiver, record.context, ...completionRoots(record.after)];
    case "frame-write":
    case "function-capture":
    case "native-not-equal":
    case "native-method-hash":
    case "relay": case "subclass-result": case "protocol-result": case "optional-truth": case "format-result": case "index-result": case "item-result": return [record.receiver, ...completionRoots(record.after)];
    case "native-method-compare": return [record.receiver, record.other, ...completionRoots(record.after)];
    case "property-diagnostic": return [record.receiver, record.target, record.name, record.qualification, record.renderedName, ...completionRoots(record.after)];
    case "abstract-lookup": case "abstract-truth":
    case "hash-result": case "vars-result": case "property-name": case "dir-result": case "dir-iter": case "dir-sort":
    case "dir-compare": case "dir-truth": return [record.receiver, ...completionRoots(record.after)];
    case "object-dir-class": return [record.receiver, record.result, ...completionRoots(record.after)];
    case "class-dir-merge": return [record.receiver, record.result, record.owner, ...record.pending, ...record.names.filter(name => typeof name !== "string"), ...completionRoots(record.after)];
    case "object-dir-dictionary": case "method-dir-dictionary": return [record.receiver, ...completionRoots(record.after)];
    case "native-dir-merge": return [record.receiver, record.result, ...completionRoots(record.after)];
    case "function-entry": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "instance-entry": return [record.receiver, record.key, ...(record.found ? [record.fallback] : []), ...completionRoots(record.after)];
    case "wrapper-metadata": return [record.receiver, ...completionRoots(record.after)];
    case "property-documentation": return [record.receiver, ...record.accessors, ...completionRoots(record.after)];
    case "dir-length": case "dir-hint-bound": case "dir-hint-call": case "dir-hint-value":
      return [record.receiver, record.iterator, ...completionRoots(record.after)];
    case "sequence-hash": return [record.receiver, record.hash, ...completionRoots(record.after)];
    case "numeric-result": case "numeric-index": return [...record.args, ...completionRoots(record.after)];
    case "dict-hash": case "dict-key": case "dict-truth": return [record.receiver, record.key, record.hash, record.candidate,
      ...(["set", "set-default"].includes(record.operation) ? [record.item] : []), ...completionRoots(record.after)];
    case "dict-build": return [record.receiver, ...record.parts, ...completionRoots(record.after)];
    case "dict-pair": case "dict-value": case "dict-value-truth": return [record.left, record.right, record.value, ...completionRoots(record.after)];
    case "delegate-iter": case "delegate-next": case "delegate-return": case "delegate-close":
    case "iter-result": case "indexed-result": case "callable-result": return [record.receiver, ...completionRoots(record.after)];
    case "next-default": return [record.receiver, record.default, ...completionRoots(record.after)];
    case "binary-result": case "binary-count": case "binary-member": return [record.receiver, ...completionRoots(record.after)];
    case "byte-assignment": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "display-iter": case "display-next": return [record.receiver, record.iterator, ...completionRoots(record.after)];
    case "display-insert": return [record.receiver, ...completionRoots(record.after)];
    case "unpack-iter": case "unpack-next": case "unpack-rest-iter": case "unpack-rest-next": return [record.receiver, record.iterator, record.sourceIterator, record.result, ...completionRoots(record.after)];
    case "call-duplicate-result": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "call-map-lookup": case "call-map-keys": case "call-map-sequence": case "call-map-hash":
    case "call-map-probe": case "call-map-value": case "call-map-insert": case "call-map-stored":
      return [record.receiver, record.mapping, record.keys, record.key, record.item, record.hash, ...completionRoots(record.after)];
    case "call-star-iter": case "call-star-next": return [record.receiver, record.iterator, ...completionRoots(record.after)];
    case "consume-iter": case "consume-next": case "consume-truth": case "consume-stored": case "consume-byte": return [record.receiver, record.result, ...completionRoots(record.after)];
    case "contains-result": case "search-iter": case "search-next": case "search-equal": case "search-truth": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "sentinel-equal": case "sentinel-truth": return [record.receiver, record.value, ...completionRoots(record.after)];
    case "compare-result": case "ne-result": case "sequence-item": case "sequence-truth": return [record.left, record.right, ...completionRoots(record.after)];
    case "index-key": return [record.receiver, record.key, ...(record.operation === "set" ? [record.item] : []), ...completionRoots(record.after)];
    case "slice-index": return [record.receiver, ...record.parts, ...(record.operation === "set" ? [record.item] : []), ...completionRoots(record.after)];
    case "raise-value": return [record.cause];
    case "raise-cause": return [record.receiver];
    case "exception-args": return [record.receiver, ...completionRoots(record.after)];
    case "exception-note-get": case "exception-note-store": return [record.receiver, record.note, record.result, ...completionRoots(record.after)];
    case "print-argument": return [...record.args, ...completionRoots(record.after)];
    case "arithmetic-result": case "arithmetic-index": return [...record.args, ...completionRoots(record.after)];
    case "attribute-write": return [record.receiver, ...completionRoots(record.after)];
    case "advertised-instance": case "advertised-super": case "instance-tuple": case "subclass-tuple": case "check-result": case "check-truth": return [record.receiver, record.type, ...completionRoots(record.after)];
    case "attribute-fallback": return [record.receiver, record.key, record.hook, ...completionRoots(record.after)];
    case "attribute-result": return [record.receiver, record.default, ...completionRoots(record.after)];
    case "delegate-bind": return [record.receiver, ...record.args, ...completionRoots(record.after)];
    case "invoke": return [...record.args, ...record.keywordValues, ...completionRoots(record.after)];
    case "mro-result": case "mro-iter": case "mro-sequence": return [record.type, record.cell, record.dictcell, ...record.entries.flatMap(entry => typeof entry[0] === "string" ? [entry[1]] : entry), ...record.keywordValues, ...completionRoots(record.after)];
    case "notify": return [record.type, ...record.entries.flatMap(entry => typeof entry[0] === "string" ? [entry[1]] : entry), ...record.keywordValues, ...completionRoots(record.after)];
    default: throw new TypeError("Unknown operation root owner.");
  }
}
const empty = Object.freeze([]);
export function completionRoots(record, frame = false) {
  if (record === null) return empty;
  if (!records.has(record)) throw new TypeError("Unknown operation root owner.");
  const retained = roots.get(record);
  if (!frame) return retained;
    if (record.kind === "class") return [...(record.nameValue ? [record.nameValue, record.basesTuple] : []),...(record.originalBases ? [record.originalBases] : []), ...record.bases, ...(record.metaclass ? [record.metaclass] : []), ...(record.keywordValues ?? [])];
  if (record.kind === "init") return [record.instance, ...retained];
  return retained;
}
const depthCheck = depth => {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 256) throw new TypeError("Invalid operation depth.");
};
const comparisonCheck = (operation, position) => {
  if (!["equal", "not-equal", "less", "less-equal", "greater", "greater-equal"].includes(operation) || !Number.isSafeInteger(position) || position < 0 || position > 1024)
    throw new TypeError("Invalid comparison phase.");
};
export function compareTask(operation, left, right, site, after = null, depth = 0, position = 0) {
  depthCheck(depth); completionRoots(after); comparisonCheck(operation, position);
  if (position > 2) throw new TypeError("Invalid comparison candidate.");
  return Object.freeze({kind: "compare", operation, left, right, site, completion: after, depth, position});
}
export function callTask(callable, args, keywords, keywordValues, site, after = null, depth = 0) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "call", callable, args: operands(args), keywords: operands(keywords),
    keywordValues: operands(keywordValues), site, completion: after, depth});
}
export function constructTask(callable, args, keywords, keywordValues, site, after = null, depth = 0) {
  return Object.freeze({...callTask(callable, args, keywords, keywordValues, site, after, depth), kind: "construct"});
}
export function unaryTask(operation, value, site, after = null, depth = 0, optionalLength = false) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "unary", operation, value, site, completion: after, depth, optionalLength});
}
const arithmeticCheck = (operation, args, position, order, active) => {
  const name = operation.startsWith("inplace-") ? operation.slice(8) : operation;
  if (!Object.hasOwn(ARITHMETIC_SLOTS, name) || args.length < 2 || args.length > (name === "power" ? 3 : 2) ||
      !Number.isSafeInteger(position) || position < 0 || position > 2 || ![null, false, true].includes(order) ||
      active !== null && (!Number.isSafeInteger(active) || active < 0 || active > 3)) throw new TypeError("Invalid arithmetic operation.");
};
export function arithmeticTask(operation, args, site, after = null, depth = 0, position = 0, order = null, nativeInplace = false, active = null) {
  arithmeticCheck(operation, args, position, order, active); depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "arithmetic", operation, args: operands(args), site, completion: after, depth, position, order, nativeInplace, active});
}
export function numericTask(name, args, site, after = null, depth = 0, position = 0) {
  depthCheck(depth); completionRoots(after); numericPosition(position);
  if (args.length > 3 || position > (name === "range" ? 3 : 2)) throw new TypeError("Invalid numeric operands.");
  return Object.freeze({kind:"numeric", name:numericName(name), args:operands(args), position, site, completion:after, depth});
}
export function consumeTask(name, receiver, site, after = null, depth = 0, result = null) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "consume", name: consumerName(name), receiver, result, site, completion: after, depth});
}
export function valueTask(value, site, after = null, depth = 0) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "value", value, site, completion: after, depth});
}
export function itemTask(receiver, key, site, after = null, depth = 0, operation = "get", item = null) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "item", receiver, key, operation: itemOperation(operation), item, site, completion: after, depth});
}
export function attributeTask(receiver, name, site, after = null, depth = 0, operation = "get", key = null, hook = null, item = null) {
  depthCheck(depth); completionRoots(after);
  if (typeof name !== "string" || name.length > 256 || !["import", "get", "native-get", "fallback", "set", "delete", "native-set", "native-delete"].includes(operation))
    throw new TypeError("Invalid attribute operation.");
  return Object.freeze({kind: "attribute", receiver, name, key, hook, item, operation, site, completion: after, depth});
}
export function instanceTask(receiver, type, site, after = null, depth = 0, nesting = 0, native = false) {
  depthCheck(depth); completionRoots(after);
  if (typeof native !== "boolean") throw new TypeError("Invalid native instance-check phase.");
  if (!Number.isSafeInteger(nesting) || nesting < 0 || nesting > 32) throw new TypeError("Invalid class-info tuple depth.");
  return Object.freeze({kind: "instance", receiver, type, nesting, native, site, completion: after, depth});
}
export function subclassTask(receiver, type, site, after = null, depth = 0, nesting = 0, native = false) {
  return Object.freeze({...instanceTask(receiver, type, site, after, depth, nesting, native), kind: "subclass"});
}
export function sliceTask(receiver, parts, site, after = null, depth = 0, operation = "get", item = null) {
  depthCheck(depth); completionRoots(after);
  if (parts.length !== 3) throw new TypeError("A slice requires three parts.");
  return Object.freeze({kind: "slice", receiver, parts: operands(parts), operation: itemOperation(operation), item, site, completion: after, depth});
}
export function containsTask(receiver, key, site, after = null, depth = 0, search = false) {
  depthCheck(depth); completionRoots(after);
  if (typeof search !== "boolean") throw new TypeError("Invalid membership phase.");
  return Object.freeze({kind: "contains", receiver, key, site, completion: after, depth, search});
}
export function dictionaryTask(receiver, key, site, after = null, depth = 0, operation = "get", item = null, hash = null, position = 0) {
  depthCheck(depth); completionRoots(after);
  if (hash !== null && typeof hash !== "bigint" || !Number.isSafeInteger(position) || position < 0 || position > 1024)
    throw new TypeError("Invalid dictionary lookup phase.");
  return Object.freeze({kind: "dict", receiver, key, item, operation: dictionaryOperation(operation), hash, position, site, completion: after, depth});
}
export function dictionaryBuildTask(receiver, parts, site, after = null, depth = 0, position = 0) {
  depthCheck(depth); completionRoots(after);
  if (parts.length > 2048 || parts.length % 2 || !Number.isSafeInteger(position) || position < 0 || position > parts.length || position % 2)
    throw new TypeError("Invalid dictionary build phase.");
  return Object.freeze({kind: "dict-build", receiver, parts: operands(parts), position, site, completion: after, depth});
}
export function hierarchyTask(transaction, pending, site, after = null) {
  completionRoots(after); return Object.freeze({kind: "hierarchy-next", transaction, pending: operands(pending), site, completion: after, depth: 0});
}
export function namespaceCreateTask(fields, site, after = null, depth = 0) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "namespace-create", ...fields, phase: fields.phase ?? 0, site, completion: after, depth});
}
export function operationRoots(task) {
  return [...(task.lookupCache ? [task.lookupCache] : []), ...taskRoots(task)];
}
function taskRoots(task) {
  switch (task.kind) {
    case "hierarchy-next": return [task.transaction, ...task.pending, ...completionRoots(task.completion)];
    case "namespace-create": return [...(task.slotNames || []), task.dictionary, ...task.bases, task.defaultModule, task.moduleObject, task.cell, task.dictcell, task.type,
      ...(task.metaclass ? [task.metaclass] : []), ...task.keywordValues, ...completionRoots(task.completion)].filter(value => value !== undefined);
    case "notify": return [task.type, ...task.entries.flatMap(entry => typeof entry[0] === "string" ? [entry[1]] : entry), ...task.keywordValues, ...completionRoots(task.completion)];
    case "instance": case "subclass": return [task.receiver, task.type, ...completionRoots(task.completion)];
    case "attribute": return [task.receiver, task.key, task.hook, ...(["set", "native-set"].includes(task.operation) ? [task.item] : []), ...completionRoots(task.completion)];
    case "initialize": case "construct": case "call": return [task.callable, ...task.args, ...task.keywordValues, ...completionRoots(task.completion)];
    case "arithmetic":
    case "numeric": return [...task.args, ...completionRoots(task.completion)];
    case "consume": return [task.receiver, ...(task.result === null ? [] : [task.result]), ...completionRoots(task.completion)];
    case "item": return [task.receiver, task.key, ...(task.operation === "set" ? [task.item] : []), ...completionRoots(task.completion)];
    case "contains": return [task.receiver, task.key, ...completionRoots(task.completion)];
    case "compare": return [task.left, task.right, ...completionRoots(task.completion)];
    case "dict": return [task.receiver, task.key, task.hash, ...(["set", "set-default"].includes(task.operation) ? [task.item] : []), ...completionRoots(task.completion)];
    case "dict-build": return [task.receiver, ...task.parts, ...completionRoots(task.completion)];
    case "slice": return [task.receiver, ...task.parts, ...(task.operation === "set" ? [task.item] : []), ...completionRoots(task.completion)];
    case "unary": case "value": return [task.value, ...completionRoots(task.completion)];
    default: throw new TypeError("Unknown operation task.");
  }
}
export function controlRoots(task) {
  switch (task.type) {
    case "block": return task.stack;
    case "delegate": return [task.iterator, task.closing ?? null];
    case "while": case "for": case "try": return [task.iterator ?? null, task.pending?.value ?? null, task.caught ?? null, task.previous ?? null];
    default: throw new TypeError("Unknown control root owner.");
  }
}
// The destination is live before the caller releases its scope. No collection,
// quota poll or callback can occur in the middle of this structural transfer.
export function retainTransfer(destination, values, after = null) {
  destination.push(...values, ...completionRoots(after));
}
