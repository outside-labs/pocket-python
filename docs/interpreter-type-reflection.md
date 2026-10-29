# Native descriptor owners and type hierarchy reflection

O35/O36 continue #123 and #33 with a finite CPython 3.14.7 contract.
The reference matrix is `tests/fixtures/interpreter/type-reflection.json`.
Reference observations alone do not establish independent execution.

| Stage | Adopted behavior |
| --- | --- |
| O35 | The existing native method/wrapper descriptor allowlist exposes its canonical declaring type through read-only `__objclass__`. Native bound method-wrappers expose the same declaring type, independently of their receiver. Bound native methods lack this attribute and raise AttributeError. |
| O36 | `type.mro(type, /)` and its ordinary bound forms return a fresh list of the actual C3 hierarchy. `__base__` exposes the actual primary storage base, or None for object. All adopted user types, type-derived metaclasses and canonical native types participate. |

O35 covers the methods and wrappers in the
[native rebinding contract](interpreter-native-rebinding.md); O36 adds type.mro
to that method-descriptor allowlist. Rebinding preserves the declaring type.
Class-method wrappers around native callables remain Python method values and
forward owner metadata from their wrapped descriptor. Ordinary Python functions
and methods have no default owner attribute. Owner reflection invokes no receiver,
advertised-class, metaclass checking, equality or truth callback. Assigning or
deleting the adopted native owner attribute raises AttributeError.
Both direct assignment/deletion syntax and attribute builtins reach that same
runtime error, preserving preceding output and source frames.

type.mro accepts exactly one positional actual type, including a receiver
supplied by binding. Missing/excess/keyword arguments and advertised classes
raise TypeError. Bound handles retain native callable identity, names,
qualification, equality, hashing and no Python `__func__`. A class attribute
named mro shadows the metaclass's non-data descriptor; ordinary metaclass read
hooks and descriptors retain their existing owned callback behavior. The native
helper bypasses those read hooks and never invokes a custom mro callback.
Qualification of a bound native MRO method on a receiver with a custom metaclass
read hook remains an explicit refusal before hook effects.

Custom metaclass mro construction is deferred. Definitions, dynamic namespaces
and direct mutations of that protocol refuse before their deferred effects;
selecting a metaclass whose inherited mro was changed also refuses before the
new class body. Ordinary class methods named mro remain valid. Base/MRO mutation
and live namespace mappings keep their explicit refusals.

`__base__` follows the primary native layout: an ordinary user hierarchy selects
its first base, while a type-derived layout selects its first type-derived base.
Metaclass read hooks can intercept ordinary reads; native type reads bypass
those hooks. Mutation of user type primary-base metadata raises AttributeError;
native type mutation retains TypeError. Custom primary-base descriptors and
builtin instance subclassing remain outside this finite contract.

Detached native handles, returned lists, temporary types and their namespace
values must survive instruction stepping, parked collection, cancellation and
idempotent close. Use the shared instruction/work/arena/recursion limits and
retain the eight composed resource observations. Node/Chromium drain, stepped
and parked source matrices, focused lifecycle tests and installed-wheel offline
reload, Stop/Restart and reduced-profile update acceptance establish delivery.

These operations belong to classes-source/1 and bytecode 5. Core and legacy
admission stay explicit. Default directories, live dictionaries, documentation,
broader descriptor reflection and dynamic source admission remain later work.
Native coroutine/await and host adapters remain under #34. No dependency, host
grant, release, publication or deployment is included.

Primary references: CPython v3.14.7
[descriptor metadata](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c)
and [type hierarchy implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
The executable reference pins patch-level argument and lookup behavior.

O35 is implemented over the adopted native descriptor allowlist. Its source
cases pass Node drain, instruction-boundary and parked execution, with original
receiver/cell ownership, actual memory/work interruption and zero teardown.
O36 is implemented for the adopted immutable hierarchies, including ordinary
metaclass reads and native descriptor rebinding. Custom metaclass MRO
construction and hooked native method qualification retain explicit refusals.

The complete 87-case matrix has 82 adopted comparisons and five explicit
refusals. Node/Chromium drain, instruction-boundary and parked execution pass
all 522 observations with zero logical teardown. Ten representative probes
extend the compatibility inventory to 189 cases per target. Installed-wheel
offline acceptance passes 1,362 program comparisons, 85 groups and 165
Stop/Restart cycles, including original callback diagnostics, reload and a
waiting core-profile update. The [hierarchy example](../examples/interpreter_type_reflection.py)
and its [payload record](measurements/2026-10-28-type-reflection.json) verify all
38 files at 675,436 bytes. These are finite semantic/source/payload observations.

Native iterator identity distinguishes compact ASCII (`str_ascii_iterator`) from general Unicode text (`str_iterator`). Range iterator identities follow the pinned 64-bit C-long CPython 3.14.7 oracle: `range_iterator` requires representable start/stop/step/length and the native endpoint-overflow checks; otherwise the canonical identity is `longrange_iterator`. This internal layout choice is independent of the host's C-long width. Exhaustion preserves the original identity. Text identity scans charge the shared work budget and do not consume the iterator.
