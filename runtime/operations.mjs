// Closed internal records. Root order and multiplicity implement the initial
// resource contract, including copied ancestor roots and the extra init root.
const records = new WeakSet(), roots = new WeakMap(), heights = new WeakMap();
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
    case "format-result": record = {kind, receiver: fields.receiver, slot: fields.slot, after}; break;
    case "print-argument":
      record = {kind, args: operands(fields.args), index: fields.index, depth: fields.depth, after};
      depthCheck(record.depth);
      if (!Number.isSafeInteger(record.index) || record.index < 0 || record.index >= record.args.length)
        throw new TypeError("Invalid print position.");
      break;
    case "protocol-result": record = {kind, receiver: fields.receiver, operation: fields.operation, slot: fields.slot, after}; break;
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
    case "class": case "condition": case "discard": return [];
    case "init": return [record.instance, ...completionRoots(record.after)];
    case "relay": case "protocol-result": case "optional-truth": case "format-result": return [record.receiver, ...completionRoots(record.after)];
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
export function operationRoots(task) {
  switch (task.kind) {
    case "call": return [task.callable, ...task.args, ...task.keywordValues, ...completionRoots(task.completion)];
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
