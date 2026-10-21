import {Peer, CONSOLE_LIMITS, application, capabilities, limits, exact, fields, request,
  same, failure, exception, sourceValue, readText, checkError} from "./browser-protocol.mjs";
import {libraryProfile, snapshotLibraries, hostProfile as verifyHostProfile} from "./library-selection.mjs";

export function mountInterpreter({application: identity, capabilities: grants = [{id: "output/1"}],
  limits: requested = {}, libraryProfile: profile = "core-only/1", libraries = [], hostProfile: host = "output-only/1",
  onOutput = () => {}, onError = () => {}} = {}, WorkerType = Worker) {
  identity = application(identity); grants = capabilities(grants); const bounds = limits(requested);
  verifyHostProfile(host);
  libraries = snapshotLibraries(profile, libraries);
  const selected = {id: profile, fingerprint: libraryProfile(profile).fingerprint};
  if (typeof onOutput !== "function" || typeof onError !== "function") throw new TypeError("Console callbacks must be functions.");
  const session = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const worker = new WorkerType(new URL("./interpreter-worker.mjs", import.meta.url), {type: "module"});
  const peer = new Peer(worker, session, bounds);
  let state = "initializing", pending = null, nextRun = 1, nextOutput = 1, outputPoints = 0, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // An owner may stop before awaiting ready; retain the original rejected promise.
  ready.catch(() => {});
  let deadline = setTimeout(() => stop("error", failure("TIMEOUT", "Worker initialization timed out.", "host", "HostError")), bounds.deadline_ms);
  function stop(reason = "stop", error = failure("CANCELLED", "Console stopped.", "host", "HostError")) {
    if (state === "closed") return;
    state = "closed"; clearTimeout(deadline);
    if (pending) { clearTimeout(pending.timer); pending.reject(exception(error)); pending = null; }
    rejectReady(exception(error));
    worker.removeEventListener("message", receive); worker.removeEventListener("error", crashed); worker.removeEventListener("messageerror", crashed);
    try { peer.send("close", {reason}); } catch { /* Termination is authoritative. */ }
    worker.terminate();
  }
  function fail(error) { stop("error", error); onError(error); }
  function crashed() { fail(failure("PROTOCOL", "Interpreter worker could not deliver a valid message.")); }
  function receive(event) {
    if (state === "closed") return;
    try {
      const message = event.data;
      if (!peer.receive(message)) return;
      if (message.kind === "fatal") {
        fields(message, ["error"]); checkError(message.error); fail(message.error); return;
      }
      if (state === "initializing") {
        fields(message, ["application", "capabilities", "limits", "library_profile"]);
        if (message.kind !== "ready" || !same(identity, message.application) || !same(bounds, message.limits) ||
            !same(selected, message.library_profile) ||
            !Array.isArray(message.capabilities) || message.capabilities.length !== 1 || message.capabilities[0] !== "output/1") throw new Error("Ready identities/grants/limits differ.");
        clearTimeout(deadline); state = "ready"; resolveReady();
      } else if (message.kind === "request") {
        request(message, "w", nextOutput++);
        let error = null;
        if (message.operation !== "output.write") error = failure("DENIED", "Console host capability is not granted.", "host", "HostError");
        else if (!pending || !exact(message.arguments, ["stream", "text"]) || !["stdout", "stderr"].includes(message.arguments.stream)) error = failure("BAD_VALUE", "Output requires an active run and a named text stream.", "host", "HostError");
        else {
          try {
            const text = readText(message.arguments.text, bounds.output_codepoints);
            if (new TextEncoder().encode(text).byteLength > bounds.response_bytes) throw exception(failure("QUOTA", "Output byte budget exceeded.", "host", "HostError"));
            outputPoints += message.arguments.text.codepoints.length;
            if (outputPoints > bounds.output_codepoints) throw exception(failure("QUOTA", "Output budget exceeded.", "host", "HostError"));
            onOutput(text, message.arguments.stream);
          } catch (cause) { error = cause.detail || failure("IO", "Could not display output.", "host", "HostError"); }
        }
        peer.send("result", {reply_to: message.id, ...(error ? {error} : {value: {type: "none"}})});
      } else if (message.kind === "result") {
        fields(message, ["reply_to", Object.hasOwn(message, "error") ? "error" : "value"]);
        if (!pending || message.reply_to !== pending.id) throw new Error("Unknown or duplicate run result.");
        if (message.error) checkError(message.error);
        else if (!exact(message.value, ["type"]) || message.value.type !== "none") throw new Error("Run must return None.");
        const completed = pending; pending = null; clearTimeout(completed.timer);
        if (message.error) completed.reject(exception(message.error)); else completed.resolve();
      } else throw new Error("Unexpected host message.");
    } catch (error) { fail(failure("PROTOCOL", String(error.message).slice(0, 1024))); }
  }
  worker.addEventListener("message", receive); worker.addEventListener("error", crashed); worker.addEventListener("messageerror", crashed);
  try { peer.send("init", {application: identity, capabilities: grants, limits: bounds, library_profile: profile, libraries}); }
  catch (error) { stop("error", error.detail || failure("PROTOCOL", "Initialization failed.")); throw error; }
  return Object.freeze({ready,
    run(source) {
      if (state !== "ready") return Promise.reject(exception(failure("UNAVAILABLE", "Console is not ready.", "host", "HostError")));
      if (pending) return Promise.reject(exception(failure("QUOTA", "Only one run may be pending.", "host", "HostError")));
      let value;
      try { value = sourceValue(source, bounds); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        const id = "h" + nextRun;
        const timer = setTimeout(() => {
          const error = failure("TIMEOUT", "Source execution deadline expired.", "host", "HostError");
          fail(error);
        }, bounds.deadline_ms);
        pending = {id, resolve, reject, timer}; outputPoints = 0;
        try { peer.send("request", {id, operation: "interpreter.run", arguments: {source: value}, timeout_ms: bounds.deadline_ms}); nextRun++; }
        catch (error) { clearTimeout(timer); pending = null; reject(error); }
      });
    }, stop,
    stats: () => ({state, session, pending: pending ? 1 : 0, listeners: state === "closed" ? 0 : 3, handles: 0, subscriptions: 0,
      limits: bounds, library_profile: {...selected}})});
}
