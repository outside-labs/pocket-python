# Native callable directories

O54 continues #123 and #33 against pinned CPython 3.14.7. The independently
authored `native-callable-directories.json` matrix separates reference cases
from engine adoption.

The existing native descriptor allowlist gains fresh sorted default directories
and unsorted native `object.__dir__` collection. Unbound method descriptors and
wrapper descriptors use their pinned descriptor/object keys. Bound method
descriptors and native class methods use builtin-function/method keys; bound
wrapper descriptors and their binding handles use method-wrapper keys. These
actual layouts differ in `__get__`, `__objclass__`, `__module__` and `__self__`.
Python bound methods retain O51, including classmethod-wrapped callables.

The allowlist is the existing native method descriptors, descriptor/type/binding
wrappers and native `object.__init_subclass__` binding. Ordinary builtin
functions, primitive value methods, native type directories and wrapper objects
such as staticmethod/classmethod retain separate contracts. This stage does not
infer a directory from an arbitrary internal callable name.

Collection merges actual native namespace keys in pinned insertion order and
deduplicates repeated names. It does not read the wrapped receiver's dictionary,
metaclass attributes, property names/documents/abstract flags or accessor hooks.
Metadata listing does not adopt additional native methods or metadata reads.
Native binding, explicit object attribute lookup, names/qualifications and exact
receiver identity compose recursively. Directory writes/deletes raise
AttributeError; arity and keyword errors raise TypeError.

Selected native callers own their complete receiver chain, including detached
properties, live class views, functions and cycles. Charged collection and owned
sorting preserve shared instruction/work/allocation bounds. Parking, collection,
cancellation and idempotent close leave zero logical owners; close runs no new
callbacks. Existing composed resource observations remain unchanged.

This belongs to classes-source/1 and bytecode 5. Core source admission, unread
native documentation, other builtin layouts, live module/class-body namespaces,
class mapping enumeration and dynamic source retain their separate boundaries.
No dependency, host grant, release, publication or deployment is included.

References: [pinned descriptor layouts](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c),
[native methods](https://github.com/python/cpython/blob/v3.14.7/Objects/methodobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
