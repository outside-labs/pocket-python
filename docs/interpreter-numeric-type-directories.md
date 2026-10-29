# Numeric and sentinel type directories

O63 continues #123 and #33 over the O62 ordinary class directory contract.
Pinned CPython 3.14.7 is the semantic oracle. The independently authored
`numeric-type-directories.json` records reference cases before engine adoption.

`dir(cls)` for bool, int, float, complex, NoneType and NotImplementedType returns
a fresh sorted list of native namespace keys. `type.__dir__(cls)` and explicit
bound/rebound forms return fresh lists in pinned native own/base merge order.
Bool includes its int base; every type includes the object namespace. Duplicate
names keep their first position. Metaclass names do not enter these directories.
These immutable type namespaces use their canonical adopted type identities.

The existing type directory descriptor retains native receiver validation,
None/ignored-owner binding, read-only metadata and no Python method `__func__`.
Detached callers and nested caller chains retain their receivers across collection,
instruction-boundary parking, cancellation and idempotent close. Wrong receivers,
extra/keyword arguments and immutable type mutation preserve their Python errors,
prior output and source frames.

Ordinary instance directory merging also accepts these advertised `__class__`
values, after its optional dictionary snapshot. Existing arbitrary dictionary
keys keep their first identities and owned hash/equality/truth callbacks. Native
keys are listed without looking up or invoking native entry values. Merely listing
names does not adopt their reads/APIs, type mapping access/enumeration, builtin
subclass layouts or `object.__dir__` on type objects. Custom metaclass namespaces,
further builtin types, module/wrapper/super directories, live mappings and dynamic
source retain separate contracts. Core-source admission remains explicit.

The shared instruction/work/allocation limits, zero logical teardown and existing
composed resource observations remain required. No dependency, host grant, release,
publication or deployment is included.

Reference: pinned [native type directories and recursive namespace merging](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

The 63-case source matrix has 58 adopted comparisons and five explicit refusals.
All six Node/Chromium drain, instruction-boundary and parked drivers pass. The 75
feature units cover native binding, canonical receiver retention, cyclic advertised
instance graphs, cancellation, close, real shared limits and core admission.
Adjacent directory/namespace/resource tests and 23 affected Python checks pass;
the eight composed execution/resource observations remain unchanged.
