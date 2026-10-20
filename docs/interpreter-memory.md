# Independent VM lifetime and resource control

The development engine uses explicit roots and deterministic logical allocation
accounting around JavaScript's garbage collector. It does not implement a second
physical heap or rely on finalizers/WeakRef timing. At instruction safe points
and before adopted allocation/growth, an iterative traversal marks supported
objects reachable from active constant/operand roots, result leases and declared
host captures. Object aliases count once; cycles terminate through identity
tracking. Unreachable records lose their strong references and JavaScript may
then reclaim their physical storage. `reclaimed` counts removed accounting
records, not observed garbage collections or released operating-system pages.

| Resource | Default limit / logical cost |
| --- | --- |
| Live allocation account | 8,388,608 bytes, at most 4096 distinct supported objects |
| Persistent root leases | 1024; 32 bytes plus 8 per declared root slot |
| Active execution scopes | 64; 128 bytes plus 8 per constant/operand root slot |
| Verified operand stack | 256 values; control-flow joins cannot grow the stack |
| Host handles | 128 per table; 128 bytes plus twice ID/kind length and explicit native allocation estimate |
| None/bool | 8 bytes per root/edge |
| BigInt | 24 plus twice decimal digit count per root/edge; primitive aliases are conservatively counted repeatedly |
| Float | 64 bytes per distinct value wrapper |
| String | 64 plus 4 per code point |
| Tuple/list | 64 plus 8 per item slot, plus reachable values |
| Dictionary | 96 plus 48 per entry plus twice stored hash length, plus reachable keys/values |
| Iterator | 64 plus its retained container |

These are versioned accounting rules, not estimates of a particular JavaScript
engine's RSS. Host object internals, JS engine overhead, transport copies,
verifier snapshots and bounded primitive temporaries have separate bounds or
declared estimates. String/container/digit limits, one-million-unit constant
decode and output encoding limits, and the 1024-instruction/256-constant verifier
remain in force. Arithmetic may temporarily create an 8192-digit product before
the existing result limit rejects it. Slicing/hash/layout helpers can allocate
bounded native scratch arrays. There is no claim of a hard process memory cap.

Collection traversals charge the execution work budget and poll cancellation;
each traversal also has a one-million-unit ceiling outside execution. Existing
numeric/string/container primitive charges remain. Budgeted failure never
chooses an alternate engine. Account exhaustion is `OOM` / `MemoryError`, work,
instruction or active-scope exhaustion is `BUDGET` / `ExecutionLimitError`, and
cancellation is `CANCELLED` / `ExecutionCancelled`. During execution these errors
retain the current instruction/source span. Constructors and growth preflight
their supported allocation before creating the retained value or mutating the
target; failed preflights leave the target unchanged. Conservative operand roots
can cause a limit to be reached before the mathematically smallest live graph.

## One-shot and retained execution

`execute(program, {memoryLimits, maxSteps, maxWork, shouldCancel})` creates a
temporary arena, preserving the existing native-value return API. That result
becomes caller-owned after return; the temporary arena closes in `finally`.
Use a session for engine-owned values retained across runs:

```javascript
import {InterpreterSession} from './runtime/session.mjs';
const session = new InterpreterSession({
  memoryLimits: {maxBytes: 1048576, maxObjects: 1024}, maxHandles: 32
});
try {
  const handle = session.run(program, {maxSteps: 5000});
  console.log(session.read(handle)); // bounded, tagged acyclic by-value copy
  session.release(handle);
} finally { session.close(); }
```

Session runs retain results through leases before execution roots unwind. A
worker-owned `python.value` handle can retain a cyclic result, although `read`
still refuses to serialize a cycle by value. Host callbacks declare their VM
capture roots and native allocation estimate explicitly:

```javascript
const handle = session.handles.create(callback, {
  owner: 'main', kind: 'callback', roots: [capturedValue], bytes: 64,
  dispose: callback => removeNativeSubscription(callback)
});
```

Arbitrary native JavaScript closure captures cannot be inspected or discovered
automatically. A host using MemoryArena/ValueRuntime directly must lease values
that survive a safe point; native host locals are not implicit VM roots. Mutable
VM representations are internal: a trusted adapter must use their runtime
operations rather than editing native fields. Values already owned by another
arena require explicit tagged copying; foreign leases and closed arenas fail.

Handles use the HOST-01 type/owner/kind/id shape. Each table has a fresh random
prefix and monotonically increasing IDs, rejects mismatched owners/kinds, and
never reuses a released ID. These identifiers prevent accidental stale reuse;
they do not grant capabilities or authenticate a protocol peer. Transport
session validation and capability checks remain INT-10. Ordinary release drops
the entry and roots before native disposal. Close clears every entry and root,
attempts all disposal callbacks and returns their failures. Session close always
closes its arena, even if native cleanup fails. There is no Python `__del__`,
weakref or finalizer behavior in this milestone.

The vm2 Node and browser conformance adapters now retain/encode results within a
session and close it after every request. The 11 interpreter-memory/1 checks run
unchanged in Node and a real browser worker. They include 200 result releases,
200 unreachable cyclic VM allocations under a one-object limit, retained cycles
and alias identity, declared callback captures, mutual list/dict cycles, atomic
OOM, source-located OOM, handle exhaustion/staleness, disposal failure and
cancellation/work/scope unwinding. CI retains both target reports.

```sh
node --test runtime/memory.test.mjs
python runtime/check_memory.py --report build/memory-node-report.json
python runtime/check_memory.py --target browser --report build/memory-browser-report.json
```

Python functions, closure cells, calls and exception handlers are INT-06. This
milestone tests retained host callback captures and the scope/root primitives
that their future Python counterparts will use; it does not claim Python
closure execution. Source parsing is still INT-08. Worker termination is the
final browser interruption mechanism for synchronous work that cannot process
queued messages. Workers isolate responsiveness, not arbitrary same-origin
code. Published 0.1.0 artifacts remain unchanged.
