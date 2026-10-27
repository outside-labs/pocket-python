# Persistent module events

`module-events/1` extends the trusted JavaScript module-session API. Python source
profiles, bytecode identities and import/host grants keep their existing meaning.
The console host does not gain event or storage capabilities from this API.

`session.start(options, onOutput)` returns one owned module activation.
`advance(n)` executes at most n verified instructions and parks all live scopes
before returning. `drain()` uses the same controller synchronously. The existing
`run` facade drains this activation and preserves its receipt and resource
observations. Module state and initialized imports persist until session close.

After successful entry, `register(name)` captures an ordinary exported Python
function. A bounded root lease retains that exact callable, its defaults, globals
and closure cells even if Python replaces the export. Generator functions,
classes and other callable families require separate entry contracts. Callback
handles have session-specific generations and expire on unregister or close.
They convey no authority to enter a different session or import undeclared code.

`enqueue(handle, positionalValues, options, onOutput)` returns an event with a
result Promise and idempotent `cancel`. Arguments use the existing tagged
by-value encoding. Admission copies plain data without getters/toJSON hooks,
cycles or mutable aliases; it validates tags and bounds conversion work before
accounting the queued representation. Each event admits at most 128 arguments,
65,536 logical transport bytes, 20,000 data nodes and 40 transport levels.
Callback and pending-event caps default to 128 each (configurable 1–1,024).
The pending cap includes the active event. Queue and callback metadata, serialized
arguments and retained VM graphs all have explicit arena owners.

`pump(n)` starts or advances one FIFO event. It never starts a second Python
activation inside a running callback. Output callbacks may enqueue later events;
pump, close, unregister and active cancellation reject running reentry without
settling or disturbing the current event. Events are not coalesced. The host
decides when to pump and yield to its event loop; this API provides no fairness
or wall-clock scheduling guarantee by itself.

Each callback activation shares its instruction/work/depth allowance across all
quanta, nested calls and imports. Input decoding retains each intermediate value
and charges the activation's work budget. A completed result has an explicit
lease while bounded result encoding runs; the exported frozen data is a copy.
Result conversion also charges that activation's work/cancellation budget.
Binding, Python, resource and conversion failures reject only that event, retain
already observable effects and leave later queued events available. Failed
imports are removed while the previously initialized entry/cache stays live.

Cancellation between quanta closes the activation without executing Python
handlers or finally blocks. Unregister cancels that callback's active and queued
events before releasing its lease. Session close cancels every event and releases
all callbacks, output leases, cache and registry ownership. Each admitted event
settles once; cancellation after settlement returns false. Reusing released or
foreign handles fails before event admission.

The pinned CPython 3.14.7 source matrix covers persistent globals/defaults/cells,
ordered calls, signatures/errors, nested values, class/hash protocols, generators,
Unicode/binary/numeric results and recovery. Node and Chromium use one-instruction
pumps and forced collection. Separate lifecycle tests cover queue/handle/transport
caps, stale generations, reentry, OOM, cancellation, close and zero teardown.
Native coroutines, await, async iterators/generators/context managers and awaited
host adapters remain subsequent #34 slices.
