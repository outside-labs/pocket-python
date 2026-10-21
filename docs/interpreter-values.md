# Independent VM values: bytecode 2

INT-04 adds a staged value model in `runtime/values.mjs`, used by bytecode version
2 in Node and a browser worker. Version 1 and the architecture prototype retain
their existing formats. This remains bytecode-fixture execution: no source parser,
Python compiler, remote execution or alternate runtime is used by the VM.

## Scalars and arithmetic

None, bool and arbitrary-precision integers retain separate types. Int uses
BigInt and is bounded to 4096 decimal digits. Float is an explicit immutable
binary64 value, transported as 16 lowercase hexadecimal big-endian bits. Raw
JavaScript Number is never accepted as a Python int. Signed zero, infinities
and NaNs are retained. Decoding/encoding an existing float preserves its bits;
arithmetic NaN results use canonical `7ff8000000000000`, without promising payload
propagation or platform-specific NaN signs.

Integer arithmetic supports +, -, *, floor division and modulo. Float/mixed
arithmetic additionally supports true division. Mixed arithmetic explicitly
converts int to float, matching the reference conversion/rounding, and raises
OverflowError when the int cannot become a finite float. Comparisons between
int and float remain exact without first rounding the integer. Bool participates
numerically as 0/1. Python truthiness, zero-division errors, negative floor/modulo,
NaN comparisons and signed-zero results have differential cases.

Pure-int true division is explicitly UNSUPPORTED: finite ratios of enormous
integers need a separately adopted conversion algorithm. Exponentiation,
bitwise operators, complex, bytes and general numeric constructors are deferred.
An invalid type combination raises TypeError; a recognized deferred operation
uses UnsupportedOperationError/code UNSUPPORTED. Numeric interning identity is
not adopted; int operands to `is` are rejected. Identity is useful for retained
container/string/float aliases and None/bool singletons, without promising literal
interning.

Str stores immutable Unicode code points, including deliberately separate lone
surrogates. Length, indexing, iteration, comparisons, membership, concatenation
and slicing use those points without normalization or UTF-16 pair combination.
This distinguishes one astral character from two explicit surrogate characters.
Other string methods and Python formatting/printing are not added by this stage.

## Containers and iteration

Tuple is immutable; list preserves aliases and supports construction,
concatenation, equality/order, membership, negative indexing, item assignment,
append and slicing. Slices create a new outer container and preserve contained
references. Slice endpoints/steps use Python integer/None rules, including huge
integer clamping, reverse steps and a ValueError for step zero. Sequence
repetition, slice assignment, list deletion and other methods are deferred.

Dict preserves insertion order, the first retained equal key, and in-place value
updates. Deleting and reinserting a key appends it to the order. Supported keys
are None, bool, int, float, str and recursively hashable tuples. True, 1 and 1.0
address one entry; distinct NaNs remain unequal, while a retained NaN key can be
looked up by identity. Lists/dicts and tuples containing them fail as unhashable.
Private deterministic hashes are not Python's public `hash()` results; collisions
always require Python equality checks and consume work budget. Custom key objects,
iterator hashing and sets remain deferred.

Lists, tuples and dicts compare structurally within their own type. Container
element equality checks retained identity first, including a shared NaN object;
numeric NaN equality itself stays false. Dict ordering and ordering None remain
TypeError. Recursive comparisons are bounded rather than promising unlimited
recursive graphs.

Iterators retain identity and cursor state. List iteration sees subsequent
appends/item updates; exhausted iterators remain exhausted. Dict iteration yields
keys in insertion order and allows value updates. Size changes invalidate a live
iterator with RuntimeError. Equal-size key deletion/reinsertion during iteration
is explicitly UNSUPPORTED until its more detailed behavior is adopted. Generator
protocols, reversed iteration and user iterators remain deferred.

## Bytecode and transport

Version 2 constants use the host protocol's tagged none/bool/int/float/str/tuple
forms. Mutable list/dict constants are rejected; construction instructions create
fresh values during execution. All constants are validated and snapshotted before
execution. In addition to the version-1 instructions, version 2 supports:

| Instruction | Stack rule |
| --- | --- |
| build-list N / build-tuple N | Consume N values, push a fresh container |
| build-dict N | Consume N ordered key/value pairs, push a fresh dict |
| swap | Exchange the top two values |
| truth / not / len / positive / negative | Replace one adopted value with its result |
| iter / next | Replace an iterable with its iterator, or an iterator with its next value; exhaustion raises StopIteration |
| divide / not-equal / less-equal / greater / greater-equal / is / contains | Consume left/right and push the result |
| getitem | Consume container/key, push the selected item |
| setitem | Consume container/key/value, perform assignment and push None |
| append / dict-delete | Consume container/value or dict/key, mutate and push None |
| slice | Consume sequence/start/stop/step, push a new sequence |

The existing structural verifier checks every opcode, arity and operand, including
unreachable code, then checks stack heights/control flow. It does not prove
operation types or termination. Version 1 cannot use version-2 instructions.
Runtime errors retain the original instruction/source span.

`encodeValue` emits tagged acyclic by-value results. It preserves type and ordered
entries, but transport copies do not preserve aliases. Cycles fail with ValueError;
retained session handles can own such graphs without serializing them. Iterators and unknown native values cannot be serialized.
There is no implicit JavaScript object/array or HTML conversion.

## Limits and verification

In addition to instruction/stack/digit limits, a string has at most 65,536 code
points and a container at most 1024 items. Decoding, recursive hashing/comparison
and transport nesting is bounded to 32. Aggregate constant decoding and by-value
encoding each have a separate one-million-unit work limit. Execution charges
numeric, character, lookup, comparison, traversal and construction work against
`maxWork`, polling cancellation before bounded primitives. Concatenations and
mutations check lengths before changing the target. Native arithmetic can still
have a bounded temporary result, such as an 8192-digit multiplication.

These deterministic work/size limits operate alongside the
[INT-05 root/lifetime and allocation account](interpreter-memory.md). JavaScript
GC reclaims physical memory after roots and accounting records are released. Worker termination remains
necessary to interrupt a busy synchronous operation from the main thread.

Run `node --test runtime/values.test.mjs` and
`python runtime/check_conformance.py --engine vm2 --target node` or `browser`.
The shared language corpus and compact `tests/fixtures/interpreter/values.json`
extension compare exact typed results/errors with CPython 3.14.7. Cases cover
numeric precision/conversion, float boundaries, Unicode/surrogates/slices,
aliases, mutation, dictionary keys/order and iterators. Negative cases cover
unknown/mutable constants, invalid code points, depth, stack effects, deferred
operations and growth/work limits. Functions/scopes, exception unwinding and
malformed source remain visibly unsupported in the report.

The independent [source profile](interpreter-source.md) adopts receiver-owned
list.append and in-place list extension/repetition with explicit bounds. These
use the same arena edges and mutation accounting. Ordinary binary sequence
repetition remains deferred; this is a named source-profile extension.
