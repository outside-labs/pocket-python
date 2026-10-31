# Property directories

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O53 continues #123 and #33 against pinned CPython 3.14.7. The independently
authored `property-directories.json` matrix separates reference observations
from engine adoption. O53 is implemented through the existing charged native
directory merge and owned sorting machinery.

`dir(property_value)` returns a fresh sorted list of the pinned property and
object namespace names. `object.__dir__(property_value)` and the native bound
`property_value.__dir__()` return their unsorted insertion order, deduplicating
repeated names. Native descriptor binding, explicit object attribute lookup,
callable metadata and retained callers preserve the exact property receiver.
Arity and keyword errors raise TypeError; directory mutation raises
AttributeError.

Names describe reflection availability. Collection does not read accessor
attributes, call accessors, resolve the property's lazy name, inspect its
documentation or compute its abstract flag. Arbitrary name/document values,
callback-bearing accessors, accessor copies, automatic name notification and
class/metaclass mutation cannot contribute names or effects. Listing native
methods does not adopt their APIs.

The original property, accessors and arbitrary metadata remain owned during
charged collection and sorting, including detached callers and cycles through
function dictionaries. Fresh lists have independent mutable storage. Parking,
collection, cancellation and idempotent close leave zero logical owners; close
runs no callbacks. Existing shared instruction/work/allocation bounds and
composed resource observations remain unchanged.

This is classes-source/1 and bytecode 5. Property subclasses, wrapper/default
directories on other layouts, unread native metadata, live module/class-body
namespaces and dynamic source admission retain separate contracts. Core source
admission, dependencies, host grants, publication and deployment do not change.

References: [pinned property layout](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

All 37 pinned cases pass six Node/Chromium drain, instruction-boundary and
parked drivers: 222 observations with 222 zero logical teardowns. Reports verify
348 runtime/driver hashes. All 40 feature units, the full 2,715-test Node suite
and 17 affected Python checks pass; eight composed resource observations remain
unchanged. The final inventory has 393 passing probes per target.

The [property directory console](../examples/interpreter_property_directories.py)
composes accessor copies, arbitrary metadata, native binding and lazy generators.
Combined installed-wheel offline acceptance passes 1,932 programs, 112 groups
and 193 Stop/Restart cycles. Its [payload record](measurements/2026-10-29-property-directories.json)
verifies all 38 files at 721,255 bytes against the final directory engine.
These are finite semantic/source/payload observations. Broader reflection
remains under #123/#33; native async/browser adapters remain under #34.
