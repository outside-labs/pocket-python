# Ordinary exception semantics

Track A [#600](https://github.com/outside-labs/pocket-python/issues/600) adopts
focused exception slices under [#124](https://github.com/outside-labs/pocket-python/issues/124),
using CPython 3.14.7 as the semantic oracle. Bytecode 4/5 retain their existing
profile identities; legacy bytecode 2/3 keeps its earlier constructor boundary.

| Stage | Exact surface | Boundary |
| --- | --- | --- |
| LA-8 | Generic positional builtin exception arguments; stable tuple `args`; constructor argument identity; lazy single-argument `str`/`print`; `StopIteration.value`; arbitrary assertion messages | Construction runs no argument formatting callbacks. Scalar/core cases are explicitly shared; owned callbacks require classes-source/1. Multiple-argument and unadopted value displays retain #127. Structured constructors retain #124. |
| LA-9 | Atomic `args` replacement from adopted iterables; writable `__context__`, `__cause__`, `__suppress_context__`; independent writable/deletable `StopIteration.value` | Cause assignment also enables suppression. Chain fields validate exact exception/None or bool values. Traceback objects and structured fields remain #124; tuple construction retains its explicit length-hint boundary. |
| LA-10 | `raise value from cause` / `from None`, builtin class normalization, explicit cause/suppression, implicit context cycle removal, bare reraises | Evaluation and validation order and original source frames are preserved. Exception subclasses follow in LA-11/LA-12. |
| LA-11 | Generic exception subclasses, inherited/native `__new__` and `__init__`, super, custom constructors, ordinary dictionaries/slots and user display/equality/hash/call slots | Generic bases share BaseException storage and compatible multiple inheritance. Structured exception bases and StopIteration subclasses retain their layout gate. Raising/catching user classes follows in LA-12. |
| LA-12 | Raising generic exception instances/classes; owned class normalization for values/causes; named class handlers and flat tuples of class names; actual-MRO matching; original source frames | Handler matching bypasses virtual subclass hooks and evaluates names before validation. General handler expressions/named tuple values, groups and structured subclasses retain #124. |
| LA-12A | Lazy ordinary runtime message arguments; original failed keys in primitive/owned dictionary, proxy, removal and pop errors | Errors retain the searched key without formatting it. Message tuple materialization preserves `str(error)` identity. Structured exception field/constructor families remain separate. |
| LA-13 | Composed record loading, modules, dynamic source, message callback failures, empty exhaustion arguments, PEP 479 causes, suspended cleanup and offline stop/restart/profile updates | The 123-case corpus has 115 semantic/error observations and eight explicit refusals; 24 cases are explicitly shared with core-source/1. These are finite API observations, not an overall Python completion measure. |
| LA-14 | Lazy handler expressions, named/empty flat tuples, attribute/call/subscript selection and tuple subclasses | Each selected expression completes before all flat tuple elements are validated. Matching uses actual ancestry. Nested tuples and nonexception elements raise TypeError; later clauses are evaluated only after a valid nonmatch. |
| LA-15 | `BaseException.add_note(note, /)`, inherited bound/unbound calls, lazy `__notes__`, string identity, ordinary note replacement/deletion and owned attribute hooks | Nonstring notes fail before lookup. An existing list or list subclass is appended through native storage; a missing attribute creates a list through ordinary assignment. Notes preserve `args` and `str(error)`; host summaries and traceback rendering retain their separate diagnostic contract. |

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

Run `examples/interpreter_exceptions.py` unchanged on CPython or in the console.
The exact corpus is included in the shared Node/Chromium matrix:

```sh
python scripts/run_tests.py focused --feature exceptions --feature object-scope-inventory
python scripts/run_tests.py browser-conformance --feature exceptions
python scripts/object_integration_browser_smoke.py --exceptions
```

Exception groups/except*, traceback objects/mutation, and structured
native constructors/fields/subclasses remain #124. Generator throw of a user
exception class retains #120; throwing an instance remains adopted. Multiple
argument/container/default exception representations remain #127. The ordinary
exception slices do not complete Track A A2, which also requires formatting.

Modern bytecode 4/5 handler records accept an expression block reference in
their first field. A successful expression must leave exactly one value; an
empty tuple never matches. The existing name-array representation and empty
array bare-handler representation remain readable. Bytecode 2/3 does not admit
expression block references. Handler expressions use the ordinary frame,
closure and namespace lookup paths, including suspended owned callbacks and
the active exception for bare reraises. Alias cleanup and finally handling
apply when expression evaluation or validation fails.
