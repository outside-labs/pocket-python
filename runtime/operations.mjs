import {ARITHMETIC_SLOTS} from "./class-policy.mjs";
// Closed internal records. Root order and multiplicity implement the initial
// resource contract, including copied ancestor roots and the extra init root.
const records = new WeakSet(), roots = new WeakMap(), heights = new WeakMap();
const itemOperation = value => {
  if (!["get", "set", "delete"].includes(value)) throw new TypeError("Invalid item operation.");
  return value;
};
const dictionaryOperation = value => {
  if (!["get", "set", "delete", "discard", "contains", "probe"].includes(value)) throw new TypeError("Invalid dictionary operation.");
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
    case "class": record = {kind, bases: operands(fields.bases), module: fields.module}; break;
    case "init": record = {kind, instance: fields.instance, after}; break;
    case "new-result":
      record = {kind, type: fields.type, args: operands(fields.args), keywords: operands(fields.keywords),
        keywordValues: operands(fields.keywordValues), depth: fields.depth, after};
      depthCheck(record.depth); break;
    case "relay": record = {kind, receiver: fields.receiver, after}; break;
    case "item-result": record = {kind, receiver: fields.receiver, after}; break;
    case "index-result": record = {kind, receiver: fields.receiver, after}; break;
    case "hash-result": record = {kind, receiver: fields.receiver, after}; break;
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
        version: fields.version, otherVersion: fields.otherVersion, after};
      depthCheck(record.depth); comparisonCheck(record.operation, record.position);
      if (!Number.isSafeInteger(record.version) || record.version < 0 || !Number.isSafeInteger(record.otherVersion) || record.otherVersion < 0)
        throw new TypeError("Invalid dictionary comparison versions.");
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
      record = {kind, operation: fields.operation, args: operands(fields.args), position: fields.position, order: fields.order, nativeInplace: fields.nativeInplace === true, depth: fields.depth, after};
      arithmeticCheck(record.operation, record.args, record.position, record.order); depthCheck(record.depth); break;
    case "attribute-write": record = {kind, receiver: fields.receiver, after}; break;
    case "attribute-result": record = {kind, receiver: fields.receiver, default: fields.default, mode: fields.mode, after};
      if (!["getattr", "hasattr"].includes(record.mode)) throw new TypeError("Invalid attribute result mode."); break;
    case "delegate-bind": record = {kind, receiver: fields.receiver, args: operands(fields.args), after}; break;
    case "invoke": record = {kind, args: operands(fields.args), keywords: operands(fields.keywords),
      keywordValues: operands(fields.keywordValues), depth: fields.depth, fallback: fields.fallback ?? null, after}; break;
    case "notify": record = {kind, type: fields.type, entries: Object.freeze(fields.entries.map(entry => Object.freeze([...entry]))), index: fields.index};
      if (record.entries.length > 128) throw new TypeError("Invalid notification snapshot.");
      break;
    case "condition":
      if (!["if", "while", "jump"].includes(fields.control)) throw new TypeError("Invalid condition destination.");
      record = {kind, control: fields.control, body: fields.body, otherwise: fields.otherwise, target: fields.target}; break;
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
    case "class": case "condition": case "discard": case "for-iter": case "for-next": case "for-exhausted": return [];
    case "init": return [record.instance, ...completionRoots(record.after)];
    case "new-result": return [record.type, ...record.args, ...record.keywordValues, ...completionRoots(record.after)];
    case "relay": case "protocol-result": case "optional-truth": case "format-result": case "index-result": case "item-result": return [record.receiver, ...completionRoots(record.after)];
    case "hash-result": return [record.receiver, ...completionRoots(record.after)];
    case "numeric-result": case "numeric-index": return [...record.args, ...completionRoots(record.after)];
    case "dict-hash": case "dict-key": case "dict-truth": return [record.receiver, record.key, record.hash, record.candidate,
      ...(record.operation === "set" ? [record.item] : []), ...completionRoots(record.after)];
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
    case "print-argument": return [...record.args, ...completionRoots(record.after)];
    case "arithmetic-result": case "arithmetic-index": return [...record.args, ...completionRoots(record.after)];
    case "attribute-write": return [record.receiver, ...completionRoots(record.after)];
    case "attribute-result": return [record.receiver, record.default, ...completionRoots(record.after)];
    case "delegate-bind": return [record.receiver, ...record.args, ...completionRoots(record.after)];
    case "invoke": return [...record.args, ...record.keywordValues, ...completionRoots(record.after)];
    case "notify": return [record.type, ...record.entries.map(entry => entry[1])];
    default: throw new TypeError("Unknown operation root owner.");
  }
}
const empty = Object.freeze([]);
export function completionRoots(record, frame = false) {
  if (record === null) return empty;
  if (!records.has(record)) throw new TypeError("Unknown operation root owner.");
  const retained = roots.get(record);
  if (!frame) return retained;
  if (record.kind === "class") return record.bases;
  if (record.kind === "init") return [record.instance, ...retained];
  return retained;
}
const depthCheck = depth => {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 256) throw new TypeError("Invalid operation depth.");
};
const comparisonCheck = (operation, position) => {
  if (!["equal", "not-equal"].includes(operation) || !Number.isSafeInteger(position) || position < 0 || position > 1024)
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
export function unaryTask(operation, value, site, after = null, depth = 0, optionalLength = false) {
  depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "unary", operation, value, site, completion: after, depth, optionalLength});
}
const arithmeticCheck = (operation, args, position, order) => {
  const name = operation.startsWith("inplace-") ? operation.slice(8) : operation;
  if (!Object.hasOwn(ARITHMETIC_SLOTS, name) || args.length < 2 || args.length > (name === "power" ? 3 : 2) ||
      !Number.isSafeInteger(position) || position < 0 || position > 2 || ![null, false, true].includes(order)) throw new TypeError("Invalid arithmetic operation.");
};
export function arithmeticTask(operation, args, site, after = null, depth = 0, position = 0, order = null, nativeInplace = false) {
  arithmeticCheck(operation, args, position, order); depthCheck(depth); completionRoots(after);
  return Object.freeze({kind: "arithmetic", operation, args: operands(args), site, completion: after, depth, position, order, nativeInplace});
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
export function operationRoots(task) {
  switch (task.kind) {
    case "call": return [task.callable, ...task.args, ...task.keywordValues, ...completionRoots(task.completion)];
    case "arithmetic":
    case "numeric": return [...task.args, ...completionRoots(task.completion)];
    case "consume": return [task.receiver, ...(task.result === null ? [] : [task.result]), ...completionRoots(task.completion)];
    case "item": return [task.receiver, task.key, ...(task.operation === "set" ? [task.item] : []), ...completionRoots(task.completion)];
    case "contains": return [task.receiver, task.key, ...completionRoots(task.completion)];
    case "compare": return [task.left, task.right, ...completionRoots(task.completion)];
    case "dict": return [task.receiver, task.key, task.hash, ...(task.operation === "set" ? [task.item] : []), ...completionRoots(task.completion)];
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
