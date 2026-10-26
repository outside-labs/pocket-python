# Sets, binary sequences and logical buffers

INT-VALUES-01 uses CPython 3.14.7 as the executable semantic reference.
The staged `value-families.json` corpus separates reference observations from
independent source execution. A reference-only result never establishes support.
Core-source/1 and classes-source/1 retain bytecode versions 4 and 5.

V1/V2/V3 are implemented; Future cases retain explicit refusals.

## Finite delivery contract

| Stage | Adopted surface |
| --- | --- |
| V1 | `set()` / `frozenset()` with zero or one positional iterable, set displays including starred expansion, length/truth/iteration/membership/equality, primitive subset ordering and `\| & ^ -` algebra. `add`, `discard`, `remove`, `clear`, `copy`; frozen sets are immutable and hashable when their element hashes belong to the adopted primitive families. |
| V2 | ASCII bytes literals including raw/adjacent literals and byte escapes; `bytes` / `bytearray` from no argument, a nonnegative integer, an adopted iterable of byte integers, another binary value, or text plus an explicit encoding. Integer iteration/indexing, slicing, membership, equality/order, concatenation/repetition, bytearray scalar assignment; `decode`, text `encode` and binary repr/str. |
| V3 | One-dimensional unsigned-byte `memoryview` over owned bytes/bytearray or another live view. Integer indexing/iteration, strided slicing, scalar writes through mutable aliases, equality, readonly hashing, `release`, `tobytes`, `tolist`, `toreadonly` and finite metadata (`obj`, `readonly`, `format`, `itemsize`, `ndim`, `nbytes`, `shape`, `strides`, `suboffsets`, contiguity flags). |
| Future | Set comprehensions, broader set methods, set-algebra callbacks, recursive frozen-set hashing containing user objects, bytearray resizing and slice mutation, non-strict codec policies, additional codecs, buffer casts/formats/dimensions, context-manager views and native buffers remain separate slices. |

Construction, set membership and selected set mutations use the existing owned
iterator/hash/equality dispatch for user objects in classes-source/1. Byte
construction and indexing use type-level integer conversion; `bytes` additionally
adopts type-level `__bytes__` with a validated immutable bytes result. Callback exceptions
propagate through ordinary frames; only iterator advancement exhaustion completes
construction. Set and bytearray construction do not consult user length hints;
bytes construction with a user length hint explicitly refuses before callbacks.

Set order is deliberately unspecified; cases compare membership and counts rather
than CPython's incidental iteration order. Equal numeric keys retain one element.
Set size mutation invalidates a live iterator. Equal-size structural mutation and
mutation during key equality retain the dictionary machinery's explicit refusal.
Set algebra and subset ordering initially admit primitive keys; user-key forms
refuse before invoking callbacks. Hash values are private implementation values:
equality implies equal hashes, without promising CPython's salted hash numbers.

UTF-8, ASCII and Latin-1 use strict conversion with Python Unicode error classes.
Lone surrogates must raise UnicodeEncodeError; a host encoder must not silently
replace them. Malformed UTF-8 raises UnicodeDecodeError. Codec names are normalized
for the finite adopted aliases; unknown encodings raise LookupError and recognized
unadopted policies/codecs refuse explicitly.

Binary values contain at most 65,536 bytes; sets retain the 1024-element container
limit. Work, logical allocation, recursion and cancellation budgets apply before
growth or callbacks. Frozen values and views retain explicit arena edges, paused
operations retain partial construction, and repeated close releases all owners.
These are logical quotas, not host RSS or native-memory measurements.

Views retain their underlying owned buffer and a bounded logical selection. Slices
alias that buffer and survive release of a parent view. Release is idempotent;
subsequent data operations on that view raise ValueError. Equality retains self identity and returns false against other values; a previously cached readonly hash remains available. Mutable-byte resizing remains
explicitly unadopted, so this stage makes no exported-buffer resizing claim.
Readonly views over mutable bytearrays remain unhashable, matching the owner.

## Verification

Run the reference with:

```sh
python runtime/check_classes.py --reference-only --corpus tests/fixtures/interpreter/value-families.json
```

Adopted stages must additionally pass Node and Chromium in draining and
instruction-boundary drivers, with explicit shared core cases, zero logical
teardown and offline console source/cancellation/update checks. Existing composed
resource baselines and package allowlists remain required.

References: [sets](https://docs.python.org/3.14/builtins/stdtypes.html#set-types-set-frozenset),
[binary sequences](https://docs.python.org/3.14/builtins/stdtypes.html#binary-sequence-types-bytes-bytearray-memoryview)
and [buffer views](https://docs.python.org/3.14/builtins/stdtypes.html#memoryview).

This batch does not complete all builtin methods, generators, object/exception
protocols, formatting, libraries or native-extension compatibility. Those remain
in their established issue families; publication and hosting retain separate gates.
