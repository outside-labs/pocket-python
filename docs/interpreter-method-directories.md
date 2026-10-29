# Bound Python method directories

O51 continues #123 and #33 against pinned CPython 3.14.7. The authored
`method-directories.json` matrix separates reference observations from engine
adoption. Its implementation stages remain empty until the owned runtime lands.

`dir(method)` returns a fresh sorted list combining keys from the wrapped
callable's current dictionary with the pinned method and object namespaces.
It lists method names rather than function names: fallback metadata such as
`__name__` need not appear. Listing a native name does not adopt its API.
Class methods use the same contract; static methods returning functions retain
O50. Native builtin methods and other receiver layouts remain separate.

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
