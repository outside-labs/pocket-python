# Complete live class mapping proxies

O70 of #123 completes the class namespace interface from O49/O69. Source and
native classes expose complete own dictionaries through fresh read-only views.
Qualified native type access also works when a metaclass shadows `__dict__`.

| Operation | Behavior |
| --- | --- |
| `len`, truth, iteration and reverse iteration | Observe the actual dictionary and its insertion order. Reading keys does not bind stored descriptors. |
| `keys`, `values`, `items` | Fresh live dictionary views, with their actual native types, lengths, forward/reverse iterators and fresh read-only `mapping` proxies. Values reflect replacements; item tuples preserve exact keys and values. |
| Item lookup, membership and `get` | Owned key hashing, equality and truth callbacks, native missing/default behavior and original failures. Key views use dictionary lookup; value views compare stored values; item membership accepts a two-element tuple and probes its key first. |
| `copy` | An independent shallow dictionary with the same stored keys, values, descriptors and recorded hashes. Copying does not invoke key hashing again. |
| Equality and ordering | Delegate to the underlying dictionary, preserving raw user results, reflected operand identity, errors and callback-visible namespace mutation. Dictionary ordering normally raises TypeError. |
| Union and reflected union | Produce a shallow dictionary, preserving left key order/identity and using right values for equal keys. Owned collisions and structural source mutation follow the pinned behavior. |
| Mutation | Item assignment/deletion, attribute writes and in-place union retain native errors. Class mutation remains visible through all retained views. |

Native bound, detached, qualified and rebound proxy/view entry points use the
same operations. The actual mappingproxy type can wrap an admitted dictionary
or another proxy, including the native `mapping` keyword. Its dictionary is
retained rather than copied.

Forward iterators retain native entry positions, observe replacements and
detect changed sizes or unexpected remaining keys. Reverse iterators preserve
the pinned 3.14.7 behavior after equal-size changes, including reused positions
after dictionary compaction. This does not adopt a later maintenance release's
changed reverse-iterator error. Observed size errors stay errors;
exhausted iterators remain exhausted and release their dictionaries while
retaining their actual type. Allocation failure while creating an item tuple
does not advance the iterator. Keys/items views are unhashable; values views
retain ordinary identity hashing.

Proxy, view, iterator, copy and pending equality/union graphs have explicit
charged memory edges. Partial union results remain private and rooted across
callbacks. Work, instruction, cancellation and real allocation limits apply to
all phases; teardown releases transient roots and cyclic owners. Namespace
copy/union results use the same physical entry bookkeeping. Accounting revision 6
records real class-body/copy dictionary storage and retains all revision 5
observations. Canonical dictionaries replace duplicate namespace key records.

The corpus enumerates all 81 adopted native own dictionaries and covers both
source/native storage, metaclass shadows, callback errors, key identities,
read-only errors and all view/iterator families. Node and Chromium run the same
drain, stepped and parked matrix; the offline console executes successful
cases and dedicated native error checks.

Dictionary-view set comparison/algebra and broader dictionary methods remain
#116/#117. General sequence/user `reversed` protocols remain #116; arbitrary
prepared/user mappings remain O80/#116. Directory completion for new native
layouts remains O78, and unrelated explicit native APIs retain their owners in
the [native namespace contract](interpreter-native-namespaces.md). No dependency
or host authority is added.
