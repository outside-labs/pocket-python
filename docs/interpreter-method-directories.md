# Bound Python method directories

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O51 continues #123 and #33 against pinned CPython 3.14.7. The authored
`method-directories.json` matrix separates reference observations from engine
adoption. O51 is implemented through owned dictionary lookup, native merging
and sorting continuations.

`dir(method)` returns a fresh sorted list combining keys from the wrapped
callable's current dictionary with the pinned method and object namespaces.
It lists method names rather than function names: fallback metadata such as
`__name__` need not appear. Listing a native name does not adopt its API.
Class methods use the same contract; static methods returning functions retain
O50. Adopted native bound callables use the separate
[O54 contract](interpreter-native-callable-directories.md); other receiver
layouts retain their own boundaries.

Collection reads `method.__dict__` through ordinary callable fallback. A missing
dictionary or a non-dictionary result contributes no keys. Only AttributeError
from this lookup is suppressed; custom read, descriptor and fallback hooks use
owned frames and preserve other errors. The method's actual native class supplies
the method names without consulting the wrapped callable's advertised class.

The dictionary is copied without rehashing stored keys. Native method names,
then object names, merge in pinned namespace insertion order, including repeated
names. Keys retain identity and equal replacement retains the original key.
Collision equality/truth callbacks use the existing owned dictionary machine.
Changes to the original dictionary cannot change the selected private copy.
Merge errors, including AttributeError and KeyError, propagate unchanged.

`object.__dir__(method)` and the native bound `method.__dir__()` return unsorted
keys without ordering callbacks. The native method takes priority over a
wrapped callable's `__dir__` entry. Native descriptor binding, receiver metadata
and retained callers preserve the original method. `dir` sorts its private list
using the adopted owned ordering/truth protocol; incompatible keys raise
TypeError. No general sorting algorithm or comparison count is promised.

Receivers, private copies, keys, values and outer destinations remain owned
through lookup, merging, sorting, collection and parking. Shared instruction,
work, recursion and allocation limits apply. Cancellation/close run no new
callbacks and leave zero logical owners. Existing composed resource observations
remain unchanged. This belongs to classes-source/1 and bytecode 5; core admission
does not change. No dependency, host grant, publication or deployment is included.

References: [pinned generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c)
and [method lookup](https://github.com/python/cpython/blob/v3.14.7/Objects/classobject.c).

All 48 pinned cases pass through six Node/Chromium drain, instruction-boundary
and parked drivers: 288 observations with 288 zero logical teardowns. Reports
verify 348 runtime/driver hashes. There are 108 directory units, 388 adjacent
units and 22 affected Python checks; all eight composed resource observations
remain unchanged. The inventory has 345 probes per target.

The [method directory console](../examples/interpreter_method_directories.py)
composes retained methods, live callable dictionaries, native binding and lazy
generators. Its [payload record](measurements/2026-10-29-method-directories.json)
verifies all 38 files at 717,478 bytes. Installed-wheel offline acceptance passes
1,850 programs, 106 groups and 189 Stop/Restart cycles at the O51 checkpoint.
Broader reflection remains under
#123/#33; native async/browser adapters remain under #34.
