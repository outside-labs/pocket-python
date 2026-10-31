# Explicit native protocol calls

The native-call portion of O90 in #123 gives the already adopted implicit
protocols explicit bound, unbound and rebound entry points. Property diagnostic
and accessor-copy completion is the other O90 portion. The
[source matrix](../tests/fixtures/interpreter/native-protocols.json) records the
pinned CPython 3.14.7 result for each admitted signature and retained boundary.
All 597 adopted cases pass the six Node/Chromium drain, stepped and parked
drivers: [3,582 source observations](measurements/2026-10-30-native-protocols.json),
with zero teardown failures. The 15 retained boundary cases receive no adoption
credit. Focused semantic/lifetime regressions and the composed resource counters
pass locally; installed offline composition runs in CI.

| Family | Explicit contract |
| --- | --- |
| Python functions | The native call wrapper forwards positional and keyword arguments to the existing binder. Native get retains its positional-only receiver/optional-owner signature and creates the same owned method as ordinary descriptor binding. Function dictionary shadows retain ordinary precedence. |
| Python methods | Native get returns the original method. Native call preserves its bound receiver and forwards arguments. The reflected method constructor and native new accept an adopted callable and non-None receiver. Equality compares callable values and receiver identity; hash uses the callable's owned hash and the receiver's generic identity hash, including nested methods and callable objects. |
| Native callable layouts | Builtin functions, bound native methods, method wrappers, method descriptors, wrapper descriptors and class-method descriptors expose their own native call wrappers. Recursive rebinding retains the original operation and receiver. Equality and hashing use a shared canonical operation identity, so ordinary and explicitly bound aliases agree. |
| Numeric slots | Existing conversion, unary, arithmetic, comparison, power and hashing signatures operate on native values and builtin subtype payloads. Explicit int/float/complex comparisons preserve their own NotImplemented rules. Native ternary-power methods preserve modulus validation and differ from the implicit reflected dispatch. |
| Containers and iterators | Existing length, truth, iteration, next, membership, item access/mutation, comparisons, repetition and admitted in-place operations reuse their owned execution paths. Explicit base operations bypass subtype overrides. Index, key/hash/equality and contained-value callbacks run in ordinary frames. Broader iterable/mapping forms remain with their original API owners. |
| Descriptors and metadata | Native namespaces return canonical own descriptors before inherited object defaults. Bound/unbound/rebound calls validate actual receiver layouts before signatures, with pinned wrapper/method error forms. Owner identity, documents, names, qualification and text signatures retain native read-only behavior. Text signatures are generated with the namespace documents from the pinned oracle. |
| Display | Explicit integer, boolean, string and byte displays use their already admitted representation paths. Float/complex/container/callable/default object display families still requiring #127 retain that boundary. |

`NATIVE_PROTOCOL_KEYS` is the finite explicit slot inventory. It does not admit
an unrelated library API because its name appears in a native namespace.
Range hashing and general reversed/constructor forms retain #116; user-key set
algebra and broader buffer forms retain #117; native iterator length-hint/state
APIs retain #120; generic aliases retain #125; serialization retains #126;
numeric floor/ceil/truncation helpers retain #184. Code/function constructors
retain O91. Context, buffer and async protocols retain #121, #117 and #34.

Native descriptor lookup can materialize one canonical callable without first
enumerating a complete type dictionary. Later dictionary materialization stores
the same value. All new method/hash/comparison continuations declare and charge
their retained operands. Parked collection, cancellation, close and ordinary
execution limits use the enclosing execution. The eight existing composed
resource observations remain unchanged, with no storage/accounting revision,
dependency or host grant change.

References: [pinned Python method get/call/equality/hash](https://github.com/python/cpython/blob/v3.14.7/Objects/classobject.c),
[pinned native descriptors and method wrappers](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c),
[pinned wrapper validation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
