# Matrix multiplication and ternary power

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O89 of #123 completes the arithmetic dispatch inventory over the already adopted
values. The [source matrix](../tests/fixtures/interpreter/arithmetic-dispatch.json)
uses CPython 3.14.7 as its reference. All 51 cases pass Node/Chromium drain,
stepped and parked execution: [306 observations](measurements/2026-10-30-arithmetic-dispatch.json),
with zero logical teardown failures.

| Entry | Contract |
| --- | --- |
| `left @ right` | Multiplicative precedence and left associativity; operands evaluate once, left to right. Actual-type `__matmul__` and `__rmatmul__` lookup bypasses instance shadows and attribute hooks. An overridden reflected method on a strict subtype has priority. Equal types do not try the reflected method. |
| `target @= right` | `__imatmul__` may return any owned value. Missing or NotImplemented results fall back to ordinary/reflected dispatch. Attribute receivers and subscription receivers/keys evaluate once; failed operations do not assign a replacement. |
| `pow(base, exp, mod)` | The existing positional/keyword signature retains argument evaluation order and exact owned operand identities. `__pow__` and Python 3.14 `__rpow__` receive the modulus unchanged. An omitted or None modulus uses the two-argument slots. Subtype priority, equal-type suppression and arbitrary result rules match binary dispatch. |
| Native power slots | Inherited native numeric slots use their existing payload/signature contract. A user-valued modulus is passed to source callbacks without conversion. It does not receive its own `__pow__`, `__rpow__` or `__index__` callback; a distinct native numeric modulus slot can still perform the native operation. |
| Failure and mutation | Numeric slot eligibility and reflected priority are fixed before callbacks; later method lookup observes mutations to eligible types. Binding AttributeError is an optional-lookup miss for ordinary/reflected arithmetic; method-body exceptions propagate. In-place binding exceptions propagate. None methods are called and raise TypeError. Exhausted dispatch raises TypeError. |

Matrix multiplication adds no primitive matrix values. Primitive operands fail
with TypeError in both source profiles. Versions 2/3 of the bytecode format do
not gain matrix opcodes; modern independently verified source bytecode does.
Metaclasses and builtin payload subclasses use the same owned dispatch paths.
The O83 inventory now includes the three matrix slots, for 75 names.

The operand and charged continuation root inventory owns every operand across
binding, callback execution, parked collection, cancellation and close. Slot
eligibility adds scalar state; subtype-priority lookup retains the operands and
the fetched reflected candidate under the existing continuation accounting.
Owned class lookups, candidate comparison and truth conversion preserve their
callback effects. No storage layout or accounting revision is needed.
Callback recursion, instruction/work limits and allocation failures
share the enclosing execution's limits. Installed offline source acceptance
includes successful matrix and ternary-power cases. Primitive complex-power and
numeric recovery remain #184; native entry-point completion is O90.

References: [pinned arithmetic and ternary slot selection](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c),
[pinned source slot binding and reflected ternary power](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
