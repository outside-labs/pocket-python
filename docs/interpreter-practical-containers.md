# Practical container APIs

Track A [#600](https://github.com/outside-labs/pocket-python/issues/600) adopts
focused language slices under [#116](https://github.com/outside-labs/pocket-python/issues/116).
The independent source corpus uses CPython 3.14.7, with separate observations
for classes-source/1 and explicitly shared core-source/1 cases. Bytecode versions
4 and 5 retain their existing meanings. Defining `__missing__` remains an
explicit #116 source boundary; these methods bypass admitted item overrides.

| Stage | Exact API | Status and boundary |
| --- | --- | --- |
| LA-1 | `list.copy()`, `list.clear()`, `list.reverse()` | Implemented. No arguments or keywords. Copies are fresh shallow base lists; mutation keeps the original list identity and returns None. Native bound/unbound/rebound calls validate their receiver. |
| LA-2 | `list.insert(index, object, /)`, `list.pop(index=-1, /)` | Implemented. Signed-64-bit index conversion precedes current-length bounds/clipping; owned callbacks may mutate the receiver. Pop returns the original element. |
| LA-3 | `list.count(value, /)`, `tuple.count(value, /)`, list/tuple `index(value, start=0, stop=sys.maxsize, /)` | Implemented. Identity fast paths and owned equality/truth callbacks scan current contents; positional index bounds convert in order and saturate to signed-size limits. |
| LA-4 | `list.extend(iterable, /)` | Implemented for adopted iterables without user length hints. Self-extension snapshots the native payload, including subclasses; iterator failures retain the appended prefix. User hints refuse before binding or consumption and remain under #116. |
| LA-5 | `dict.get(key, default=None, /)`, `dict.setdefault(key, default=None, /)`, `dict.pop(key[, default], /)` | Implemented. Owned hash/equality uses one hash per lookup, retains exact stored keys/defaults/values and restarts after key mutation. Empty pop bypasses hashing. General KeyError argument introspection remains #124. |
| LA-6 | `dict.keys()`, `dict.values()`, `dict.items()` | Queued. Live ordered views, iteration/membership and owner lifetimes; further view operations require their own cases. |
| LA-7 | Composed source/offline acceptance | Queued. Integration does not imply the remaining #116 APIs. |

The initial two batches do not adopt populated dictionary construction/update,
text methods, aggregate/sorting/map/filter APIs, enumerate/zip or general reversed
protocols. Existing delivered APIs remain available; each remaining surface keeps
its issue owner and explicit refusal.

`practical-containers.json` records exact source observations. The shared test
manifest runs the admitted profiles in Node and Chromium through draining,
instruction stepping and parked execution. Tests distinguish semantic successes
and errors from unsupported operations. Method-name availability alone is not
API support. Logical item/work/memory limits and cancellation continue to apply;
zero teardown observations measure logical owners rather than host RSS.
