import {compileSourceModules} from "./source-modules.mjs";
import {ModuleSession} from "./module-session.mjs";
import {verifyLibraries, profileModules} from "./library-selection.mjs";
import {Peer, CONSOLE_LIMITS, application, capabilities, limits, record, exact, fields, request,
  failure, exception, readText, sourceValue, textValue, diagnostic, checkError} from "./browser-protocol.mjs";

export const WORKER_QUANTUM = 512;

// Ports make the same state machine usable by a browser Worker and unit tests.
export function attachInterpreterWorker(port) {
  let peer = null, state = "created", nextHost = 1, nextOutput = 1, active = null, output = null, selection = null, languageProfile = null;
  const dispose = () => {
    if (state === "closed") return;
    state = "closed"; if (active) active.cancelled = true; active = null;
    port.removeEventListener("message", receive);
    if (output) { clearTimeout(output.timer); output.reject(exception(failure("CANCELLED", "Worker closed.", "host", "HostError"))); output = null; }
  };
  const fatal = error => {
    const library = ["LIBRARY_PROFILE", "LIBRARY_INTEGRITY", "UNAVAILABLE"].includes(error.code);
    try { peer?.send("fatal", {error: failure(library ? error.code : "PROTOCOL", String(error.message).slice(0, 1024),
      library ? "runtime" : "protocol", library ? error.name : "ProtocolError")}); }
    finally { dispose(); }
  };
  const sendOutput = text => new Promise((resolve, reject) => {
    const id = "w" + nextOutput++;
    const timer = setTimeout(() => { output = null; reject(exception(failure("TIMEOUT", "Output deadline expired.", "host", "HostError"))); dispose(); }, peer.limits.deadline_ms);
    output = {id, resolve, reject, timer};
    try { peer.send("request", {id, operation: "output.write", arguments: {stream: "stdout", text: textValue(text, peer.limits.output_codepoints)}, timeout_ms: peer.limits.deadline_ms}); }
    catch (error) { clearTimeout(timer); output = null; reject(error); }
  });
  async function run(message, token) {
    let registry = null, session = null, stdout = "", points = 0, error = null;
    const expires = performance.now() + Math.min(message.timeout_ms, peer.limits.deadline_ms);
    const cancelled = () => token.cancelled || performance.now() >= expires;
    try {
      if (message.operation !== "interpreter.run") throw exception(failure("UNAVAILABLE", "Unknown console operation.", "host", "HostError"));
      if (!exact(message.arguments, ["source"])) throw exception(failure("BAD_VALUE", "Run requires only source.", "host", "HostError"));
      const source = readText(message.arguments.source, peer.limits.source_bytes);
      sourceValue(source, peer.limits);
      const result = await compileSourceModules(profileModules(source, selection),
      {entry: "app", languageProfile, maxBytes: peer.limits.source_bytes, maxWork: peer.limits.compile_work, shouldCancel: cancelled});
      registry = result.registry;
      if (state === "closed" || token.cancelled) throw exception(failure("CANCELLED", "Run cancelled.", "host", "HostError"));
      session = new ModuleSession(registry, {memoryLimits: {maxBytes: peer.limits.memory_bytes,
        maxObjects: peer.limits.memory_objects, maxFrames: peer.limits.memory_frames}});
      const activation = session.start({maxSteps: peer.limits.execution_steps, maxWork: peer.limits.execution_work,
        maxDepth: peer.limits.memory_frames, shouldCancel: cancelled}, text => {
        points += Array.from(text).length;
        if (points > peer.limits.output_codepoints) throw exception(failure("QUOTA", "Console output budget exceeded.", "runtime", "ExecutionLimitError"));
        stdout += text;
      });
      do {
        if (cancelled()) throw exception(failure(token.cancelled ? "CANCELLED" : "TIMEOUT", "Source execution interrupted.", "host", "HostError"));
        activation.advance(WORKER_QUANTUM); token.quanta++;
        if (activation.state === "parked") {
          if (stdout) { const text = stdout; stdout = ""; await sendOutput(text); }
          // A macrotask permits actual worker cancel/close messages to run.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } while (activation.state === "parked");
    } catch (cause) { error = cause.detail || diagnostic(cause); }
    finally { session?.close(); registry?.close(); }
    if (state === "closed") return;
    try {
      // Every output batch is acknowledged before the terminal result.
      if (stdout) {
        try { await sendOutput(stdout); }
        catch (cause) { error = cause.detail || diagnostic(cause); }
      }
      if (state === "closed") return;
      if (token.cancelled) error = failure("CANCELLED", "Run cancelled.", "host", "HostError");
      else if (performance.now() >= expires) error = failure("TIMEOUT", "Source execution deadline expired.", "host", "HostError");
      peer.send("result", {reply_to: message.id, ...(error ? {error} : {value: {type: "none"}})});
    } catch (cause) { if (state !== "closed") fatal(cause); }
    finally { if (active === token) active = null; }
  }
  async function initialize(message) {
    try {
      const extended = Object.hasOwn(message, "library_profile") || Object.hasOwn(message, "libraries");
      fields(message, ["application", "capabilities", "limits", ...(extended ? ["library_profile", "libraries"] : [])]);
      const identity = application(message.application), grants = capabilities(message.capabilities), bounds = limits(message.limits);
      languageProfile = identity.engine.language_profile;
      if (!exact(message.limits, Object.keys(CONSOLE_LIMITS))) throw new Error("Explicit effective limits required.");
      peer.limits = bounds; state = "initializing";
      selection = await verifyLibraries(extended ? message.library_profile : "core-only/1", extended ? message.libraries : []);
      if (state === "closed") return;
      state = "ready";
      peer.send("ready", {application: identity, capabilities: grants.map(grant => grant.id), limits: bounds,
        library_profile: {id: selection.id, fingerprint: selection.fingerprint}});
    } catch (error) { if (state !== "closed") fatal(error); }
  }
  function receive(event) {
    if (state === "closed") return;
    try {
      const message = event.data;
      if (!peer) {
        if (!record(message) || !/^[0-9a-f]{32}$/.test(message.session)) throw new Error("Invalid initialization session.");
        peer = new Peer(port, message.session, CONSOLE_LIMITS);
      }
      if (!peer.receive(message)) return;
      if (state === "created") {
        if (message.kind !== "init") throw new Error("Initialization required.");
        void initialize(message);
      } else if (state === "initializing" && message.kind !== "close") {
        throw new Error("Library verification must complete before application messages.");
      } else if (message.kind === "request") {
        request(message, "h", nextHost++);
        if (active) { peer.send("result", {reply_to: message.id, error: failure("QUOTA", "Only one source run may be pending.", "host", "HostError")}); return; }
        active = {id: message.id, cancelled: false, quanta: 0}; void run(message, active);
      } else if (message.kind === "result") {
        fields(message, ["reply_to", Object.hasOwn(message, "error") ? "error" : "value"]);
        if (!output || output.id !== message.reply_to) throw new Error("Unknown or duplicate output reply.");
        if (message.error) checkError(message.error);
        else if (!exact(message.value, ["type"]) || message.value.type !== "none") throw new Error("Output must return None.");
        clearTimeout(output.timer); const pending = output; output = null;
        if (message.error) pending.reject(exception(message.error)); else pending.resolve();
      } else if (message.kind === "cancel") {
        fields(message, ["reply_to"]);
        if (typeof message.reply_to !== "string" || !/^h[1-9][0-9]{0,9}$/.test(message.reply_to) || Number(message.reply_to.slice(1)) >= nextHost) throw new Error("Cancellation must name an admitted request.");
        if (active?.id === message.reply_to) active.cancelled = true;
      } else if (message.kind === "close") {
        fields(message, ["reason"]);
        if (!["stop", "restart", "completed", "error"].includes(message.reason)) throw new Error("Unknown close reason.");
        peer.send("closed"); dispose();
      } else throw new Error("Unexpected worker message.");
    } catch (error) { fatal(error); }
  }
  port.addEventListener("message", receive);
  return Object.freeze({dispose, stats: () => ({state, active: active !== null && state !== "closed", pending: output ? 1 : 0,
    quanta: active?.quanta || 0})});
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) attachInterpreterWorker(globalThis);
