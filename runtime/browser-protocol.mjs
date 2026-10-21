// The source-console profile is an explicit subset of host protocol 1.
import {isSourceLocation} from "./library-selection.mjs";
export const ENGINE = Object.freeze({implementation: "pocket-python-source", version: "1",
  backend: "javascript-vm", bytecode_version: 4, language_profile: "core-source/1"});
export const LANGUAGE_ENGINES = Object.freeze({"core-source/1": ENGINE,
  "classes-source/1": Object.freeze({...ENGINE, bytecode_version: 5, language_profile: "classes-source/1"})});
export const CONSOLE_LIMITS = Object.freeze({message_bytes: 1048576, value_depth: 16,
  pending_requests: 1, subscriptions: 0, output_codepoints: 16384, response_bytes: 1048576,
  deadline_ms: 10000, source_bytes: 65536, compile_work: 4194304,
  execution_steps: 1000000, execution_work: 100000000, memory_bytes: 8388608,
  memory_objects: 4096, memory_frames: 64});
const encoder = new TextEncoder();
export const record = value => value !== null && typeof value === "object" &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const integer = (value, maximum = 2147483647) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
export const same = (left, right) => record(left) && record(right) && Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => record(value) ? same(value, right[key]) : right[key] === value);
export function failure(code, message, domain = "protocol", type = "ProtocolError") {
  return {domain, code, type, message};
}
export function exception(error) {
  return Object.assign(new Error(error.message), {name: error.type, code: error.code, detail: error});
}
export function limits(input = {}) {
  if (!record(input) || Object.keys(input).some(key => !Object.hasOwn(CONSOLE_LIMITS, key))) throw exception(failure("BAD_VALUE", "Unknown console limit."));
  const result = {...CONSOLE_LIMITS, ...input};
  for (const [key, maximum] of Object.entries(CONSOLE_LIMITS)) {
    if (key === "subscriptions" ? result[key] !== 0 : !integer(result[key], maximum)) throw exception(failure("BAD_VALUE", "Invalid console limit: " + key));
  }
  if (result.message_bytes < 4096 || result.value_depth < 4) throw exception(failure("BAD_VALUE", "Console envelopes require 4096 bytes and depth 4."));
  return Object.freeze(result);
}

// Inspect before JSON encoding or making arrays from text. Structured clone has
// already allocated received data; these limits bound our subsequent traversal.
export function checkMessage(value, bounds = CONSOLE_LIMITS) {
  const active = new Set();
  let bytes = 0, nodes = 0;
  const charge = amount => {
    if ((bytes += amount) > bounds.message_bytes) throw exception(failure("PROTOCOL", "Message byte budget exceeded."));
  };
  const string = text => {
    charge(2);
    for (let i = 0; i < text.length; i++) {
      const point = text.codePointAt(i);
      if (point > 0xffff) { charge(4); i++; }
      else if (point >= 0xd800 && point <= 0xdfff) charge(6);
      else if (point === 34 || point === 92 || [8, 9, 10, 12, 13].includes(point)) charge(2);
      else charge(point < 32 ? 6 : point < 128 ? 1 : point < 2048 ? 2 : 3);
    }
  };
  const visit = (item, depth) => {
    if (++nodes > bounds.message_bytes || depth > bounds.value_depth) throw exception(failure("PROTOCOL", "Message depth/node budget exceeded."));
    if (typeof item === "string") string(item);
    else if (item === null || typeof item === "boolean" || Number.isSafeInteger(item)) charge(String(item).length);
    else {
      if ((!record(item) && !Array.isArray(item)) || active.has(item)) throw exception(failure("PROTOCOL", "Expected acyclic plain message data."));
      const array = Array.isArray(item), keys = Object.keys(item), count = array ? item.length : keys.length;
      if (count > (array ? 65536 : 64) || (array && keys.length !== count)) throw exception(failure("PROTOCOL", "Message collection budget exceeded."));
      active.add(item);
      charge(2 + Math.max(0, count - 1));
      for (let i = 0; i < count; i++) {
        const key = array ? String(i) : keys[i], descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) throw exception(failure("PROTOCOL", "Message accessors or sparse arrays are unsupported."));
        if (!array) { string(key); charge(1); }
        visit(descriptor.value, depth + 1);
      }
      active.delete(item);
    }
  };
  visit(value, 0);
  return bytes;
}

export function application(value) {
  if (!exact(value, ["manifest_sha256", "profile", "profile_version", "entrypoint", "engine"]) ||
      typeof value.manifest_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.manifest_sha256) || value.profile !== "in-house-interpreter" || value.profile_version !== 1 ||
      value.entrypoint !== "sources/app.py" || !record(value.engine) || !Object.hasOwn(LANGUAGE_ENGINES, value.engine.language_profile) ||
      !same(LANGUAGE_ENGINES[value.engine.language_profile], value.engine)) throw exception(failure("PROTOCOL", "Unsupported source application/engine identity."));
  return structuredClone(value);
}
export function capabilities(value) {
  if (!Array.isArray(value) || value.length !== 1 || !exact(value[0], ["id"]) || value[0].id !== "output/1") throw exception(failure("DENIED", "The console requires exactly output/1; other host capabilities are unavailable."));
  return [{id: "output/1"}];
}
export function textValue(text, maximum) {
  if (typeof text !== "string" || text.length > maximum * 2) throw exception(failure("BAD_VALUE", "Text exceeds its point budget.", "host", "HostError"));
  const codepoints = Array.from(text, char => char.codePointAt(0));
  if (codepoints.length > maximum) throw exception(failure("BAD_VALUE", "Text exceeds its point budget.", "host", "HostError"));
  return {type: "str", codepoints};
}
export function readText(value, maximum) {
  if (!exact(value, ["type", "codepoints"]) || value.type !== "str" || !Array.isArray(value.codepoints) || value.codepoints.length > maximum ||
      !value.codepoints.every(point => Number.isInteger(point) && point >= 0 && point <= 0x10ffff)) throw exception(failure("BAD_VALUE", "Expected a bounded tagged string.", "host", "HostError"));
  let text = "";
  for (const point of value.codepoints) text += String.fromCodePoint(point);
  return text;
}
export function sourceValue(source, bounds) {
  if (typeof source !== "string" || source.length > bounds.source_bytes || encoder.encode(source).byteLength > bounds.source_bytes) throw exception(failure("BAD_VALUE", "Source byte budget exceeded.", "host", "HostError"));
  return textValue(source, bounds.source_bytes);
}
export function diagnostic(error) {
  const location = input => {
    if (!input || !isSourceLocation(input.filename)) return null;
    const span = input.span || [input.line, input.column, input.end_line, input.end_column];
    return span.length === 4 && span.every(value => integer(value, 262145)) ?
      {filename: input.filename, line: span[0], column: span[1], end_line: span[2], end_column: span[3]} : null;
  };
  return {...failure(String(error.code || "RUNTIME").slice(0, 64), String(error.message || "Execution failed.").slice(0, 1024), "runtime", String(error.name || "RuntimeError").slice(0, 64)),
    location: location(error.location), frames: (error.traceback || []).slice(-16).map(frame =>
      ({function: String(frame.function).slice(0, 64), location: location(frame.location)}))};
}
export function checkError(value) {
  if (!record(value) || !["protocol", "host", "runtime"].includes(value.domain) ||
      typeof value.code !== "string" || value.code.length > 64 || typeof value.type !== "string" || value.type.length > 64 ||
      typeof value.message !== "string" || value.message.length > 1024 ||
      Object.keys(value).some(key => !["domain", "code", "type", "message", "location", "frames"].includes(key))) throw exception(failure("PROTOCOL", "Invalid error record."));
  for (const at of [value.location, ...(value.frames || []).map(frame => frame.location)].filter(Boolean)) {
    if (!exact(at, ["filename", "line", "column", "end_line", "end_column"]) || !isSourceLocation(at.filename) ||
        ![at.line, at.column, at.end_line, at.end_column].every(n => integer(n, 262145))) throw exception(failure("PROTOCOL", "Invalid source location."));
  }
  if (value.frames !== undefined && (!Array.isArray(value.frames) || value.frames.length > 16 || value.frames.some(frame =>
    !exact(frame, ["function", "location"]) || typeof frame.function !== "string" || frame.function.length > 64))) throw exception(failure("PROTOCOL", "Invalid error frames."));
  return value;
}
export class Peer {
  constructor(port, session, bounds) { this.port = port; this.session = session; this.limits = bounds; this.sent = 0; this.received = 0; }
  send(kind, fields = {}) {
    if (!integer(this.sent + 1)) throw exception(failure("PROTOCOL", "Sequence exhausted; restart required."));
    const message = {protocol: "pocket-python-host", version: 1, session: this.session, seq: this.sent + 1, kind, ...fields};
    checkMessage(message, this.limits); this.port.postMessage(message); this.sent++; return message;
  }
  receive(message) {
    if (record(message) && typeof message.session === "string" && /^[0-9a-f]{32}$/.test(message.session) && message.session !== this.session) return false;
    checkMessage(message, this.limits);
    if (!record(message) || message.protocol !== "pocket-python-host" || message.version !== 1 || message.session !== this.session ||
        message.seq !== this.received + 1 || !integer(message.seq) || typeof message.kind !== "string") throw exception(failure("PROTOCOL", "Invalid active-session envelope or sequence."));
    this.received++; return true;
  }
}
export function fields(message, additional) {
  if (!exact(message, ["protocol", "version", "session", "seq", "kind", ...additional])) throw exception(failure("PROTOCOL", "Unexpected message fields."));
}
export function request(message, prefix, expected) {
  fields(message, ["id", "operation", "arguments", "timeout_ms"]);
  if (message.id !== prefix + expected || !integer(expected) || typeof message.operation !== "string" || message.operation.length > 64 ||
      !record(message.arguments) || !integer(message.timeout_ms)) throw exception(failure("PROTOCOL", "Invalid request identity or arguments envelope."));
}
