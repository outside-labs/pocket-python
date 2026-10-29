# Class namespace view directories

O52 continues #123 and #33 against pinned CPython 3.14.7. The independently
authored `namespace-view-directories.json` matrix distinguishes reference
observations from engine adoption. O52 is implemented through the charged
native directory merge and owned sorting machinery.

`dir(view)` on an adopted class namespace mappingproxy returns a fresh sorted
list of the pinned mappingproxy and object namespace names. The view's class
contents do not contribute names. Class mutation, stored `__dir__` entries,
metaclass read hooks and namespace values cannot change this list or run
callbacks during its collection. Names describe reflection availability;
listing `keys`, `copy`, equality or union does not adopt those APIs.

`object.__dir__(view)` and `view.__dir__()` return the unsorted native key list
in mappingproxy-then-object insertion order, deduplicating repeated names.
Native descriptor binding, explicit object attribute lookup, names,
qualifications and receiver identity follow the existing directory descriptor
contract. Arity and keyword errors raise TypeError. View attribute mutation
remains read-only; hashing remains TypeError.

Retained native callers own the exact view and its live class. Detached classes,
view/class cycles, ordinary keyed reads and lazy generator observations preserve
identity across collection and parking. Fresh directory lists do not share
mutable storage. Shared instruction/work/allocation limits and cancellation
apply; close runs no new callbacks and leaves zero logical owners. Existing
composed resource observations remain unchanged.

This is classes-source/1 and bytecode 5. Class mapping enumeration, length,
copy/equality/union, native class dictionaries, unmaterialized native entries
and other default directory layouts remain explicit separate contracts. Core
source admission, dependencies, host grants, publication and deployment do not
change.

References: [pinned mappingproxy layout](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

All 31 pinned cases pass through six Node/Chromium drain, instruction-boundary
and parked drivers: 186 observations with 186 zero logical teardowns. Reports
verify 348 runtime/driver hashes. All 2,617 Node units and 22 affected Python
checks pass; a subsequent native-write boundary test brings feature coverage
to 34 units. All eight composed resource observations remain unchanged.
The inventory has 359 passing probes per target.

The [namespace view console](../examples/interpreter_namespace_view_directories.py)
composes keyed views, retained methods, native binding and lazy generators. Its
[payload record](measurements/2026-10-29-namespace-view-directories.json) verifies
all 38 files at 718,517 bytes. Installed-wheel offline acceptance passes
1,870 programs, 108 groups and 190 Stop/Restart cycles. Broader reflection remains
under
#123/#33; native async/browser adapters remain under #34.

The related method corpus also passes all six drivers against this engine.
Together both matrices provide 474 observations and 474 zero logical teardowns;
source/corpus hashes retain the exact final directory implementation.

The formerly deferred native `view.get` directory case is adopted by the
separate [O54 contract](interpreter-native-callable-directories.md). The current
matrix retains O52 namespace-view behavior alongside that native callable case;
mapping enumeration and unread native APIs remain separate.
