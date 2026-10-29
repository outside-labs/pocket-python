# Execution and ownership contract

INT-EXEC-01 baseline: runtime `56b99ff08b469eae38d023d8bee9b9f8bbd9877a`.
The consolidation changes representation in stages; it adds no Python syntax,
protocol, host capability or import grant. The synchronous `execute` facade keeps
its current result/error contract, and console runs still start fresh sessions.

## Three distinct transitions

A **control completion** is `normal`, `return`, `break`, `continue` or `raise`.
It passes through the one loop/try/frame unwinder. A finally block retains its
pending completion and previous active exception; normal completion restores the
pending signal, and an abrupt completion replaces it. Handler matching can raise
again and reenter that same unwinder. Hard budget, cancellation, arena and host
failures bypass Python handlers and finally blocks and release transient owners.

An **operation continuation** describes work after a callback: bind a descriptor,
invoke its result, validate a protocol result, construct a class, resume a class
notification snapshot or deliver a value to a stack/control destination. User
callbacks enter ordinary Python frames. Primitive value operations remain direct
and synchronous; no Promise or second evaluator is involved.

A **scheduling suspension** stops the owned machine at a supported safe boundary.
It is neither Python `yield` nor `await`. Initially, boundaries are before the
next verified instruction, after all work from the preceding instruction has a
live owner. Dispatch, allocation preflight, mutation rollback, handler matching
and frame transfer are atomic with respect to that driver. Later operation-phase
boundaries require their own ownership and equivalence evidence.

## Closed operation and control vocabulary

| Record | Input and transition | Retained values / destination |
| --- | --- | --- |
| call task | Callable, positional/keyword operands, source site, implicit redirect depth. Unwrap native method wrappers, resolve a type call slot, enter a Python frame or execute a builtin. | Callable and original operands survive descriptor planning; continuation carries the eventual destination. Native wrappers do not consume Python depth; instance redirects do. |
| unary task | Operation, receiver, source site, depth and optional-length mode. Primitive operation is immediate; instance len/truth/not plans a type slot callback. | Receiver and outer continuation survive binding and result validation. |
| value task | Already computed value and continuation. | Immediate delivery; used by truth-specific optional binding recovery. |
| class completion | Finish the class body, create the type, then walk the original namespace snapshot for notifications. | Bases, body locals, module identity and snapshot values. |
| init completion | Require None from initializer, replace with the new instance, then deliver outward. | New instance and outer continuation. |
| relay completion | Preserve an implicit callable receiver while forwarding its result. | Receiver and outer roots. |
| invoke completion | Binding returned a callable; call it with the original operands. | Original positional/keyword values, receiver roots and outer continuation. |
| protocol-result completion | Validate bool strictly, or len as adopted integer with signed-64-bit positive bound; convert to truth/not as required. | Receiver and outer continuation. Body errors propagate. |
| optional-truth completion | Truth-test the raw result of optional length recovery. | Receiver, outer continuation and redirect depth. |
| notify completion | Resume the next entry of the original class namespace snapshot. | Type and every original entry value, even if a callback mutates the type. |
| condition completion | Consume truth result for if, while or expression jump. | Named destination fields; enclosing frame owns the target block/control record. |
| discard completion | Ignore a setter/deleter result and push None. | Enclosing frame/stack. |
| absent completion | Push an ordinary result to the caller stack. | Caller stack becomes the owner before collection can occur. |
| block / while / for / try control | Verified cursor and stack; loop phase/iterator; try phase/pending signal/caught and previous exception. | Part of its Python frame, handled only by the common unwinder. |

Binding AttributeError recovery is deliberately narrow: skip init/relay wrappers,
then use only an explicit optional-bool/optional-length **binding** fallback.
The corresponding method-body error is never suppressed. Other protocols do not
inherit that policy. Frame-free callable/binding cycles remain depth/work bounded.

## Baseline owner map

| Owner | Roots and lifetime | Transfer / failure rule |
| --- | --- | --- |
| execution scope | Code pool, globals, inherited exception, non-module builtins and temporaries. | Enter before allocation; leave after all Python frames. Temporaries bridge popped operands/results until destination roots are installed. |
| Python frame scope | Callable; local cells; active exception; block stacks; control iterator, pending value, caught and previous exceptions; completion bases, instance and roots. | New frame is rooted before binding allocates cells. Return/raise/class transfer first places the value, namespace and continuation roots in execution temporaries, then leaves the frame. |
| pending operation | Named operands and closed continuation. The extracted visitor preserves copied ancestor roots. | A callback frame retains its completion. Dispatch first adds operands to temporaries, before planning can allocate. Do not discard ancestors during extraction. |
| class notification | Type and original namespace entry snapshot. | Retain all snapshot values before each callback; mutation does not alter which entries are notified. |
| module initialization scope | New environment/module, cache entry, active import chain. At the baseline, each recursive module execution has its own execution/frame scopes; the consolidated controller preserves these scopes as owned units. | Mark ready and bind parent on success. Remove failed initializer from cache, keep already observable effects, pop chain and unwind in LIFO order. |
| imported Python error lease | Exception and context/trace graph while native import stack unwinds. | Importer roots the value before releasing the lease and appending its own source location. Remove the bridge only after machine-owned import errors replace it. |
| module session | Pinned cache, shared builtin objects, registry bytes and output leases. | Shared instruction/work/output totals across imports. Finish releases transient output; close releases cache/registry ownership. |
| retained result lease | Result plus its transitive value graph. | Pin before leaving final frame; caller explicitly releases it. No unleased VM object is exported in diagnostics. |
| memory preflight | Proposed allocation children or replacement layout plus existing roots. | Failed resize restores the old value; failed pin keeps the old owner. Cleanup releases roots even after quota/cancellation failure. |

Active arena scopes are LIFO. A static pin is an immutable value snapshot; it is
not a substitute for the mutable frame/control graph of a paused execution. The
first stepping driver supports a single active activation. The parked-owner
extension below permits multiple independent activations; host waiting and
coroutine construction retain their separate contracts.

## Lifecycle and safe boundaries

An owned execution progresses from ready to running, then paused, completed or
failed. Only ready/paused can advance. Running rejects reentry and close. Close
is idempotent in ready, paused, completed and failed states and releases all
transient execution/frame owners, even after a hard failure. Completed result
leases retain their explicit caller lifetime. Diagnostic snapshots expose source
cursors, graph counts and total counters rather than mutable VM values.

Draining `execute` uses the same machine without publishing suspension. A test
driver can advance one safe unit repeatedly. Compare it with draining execution
for output, side effects, exported values, error type/context/source traceback,
resource counters and zero final ownership. No new per-quantum allowance resets
an activation budget. A paused single activation may retain its LIFO scopes; do
not interleave another arena activation until parked ownership is adopted.

## Resource compatibility

During initial root extraction, preserve root **order and multiplicity**, including
null placeholders, copied ancestor roots and the separately enumerated init
instance. Preserve instruction/work/cancellation polls, allocation preflights,
collection schedule, scope count, output/registry lease charges and result/error
lease lifetime. Primitive roots and repeated root arrays affect logical bytes and
work even when object traversal deduplicates object identities.

`tests/fixtures/interpreter/execution-resources.json` records complete deterministic
steps/work/arena observations for eight composed cases. The companion Node tests
also check nested-import source locations, failed-cache removal, shared budgets,
OOM/cancellation and zero bytes/objects/roots/frames/external leases at close.
`execution.json` is independently compared with pinned CPython in Node and browser
CI. Existing class, descriptor, call, len/truth, core and refusal matrices remain
required.

O38 introduces the explicit `execution-accounting/2` extension for automatic
property names. The fixture keeps the initial counters as `previous_cases` and
the adopted counters as `cases`. Four property-bearing cases retain a new
104-byte name edge, with ordinary mutation preflight/work charges; instructions,
allocation counts and the other four observations remain unchanged. The
[memory contract](interpreter-memory.md) specifies the slot/string costs.

O43 adds `execution-accounting/3`: ordinary bytecode-5 functions retain a
definition-time module snapshot (eight bytes when non-None). Default name and
qualification strings are retained lazily when read. The eight revised cases
preserve instructions, allocations, collection counts and root/frame counts;
their retained module edges add 0–24 live bytes and 8–32 peak bytes, with normal
graph traversal work. Prior accounting/2 observations remain in
`accounting_2_cases`; the original observations remain in `previous_cases`.
Bytecode-3/4 and internal module/class entries keep their previous layouts.

Deduplication, different operation metadata charges, independent parked graph
owners, changed collection boundaries or import scope/depth rules require an
explicit resource-contract revision. Record old/new counters, threshold behavior
and full payload closure; structural extraction alone makes no speed or memory
improvement claim. Bytecode 4/5 and core-source/1/classes-source/1 remain unchanged.

The initial operation extraction uses closed immutable records in `operations.mjs`
and an exhaustive cached root visitor. It copies operand/snapshot arrays and
preserves the recorded multiset, including duplicate init/ancestor roots.
Structural transfers retain destination temporaries before releasing a frame.
These records add no logical metadata charge under the initial contract.

## Owned instruction driver

`Execution` now owns the activation graph, counters, temporaries and source cursor.
`advance(n)` runs at most n verified instructions and returns an immutable
value-free diagnostic snapshot. `drain()` drives that same machine to completion;
`execute` preserves the previous synchronous facade. Ready/paused activations can
advance; running reentry/close and completed/failed/closed advance are rejected.
Close is idempotent and leaves explicit result leases with their caller.

The single paused activation retains its mutable LIFO scopes. Another activation
cannot interleave on that arena. Imported initializers now run on the same
controller and can pause between their own verified instructions. The test-only
`execution_checks.mjs` harness and runner/worker are excluded from application
assets. Node and browser CI exercise the adopted and refusal matrices through
both draining and instruction-boundary drivers, without resetting quotas.

## Shared operation phases

`operation-runtime.mjs` now contains the closed call/unary/value phases, builtin
execution and completion delivery. It uses the activation's ordinary frame
entry, block stack, error carrier and unwinder; primitive value operations remain
synchronous. Type-slot lookup, optional binding recovery, class notifications and
constructor result checks retain their existing behavior and resource counters.

Diagnostic transition counts include dispatch kinds, builtin names, completion
destinations and original namespace entries. They do not charge a new Python
budget. The [phase/payload record](measurements/2026-10-21-execution-phases.json)
compares draining and instruction-boundary counts for the composed cases and
lists every changed file in a complete source-console assembly. This extraction
adds 2,548 uncompressed bytes for that fixture (326,305 to 328,853 bytes); it makes
no execution-speed or logical-memory improvement claim.

## Owned module initialization

`Execution.modules(context)` owns the entry/package initialization plan and all
nested import plans. Each plan names its bounded parent/target sequence, current
index, result destination and inherited active exception. Initialization records
own the new module/environment, cache insertion and chain position until complete
or abort. `complete` marks ready and binds the package parent; `abort` removes a
failed initializer while preserving earlier observable effects. Cached modules
keep their identity and initialize once. The existing explicit cycle refusal,
16-module depth limit, grants and shared budgets remain in force.

An import opcode queues a plan. The controller pushes ordinary activation units
and drives their verified instructions, without recursively entering `execute`
or `drain`. Diagnostic snapshots include the pending import plans and every unit's
Python frames. One-instruction advancement counts imported instructions in the
same total; it does not reset an activation's allowance. Close, cancellation and
hard limits unwind units and initialization records in arena order.

Imported Python errors use a temporary pin owned by the controller while a child
unit is released. The importer roots the error before releasing that pin, adds
its source location and passes it through the existing Python unwinder. A failed
pin preflight leaves the old frame owner intact until hard-failure cleanup. The
global imported-error lease map and exported release side channel are removed.
The pin's logical charge and transfer order remain identical to the baseline;
no root deduplication or new operation-metadata charge is introduced.

The [consolidation record](measurements/2026-10-22-execution-consolidation.json)
checks every field of the eight original resource observations and the shared
phase counts. Node/browser matrices exercise both drivers; focused tests inspect
paused imports, force collection, verify cache identity and relative parents,
retry failures, and interrupt error transfer with OOM/cancellation. Closed sessions
retain zero bytes, objects, roots, frames and external leases. The complete
measured console fixture grows from 316,222 to 334,337 uncompressed bytes across
the batch (+18,115), including 5,484 bytes for module scheduling. This is structural
and compatibility evidence; multi-task parking, host waiting, coroutines and
additional Python features remain separately planned.


## Parked execution ownership (INT-ASYNC-01)

`Execution.park()` transfers a paused execution's complete suffix of arena scopes
into a session-owned parked group. Its dynamic root visitors retain frames,
module plans, continuations, generators, exceptions and temporaries. Parking and
restoring allocate no logical pins or new roots and do not collect, execute
Python, replenish budgets or change the existing scope charges. Within each
owner the original root order and multiplicity are preserved. Collection visits
parked groups in parking order, followed by active scopes; work is charged to the
current active execution. Host cleanup collection never invokes a parked
execution's work/cancellation callback.

`advance(n)` restores a parked owner before running at most n verified
instructions. Only one activation can be active on an arena; other activations
must park first. Multiple parked owners remain subject to the arena's combined
byte/object/frame limits. Counters, import plans, active exceptions and output
leases retain their activation lifetimes across every pause. A failed admission
or allocation cannot destroy another parked owner's graph.

A parked execution may close in any order, including while another is paused.
Close temporarily restores its own scopes above the current paused owner and
unwinds only that group. No Python handlers/finalizers run on hard close or
cancellation. Running reentry, park during dispatch, and closing another parked
owner from a running host callback are rejected. Scope-owner tokens are local to
one arena, single-use and inaccessible from Python. A stale or foreign restore
fails without changing ownership.

The eight existing composed resource baselines remain exact when parking at each
instruction boundary. Forced collections and interleaved activations have their
explicit additional collection/work costs. `check_classes.py --parked` compares
independently compiled source through this owner transfer in Node and Chromium.
Persistent callback/event entry, native coroutine syntax, scheduling fairness and
awaited host replies require their own delivery slices.

O45 adds `execution-accounting/4`: a live function dictionary retains one
eight-byte function edge plus ordinary dictionary/key/value storage. The layout
is lazy. Abstract markers now live in that dictionary rather than a separate
function field. Functions without dictionary access or custom attributes retain
their accounting/3 layout. The eight composed cases do not access function
dictionaries and keep their existing observations. Replacement validates the
new graph before committing; failed transfers restore the prior dictionary.
