# Mutable builtin subclass layouts

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O86 of #123 adopts list, dict, set and bytearray subclasses over their existing
constructor and value-operation signatures. The [51-case source matrix](../tests/fixtures/interpreter/mutable-subclasses.json)
uses CPython 3.14.7 and all six Node/Chromium execution drivers.

| Surface | Contract |
| --- | --- |
| Allocation | Native `__new__` allocates an empty payload without consuming initializer operands. A source initializer sees that empty payload; inherited native initialization fills it using the owned machine. |
| Initialization | List/set reinitialization clears the payload before consuming its iterable, so callbacks and failures observe partial native mutation. Empty dict initialization preserves entries; populated dict constructors remain #116. Bytearray retains its admitted integer, byte-string, encoded-string and iterable forms. |
| State | Aliases observe the same payload. Slots and dictionaries remain independent of items. Source overrides bind normally; explicit native operations on the subclass bypass those overrides. Native slicing, concatenation and set operations return base values. |
| Mutation | Item assignment/deletion, list append and admitted set methods retain existing key/index callbacks, version checks and iteration behavior. In-place list/set operations preserve the subclass and aliases; repetition uses owned index callbacks. |
| Buffers | A view of a bytes/bytearray subclass owns its native bytes and original subclass object. `obj`, slices and read-only aliases preserve that identity. Native bytearray reinitialization rejects live exports with BufferError; released/unreachable views no longer prevent resizing. |
| Errors | Invalid native receiver/signature and incompatible solid layouts use native error types. BufferError is added to the existing exception hierarchy and generated native namespace/directory inventory. |

Mutable payload edges use the O85 eight-byte edge and trace the existing native
allocation. A subclass-backed memoryview adds an eight-byte source-object edge;
release drops both byte storage and source-object ownership. Live export scans
use the arena's collectable records, not a registry retaining unreachable views.
The lifecycle tests collect while native initialization is parked and while a
view is the only owner of a subclass with custom state, then finish, cancel and
close with zero logical teardown.

Broader constructors/methods, iterable length hints and `dict.__missing__` retain
#116/#117. Bytearray in-place resizing retains its existing #117 boundary.
Descriptor/wrapper/module/super subclasses continue in O87; reassignment in O88.

References: [pinned list allocation and initialization](https://github.com/python/cpython/blob/v3.14.7/Objects/listobject.c),
[pinned set initialization](https://github.com/python/cpython/blob/v3.14.7/Objects/setobject.c),
[pinned bytearray export validation](https://github.com/python/cpython/blob/v3.14.7/Objects/bytearrayobject.c).
