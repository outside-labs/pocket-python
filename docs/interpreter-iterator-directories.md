# Native iterator directories

O56 continues #123, #33, #116 and #120 against pinned CPython 3.14.7. The
independently authored `iterator-directories.json` matrix records reference
behavior before engine adoption.

Existing native list, tuple, ASCII/Unicode text, dictionary-key, short/long
range, set/frozenset, bytes, bytearray, memoryview, indexed and callable-sentinel
iterators gain fresh sorted `dir(it)` and unsorted native
`object.__dir__(it)` / `it.__dir__()` lists. Collection merges the exact native
iterator and object namespace names in insertion order. The layouts differ in
length-hint, reduction and state-restoration names; listing them adopts no new
API. Indexed/callable iterators expose their native layout, independent of the
source's type, instance attributes, dictionary or hooks.

Native binding, explicit object lookup, caller names/qualifications and exact
receiver identities compose with detached callers. Native type identities use
the separately corrected ASCII/Unicode distinction and pinned 64-bit C-long
range oracle. Directory mutation raises AttributeError; extra arguments and
keywords raise TypeError.

Collection does not advance or exhaust iterators, call indexed/callable sources,
compare sentinels, inspect source dictionaries or validate underlying container
versions. Mutated dictionaries/sets and released memoryviews remain introspectable;
their next operation retains its ordinary error. List mutation remains visible
to subsequent iteration. Exhaustion retains directory names and native identity.

Charged collection and owned sorting preserve shared instruction/work/allocation
limits. Native callers retain their complete iterator/source/sentinel graph,
including cycles. Parking, collection, cancellation and idempotent close leave
zero logical owners and run no new application callbacks. Existing composed
resource observations remain unchanged.

This belongs to classes-source/1 and bytecode 5. User-defined iterator instance
directories, unread native APIs/metadata, other default directories, live
module/class-body namespaces and dynamic source retain separate contracts.
Native async/host work remains under #34. No dependency, host grant, release,
publication or deployment is included.

References: pinned [indexed/callable iterators](https://github.com/python/cpython/blob/v3.14.7/Objects/iterobject.c),
[text iterators](https://github.com/python/cpython/blob/v3.14.7/Objects/unicodeobject.c),
[range iterators](https://github.com/python/cpython/blob/v3.14.7/Objects/rangeobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
