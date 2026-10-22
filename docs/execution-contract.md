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

## Current owner map

| Owner | Roots and lifetime | Transfer / failure rule |
| --- | --- | --- |
| execution scope | Code pool, globals, inherited exception, non-module builtins and temporaries. | Enter before allocation; leave after all Python frames. Temporaries bridge popped operands/results until destination roots are installed. |
| Python frame scope | Callable; local cells; active exception; block stacks; control iterator, pending value, caught and previous exceptions; completion bases, instance and roots. | New frame is rooted before binding allocates cells. Return/raise/class transfer first places the value, namespace and continuation roots in execution temporaries, then leaves the frame. |
| pending operation | Named operands and closed continuation. Existing completion `roots` includes copied ancestor roots. | A callback frame retains its completion. Dispatch first adds operands to temporaries, before planning can allocate. Do not discard ancestors during extraction. |
| class notification | Type and original namespace entry snapshot. | Retain all snapshot values before each callback; mutation does not alter which entries are notified. |
| module initialization scope | New environment/module, cache entry, active import chain. Each recursive module execution currently has its own execution/frame scopes. | Mark ready and bind parent on success. Remove failed initializer from cache, keep already observable effects, pop chain and unwind in LIFO order. |
| imported Python error lease | Exception and context/trace graph while native import stack unwinds. | Importer roots the value before releasing the lease and appending its own source location. Remove the bridge only after machine-owned import errors replace it. |
| module session | Pinned cache, shared builtin objects, registry bytes and output leases. | Shared instruction/work/output totals across imports. Finish releases transient output; close releases cache/registry ownership. |
| retained result lease | Result plus its transitive value graph. | Pin before leaving final frame; caller explicitly releases it. No unleased VM object is exported in diagnostics. |
| memory preflight | Proposed allocation children or replacement layout plus existing roots. | Failed resize restores the old value; failed pin keeps the old owner. Cleanup releases roots even after quota/cancellation failure. |

Active arena scopes are LIFO. A static pin is an immutable value snapshot; it is
not a substitute for the mutable frame/control graph of a paused execution. The
first stepping driver supports a single owned activation. Multiple parked tasks,
host waiting and coroutine construction need the later scheduling contract.

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
