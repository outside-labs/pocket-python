# Ordinary exception semantics

Track A [#600](https://github.com/outside-labs/pocket-python/issues/600) adopts
focused exception slices under [#124](https://github.com/outside-labs/pocket-python/issues/124),
using CPython 3.14.7 as the semantic oracle.

| Stage | Exact surface | Boundary |
| --- | --- | --- |
| LA-8 | Generic positional builtin exception arguments; stable tuple `args`; constructor argument identity; lazy single-argument `str`/`print`; `StopIteration.value`; arbitrary assertion messages | Construction runs no argument formatting callbacks. Scalar/core cases are explicitly shared; owned callbacks require classes-source/1. Multiple-argument and unadopted value displays retain #127. Structured constructors retain #124. |
| LA-9 | Atomic `args` replacement from adopted iterables; writable `__context__`, `__cause__`, `__suppress_context__`; independent writable/deletable `StopIteration.value` | Cause assignment also enables suppression. Chain fields validate exact exception/None or bool values. Traceback objects and structured fields remain #124; tuple construction retains its explicit length-hint boundary. |
| LA-10 | `raise value from cause` / `from None`, builtin class normalization, explicit cause/suppression, implicit context cycle removal, bare reraises | Evaluation and validation order and original source frames are preserved. Exception subclasses follow in LA-11/LA-12. |
| LA-11 | Generic exception subclasses, inherited/native `__new__` and `__init__`, super, custom constructors, ordinary dictionaries/slots and user display/equality/hash/call slots | Generic bases share BaseException storage and compatible multiple inheritance. Structured exception bases and StopIteration subclasses retain their layout gate. Raising/catching user classes follows in LA-12. |
| LA-12 | Raising generic exception instances/classes; owned class normalization for values/causes; named class handlers and flat tuples of class names; actual-MRO matching; original source frames | Handler matching bypasses virtual subclass hooks and evaluates names before validation. General handler expressions/named tuple values, groups and structured subclasses retain #124. |

The source corpus `exceptions.json` distinguishes implemented cases from
retained refusals. Node and Chromium execute independently compiled source
through draining, instruction stepping and parked execution. Logical work,
allocation and cancellation limits continue to apply. Host error summaries
copy safe diagnostics without exporting live exception objects or invoking
arbitrary message callbacks.

Exception groups, traceback objects, specialized native exception fields,
serialization and remaining formatting families retain separate gates.

The generic subclass bases are BaseException, GeneratorExit, Exception,
AssertionError, ArithmeticError, ZeroDivisionError, OverflowError, LookupError,
IndexError, KeyError, ValueError, BufferError, TypeError, UnicodeError,
RuntimeError, SystemError and RecursionError. Native fields beyond the adopted
argument/chaining storage and ordinary dictionaries retain their named gates.
