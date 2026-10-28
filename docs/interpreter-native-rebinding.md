# Explicit native descriptor rebinding

O33/O34 continue #123 and #33 with a finite CPython 3.14.7 contract.
`tests/fixtures/interpreter/native-rebinding.json` pins the reference behavior.
Reference-only results do not establish independent execution.

| Stage | Contract |
| --- | --- |
| O33 | Bound and unbound `method_descriptor.__get__(target, owner=None, /)` bind the adopted `property.getter/setter/deleter` and `type.__instancecheck__/__subclasscheck__` descriptors. A non-None target must have the descriptor's actual native receiver layout. Binding produces a fresh native callable retaining the original descriptor and target. |
| O34 | Bound and unbound `wrapper_descriptor.__get__` bind the adopted `type.__getattribute__/__setattr__/__delattr__`, `property.__get__/__set__/__delete__`, `staticmethod.__get__`, `classmethod.__get__`, `function.__get__`, and the two native descriptor `__get__` wrappers themselves. Binding produces a fresh native method-wrapper with the same receiver rules. |

Both APIs return the original descriptor when target is None and owner is
non-None. Both target and owner None raise TypeError. Owner is otherwise ignored,
including arbitrary adopted false-valued objects. These finite descriptors do
not use CPython's METH_METHOD convention. Missing, excess and keyword arguments,
wrong descriptor receivers and wrong target layouts raise TypeError. Validation
uses actual types, including type-derived metaclasses; advertised `__class__`,
custom checking, attribute-read, equality and truth hooks never run during binding.

Unbound `__get__` values are canonical wrapper descriptors with `__class__`,
`__name__` and `__qualname__`. Bound binding handles are fresh method-wrapper
values with `__self__` and no `__func__`. Bound results retain the existing
native method versus method-wrapper identities, metadata, equality and hashing.
Binding never executes the eventual callback. Invocation uses ordinary owned
frames, source errors and shared instruction/work/arena/recursion budgets.
Detached handles retain their descriptor, receiver, functions, defaults and
cells through collection and parked execution. Cancellation, close and actual
allocation failures must release every logical owner. Preserve the eight
composed resource observations.

The operations belong to classes-source/1 and bytecode 5. Core-source/1 and
legacy bytecode keep their existing admission and runtime boundaries. The
allowlist above does not adopt all builtin method descriptors, wrapper layouts,
descriptor documentation/owner reflection, live dictionaries or native type
construction. Native coroutine/await and host adapters remain under #34.

Acceptance requires the pinned matrix in Node/Chromium drain, instruction and
parked modes, focused ownership tests and installed-wheel offline source with
reload, callback diagnostics, Stop/Restart and a waiting reduced-profile update.
No dependency, host grant, publication or deployment is included.

Primary reference: CPython v3.14.7
[descriptor implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c),
especially `method_get`, `wrapperdescr_get` and `descr_check`. The executable
reference resolves argument and patch-level details.

O33 is implemented. Its adopted source cases cover property copies and native
type checks, including ignored custom metaclass checking hooks. Focused lifecycle
tests retain detached bindings and accessor cells through parked collection,
cancellation, idempotent close and actual arena exhaustion.

O34 is implemented over the stated allowlist, including recursively rebound
binding wrappers. The complete 96-case matrix includes original callback
tracebacks, actual metaclass layouts, immutable type mutation errors, cross-kind
receiver rejection and two retained documentation/live-namespace refusals.
Additional lifecycle checks retain rebound function defaults/cells, lazy
generators and intermediate binding handles through parked collection and
interruption. Explicit native rebinding remains unavailable in the core profile.

All 96 cases (94 adopted comparisons and two refusals) pass Node/Chromium drain,
instruction-boundary and parked execution: 576 observations with zero logical
teardown. The compatibility inventory contains nine representative rebinding
probes. The [descriptor console](../examples/interpreter_native_rebinding.py)
composes rebound copies, native type checks, closures and generators. Installed
wheel acceptance covers offline reload, original callback diagnostics,
Stop/Restart and a waiting core-profile update. The
[payload record](measurements/2026-10-28-native-rebinding.json) records the
38-file, 671,693-byte example and source/compatibility/offline evidence. An
independent rebuild produces identical bytes; this is no performance claim.
