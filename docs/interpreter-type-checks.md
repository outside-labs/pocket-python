# Custom instance and subclass checking

The [O76 contract](interpreter-advertised-directories.md) supersedes the earlier
type/custom-metaclass and advertised namespace/base refusals in this checkpoint.

The later [O25/O26 metaclass attribute contract](interpreter-metaclass-attributes.md)
supersedes the earlier metaclass read/mutation refusals below. Live namespace,
layout and further construction protocols retain their separate boundaries.

The finite #123 slices adopt custom type checking against CPython 3.14.7.
The `type-checks.json` source corpus is executable reference evidence; stages
become implemented only after independent execution and ownership checks pass.
The explicit classes-source/1 profile and bytecode 5 remain the admission boundary.

| Stage | Contract |
| --- | --- |
| O9 | `isinstance(value, classinfo)` first accepts an exact actual-type identity. Otherwise custom `__instancecheck__` is selected through classinfo's actual type, bypassing class/instance shadows and ordinary attribute hooks. Classes bind the metaclass descriptor to the class and its actual metaclass; ordinary checker instances bind their actual type's descriptor. Inherited functions, static/class methods, properties and custom descriptors use ordinary frames. The returned value undergoes owned Python truth conversion. Native `type.__instancecheck__` bypasses custom checking, accepts real subtypes first and then uses the adopted advertised `__class__` lookup. |
| O10 | `issubclass(derived, classinfo)` selects `__subclasscheck__` through classinfo's actual type before validating derived. Custom hooks also run for self and real subtype relationships. Descriptor binding and result truth conversion follow O9. Native `type.__subclasscheck__` bypasses custom hooks and checks adopted actual type ancestry; advertised `__class__` does not make an ordinary instance into a class. |
| O11 | Native type checking helpers have canonical `method_descriptor` identities when unbound, and `builtin_function_or_method` identities when bound. Unbound `__name__` is bare and `__qualname__` is type-qualified; bound native methods expose their class receiver and have no Python-method `__func__` attribute. These values retain ordinary invocation and owned receiver lifetimes. Constructing `method_descriptor` instances raises TypeError. Broader method-descriptor metadata, binding APIs and builtin subclassing remain separately gated. |
| Base | Nested class-info tuples run left to right and stop at the first true result or error. An empty tuple returns false even for an invalid derived argument. Existing bool/int and exception ancestry remain adopted. |
| Future | Abstract class-like objects advertising `__bases__`, unions, generic aliases, custom metaclass attribute access, namespace preparation and mappings remain separately gated. Broader dir/vars/globals/locals/id and dynamic source admission remain under #123. Persistent scheduling, async syntax and host capabilities remain under #34. |

Hooks are ordinary special methods, not automatically class methods. A hook
defined on the checked class itself does not override its metaclass's hook.
An instance checker ignores an instance shadow. Explicit calls preserve the
hook's original result; the builtins convert it to bool. `NotImplemented` has
its adopted Python 3.14 truth error, rather than meaning default fallback.
Missing hooks use the native checking contract. Non-callable hooks, descriptor
binding failures and callback/truth errors propagate, including AttributeError
and StopIteration. A binding AttributeError never requests a native fallback.

The builtins and native type defaults require exactly two positional arguments
(including the receiver for native defaults). Signatures are validated before
callbacks. Native defaults require an adopted type receiver. Class-info tuple
nesting remains bounded at 32; callback recursion, work, instructions and arena
allocations share the activation limits. Non-type checkers without a custom hook
retain an explicit refusal if abstract `__bases__` lookup would be required.
Class and metaclass creation/mutation admit only the adopted special names.

Checked values, checker objects, pending descriptors, truth values and enclosing
tuple destinations must remain explicit roots. Binding, invocation and truth
conversion use the existing execution machine and ordinary owned frames. Every
instruction can be followed by collection. Cancellation, resource failures and
idempotent close release all logical owners without executing further callbacks.
The eight existing composed resource observations retain their exact accounting.

Acceptance requires independently compiled Node and Chromium source with drain
and instruction-boundary drivers, source diagnostics, collection, cancellation,
recursion/work/allocation failures, followed by installed offline execution and
Stop/Restart inside binding, checking and truth callbacks. Engine assets and
receipt hashes stay pinned. No dependency, host authority, publication or
deployment change accompanies these protocols.

Semantic anchors: Python's [custom checking protocol](https://docs.python.org/3.14/reference/datamodel.html#customizing-instance-and-subclass-checks)
and the pinned [CPython implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c).
The pinned executable decides the finite cases when later documentation differs.

## Accepted O9/O10 checkpoint

O9/O10 are implemented. The 74-case corpus has 71 adopted comparisons and three
explicit future refusals. Node and Chromium each pass drain and instruction-boundary
execution: 296 observations, including 288 measured zero logical teardown records.
Retained reports verify all 55 input hashes and the corpus hash. The full Node
suite passes 562 tests, including every-instruction collection, cancellation,
idempotent close, callback source frames, bounded tuple nesting and real recursion,
work, instruction and allocation failures in binding, checking and truth phases.
The eight composed resource observations retain their original exact accounting.

Installed-wheel offline acceptance passes 599 program comparisons and 49
acceptance groups with 111 Stop/Restart cycles. Newly entered source composes
metaclass checking, ordinary checker objects, descriptors, truth conversion,
native defaults and suspended generators after offline reload. Binding, checker
and truth failures retain Python diagnostics. The waiting class-to-core update
retains its reduced authority. The earlier construction and attribute corpora
also adopt their formerly refused metaclass instance-check cases.

Build `python -m examples.interpreter_type_checks` for the composed console. The
[payload/source record](measurements/2026-10-27-type-checks.json) verifies all 38
files and receipt hashes of its 609,290-byte payload, including deterministic
compression and an identical fresh rebuild. The wheel and source distribution
pass the repository's isolated installation checks. The payload is a local
example measurement; no timing, device or package compatibility claim follows.

#123 and #33 remain open for namespace/identity reflection, ordering, builtin
layouts, further metaclass protocols and dynamic source admission. Persistent
execution, native coroutines, host await and event ownership remain under #34.
No publication or deployment accompanies this delivery.

## Native checking callable reflection

O11 corrects the native checking helpers' unbound/bound type identities and bare
unbound names, and prevents bound native methods from exposing a Python-method
`__func__`. Checked instance/subclass results and descriptor invocation are
unchanged. Canonical reflected descriptor types support the adopted type
relations; direct descriptor construction raises Python TypeError.

The expanded 86-case matrix has 83 adopted comparisons and three explicit
refusals. All four Node/Chromium drain/step combinations pass: 344 observations
and 336 measured zero logical teardown records, with all 55 input hashes and the
corpus hash verified. The full Node suite passes 575 tests, including temporary
bound class-owner collection and the eight unchanged composed resource cases.

Installed-wheel offline acceptance passes 607 program comparisons and 50 groups
with 111 Stop/Restart cycles. Newly entered source checks callable identities and
metadata; native descriptor construction and missing `__func__` retain their
Python errors. The updated [payload/source record](measurements/2026-10-27-type-check-reflection.json)
verifies the complete 38-file, 610,170-byte example, all receipt hashes and an
identical fresh rebuild. Isolated wheel and source-distribution checks pass.
These are finite callable reflection claims; broader descriptor APIs, ordinary
namespace/identity reflection and async retain their existing separate scopes.
