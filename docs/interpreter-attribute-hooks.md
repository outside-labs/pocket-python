# Instance attribute hooks and advertised classes

The next finite #123 slices use CPython 3.14.7 as their executable reference.
`attribute-hooks.json` records 92 source cases. Reference expectations do not
establish implementation; each stage is enabled only with independent execution
and its ownership tests. Classes remain explicit in classes-source/1, bytecode 5.

| Stage | Contract |
| --- | --- |
| O6 | Ordinary instance reads select `__getattribute__` through the actual type's C3 MRO. Only `AttributeError`, including descriptor-binding errors, enables type-selected `__getattr__`; its own failure is propagated once. The default read retains data-descriptor, instance and non-data-descriptor precedence. `object.__getattribute__` bypasses custom hooks and never invokes the missing-attribute fallback. Functions, static/class methods and descriptor-valued hooks bind through ordinary owned frames. Instance shadows do not replace implicit hooks. |
| O7 | Writes/deletes select `__setattr__`/`__delattr__` through the actual type, ignoring instance shadows. Implicit mutation ignores the hook's return value; explicit calls preserve it. Direct `object.__setattr__`/`object.__delattr__` bypass custom hooks while retaining existing properties, descriptors, bounded mutation and rollback on allocation failure. Missing/erroring mutation never invokes `__getattr__`. |
| O8 | Ordinary instance `__class__` reads obey custom hooks and class descriptors/values; the native default otherwise returns the actual type. `type(value)`, implicit protocols and successful actual-type checks bypass advertised identities. `isinstance` traverses bounded nested class-info tuples in order, checking the actual type before an advertised class for each valid candidate. `AttributeError` in the advertised read means false; other exceptions propagate. `super` first accepts real instance/subtype relationships, then tries an advertised class. A missing/invalid/unrelated advertised class produces `TypeError`; other lookup failures propagate. |
| Future | Custom metaclass attribute hooks, namespace preparation, class keywords, `__init_subclass__`, `__mro_entries__`, builtin layouts, `__dict__`/mapping proxies, dir/vars/globals/locals/id and dynamic source admission retain separate contracts. Async scheduling and host capabilities remain under #34. |

The existing bounded string-name contract applies: at most 256 JavaScript code
units, no identifier normalization for reflective calls, and no private-name
mangling of supplied strings. Unsupported special attributes retain their
explicit refusal before custom hook effects. Signatures and name types are
validated before callbacks. Native object defaults in this slice accept ordinary
user instances; builtin layouts, class receivers and their mutation protocols
remain separately gated. `__class__` assignment remains refused.

Ordinary syntax and getattr/hasattr share the read pipeline. The optional
reflection wrappers suppress only a final `AttributeError`, after the missing
hook has had its opportunity. An explicit `a.__getattribute__(name)` is an
ordinary attribute read followed by a call; it is not the implicit dispatch
operation. Construction, arithmetic, iteration, truth/length, hashing and other
special protocols continue to select slots through the actual type, bypassing
these instance hooks. Class-object reads keep their adopted metaclass behavior.

All receivers, names, pending values, fallback arguments, advertised classes,
super types and outer destinations must be explicit operation/continuation
roots. Descriptor binding and hook invocation use the common execution machine,
with collection between instructions, shared recursion/work/allocation limits,
source-located errors, cancellation and idempotent close. A fallback does not
run on cancellation or resource failure. Logical teardown must reach zero;
the eight existing composed resource observations retain their exact values.

Acceptance requires Node and Chromium source execution with drain/step drivers,
resource interruption and callback lifetime checks, followed by installed offline
console execution and Stop/Restart inside hooks. Engine assets and receipt hashes
stay pinned. No dependency, service, host grant, publication or deployment changes.

Semantic anchors: Python's [attribute-access model](https://docs.python.org/3.14/reference/datamodel.html#customizing-attribute-access),
[special-method lookup](https://docs.python.org/3.14/reference/datamodel.html#special-method-lookup),
[isinstance](https://docs.python.org/3.14/library/functions.html#isinstance) and
[super](https://docs.python.org/3.14/library/functions.html#super). The pinned
executable reference decides these finite cases if later documentation differs.

## Accepted evidence

O6/O7/O8 are implemented. All 92 recorded cases pass Node and Chromium with
drain/step drivers: 86 adopted comparisons and six explicit future refusals per
combination, totaling 368 observations and 352 measured zero logical teardown
records. Reports verify their source/corpus/driver hashes. Dedicated tests cover
original fallback snapshots, source frames, every-instruction collection,
cancellation/close and real recursion/work/allocation failures. The full Node
suite passes 481 tests, including eight unchanged composed resource observations.

The installed offline console passes 551 program comparisons and 47 acceptance
groups with 105 Stop/Restart cycles. New source composes hooks, descriptors,
generators, type relations and super after offline reload. User callback errors
retain their source diagnostics; deferred reflection and metaclass hooks refuse
before their callback/body effects. The class-to-core update retains its reduced
authority. Native type identity, actual checks and lexical class cells remain
independent of advertised identities.

Build `python -m examples.interpreter_attributes` for the composed console. The
[payload/source record](measurements/2026-10-27-attribute-hooks.json) verifies all
38 files and receipt hashes for its 604,860-byte payload, with deterministic
compression and an identical fresh rebuild. This measures the complete local
example payload; it makes no timing, device or package claim.

The later [type-checking contract](interpreter-type-checks.md) adopts custom
metaclass instance/subclass checking through separate implicit slots. It does
not widen metaclass ordinary attribute access or namespace preparation.

The later [O15–O17 reflection contract](interpreter-reflection.md) adopts custom
instance `__dict__` reads, `vars` and actual-type/metaclass `__dir__`, alongside
owned object IDs and optimized-function snapshots. Ordinary dictionary storage,
class mapping proxies, default directories and live module/class/global
namespaces remain deferred. The earlier directory refusal in this corpus is now
an adopted O17 comparison.
