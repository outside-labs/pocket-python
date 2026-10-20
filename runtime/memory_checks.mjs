import {MemoryArena} from "./memory.mjs";
import {HostHandles, InterpreterSession} from "./session.mjs";
import {ValueRuntime} from "./values.mjs";
import {execute} from "./vm.mjs";

function check(condition, message) { if (!condition) throw new Error(message); }
function throws(call, code) {
  try { call(); } catch (error) { check(error.code === code, "Expected " + code + ", received " + error.code); return error; }
  throw new Error("Expected " + code + " failure.");
}
const program = instructions => ({format: "pocket-python-bytecode", version: 2, constants: [], instructions});
const empty = () => program([["build-list", 0], ["return"]]);
const baseline = session => {
  const stats = session.stats();
  check(stats.bytes === 0 && stats.objects === 0 && stats.roots === 0 && stats.frames === 0 && stats.handles === 0, "Lifetime did not return to baseline.");
};

export const memoryChecks = [
  ["repeated-result-handle-release", () => {
    const session = new InterpreterSession();
    for (let index = 0; index < 200; index++) {
      const handle = session.run(empty());
      check(session.read(handle).type === "list", "Incorrect retained result.");
      check(session.stats().objects === 1 && session.stats().handles === 1, "Result lacks one owned root.");
      session.release(handle); baseline(session);
    }
    check(session.stats().allocations === 200 && session.stats().reclaimed === 200, "Repeated allocations accumulated.");
    session.close(); baseline(session);
  }],
  ["cyclic-vm-garbage-reclamation", () => {
    const arena = new MemoryArena({maxObjects: 1, maxBytes: 512});
    const cycle = program([["build-list", 0], ["dup"], ["dup"], ["append"], ["pop"], ["pop"], ["jump", 0]]);
    throws(() => execute(cycle, {arena, maxSteps: 1400}), "BUDGET");
    check(arena.stats().allocations === 200 && arena.stats().reclaimed === 200, "Unreachable cycles accumulated.");
    check(arena.stats().bytes === 0 && arena.stats().objects === 0 && arena.stats().frames === 0, "Exception retained cycle roots.");
    arena.close();
  }],
  ["retained-cycle-and-alias-identity", () => {
    const session = new InterpreterSession();
    const code = program([["build-list", 0], ["dup"], ["dup"], ["append"], ["pop"], ["return"]]);
    const handle = session.run(code), value = session.handles.resolve(handle);
    check(value.items[0] === value && session.stats().objects === 1, "Cycle or identity was lost.");
    try { session.read(handle); throw new Error("A cycle was serialized by value."); }
    catch (error) { check(error.name === "ValueError", "Cycle transport refusal changed."); }
    session.release(handle); baseline(session); session.close();
  }],
  ["captured-host-callback-roots", () => {
    const session = new InterpreterSession(), values = new ValueRuntime({memory: session.memory});
    const captured = values.list([]), callback = () => { values.append(captured, 7n); return captured; };
    const handle = session.handles.create(callback, {kind: "callback", roots: [captured], bytes: 64});
    session.memory.collect();
    const observed = session.handles.resolve({...handle}, {owner: "main", kind: "callback"})();
    check(observed === captured && observed.items[0] === 7n && session.stats().objects === 1, "Captured root was reclaimed.");
    session.release(handle); baseline(session); session.close();
  }],
  ["mutual-dictionary-list-cycle", () => {
    const arena = new MemoryArena(), values = new ValueRuntime({memory: arena});
    const list = values.list([]), root = arena.pin([list]);
    const dict = values.dict([]); values.append(list, dict);
    const key = values.string([97]); values.set(dict, key, list);
    arena.collect();
    check(arena.stats().objects === 3 && dict.entries[0].value === list, "Mutual cycle roots differ.");
    root.release();
    check(arena.stats().objects === 0 && arena.stats().bytes === 0, "Mutual cycle was not released.");
    arena.close();
  }],
  ["oom-preflight-keeps-mutation-atomic", () => {
    const arena = new MemoryArena({maxBytes: 512, maxObjects: 1}), values = new ValueRuntime({memory: arena});
    const list = values.list([]), root = arena.pin([list]);
    throws(() => values.append(list, 10n ** 200n), "OOM");
    check(list.items.length === 0, "OOM partially mutated a list.");
    throws(() => values.list([]), "OOM");
    check(arena.stats().objects === 1, "OOM leaked a provisional object.");
    root.release();
    const dict = values.dict([]), dictionaryRoot = arena.pin([dict]);
    throws(() => values.set(dict, 1n, 10n ** 200n), "OOM");
    check(dict.entries.length === 0, "OOM partially inserted a dictionary entry.");
    values.set(dict, 1n, 1n);
    throws(() => values.set(dict, 1n, 10n ** 200n), "OOM");
    check(dict.entries[0].value === 1n, "OOM partially replaced a dictionary value.");
    dictionaryRoot.release(); arena.close();
    const session = new InterpreterSession({memoryLimits: {maxBytes: 512}});
    throws(() => session.handles.create({}, {bytes: 1024}), "OOM");
    baseline(session); session.close();
  }],
  ["oom-source-location-and-unwind", () => {
    const session = new InterpreterSession({memoryLimits: {maxBytes: 250}});
    const code = program([["build-list", 0], ["build-tuple", 1], ["return"]]);
    code.source = {filename: "allocation.py", spans: [[1, 1, 1, 3], [2, 5, 2, 9], [3, 1, 3, 3]]};
    const error = throws(() => session.run(code), "OOM");
    check(error.name === "MemoryError" && error.instruction === 1 && error.location.filename === "allocation.py" && error.location.span[0] === 2, "OOM lost its original instruction.");
    baseline(session); session.close();
  }],
  ["stale-cross-session-and-mismatched-handles", () => {
    const first = new InterpreterSession(), second = new InterpreterSession();
    const handle = first.run(empty());
    throws(() => second.read(handle), "STALE_HANDLE");
    throws(() => first.handles.resolve({...handle, owner: "main"}), "STALE_HANDLE");
    throws(() => first.handles.resolve({...handle, kind: "callback"}), "STALE_HANDLE");
    throws(() => first.handles.resolve({...handle, extra: true}), "STALE_HANDLE");
    first.release(handle);
    throws(() => first.read(handle), "STALE_HANDLE");
    throws(() => first.release(handle), "STALE_HANDLE");
    const next = first.run(empty()); check(next.id !== handle.id, "Released handle ID was reused.");
    first.close(); throws(() => first.read(next), "STALE_HANDLE");
    second.close(); baseline(first); baseline(second);
  }],
  ["handle-limit-and-failing-disposal-teardown", () => {
    const session = new InterpreterSession({maxHandles: 2});
    let disposed = 0;
    session.handles.create({}, {dispose: () => { disposed++; throw new Error("fixture disposal"); }});
    session.handles.create({}, {dispose: () => { disposed++; }});
    throws(() => session.run(empty()), "OOM");
    check(session.stats().roots === 2 && session.stats().handles === 2 && session.stats().objects === 0, "Handle exhaustion leaked the rejected result.");
    const failures = session.close();
    check(disposed === 2 && failures.length === 1, "Disposal failure prevented teardown.");
    baseline(session); check(session.close().length === 0, "Close is not idempotent.");
  }],
  ["cancellation-work-and-frame-budgets-unwind", () => {
    const arena = new MemoryArena({maxFrames: 2});
    const first = arena.enter(() => []), second = arena.enter(() => []);
    throws(() => arena.enter(() => []), "BUDGET"); second(); first();
    let polls = 0;
    throws(() => execute(empty(), {arena, shouldCancel: () => ++polls > 3}), "CANCELLED");
    throws(() => execute(empty(), {arena, maxWork: 1}), "BUDGET");
    const large = {...empty(), constants: [{type: "int", value: "9".repeat(256)}], instructions: [["const", 0], ["return"]]};
    throws(() => execute(large, {arena, maxWork: 100}), "BUDGET");
    check(arena.stats().frames === 0 && arena.stats().bytes === 0, "Cancellation/work retained execution roots.");
    arena.close();
  }],
  ["root-ownership-and-closed-leases", () => {
    const first = new MemoryArena(), second = new MemoryArena(), values = new ValueRuntime();
    const value = values.list([]), lease = first.pin([value]);
    throws(() => second.pin([value]), "STALE_HANDLE");
    try { new HostHandles(second).adoptValue(lease); throw new Error("A foreign root lease was adopted."); }
    catch (error) { check(error instanceof TypeError, "Foreign lease refusal changed."); }
    lease.release(); throws(() => lease.get(), "STALE_HANDLE");
    first.close(); throws(() => first.pin([]), "STALE_HANDLE"); second.close();
  }]
];

export function runMemoryChecks() {
  const checks = [];
  for (const [name, run] of memoryChecks) {
    try { run(); } catch (error) { throw new Error(name + ": " + error.message, {cause: error}); }
    checks.push(name);
  }
  return {suite: "interpreter-memory/1", checks};
}
