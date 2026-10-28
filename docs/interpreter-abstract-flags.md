# Descriptor abstract-method flags

O39/O40 continue #123 and #33 with a finite CPython 3.14.7 contract.
`tests/fixtures/interpreter/abstract-flags.json` records the executable reference.
Reference observations alone do not establish independent execution.

| Stage | Adopted behavior |
| --- | --- |
| O39 | Python functions retain an arbitrary `__isabstractmethod__` value, with ordinary assignment, deletion and missing-attribute behavior. Bound Python methods forward reads to their original callable and reject mutation. Properties inspect getter, setter and deleter in order, returning an exact boolean and stopping after the first truthy marker. |
| O40 | Static and class method wrappers inspect their wrapped value on every read, including nested properties/wrappers and bound Python methods. Their computed flag is read-only. |

Each accessor uses ordinary optional attribute lookup followed by owned truth
conversion. Only AttributeError from lookup means a missing flag; AttributeError
from truth conversion propagates. Descriptor binding, custom read/fallback hooks,
metaclass reads and truth callbacks preserve ordering, original source frames
and shared limits. Callback changes to later markers are visible. Missing flags
on adopted primitive values and ordinary functions are false. Reading a marker
never invokes its accessor as a callable.

A function marker retains its exact value, including None, mutable containers
and cyclic references. Function objects without a marker retain their existing
allocation layout. An assigned marker adds one owned edge; failed growth must
restore the previous marker. Computed descriptor flags add no persistent state.
Pending lookup/truth phases own their descriptor and any current result across
instruction boundaries, parked execution, collection, cancellation and close.
Preserve the eight existing composed resource observations.

The flag is reflection only: it does not enforce abstract class instantiation,
adopt `abc`, or add arbitrary function dictionaries. Native getset-descriptor
reflection, property documentation, builtin subclass layouts, live namespaces
and dynamic source admission retain their separate boundaries. Wrapper
construction and other metadata retain their existing finite contracts.
These operations belong to classes-source/1 and bytecode 5. Core/legacy
admission and host grants remain explicit. Native coroutine/await and host
adapters remain under #34.

O39 is implemented. Python function markers and computed property flags use
owned storage, optional lookup and truth phases. The matrix includes native
object-default operations for this specific marker, callback-visible changes,+nested lookup/truth errors and read-only descriptor metadata. Wrapper flags
remain explicit refusals pending O40. Focused lifecycle tests cover parked
collection, cyclic markers, cancellation, close and failed ownership growth.

Acceptance requires the pinned source matrix in Node/Chromium drain,
instruction-boundary and parked execution, focused lifecycle/resource checks,
compatibility probes and installed-wheel offline reload, Stop/Restart and
profile-update acceptance. No dependency, release, publication or deployment
is included.

Primary references are CPython v3.14.7's
[property flags](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c),
[method-wrapper flags](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c)
and [optional lookup/truth conversion](https://github.com/python/cpython/blob/v3.14.7/Objects/object.c).
