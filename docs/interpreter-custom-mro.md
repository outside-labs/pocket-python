# Custom MRO construction

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O82 of #123 executes inherited and descriptor-backed metaclass `mro` callbacks
on the existing owned machine. Source definitions, dynamic type creation and
later mutation/deletion of the metaclass method use the same construction path.
Mutating a method affects subsequent calls/constructions; it does not recompute
an already installed hierarchy. Base reassignment and descendant transactions
remain O88.

| Phase | Contract |
| --- | --- |
| Provisional class | Copy and validate the namespace and bases first. During the MRO callback, `__mro__` is None, while name, bases, primary base and namespace reflection follow the actual metaclass namespaces. The containing class name remains unpublished. |
| Callback | Look up `mro` on the actual metaclass, bypassing a class namespace shadow and class read hooks. Bind descriptors to the provisional class. Errors retain their callback frames and earlier effects. |
| Result | Consume the returned iterable through owned iteration, including iterator length hints. Require a nonempty sequence of actual types with compatible native layouts. Duplicates and compatible unrelated classes retain pinned behavior; default C3 consistency is not imposed on custom results. Native type storage follows solid bases even when a custom MRO omits or reorders `type`; constructor selection and native descriptor receiver checks retain that distinction. Existing base/MRO/sequence limits apply. |
| Installation | Validate the complete result, resize its owned MRO edges transactionally, and install it before class-cell binding, descriptor notifications, subclass initialization and metaclass initialization. Validation failures leave escaped provisional types with `__mro__` None and do not publish the class name. |
| Reflection and dispatch | Attribute lookup, actual ancestry checks, super and hierarchy reflection use the installed sequence. The primary base and original bases remain independent of custom ordering. |
| Native bypass | `type.mro(cls)`, including bound/rebound descriptors, recomputes a fresh default C3 list from actual bases. It may fail on bases whose custom hierarchy was accepted. It never invokes the custom callback. |
| Reentrancy | Independent nested constructions retain their own pending types. Recursive construction/iteration shares recursion, work, memory and cancellation limits. No pending name is published on failure. |

The [32-case source matrix](../tests/fixtures/interpreter/custom-mro.json) is
pinned to CPython 3.14.7 and registered for Node/Chromium drain, stepped and
parked drivers. Focused tests collect during callbacks/iteration, interrupt
execution and verify zero logical teardown. Existing MRO storage already charges
eight bytes per hierarchy entry; accepted replacement uses the same accounting
and atomic arena resize, without a new representation or accounting revision.
The fixed class header holds construction flags. Slots/builtin layouts and base
reassignment remain O84–O88; raw native layouts and executable objects are not
admitted.

References: [pinned MRO invocation, validation and native implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
