# Type and advertised namespace directories

O76 completes type/custom-metaclass directory traversal and advertised class-like
namespace graphs under #123. CPython 3.14.7 is the pinned oracle; executable cases
are in `advertised-directories.json`.

`dir(type)` and transparent type-derived metaclasses include their own and inherited
native namespace keys. `type.__dir__(cls)` returns a fresh raw depth-first merge;
`dir(cls)` sorts a fresh result. Metaclass members enter the metaclass's directory,
while an ordinary class directory follows its advertised `__dict__` and `__bases__`.
`object.__dir__(cls)` ignores a non-dictionary own namespace, then merges the
advertised metaclass graph. Stored descriptor values are never invoked to list keys.

Graph traversal optionally reads each node's `__dict__` before `__bases__`, suppressing
only lookup AttributeError. Dictionaries and mapping proxies preserve their exact
key objects; other namespace mappings supply `keys()` and indexed values. Missing
mapping methods and errors during copying propagate. Base sequences read length
once and fetch each child at traversal time. Diamonds revisit shared ancestors,
merges preserve first key identities, and mutations in later callbacks are visible.
Non-string raw entries remain exact; sorting uses the existing owned comparison
protocol and may raise TypeError. Cycles have bounded recursion, total work and
allocation limits. Native method qualification reads a hooked receiver's
`__qualname__` through owned execution and requires a string.

`isinstance` and `issubclass` accept non-type class-like objects with tuple
`__bases__`, preserving validation order, identity comparisons, optional reads,
custom checking priority and left-to-right tuple short circuits. Native type
checking bypasses custom checking while retaining advertised-base fallback.
Union/generic-alias semantics remain #125. Reassigning an actual type's bases
remains O88; ordinary objects may store advertised bases.

All pending receivers, mappings, keys, results and base sequences are roots across
instruction-boundary collection and parking. Cancellation and close release them
without callbacks. Existing composed execution accounting is unchanged. Wrapper,
super and remaining native directories follow O77/O78; no new runtime dependency,
host capability or publication is introduced.

References: pinned [directory traversal](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c)
and [abstract type checking](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c).

Ordinary source class namespaces containing callback-bearing keys use the same
owned mapping traversal. Each key is read from its source namespace before it is
merged; hash/equality errors during that read propagate independently of optional
namespace attribute lookup. Inherited namespaces and object.__dir__ retain this
ordering through parking, cancellation and close.
