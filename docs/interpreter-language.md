# Independent interpreter language contract

INT-01 adopts Python 3.14 as the initial reference grammar and behavior oracle.
This is a staged implementation contract for a repository prototype, with
its [independent source profile](interpreter-source.md) now implemented. The executable reference cases live in
tests/fixtures/interpreter/language.json. The [conformance harness](interpreter-conformance.md)
compares implemented bytecode fixtures with CPython and reports the remaining
source/language cases as unsupported.

## Stages and feature decisions

| Area | Initial adopted behavior | Later or rejected |
| --- | --- | --- |
| Scalars | None, bool, arbitrary-precision int, binary64 float and Unicode str; Python truthiness and comparison rules. | Complex and bytes/buffer operations need separate cases. |
| Containers | Staged list, tuple and dict with Python identity, mutation, equality, key/hash and iteration behavior. | Sets, custom hash/equality and arbitrary user objects follow class support. |
| Expressions | Literals, names, arithmetic including floor division/modulo, boolean short-circuiting, comparisons, indexing/slicing and calls as their value operations land. | Unsupported operators fail explicitly; no JavaScript coercion. |
| Control flow | Assignment, expression statements, if/elif/else, while/for, break/continue and return, with defined evaluation order. | Comprehensions, generators, pattern matching and exception groups are deferred. |
| Functions | Positional/keyword binding, immutable literal defaults, lexical locals/globals/closures and recursion; normal error behavior. | Starred argument expansion, mutable/computed defaults, global/nonlocal mutation and annotations require later adoption. |
| Errors | Adopted builtin exception classes, raise, try/except/finally, propagation, unwinding and original source locations. | Arbitrary exception subclasses follow class support. |
| Modules | Explicit verified registry/roots, import caching and initialization, adopted relative imports; cycle behavior must be implemented or rejected clearly. | Dynamic import hooks, undeclared imports, runtime package installation and CPython extensions are rejected. |
| Library/host | A named builtin/stdlib subset sufficient for the corpus; output and explicit host capabilities. | Raw OS processes/sockets and implicit host file/network access are rejected. |
| Classes | INT-09 separately adopts identity, instances, lookup, inheritance/MRO, methods, descriptors and decorators. | Metaclasses/full reflection remain deferred. |
| Async | INT-10 separately adopts coroutine/awaitable semantics, scheduling, cancellation and async host bridges. | Threads/multiprocessing are not part of the initial client contract. |

Stage A establishes the VM and adopted values/operations under resource limits.
Stage B adds functions, exceptions, explicit modules and independent source
parsing. Stage C proves newly entered source in an offline browser. Stage D adds
adopted class/async application behavior. A feature is available only after its
implementation, negative tests and feature-tagged native/browser conformance land.

## Semantic invariants

Integers must preserve Python precision, including values beyond 2**53. A
resource-limited operation may raise an explicit budget error; it must not return
a rounded JavaScript Number or silently wrap a C integer. Floats preserve the
adopted signed-zero, NaN/infinity and division/error behavior. Bool is distinct
in transport even where Python numeric equality treats it as an integer.

Strings count/index Unicode code points, with no implicit normalization; astral
characters and combining marks require separate cases. Adopt slicing and lone-
surrogate transport deliberately. Explicit JavaScript compatibility String values
have a different API and do not change builtin str semantics.

Containers preserve aliases, iteration order and mutation rules. Hash/equality
must agree for supported dictionary keys, including bool/int equality and invalid
unhashable keys. Define evaluation order, short-circuiting and single evaluation
before lowering to instructions. Compare side effects and exception unwinding,
not only final values.

Function defaults are evaluated at definition time; the initial immutable-literal
restriction is a feature boundary, not permission to change that rule. Scope
resolution must distinguish local/global/closure cells. Import caching and
initialization retain module identity. Unsupported reflection, dynamic exports
or class behavior receive explicit errors.

## Source input, bytecode and host boundaries

Browser source execution requires our tokenizer, indentation handling, parser,
binding/compiler passes and verifier locally. Building acceptance bytecode with
CPython ast during VM development is temporary tooling; calling CPython, a
server, MicroPython, Pyodide or our JavaScript application compiler at execution
time never satisfies the independent-engine milestone.

Use our own versioned bytecode identity, source spans and supported-feature list.
Reject unknown/malformed bytecode before execution. Enforce deterministic work,
recursion/stack and accounted-allocation limits; the implementation/toolchain
decision must explain the difference between accounted allocations and host RSS.
Long primitive operations need budget checks too. Error/limit/cancellation
responses and host handles have explicit ownership and teardown behavior.

The worker holds execution state; the main thread owns DOM/events. Host output,
Fetch, virtual files and persistence are explicit capabilities with versioned
async messages. A worker is not a security sandbox for arbitrary same-origin
programs. The initial scope is a local application, not a hostile multi-user
execution service.

## Conformance and acceptance

Keep supported, rejected and deferred entries distinct by feature and target.
Reference cases record source plus expected output/error. CPython is an oracle
in tests only; the future independent engine must execute those cases itself.
The test harness must never report an unsupported feature as a successful engine
run by evaluating it through the oracle.

INT-02 selects toolchain and ownership with a measured vertical prototype.
INT-QA-01 builds tagged cross-engine/native/browser runners and bounded malformed-
input fuzzing before VM implementation broadens. Later PRs add numeric/Unicode,
mutation/aliasing, scope/default, argument, exception, import, GC/handle and budget
cases as features land. INT-WEB-01 must run source entered after deployment and
after offline reload, including errors, interrupting an infinite loop and restart.

INT-04 implements [core values and staged containers](interpreter-values.md)
under bytecode version 2. INT-06 adds [functions, closures and exception unwinding](interpreter-functions.md)
through version 3. INT-08 now compiles new source through the independent front end. INT-05 adds
[rooted allocation accounting and explicit host handles](interpreter-memory.md). Pure-int
true division and equal-size dictionary key mutation during iteration are
explicitly deferred. The published 0.2.0 assembler excludes this development engine.
