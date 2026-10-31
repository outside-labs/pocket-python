# Wrapper and super directories

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O77 completes the instance and type directory families for `staticmethod`,
`classmethod` and `super` under #123. The pinned CPython 3.14.7 namespace inventory
supplies their own native keys; inherited object keys merge in raw native order.
The executable `wrapper-super-directories.json` contract records the reference
results before implementation acceptance.

`dir(value)` returns fresh sorted keys. `object.__dir__(value)` and detached native
callers return fresh raw lists. Wrapper dictionaries precede native keys, remain
live between calls and preserve exact key identities. Dictionary collisions and
sorting retain the existing owned hash/equality/truth/comparison machinery.
An explicit wrapper `__dir__` read honors its ordinary dictionary shadow; implicit
`dir` selects the actual native slot. Listing metadata never evaluates annotation
hooks, abstract flags or wrapped callables. Those APIs retain their separate owners.

Unbound, instance-bound and class-bound super values list the actual super
namespace. Their optional `__dict__` read retains super's existing base-descriptor
lookup: a base's instance dictionary can contribute keys, custom dictionary
properties execute, and AttributeError alone is suppressed. Unrelated receiver
read/directory hooks do not execute. Explicit `s.__dir__` preserves ordinary super
binding, which can target the receiver instead of the super handle. Native calls
on the handle bypass that lookup. Nested super handles retain the actual hierarchy.

Detached native callers own wrappers, dictionaries, wrapped callables, super
handles and receiver/base graphs through parking and collection. Callback failures,
shared limits, cancellation and idempotent close retain zero logical teardown.
The offline console exercises positive/error cases and Stop/Restart inside super
namespace callbacks. Subclass layouts remain O87, and broader native APIs retain
O90 or their named library owners.

References: pinned [native namespace and directory implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c)
and [wrapper layouts](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c).
