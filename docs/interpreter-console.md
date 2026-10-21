# Source console profile

INT-WEB-01 integrates the independent source engine in three stages: the bounded
host/worker adapter, application assembly/editor, and browser/offline acceptance.
The adapter is implemented in `runtime/interpreter-host.mjs` and
`runtime/interpreter-worker.mjs`. The development `interpreter-web` command now
assembles the pinned engine and editor. The real-browser acceptance suite verifies
offline execution and updates in Chromium. No new PyPI release is implied by
these changes.

## Build and use the console

From a checkout with the normal project environment:

```sh
uv run python examples/interpreter_console.py
python -m http.server 8000 --bind 127.0.0.1 --directory build/console
```

Open `http://localhost:8000/`, wait for **Offline ready on this device**, edit the
source and choose Run. Output and source errors are visible below the editor.
Stop terminates a busy worker; Restart creates a new session and retains the
editor text. Each Run starts fresh Python variables. Reload restores the supplied
example; this first console neither persists nor uploads editor contents.
HTTPS/localhost is required. Deployment under a URL subdirectory is supported.

The example uses the same text-metrics computation as the CPython/compiled
acceptance application. It writes a `CONSOLE-SOURCE.json` client allowlist with
one source and one nonempty UTF-8 provenance/license notice. To assemble that
selection with the CLI into another new directory:

```sh
uv run pocket-python interpreter-web build/console-source/CONSOLE-SOURCE.json \
  --engine runtime --output build/another-console --title "Local Python"
```

Input kind is `pocket-python-console-source`, schema_version 1, target `client`,
with exactly source and notice records. Both carry path, size_bytes, sha256 and
role; roles must be client-source/notice, source a .py path, and notice under
LICENSES/. Each file is at most 65,536 bytes. Source is UTF-8 without BOM;
empty source is permitted. A notice is required, and does not grant a license
to subsequently entered code. No other checkout files are selected.

`--engine` must explicitly supply the known runtime assets. The assembler pins
twenty-three core assets (twenty-one modules and the project/Unicode notices) through
`_interpreter_lock.py`; it canonicalizes checkout CRLF to LF before verifying.
Unknown engine code, missing/modified files and forged snapshots fail before
publication. `python scripts/lock_interpreter.py` checks the lock; `--write` is
an explicit maintenance step after reviewing engine changes. The engine itself
remains outside Python distributions; there is no implicit download or compiler
dependency. Assembly never executes the source or engine.

The default language selection is core-source/1 (bytecode 4). Add
`--language-profile classes-source/1` to select the [class foundation](interpreter-classes.md)
(bytecode 5): class bodies, C3 inheritance, instance attributes, initialization,
bound methods, [private names](interpreter-private-names.md), and the adopted
[descriptors, properties and decorators](interpreter-descriptors.md). The editor shows the selected profile. Build a class example
with `uv run python -m examples.interpreter_classes`, then serve
`build/class-console`. Custom special methods and async remain later stages. Language selection is independent of `--library-profile`;
both language profiles use the same complete pinned engine.

Output uses application schema 2, profile in-house-interpreter/1, with distinct
engine/source identities, complete local module edges and notices, content-based
engine/application/launcher/configuration paths, file hashes and separate source,
engine, notice, data, assembly-module and total byte counts. The editor verifies
the configuration and initial source before reading them. Service-worker install
fetches the entire executable/source/notice closure with SHA-256 integrity;
receipt and service-worker files are cached alongside it. The receipt excludes
its own hash. These are provenance/integrity checks for the selected build,
not authentication of an untrusted web origin.

A failed install leaves the previous active version available. A complete
update waits until every old app tab/window closes; the visible status explains
when an update is waiting. Activation deletes only this URL scope's older caches.
Known cached assets stay together, and unknown paths within the app scope return
404. Offline use depends on the browser retaining this complete cache.

## Host protocol subset

The console uses [host protocol 1](browser-host-protocol.md), profile
`in-house-interpreter/1`, engine `pocket-python-source/1`, backend `javascript-vm`,
language `core-source/1` with bytecode 4 or explicit `classes-source/1` with
bytecode 5. Receipts, configuration, application identity and cache version bind
the selection. Ready must echo the complete engine identity; an unknown profile,
wrong bytecode version or downgrade fails without a fallback. Initialization requires exactly output/1.
Other capabilities are rejected before a worker is created. The host owns the
editor and controls; Python cannot read or modify arbitrary DOM, fetch URLs,
access files or persistent storage. The default core-only/1 selection supplies
no library imports; operator/1 grants only its reviewed operator module.
Later INT-10 supplies asynchronous language calls to additional host adapters.

Initialization additionally names library_profile and supplies its bounded
libraries (exact name/package/imports/source/notice records). The worker snapshots
and verifies every source/notice against the reviewed catalog before ready,
which echoes the library ID and fingerprint. Unknown selections fail explicitly.
These fields accompany the complete engine fingerprint; cached applications keep
their original host/worker graph. Library errors retain adopted library source
locations, without revealing host paths.

This profile adds one host-to-worker request operation, `interpreter.run`, with
exact arguments `{source: <tagged str>}`. It returns tagged None or a structured
host/runtime error. Only one run is admitted at a time. A new verified registry
and arena belong to each run; previous bindings, functions and imports do not
survive. Every supplied source is parsed and compiled locally before executing.
The logical filename is `sources/app.py`. This is source execution, without an
ahead-of-time application compiler or a server execution endpoint.

Synchronous execution collects one bounded stdout batch, releases the registry
and arena, then requests `output.write` and awaits its acknowledgement before
returning the run result. Output produced before a runtime error is retained.
Live output while a synchronous infinite loop runs is deferred with async
scheduling. The host renders output as text. Errors retain bounded Python type,
message, application-only source locations and up to sixteen original frames.

Limits are explicit in init and echoed exactly by ready. Protocol fields retain
their names: message_bytes, value_depth, pending_requests, subscriptions,
output_codepoints, response_bytes and deadline_ms. Console defaults are 1 MiB,
16 levels, one pending request per direction, zero subscriptions, 16,384 output
points, 1 MiB of output UTF-8 bytes and ten seconds. Additional profile-1 fields
are source_bytes (65,536), compile_work (4,194,304), execution_steps (1,000,000),
execution_work (100,000,000), memory_bytes (8,388,608), memory_objects (4096) and
memory_frames (64). Callers may lower these caps. Memory figures describe logical
arena accounting; source/transport allocations have separate bounded inputs.
They do not specify browser RSS.

Message checking counts JSON UTF-8 bytes, including escapes, without allocating
a serialized copy; plain acyclic data, dense arrays of at most 65,536 items,
records of at most 64 fields and the negotiated depth are required. Source is
checked before creating its code-point array. Received structured-clone data has
already been allocated by the browser; validation bounds subsequent processing.
Malformed active-session messages close the worker. Valid stale session IDs are
discarded without advancing counters. Denied host requests return DENIED without
invoking any adapter. Refused local messages consume neither sequence nor ID.

Host initialization and run deadlines terminate an unresponsive worker. Stop
also rejects pending work, detaches all three worker listeners and terminates
immediately, without waiting for a cooperative acknowledgement. Restart creates
a new worker and unpredictable session. A synchronous VM cannot process a queued
cancel message while busy; termination is authoritative. Hashing gaps can admit
cooperative cancellation. Request IDs remain monotonic, including failed runs;
already completed cancellation races are ignored.

Run `node --test runtime/browser-host.test.mjs` for source/output/errors, fresh
state, grants, malformed/stale messages, source/output/memory limits, cancellation,
deadlines and teardown. These state-machine tests use paired ports.

`python scripts/interpreter_browser_smoke.py` builds fresh applications and runs
the actual module worker in Chromium. Its versioned report includes seven
CPython/shared-source comparisons and nine acceptance groups: text-safe output,
source errors/refusals, fresh state, new source after offline reload under a
subdirectory, busy-worker interruption/restarts, transport/allocation/work limits,
grants/session/deadline/listener behavior, integrity-failed initial installation,
failed-update recovery, complete waiting updates and cache isolation. Only local
GET asset requests occur. The engine and tool/source hashes identify the build;
no startup or physical-memory performance claim follows from these checks.

CI runs this suite alongside existing MicroPython/compiled profile regressions
and the independent engine's Node/Chromium conformance suites. Browser reports
are retained as workflow artifacts. Use `--channel chrome` to check an installed
Chrome explicitly; that is a separate browser result.
