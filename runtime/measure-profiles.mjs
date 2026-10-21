// Repository measurement harness; application code still runs through our VM.
let raw = "", bytes = 0;
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if ((bytes += Buffer.byteLength(chunk, "utf8")) > 1048576) throw new Error("Measurement input exceeds 1 MiB.");
}
const request = JSON.parse(raw), start = performance.now();
const {compileProfileSource} = await import("./library-profiles.mjs");
const {ModuleSession} = await import("./module-session.mjs");
const {CONSOLE_LIMITS} = await import("./browser-protocol.mjs");
const importMs = performance.now() - start;
if (!["timing", "memory"].includes(request.mode) || !Number.isInteger(request.repeats) || request.repeats < 3 || request.repeats > 31) throw new Error("Invalid measurement mode or sample count.");
const memory = () => { globalThis.gc(); return process.memoryUsage(); };
async function run(collect = false) {
  let registry = null, session = null, stdout = "", result;
  const before = performance.now();
  try {
    const compiled = await compileProfileSource(request.source, {profile: request.profile, libraries: request.libraries,
      maxBytes: CONSOLE_LIMITS.source_bytes, maxWork: CONSOLE_LIMITS.compile_work});
    registry = compiled.registry;
    session = new ModuleSession(registry, {memoryLimits: {maxBytes: CONSOLE_LIMITS.memory_bytes,
      maxObjects: CONSOLE_LIMITS.memory_objects, maxFrames: CONSOLE_LIMITS.memory_frames}});
    const compiledAt = performance.now(), afterCompile = collect ? memory() : null;
    const executeAt = performance.now();
    session.run({maxSteps: CONSOLE_LIMITS.execution_steps, maxWork: CONSOLE_LIMITS.execution_work,
      maxDepth: CONSOLE_LIMITS.memory_frames}, text => { stdout += text; });
    const executedAt = performance.now();
    if (stdout !== request.expected_stdout) throw new Error("Measured source differs from CPython output.");
    result = {compile_registry_ms: compiledAt - before, execution_ms: executedAt - executeAt,
      total_ms: executedAt - before, stdout, logical: session.stats(), after_compile_process: afterCompile,
      after_execution_process: collect ? memory() : null, compilations: compiled.compilations};
  } finally {
    session?.close(); registry?.close();
    if (result) {
      result.closed = session.stats(); result.after_close_process = collect ? memory() : null;
      if (result.closed.bytes || result.closed.roots || result.closed.frames) throw new Error("Measured session retained logical roots after close.");
    }
  }
  return result;
}
if (request.mode === "memory") {
  if (typeof globalThis.gc !== "function") throw new Error("Memory observations require the explicit --expose-gc test flag.");
  const baseline = memory(), observation = await run(true);
  process.stdout.write(JSON.stringify({host: process.version, mode: request.mode, import_ms: importMs, baseline_process: baseline, observation}));
} else {
  const cold = await run(), warm = [];
  for (let index = 0; index < request.repeats; index++) warm.push(await run());
  process.stdout.write(JSON.stringify({host: process.version, mode: request.mode, import_ms: importMs, cold, warm}));
}
