# Source console profile

INT-WEB-01 integrates the independent source engine in three stages: the bounded
host/worker adapter, application assembly/editor, and browser/offline acceptance.
The first stage is implemented in `runtime/interpreter-host.mjs` and
`runtime/interpreter-worker.mjs`. Application assembly and actual offline console
acceptance follow separately; these adapters alone do not deliver an offline UI.

## Host protocol subset

The console uses [host protocol 1](browser-host-protocol.md), profile
`in-house-interpreter/1`, engine `pocket-python-source/1`, backend `javascript-vm`,
language `core-source/1` and bytecode 4. Initialization requires exactly output/1.
Other capabilities are rejected before a worker is created. The host owns the
editor and controls; Python cannot read or modify arbitrary DOM, fetch URLs,
access files or persistent storage. Source imports have no grants in this console.
Later INT-10 supplies asynchronous language calls to additional host adapters.

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
deadlines and teardown. These state-machine tests use paired ports; real worker,
offline and cache-update evidence belongs to the final browser stage.
