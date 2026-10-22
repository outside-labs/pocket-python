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

The [bounded formatting contract](interpreter-formatting.md) and its pinned
reference corpus define the next exact repr/str slice. Float/container/default
displays and format specifications retain their separate work package.

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
for adopted primitive values. Length/truth now use VM operations and completions;
future iteration/format operations will use the same callback/result foundation.

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
in classes-source/1. The original call milestone ran all 63 source cases in Node
and Chromium: 55 CPython comparisons and eight future-protocol refusals. Length/
truth admission now promotes two of those cases to adopted comparisons.
The default core profile retains its source and builtin boundaries.

The Counter/StepCounter example now invokes inherited __call__ and reports
callable(counter). Twenty source comparisons and nine browser acceptance groups
cover callback and binding failures, a newly entered callable decorator with a
property-based call binding after offline reload, busy call/body binding Stop
with three fresh Restarts, and a waiting class/library-to-core update that removes
callable() along with class source and the optional library. Logical teardown,
owned temporaries, redirect-cycle depth, real OOM and cancellation have dedicated
tests. INT-09 remains open for the later protocol milestones in the table.


## Length and truth contract

The next C3 milestone adopts __len__ and __bool__ through the same type-level
lookup and descriptor binding used for __call__. Instance shadows affect direct
attribute access, while implicit len(), bool(), not, conditions, conditional
expressions, and/or and while use the type's current MRO. Class objects themselves
retain their ordinary true value; metaclass protocols remain outside this profile.
A direct method call returns its raw result without implicit protocol validation.

Normal length dispatch requires a native integer result (bool is accepted as 0/1),
rejects negative values with ValueError, and rejects values above 9223372036854775807
with OverflowError. This signed-64-bit positive maximum is a virtual-machine
contract shared by Node and browsers, independent of JavaScript safe-number
limits and the host pointer size. It matches the pinned 64-bit CPython reference.
Returning a custom __index__ object remains outside admission until that protocol
has its own contract. Other result types raise TypeError.

Truth dispatch first selects __bool__, which must return an actual bool; a bad
result or an exception from its body does not fall back to length. With no bool
slot, __len__ uses the normal validated length result and zero means false. With
neither slot, instances are true. A present non-callable/None slot raises TypeError.
Inherited static/class methods, retained methods, properties, custom descriptors
and callable slot objects use ordinary binding and invocation semantics.

The reference has an additional binding distinction: AttributeError while binding
an existing __bool__ descriptor treats that binding as missing. Its optional
__len__ lookup then truth-tests the raw returned value; it does not take the normal
validated-length path. A missing optional length binding (including a binding
AttributeError) means true. Errors from an invoked body still propagate. The
93-program matrix records this separately, including raw invalid length values,
a result with its own truth protocol, and direct length-binding errors. This
behavior is confirmed against the pinned CPython source and executable reference;
no blanket exception suppression applies to other operations.

The VM must suspend the operation while a getter or callback runs, then validate
and resume the original expression, branch or loop. Preserve operand identity,
single evaluation and short circuiting; while else/break/continue, returns and
finally keep their control-flow behavior. Pending receivers, operands and outer
completions remain explicit arena roots. Recursion/redirect depth, work, memory,
cancellation, original error locations and zero logical teardown remain required.
Primitive ValueRuntime operations stay synchronous and do not run user callbacks.

References: [truth testing](https://docs.python.org/3.14/reference/datamodel.html#object.__bool__),
[length](https://docs.python.org/3.14/reference/datamodel.html#object.__len__),
[len()](https://docs.python.org/3.14/library/functions.html#len) and the pinned
[CPython type slots](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

### Length/truth delivery

1. Adopt this contract and the 93 authored reference cases: 32 length, 39 truth,
   16 control-flow and six future-protocol cases. Reference-only reports make no
   independent-engine execution claim.
2. Implement resumable builtin/unary, branch and loop completions together with
   source differential, malformed-result, root/exception and resource checks.
   Keep the existing call, descriptor, class and primitive matrices green.
3. Extend the console with newly entered length/truth source after offline reload,
   errors, pending-binding/body Stop/Restart and waiting profile updates.

Additive support keeps classes-source/1 and bytecode 5; engine fingerprints identify
the changed runtime. Formatting, indexing, iteration and equality/hash remain
separately gated. This milestone does not close INT-09 or authorize publication.


### Delivered length/truth execution

Resumable unary tasks now drive len(), bool(), not, conditional branches/jumps
and while tests. Protocol results and optional-binding recovery use explicit
completions through ordinary VM frames. The primitive runtime stays synchronous.
All 93 authored cases execute in Node and Chromium: 87 CPython comparisons and
six future refusals. The original 63 call cases now contain 57 comparisons and
six refusals; the 39 class cases include their adopted length example.

Focused checks cover temporary receivers and expression operands, standalone
verified-bytecode unary operations, source traceback boundaries, active exception/
finally behavior, Python recursion, native binding cycles, eighty native wrappers,
instruction/work/cancellation limits, real callback OOM and zero logical teardown.
The core-source default and explicit host/library grants remain unchanged. Console
acceptance is the next focused delivery step; INT-09 stays open for later protocols.


### Length/truth console checkpoint

The class console now demonstrates __len__/__bool__ alongside callable methods.
Twenty-six CPython source comparisons plus eleven Chromium groups exercise type
lookup, result validation, optional binding fallback, short circuiting, loops and
operator-library truth/not_. A newly entered private-state queue runs its own
length, property-bound truth and while/else after offline reload. Original source
locations, invalid results, five Stop/Restart cycles through calls/length/truth/
pending bindings, and a waiting class/library-to-core update are accepted. The
reduced profile retains primitive len()/bool() while refusing class source and
removed imports. The output-only host boundary and local static GETs remain.

C3 length/truth is complete for this adopted matrix. Formatting, indexed objects,
iteration/membership and equality/hash remain future milestones, so INT-09 stays
open. This checkpoint adds no package publication or public deployment.
