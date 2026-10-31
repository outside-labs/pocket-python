# Generator directories

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O55 continues #123, #33 and #120 against pinned CPython 3.14.7. The
independently authored `generator-directories.json` matrix separates reference
behavior from engine adoption. O55 uses charged native collection and owned
sorting.

Generator objects gain fresh sorted `dir(g)` lists and unsorted native
`object.__dir__(g)` / `g.__dir__()` lists. Native collection merges the pinned
generator and object namespace keys in insertion order, retaining the first
occurrence. Explicit descriptor binding and native object lookup preserve the
exact receiver, callable metadata and argument errors. Directory mutation raises
AttributeError.

Collection does not start, resume or close a generator. Created, running,
suspended, delegated, exhausted and closed generators expose the same names.
Generator expressions follow the same layout. Frame locals, function custom
attributes, renamed functions and callback-bearing bound values add no names or
effects. Listing `gi_frame`, `gi_code` or other metadata does not adopt reads or
additional APIs.

Native directory callers own their generator, suspended frame, bound values,
function and cyclic references. Charged collection and owned sorting retain
shared instruction/work/allocation limits. Parking, collection, cancellation and
idempotent close must leave zero logical owners; directory collection runs no
generator cleanup or application callback. Existing composed resource baselines
remain unchanged.

This contract belongs to classes-source/1 and bytecode 5. Core admission, unread
generator metadata, other directory layouts, broader native APIs, live
module/class-body namespaces and dynamic source retain separate contracts.
Native async and host adapters remain under #34. No dependency, host grant,
release, publication or deployment is included.

References: [pinned generator layout](https://github.com/python/cpython/blob/v3.14.7/Objects/genobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

All 40 pinned cases pass six Node/Chromium drain, instruction-boundary and
parked drivers: 240 observations with zero logical teardown failures. The 46
feature units cover retained cyclic callers, suspended locals, running generator
introspection, cancellation, repeated close and real resource failures. Adjacent
generator, execution and native directory checks preserve the eight composed
resource observations.

The [generator console](../examples/interpreter_generator_directories.py)
composes directories with send, suspension, close, retained native callers and
lazy iteration. Installed offline acceptance includes the matrix, composed
example, Stop/Restart and a waiting reduced-profile update. The
[payload record](measurements/2026-10-29-generator-directories.json) records the
exact example files. These are finite semantic/source/payload observations.

The combined inventory has 431 passing probes in each target. Together O55/O56 provide 768 source observations with zero logical teardown failures.
