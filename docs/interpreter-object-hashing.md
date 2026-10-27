# Method and slice hashing

INT-OBJECT-01X adopts hashes for ordinary bound Python methods. A method's
hash combines the identities of its function and receiver, bypassing the
receiver's `__hash__`, `__eq__` and attribute hooks. Repeated binding, inherited
methods, class methods and `super` therefore preserve equal-key dictionary
lookup even when the receiver is unhashable. Retained methods own their receivers.

The finite native method profile covers list append, adopted value/generator
methods and the existing bound native type helpers. Equality and hashing use the
native operation and receiver identity. Property accessor methods and broader
descriptor reflection retain their separate boundaries.

Hashes are session-local integers, with the existing signed hash normalization.
Their numeric values are implementation details. The pinned CPython 3.14.7
matrix compares equality, stable hashes, dictionary behavior, signatures and
errors, rather than addresses or exact identity hashes. Node and Chromium run
independently compiled source with draining and instruction-boundary drivers.
Collection, cancellation and close must release all transient owners.

Slice hashing and callback-bearing tuple hashing remain the next owned phase.
Namespace reflection, builtin layouts, metaclass protocols and dynamic source
admission remain under #123; native asynchronous language work remains under #34.
