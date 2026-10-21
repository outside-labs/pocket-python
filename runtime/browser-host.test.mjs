import test from "node:test";
import assert from "node:assert/strict";
import {mountInterpreter} from "./interpreter-host.mjs";
import {attachInterpreterWorker} from "./interpreter-worker.mjs";
import {ENGINE, CONSOLE_LIMITS, Peer, checkMessage, sourceValue, limits, diagnostic} from "./browser-protocol.mjs";

const identity = () => ({manifest_sha256: "0".repeat(64), profile: "in-house-interpreter", profile_version: 1,
  entrypoint: "sources/app.py", engine: {...ENGINE}});
class Port {
  constructor() { this.listeners = new Map(); this.messages = []; }
  addEventListener(kind, listener) { if (!this.listeners.has(kind)) this.listeners.set(kind, new Set()); this.listeners.get(kind).add(listener); }
  removeEventListener(kind, listener) { this.listeners.get(kind)?.delete(listener); }
  emit(kind, data) { for (const listener of this.listeners.get(kind) || []) listener({data}); }
  postMessage(value) {
    const snapshot = structuredClone(value); this.messages.push(snapshot);
    queueMicrotask(() => { if (!this.terminated) this.other.emit("message", snapshot); });
  }
}
class LocalWorker extends Port {
  static instances = [];
  constructor(url, options) {
    super(); assert.equal(options.type, "module"); assert.ok(url.href.endsWith("/interpreter-worker.mjs"));
    this.other = new Port(); this.other.other = this;
    this.controller = attachInterpreterWorker(this.other); LocalWorker.instances.push(this);
  }
  terminate() { this.terminated = true; this.controller.dispose(); }
}
const create = options => mountInterpreter({application: identity(), ...options}, LocalWorker);
const last = () => LocalWorker.instances.at(-1);
const tick = () => new Promise(resolve => setImmediate(resolve));

test("source host executes new source, preserves text and clears Python state on each run", async () => {
  let output = "";
  const app = create({onOutput: text => { output += text; }});
  try {
    await app.ready; await app.run("x=9007199254740993\nprint(x,'A😀 é','<script>bad()</script>')\n");
    assert.equal(output, "9007199254740993 A😀 é <script>bad()</script>\n");
    await assert.rejects(app.run("print(x)"), error => error.name === "NameError");
    assert.equal(app.stats().pending, 0);
    const records = last().messages;
    assert.equal(records[0].kind, "init"); assert.equal(records[1].operation, "interpreter.run");
    assert.equal(records[2].value.type, "none");
  } finally { app.stop(); }
  assert.equal(app.stats().listeners, 0); assert.equal(last().controller.stats().pending, 0);
});

test("syntax, unsupported features and runtime errors retain source locations without closing the host", async () => {
  let output = "";
  const app = create({onOutput: text => { output += text; }});
  try {
    await app.ready;
    await assert.rejects(app.run("if True print(1)"), error => error.name === "SyntaxError" && error.detail.location.filename === "sources/app.py");
    await assert.rejects(app.run("print('never')\nclass C: pass"), error => error.code === "UNSUPPORTED");
    assert.equal(output, "");
    await assert.rejects(app.run("def fail():\n    return 1//0\nprint('before')\nfail()"), error => {
      assert.equal(error.name, "ZeroDivisionError"); assert.equal(error.detail.location.line, 2);
      assert.deepEqual(error.detail.frames.map(frame => frame.location.line), [4, 2]); return true;
    });
    assert.equal(output, "before\n");
    await app.run("print('recovered')"); assert.ok(output.endsWith("recovered\n"));
    assert.equal(app.stats().state, "ready");
  } finally { app.stop(); }
});

test("ungranted imports, pending runs and bounded source/output/memory fail explicitly", async () => {
  const app = create({limits: {source_bytes: 128, output_codepoints: 4}});
  try {
    await app.ready;
    await assert.rejects(app.run("import browser\n"), error => error.name === "ImportError");
    await assert.rejects(app.run("😀".repeat(33)), error => error.code === "BAD_VALUE");
    const running = app.run("print('x')");
    await assert.rejects(app.run("pass"), error => error.code === "QUOTA"); await running;
    await assert.rejects(app.run("print('abcdef')"), error => error.code === "QUOTA");
    await app.run("pass");
  } finally { app.stop(); }
  const tiny = create({limits: {memory_bytes: 512}});
  try { await tiny.ready; await assert.rejects(tiny.run("print(1)"), error => error.name === "MemoryError"); }
  finally { tiny.stop(); }
});

test("stop and restart reject pending work, detach all listeners and use fresh unpredictable sessions", async () => {
  const sessions = new Set();
  for (let count = 0; count < 8; count++) {
    const app = create(); await app.ready; sessions.add(app.stats().session);
    const run = app.run("pass"); app.stop("restart");
    await assert.rejects(run, error => error.code === "CANCELLED"); await tick();
    assert.equal(last().terminated, true); assert.equal(last().controller.stats().state, "closed");
    assert.equal([...last().listeners.values()].reduce((n, set) => n + set.size, 0), 0);
    assert.equal(app.stats().handles, 0); assert.equal(app.stats().subscriptions, 0);
    await assert.rejects(app.run("pass"), error => error.code === "UNAVAILABLE");
  }
  assert.equal(sessions.size, 8);
});

test("stale sessions are discarded and active malformed sequences close the host", async () => {
  const errors = [], app = create({onError: error => errors.push(error)});
  await app.ready;
  const worker = last(), peer = new Peer(worker.other, app.stats().session, CONSOLE_LIMITS);
  worker.emit("message", {session: "f".repeat(32), nonsense: true});
  assert.equal(app.stats().state, "ready");
  peer.send("result", {reply_to: "h1", value: {type: "none"}}); await tick();
  assert.equal(app.stats().state, "closed"); assert.equal(errors[0].code, "PROTOCOL");
  const malformed = create(); await malformed.ready; last().emit("message", {kind: "ready"});
  assert.equal(malformed.stats().state, "closed");
});

test("host denies undeclared capabilities without invoking a host adapter", async () => {
  const app = create(); await app.ready;
  const worker = last();
  // Inject a well-formed request from a substituted worker; inspect the host's
  // immediate response before its real worker rejects the unsolicited reply.
  worker.emit("message", {protocol: "pocket-python-host", version: 1, session: app.stats().session, seq: 2,
    kind: "request", id: "w1", operation: "fetch.text", arguments: {url: "https://example.test/"}, timeout_ms: 10});
  assert.equal(worker.messages.at(-1).error.code, "DENIED"); app.stop(); await tick();
  assert.throws(() => create({capabilities: [{id: "fetch/1"}]}), error => error.code === "DENIED");
  const bad = identity(); bad.engine.version = "unknown";
  assert.throws(() => create({application: bad}), error => error.code === "PROTOCOL");
});

test("initialization and execution deadlines terminate unresponsive workers", async () => {
  class SilentWorker extends Port { constructor() { super(); this.other = new Port(); } terminate() { this.terminated = true; } }
  const silent = mountInterpreter({application: identity(), limits: {deadline_ms: 5}}, SilentWorker);
  await assert.rejects(silent.ready, error => error.code === "TIMEOUT"); assert.equal(silent.stats().state, "closed");
  class BusyWorker extends LocalWorker {
    postMessage(message) { if (message.kind === "init") super.postMessage(message); }
  }
  const busy = mountInterpreter({application: identity(), limits: {deadline_ms: 10}}, BusyWorker);
  await busy.ready; await assert.rejects(busy.run("pass"), error => error.code === "TIMEOUT");
  assert.equal(busy.stats().pending, 0); assert.equal(busy.stats().listeners, 0);
});

test("message validation bounds depth, cycles, arrays, types and encoded bytes before transport", async () => {
  const small = limits({message_bytes: 4096, value_depth: 4});
  for (const value of [new Map(), {x: undefined}, {x: NaN}, {x: 1n}, [,,,,], {x: [[[[[1]]]]]}, {text: "a".repeat(4096)}]) assert.throws(() => checkMessage(value, small));
  const cycle = {}; cycle.x = cycle; assert.throws(() => checkMessage(cycle));
  assert.throws(() => checkMessage({get x() { throw new Error("must not read"); }}), /accessors/);
  assert.throws(() => sourceValue("😀".repeat(10), limits({source_bytes: 39})), error => error.code === "BAD_VALUE");
  const app = create({limits: {message_bytes: 4096}});
  try {
    await app.ready;
    await assert.rejects(app.run("#" + "a".repeat(10000)), error => error.code === "PROTOCOL");
    await app.run("pass"); // A refused local message must not consume an ID.
  } finally { app.stop(); }
  assert.equal(diagnostic({name: "Error", message: "private", location: {filename: "/private/path", span: [1, 1, 1, 1]}}).location, null);
  for (const value of ["😀\ud800\n\t\u0001", {a: [1, -0, Number.MAX_SAFE_INTEGER, true, null, "é"]}]) {
    assert.equal(checkMessage(value), new TextEncoder().encode(JSON.stringify(value)).byteLength);
  }
});

test("worker validates initialization, source arguments, cancellation races and reused request IDs", async () => {
  const host = new Port(), worker = new Port(); host.other = worker; worker.other = host;
  const controller = attachInterpreterWorker(worker), responses = [];
  host.addEventListener("message", event => responses.push(event.data));
  const peer = new Peer(host, "1".repeat(32), CONSOLE_LIMITS);
  peer.send("init", {application: identity(), capabilities: [{id: "output/1"}], limits: CONSOLE_LIMITS}); await tick();
  assert.equal(responses.at(-1).kind, "ready");
  peer.send("request", {id: "h1", operation: "interpreter.run", arguments: {source: {type: "str", codepoints: [-1]}}, timeout_ms: 1000}); await tick();
  assert.equal(responses.at(-1).error.code, "BAD_VALUE");
  peer.send("cancel", {reply_to: "h1"}); await tick(); assert.equal(controller.stats().state, "ready");
  peer.send("request", {id: "h2", operation: "interpreter.run", arguments: {source: sourceValue("pass", CONSOLE_LIMITS)}, timeout_ms: 1000});
  peer.send("cancel", {reply_to: "h2"});
  for (let i = 0; i < 50 && responses.at(-1)?.reply_to !== "h2"; i++) await tick();
  assert.equal(responses.at(-1).error.code, "CANCELLED");
  peer.send("request", {id: "h2", operation: "interpreter.run", arguments: {source: sourceValue("pass", CONSOLE_LIMITS)}, timeout_ms: 1000}); await tick();
  assert.equal(responses.at(-1).kind, "fatal"); assert.equal(controller.stats().state, "closed");
});
