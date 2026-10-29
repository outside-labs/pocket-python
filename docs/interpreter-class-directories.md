# Ordinary class directories

O62 continues #123 and #33 over O61's ordinary namespace merge contract. Pinned
CPython 3.14.7 is the semantic oracle; `class-directories.json` records independently
authored source/reference cases before adoption.

`dir(cls)` on object and ordinary source/dynamic classes returns fresh sorted
namespace keys. Native `type.__dir__(cls)` and explicit bound/rebound forms return
fresh lists in depth-first own/base merge order. Repeated diamond ancestors are
visited; first key order/identities are preserved. Metaclass attributes and
instance attributes do not enter the default class directory. Stored class
properties/descriptors and ordinary instance `__dir__` definitions are listed
without invocation. Existing actual-metaclass custom `__dir__` dispatch retains
its owned descriptor/iterable/sorting behavior.

The native type method is a canonical method_descriptor with type owner metadata,
receiver validation, None/ignored-owner binding rules, native bound method
identity, read-only metadata and no Python method __func__. Detached and nested
callers retain the actual class, its bases and namespace graph across collection,
parking, cancellation and close. Extra/keyword/missing/wrong receiver arguments
raise TypeError with prior output and source frames retained.

Own/source namespace names include pinned layout entries. Mutation between calls
is live; deletion/reinsertion and implicit source documentation/hash keys preserve
native order. Listing names does not adopt native entry reads or class mapping
enumeration. Custom metaclass namespace reflection (including transparent custom
metaclasses), further builtin type namespaces, object.__dir__ on class objects,
module directories, wrappers/super, live module/class-body mappings and dynamic
source retain explicit separate boundaries. Core source admission stays explicit.

Shared instruction/work/allocation limits, zero logical teardown and the existing
composed resource observations remain required. No dependency, host grant,
release, publication or deployment is included.

Reference: pinned [native type directory and recursive class merging](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
