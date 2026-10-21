# Special-method dispatch

INT-09 C3 extends the explicit classes-source/1 profile through individually
adopted protocols. Additive support keeps verified bytecode 5 and the language
profile; the engine fingerprint identifies the changed compiler/runtime build.
Behavior-changing incompatibilities require an explicit version decision.

## Ordered protocol work

| Step | Adopted scope | Required next evidence |
| --- | --- | --- |
| Call | __call__ and callable() | Type lookup, descriptor binding, argument forwarding, original exceptions, bounded call chains and offline source. |
| Length/truth | __len__, __bool__ | Suspended builtin/conditional/loop operations; actual bool results, nonnegative bounded integer lengths and fallback precedence. |
| Formatting | __repr__, __str__ | String validation, print/str/repr sequencing, recursive formatting and source errors. |
| Indexed objects | __getitem__, __setitem__, __delitem__ | Single evaluation, key/value ownership, mutation results, slices and failures. |
| Iteration/membership | __iter__, __next__, __contains__ | Suspended loops, StopIteration handling, fallback order, cancellation and teardown. |
| Equality/hash | __eq__, __ne__, __hash__ | NotImplemented, subclass/reflected priority, automatic hash disabling and dictionary invariants. |

These are protocol milestones, without a release promise. __new__, custom
attribute lookup/mutation, arithmetic overloading, metaclasses and reflective
hooks retain separate gates. INT-09 stays open beyond the first call milestone.
Async/host integration, later C/Rust WebAssembly and alpha publication remain
separate queue items.

## Call contract

An instance call resolves __call__ through its type's C3 MRO. It bypasses instance
storage. Explicit obj.__call__ access remains ordinary attribute lookup and can
observe an instance shadow that obj() ignores. Replacing, adding or deleting a
type slot affects subsequent calls; retained bound methods keep their old function.
Calling a class retains the existing constructor behavior; this stage adds no
metaclass call overrides.

The selected type value uses the adopted descriptor binding: Python functions,
retained bound methods, static/class methods, properties and custom __get__ hooks.
Binding can run a Python frame and then return the callable to invoke. Forward the
original positional/keyword arguments after binding, without reevaluating them.
Missing slots, non-callable values and invalid arguments raise Python TypeError;
binding and callback exceptions propagate unchanged. Call results use ordinary
function return semantics, including None, containers and retained object identity.

callable() accepts one positional argument and inspects the available call slot.
It never binds a descriptor or executes user code. A present None/non-callable
slot still makes a user instance appear callable, while invocation fails. Instance
fields do not change this query. Classes, functions, builtins, bound methods and
static-method wrappers are callable; a class-method wrapper itself is not.
This builtin is added only to the explicit classes profile.

The reference behavior follows [implicit special lookup](https://docs.python.org/3.14/reference/datamodel.html#special-method-lookup),
[callable instances](https://docs.python.org/3.14/reference/datamodel.html#emulating-callable-objects)
and [callable()](https://docs.python.org/3.14/library/functions.html#callable).
The corpus pins CPython 3.14.7; live documentation may describe a later patch.

## Shared policy and resumable execution

One immutable policy controls class definitions, direct special-attribute access,
mutation and implicit protocol admission. Structural metadata retains its scoped
read/immutability rules. Compiler and class runtime must consult the same policy;
adding a method must not require separate name allowlists to stay synchronized.

Implicit dispatch plans a type lookup and descriptor binding independently of
ordinary instance lookup. The VM owns pending binding/invocation continuations
and runs Python callbacks in its existing frames. ValueRuntime remains synchronous
for adopted primitive values; future truth/iteration/format operations will use
this dispatch mechanism when they need Python callbacks and result validation.

Binding continuations retain the original receiver, arguments, keyword values,
outer completions and descriptor graph as explicit arena roots. Constructor,
notification, ignored setter results and ordinary returns share the same completion
path. The dispatcher is iterative. Python frames and implicit callable-instance
redirects respect the execution depth limit. Unwrapping retained bound methods
and native static wrappers stays work-bounded without adding Python-frame depth. Work,
cancellation, memory limits and original source locations continue to apply.
Close must leave zero logical bytes/roots/frames. This accounting does not claim
zero physical retention or a hard JavaScript-process memory ceiling.

Nested descriptor-valued setters/deleters/name-notification hooks remain the C2
refusals. Supporting descriptor binding for __call__ does not adopt those other
protocols. New host authority, by-value object transport and identity hashing are
outside this milestone.

## Delivery and verification

The original 63-program matrix in tests/fixtures/interpreter/special-calls.json
contains 41 call cases, 14 callable-query cases and eight explicit future-protocol
refusals. Validate all recorded stdout/error types with check_classes.py reference
mode before widening source admission. Source reports identify implemented stages
and any omitted stages; reference-only success never claims engine support.

Deliver focused PRs for this contract/reference matrix, the shared policy, call
execution, callable queries and offline-console acceptance. Keep the existing
39 class, 34 private-name, 69 descriptor and core/library matrices. Add resource,
exception-location, pending-root and teardown tests as each implementation lands.


## Delivered call milestone

The shared policy and iterative call dispatcher implement the adopted call surface
in classes-source/1. All 63 source cases run in Node and Chromium: 55 CPython
stdout/error-type comparisons and eight explicit future-protocol refusals.
The default core profile retains its source and builtin boundaries.

The Counter/StepCounter example now invokes inherited __call__ and reports
callable(counter). Twenty source comparisons and nine browser acceptance groups
cover callback and binding failures, a newly entered callable decorator with a
property-based call binding after offline reload, busy call/body binding Stop
with three fresh Restarts, and a waiting class/library-to-core update that removes
callable() along with class source and the optional library. Logical teardown,
owned temporaries, redirect-cycle depth, real OOM and cancellation have dedicated
tests. INT-09 remains open for the later protocol milestones in the table.
