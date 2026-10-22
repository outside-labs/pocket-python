# Numeric construction and operators

The semantic oracle is **CPython 3.14.7**. The independently authored
[numeric matrix](../tests/fixtures/interpreter/numeric.json) separates integer
operators (N1), numeric helpers (N2), real constructors (N3), complex values (N4),
conversion callbacks (N5) and explicit later object boundaries (Future).
Reference observations specify behavior. They do not establish adoption;
`implemented_stages` and independently compiled source reports do that.

## Delivery and signatures

The numeric surface is additive in core-source/1 and classes-source/1. New
primitive instructions require bytecode 4/5; earlier bytecode engines retain
their feature gates. Callback slots require classes-source/1. Engine fingerprints
identify the complete implementation; host grants and external packages retain
their existing boundaries.

| Stage | Finite API |
| --- | --- |
| N1 | `~`, `&`, `\|`, `^`, `<<`, `>>`, their augmented forms, `**`/`**=` and integer true division. Integer powers include negative exponents, zero/unit bases and underflow. |
| N2 | `abs(x)`, `divmod(x,y)`, `pow(base,exp,mod=None)`, `round(number,ndigits=None)`, `bin(x)`, `oct(x)`, `hex(x)`, `chr(i)` and `ord(c)`. `pow` and `round` accept their named keywords; other helper arguments are positional-only. |
| N3 | `int()`, `int(x)`, `int(text,base)`/`int(text,base=...)`, `float()` and `float(x)`. Constructor value arguments are positional-only. Explicit bases are 0 or 2–36. |
| N4 | Complex literals, `complex()`/one/two-argument construction and real/imaginary keywords; basic arithmetic, integer powers from -100 to 100 with finite intermediates, equality/truth, real/imaginary attributes and compatible dictionary hashes. |
| N5 | Type/MRO-selected `__int__`, `__float__`, `__complex__`, `__abs__`, `__round__` and the adopted `__index__` consumers, with ordinary descriptor binding and explicit result rules. |

All expressions evaluate once in Python order. Power associates to the right;
unary signs bind outside the left power operand and inside its exponent.
Bitwise precedence sits between arithmetic and comparisons. Bool/bool bitwise
operations return bool; other integer arithmetic returns integer values.
Negative shifts raise ValueError. Huge right shifts and zero left shifts avoid
unnecessary allocation; other huge results hit the existing integer/work quota.

Integer true division rounds an exact BigInt ratio to binary64, including
ties-to-even, subnormals, signed zero and overflow. It must not convert arbitrary
numerators and denominators separately through Number. Explicit int-to-float
coercion has its own correctly rounded conversion and OverflowError boundary.
Nonnegative integer power and modular power keep integer intermediates, with
bounded work and cancellation polls; negative modular powers require an inverse.
Negative integer exponents follow Python's real coercion before power, including
coercion overflow and the rounded floating exponent's parity.

Round uses nearest/even ties. Integer rounding remains exact; float rounding
must use the actual binary64 input rather than a decimal string approximation.
Non-finite, overflow, mixed-type, invalid-input and signature cases are explicit
matrix rows. Floating power retains binary64/libm precision rather than claiming
portable last-bit agreement for all transcendental inputs.

Numeric string conversion adopts decimal Unicode digits and Python's numeric
whitespace rules, ASCII signs, finite prefix/base rules and valid underscores.
It does not normalize arbitrary letters or accept a BOM as whitespace. Input
and result bounds are checked before unbounded native computation; resource
refusals remain distinct from Python type/value errors.

## Ownership and later boundaries

Callbacks enter ordinary VM frames and keep receiver, arguments, pending result
and outer destination rooted until transfer. Result validation and original
binding/body errors remain at source locations. Require forced collection while
paused, recursive callbacks, work/instruction/output limits, actual OOM,
cancellation and idempotent close with zero logical teardown. Preserve the eight
existing composed resource observations.

Complex values need an explicit immutable layout and tagged representation;
mixed equality and hashing must agree with equal real numbers. Numeric methods,
broader formatting, builtin subclasses, general arithmetic/reflected slots and
unadopted complex power/special-value families remain separately gated. In
particular, int no longer falls back to `__trunc__` in Python 3.14.

## Contract checkpoint

There are 149 authored reference cases. Initially, only N1 and Future run through
the independent engine, with explicit refusals; N2–N5 remain reference-only and
are listed as omitted stages in source reports. Each delivery expands the
selected stages and changes `implemented_stages` only after its own tests pass.
The first checkpoint does not close INT-NUM-01, INT-09 or async work.

## Integer operator checkpoint

N1 is implemented. Five added coercion regressions bring the complete reference
corpus to 154 cases; the selected source matrix has 44 comparisons and two
explicit future refusals in Node/Chromium drain/stepped execution. Other numeric
stages remain omitted until implemented. All 252 Node tests pass, including 103
independent CPython binary64 division observations and the unchanged eight
composed resource baselines. The expanded core source corpus also passes.

Oversized shifts and powers refuse before unbounded native allocation. Each
power multiplication charges work and polls cancellation; its native scratch
products stay within twice the admitted integer digit bound. Result allocation
uses the ordinary arena and rolls back on OOM. Collection at every instruction
boundary retains computed numeric results. Earlier value/function engines keep
their prior integer-division and opcode admission gates.

## Numeric helper checkpoint

N2 adds the nine helper builtins and real power. All 154 pinned references pass;
the selected source matrix has 88 comparisons and two explicit future refusals.
The helper tests additionally compare 285 independently generated CPython
rounding observations, including non-finite values, signed zero, subnormals,
huge precisions and exact binary64 ties. Modular inverse and exponentiation
poll the existing work/cancellation budget. Float divmod roots both owned
results before tuple allocation; collection and OOM leave no leaked objects.
Numeric/index callbacks remain the later N5 stage.

## Offline operator checkpoint

The installed nested-path console compares 127 programs with CPython and passes
24 additional acceptance groups, including fresh operator/helper source after
offline reload, numeric error prefixes/locations, bounded failures, unchanged
static-only host grants and class-to-core updates that retain primitive numeric
APIs. All 37 Stop/Restart cycles complete within the existing three-second bound.
The expanded class example demonstrates exact division, shifts/bitwise power,
modular inverse, rounding and Unicode helpers.

The [complete payload record](measurements/2026-10-22-numeric-operators.json)
verifies the immutable prior inputs and all 38 current artifact members. The
core-only class example grows from 414,161 to 430,208 bytes (+16,047), including
the new numeric module, changed engine/receipt/UI and expanded example. The
record includes per-file hashes and reproducible gzip totals; it makes no
startup, performance or device claim. INT-NUM-01 remains open for constructors,
complex values and owned conversion callbacks.

## Real constructor checkpoint

N3 implements primitive int/float construction in both source profiles. The
parser pins Unicode 16.0.0 decimal blocks and numeric whitespace, rejects
non-numeric letter normalization/BOM/control whitespace, and enforces Python's
base/prefix/underscore and positional-only signatures. Integer accumulation is
bounded before native computation and polls work/cancellation; float results
use the existing owned binary64 layout and float(existing_float) preserves
identity. The additional 482 independent CPython observations cover every
admitted Unicode decimal block and numeric whitespace plus malformed input.
Bytes and user conversion callbacks remain later stages.

## Complex value checkpoint

N4 adds an immutable 80-byte logical complex layout with native binary64 real
and imaginary fields and no owned children. Transport uses exact-field
`{type:"complex",real_bits,imag_bits}` records; earlier engines reject them.
Read-only real/imag attributes allocate ordinary owned floats. Mixed equality
compares integers exactly and numeric dictionary hashes agree with equal real
keys. NaN equality and container identity retain their existing distinction.

The independent CPython observations include 600 arithmetic/power records,
32 constructor strings and six deterministic hash records. Of the arithmetic
records, 597 compare results/errors and three verify explicit refusals for
negative powers requiring non-finite intermediate recovery. Powers admit
integer exponents from -100 to 100 with finite intermediates; larger,
fractional/complex exponents and non-finite arithmetic inputs remain explicit
later families. Five Future source cases retain those and object boundaries.
The complete numeric reference corpus now has 157 cases.

Cartesian division uses a magnitude-selected ratio to avoid squaring the
denominator; mixed real operations preserve signed-zero semantics. Primitive
operations and stored fields are independent implementations, checked against
the pinned oracle. Floating magnitudes retain host libm precision, as real
power does; no universal transcendental last-bit promise is made.
