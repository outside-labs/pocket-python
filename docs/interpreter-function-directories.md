# Default function directories

O50 continues #123 and #33 against pinned CPython 3.14.7. The authored
`function-directories.json` matrix distinguishes independently adopted behavior
from explicit future layout and metadata boundaries.

`dir(function)` returns a fresh sorted list combining the current live function
dictionary's keys with the pinned native function/object directory names.
Names describe reflection availability; listing a name does not adopt its API.
Metadata mutation does not add ordinary dictionary keys. Exact text keys are
deduplicated while preserving the first stored key's identity. Function values,
including lambdas, generator functions and retained method `__func__` values,
share this contract. Per-function `__dir__` dictionary entries do not override
implicit actual-type directory selection.

The native `object.__dir__(function)` returns the unsorted key list. Its explicit
bound form `function.__dir__()` retains ordinary function dictionary shadowing;
native descriptor binding and metadata preserve the original function receiver.
Other receiver layouts remain explicitly deferred. Keyword/arity errors retain
ordinary TypeError behavior.

Native collection first copies the function dictionary without rehashing its
keys, then merges the pinned function namespace followed by object namespace
in their recorded insertion order, including repeated native names. Custom
hash/equality collisions use the existing owned dictionary machine. The private
copy retains selected keys and values during merging; callback mutation or
replacement of the original dictionary cannot alter this selection. Original
callback errors propagate with their source frames.

The resulting list retains arbitrary adopted keys unchanged. `dir` applies the
existing owned stable less-than/truth sorting protocol; direct native directory
calls do not sort. Incompatible mixed keys raise TypeError. Sorting callbacks
can mutate the function dictionary without altering the selected list. A
particular general sorting algorithm or comparison count is not promised;
the finite matrix pins observed outcomes and merge callback order.

All intermediate dictionaries, keys, values, original receivers and pending
outer destinations remain owned across collection, parking and callbacks.
Instruction/work/recursion/allocation limits and hard cancellation apply. Close
runs no new finalizers and leaves zero logical owners. Existing composed
resource observations remain unchanged. This belongs to classes-source/1 and
bytecode 5; default core admission remains unchanged.

Default directories for ordinary instances, classes, bound methods, modules,
wrappers and builtin layouts retain separate contracts. Code/global/annotation
metadata, live module/class-body mappings and dynamic source admission remain
separate. No dependency, host grant, release, publication or deployment change
is included.

Reference: [pinned generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c)
and [function metadata](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c).
