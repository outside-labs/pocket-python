# Class namespace view directories

O52 continues #123 and #33 against pinned CPython 3.14.7. The independently
authored `namespace-view-directories.json` matrix distinguishes reference
observations from engine adoption. Implementation stages remain empty until
the runtime change lands.

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
