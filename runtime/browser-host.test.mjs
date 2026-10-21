import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {mountInterpreter} from "./interpreter-host.mjs";
import {attachInterpreterWorker} from "./interpreter-worker.mjs";
import {ENGINE, LANGUAGE_ENGINES, CONSOLE_LIMITS, Peer, checkMessage, sourceValue, limits, diagnostic} from "./browser-protocol.mjs";

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
const operator = async () => [{name: "operator", package: false, imports: [],
  source: (await readFile(new URL("library/operator.py", import.meta.url), "utf8")).replaceAll("\r\n", "\n"),
  notice: (await readFile(new URL("licenses/POCKET-PYTHON.txt", import.meta.url), "utf8")).replaceAll("\r\n", "\n")}];

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

test("explicit class identity selects v5, composes libraries and keeps each run fresh", async () => {
  const selected=identity();selected.engine={...LANGUAGE_ENGINES['classes-source/1']};
  let output='';
  const app=create({application:selected,libraryProfile:'operator/1',libraries:await operator(),onOutput:text=>{output+=text;}});
  selected.engine.language_profile='unknown/1';
  try{
    await app.ready;assert.equal(app.stats().language_profile,'classes-source/1');
    await app.run('import operator\nclass A:\n def __init__(self,n): self.n=n\n def add(self,x): return operator.add(self.n,x)\nprint(A(7).add(5))\n');
    assert.equal(output,'12\n');
    await assert.rejects(app.run('A()'),error=>error.name==='NameError');
    await assert.rejects(app.run("print('never')\nclass A:\n def __str__(self): return 7\n"),error=>error.code==='UNSUPPORTED');
    assert.equal(output,'12\n');await app.run('class B: pass\nprint(type(B()) is B)\n');
    assert.equal(output,'12\nTrue\n');assert.equal(app.stats().pending,0);
  }finally{app.stop();}
  assert.equal(app.stats().listeners,0);assert.equal(last().controller.stats().state,'closed');
});

test("unknown, mismatched and downgraded language identities never reach a usable worker", async () => {
  for(const engine of [{...ENGINE,language_profile:'unknown/1'},{...ENGINE,bytecode_version:5},
    {...LANGUAGE_ENGINES['classes-source/1'],bytecode_version:4}]){
    const count=LocalWorker.instances.length;
    assert.throws(()=>create({application:{...identity(),engine}}),error=>error.code==='PROTOCOL');
    assert.equal(LocalWorker.instances.length,count);
  }
  class DowngradeWorker extends LocalWorker{
    constructor(...args){super(...args);const send=this.other.postMessage.bind(this.other);
      this.other.postMessage=message=>{if(message.kind==='ready')message={...message,application:{...message.application,engine:{...ENGINE}}};send(message);};}
  }
  const app=mountInterpreter({application:{...identity(),engine:{...LANGUAGE_ENGINES['classes-source/1']}}},DowngradeWorker);
  await assert.rejects(app.ready,error=>error.code==='PROTOCOL');assert.equal(app.stats().state,'closed');assert.equal(app.stats().listeners,0);
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

test("host output quota and display errors resolve the run without closing a healthy session", async () => {
  let refuse = true, text = "";
  const app = create({limits: {response_bytes: 2}, onOutput: value => {
    if (refuse) throw new Error("Display unavailable");
    text += value;
  }});
  try {
    await app.ready;
    await assert.rejects(app.run("print('long')"), error => error.code === "QUOTA" && error.detail.domain === "host");
    await assert.rejects(app.run("print('x')"), error => error.code === "IO" && error.detail.domain === "host");
    assert.equal(app.stats().state, "ready"); assert.equal(app.stats().pending, 0);
    refuse = false;
    await app.run("print('x')"); assert.equal(text, "x\n");
  } finally { app.stop(); }
});

test("selected libraries initialize before ready and retain source diagnostics without host grants", async () => {
  let output = "";
  const app = create({libraryProfile: "operator/1", libraries: await operator(), onOutput: text => { output += text; }});
  try {
    await app.ready; assert.equal(app.stats().library_profile.id, "operator/1");
    await app.run("import operator\nprint(operator.add(9007199254740993,1))");
    assert.equal(output, "9007199254740994\n");
    await assert.rejects(app.run("import operator\noperator.floordiv(1,0)"), error =>
      error.name === "ZeroDivisionError" && error.detail.location.filename === "sources/operator.py");
    await assert.rejects(app.run("import browser"), error => error.name === "ImportError");
    await app.run("print('ready')");
    assert.equal(app.stats().state, "ready");
  } finally { app.stop(); }
  assert.throws(() => create({hostProfile: "dom/1"}), error => error.code === "UNAVAILABLE");
  assert.throws(() => create({libraryProfile: "operator/2"}), error => error.code === "LIBRARY_PROFILE");
});

test("a changed selected library cannot reach ready and releases host listeners", async () => {
  const libraries = await operator(); libraries[0].source = libraries[0].source.replace("return a + b", "return a - b");
  const app = create({libraryProfile: "operator/1", libraries});
  await assert.rejects(app.ready, error => error.code === "LIBRARY_INTEGRITY");
  assert.equal(app.stats().state, "closed"); assert.equal(app.stats().listeners, 0);
  assert.equal(last().terminated, true);
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
  const cancelledReply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { host.removeEventListener("message", received); reject(new Error("Cancellation reply timed out.")); }, 1000);
    function received(event) {
      if (event.data.kind !== "result" || event.data.reply_to !== "h2") return;
      clearTimeout(timer); host.removeEventListener("message", received); resolve(event.data);
    }
    host.addEventListener("message", received);
  });
  peer.send("request", {id: "h2", operation: "interpreter.run", arguments: {source: sourceValue("pass", CONSOLE_LIMITS)}, timeout_ms: 1000});
  peer.send("cancel", {reply_to: "h2"});
  assert.equal((await cancelledReply).error.code, "CANCELLED");
  peer.send("request", {id: "h2", operation: "interpreter.run", arguments: {source: sourceValue("pass", CONSOLE_LIMITS)}, timeout_ms: 1000}); await tick();
  assert.equal(responses.at(-1).kind, "fatal"); assert.equal(controller.stats().state, "closed");
});
