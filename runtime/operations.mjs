// Closed internal records. Root order and multiplicity implement the initial
// resource contract, including copied ancestor roots and the extra init root.
const records = new WeakSet(), roots = new WeakMap(), heights = new WeakMap();
const itemOperation = value => {
  if (!["get", "set", "delete"].includes(value)) throw new TypeError("Invalid item operation.");
  return value;
};
const dictionaryOperation = value => {
  if (!["get", "set", "delete", "contains", "probe"].includes(value)) throw new TypeError("Invalid dictionary operation.");
  return value;
};
const operands = values => {
  if (!Array.isArray(values) || values.length > 131072) throw new TypeError("Invalid operation operands.");
  return Object.freeze([...values]);
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
    case "relay": record = {kind, receiver: fields.receiver, after}; break;
    case "item-result": record = {kind, receiver: fields.receiver, after}; break;
    case "index-result": record = {kind, receiver: fields.receiver, after}; break;
    case "hash-result": record = {kind, receiver: fields.receiver, after}; break;
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
    case "iter-result": case "indexed-result": case "callable-result": record = {kind, receiver: fields.receiver, after}; break;
    case "next-default": record = {kind, receiver: fields.receiver, default: fields.default, after}; break;
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
    case "relay": case "protocol-result": case "optional-truth": case "format-result": case "index-result": case "item-result": return [record.receiver, ...completionRoots(record.after)];
    case "hash-result": return [record.receiver, ...completionRoots(record.after)];
    case "dict-hash": case "dict-key": case "dict-truth": return [record.receiver, record.key, record.hash, record.candidate,
      ...(record.operation === "set" ? [record.item] : []), ...completionRoots(record.after)];
    case "dict-build": return [record.receiver, ...record.parts, ...completionRoots(record.after)];
    case "dict-pair": case "dict-value": case "dict-value-truth": return [record.left, record.right, record.value, ...completionRoots(record.after)];
    case "iter-result": case "indexed-result": case "callable-result": return [record.receiver, ...completionRoots(record.after)];
    case "next-default": return [record.receiver, record.default, ...completionRoots(record.after)];
    case "contains-result": case "search-iter": case "search-next": case "search-equal": case "search-truth": return [record.receiver, record.key, ...completionRoots(record.after)];
    case "sentinel-equal": case "sentinel-truth": return [record.receiver, record.value, ...completionRoots(record.after)];
    case "compare-result": case "ne-result": case "sequence-item": case "sequence-truth": return [record.left, record.right, ...completionRoots(record.after)];
    case "index-key": return [record.receiver, record.key, ...(record.operation === "set" ? [record.item] : []), ...completionRoots(record.after)];
    case "slice-index": return [record.receiver, ...record.parts, ...(record.operation === "set" ? [record.item] : []), ...completionRoots(record.after)];
    case "print-argument": return [...record.args, ...completionRoots(record.after)];
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
    case "while": case "for": case "try": return [task.iterator ?? null, task.pending?.value ?? null, task.caught ?? null, task.previous ?? null];
    default: throw new TypeError("Unknown control root owner.");
  }
}
// The destination is live before the caller releases its scope. No collection,
// quota poll or callback can occur in the middle of this structural transfer.
export function retainTransfer(destination, values, after = null) {
  destination.push(...values, ...completionRoots(after));
}
