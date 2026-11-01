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
| LA-16 | Composed handler/note record loading, modules, dynamic source, reraises and generator suspension during handler selection; offline cancellation and restart | The corpus records 174 observations: 167 semantic/error comparisons and seven explicit refusals, with 39 cases shared by core-source/1. Handler and note callbacks preserve zero logical teardown, including suspended selection and cyclic note dictionaries. |
| LA-17 | `NameError(*args, name=None)` and `UnboundLocalError`, mutable native `name`, subclasses and explicit native initializers/descriptors | Native fields preserve identity independently of `args` and dictionaries. Reinitialization replaces arguments before rejecting an unknown keyword, preserving old fields on that error. Global/free/deleted missing names populate `name`; unbound locals retain None. Structured layouts permit compatible generic exception bases and reject conflicting storage. |
| LA-18 | `AttributeError(*args, name=None, obj=None)`, native member fields, subclasses, owned constructors and descriptors | Explicit fields retain arbitrary values without callbacks. Replacement/deletion, initializer bypass and partial state on invalid keywords match the pinned oracle. Automatic runtime lookup enrichment retains a named refusal when its unresolved `name`/`obj` is read; explicit field assignment or reinitialization resolves that field boundary. |
| LA-19 | Composed native-field record failures, modules, dynamic source diagnostics, causes/notes and generator suspension; installed offline stop/restart | The 233-case corpus records 225 semantic/error comparisons, eight explicit refusals and 48 explicitly shared core cases. The runnable example retains the failed record/key by identity; native field callbacks and suspended cleanup share existing resource limits. |
| LA-20 | `ImportError(*args, name=None, path=None, name_from=None)` and `ModuleNotFoundError`; mutable `msg`/`name`/`path`/`name_from`, native initializers/descriptors and subclasses | A single positional argument initializes `msg`. Native `__str__` selects a string `msg`, strips string-subclass identity without calling its hooks, and otherwise uses the retained BaseException display contract. Generic BaseException initialization preserves native fields. Invalid keywords replace `args` but preserve the old fields. Automatic import-failure metadata enrichment remains an explicit field-read refusal. |

The source corpus `exceptions.json` distinguishes implemented cases from
retained refusals. Node and Chromium execute independently compiled source
through draining, instruction stepping and parked execution. Logical work,
allocation and cancellation limits continue to apply. Host error summaries
copy safe diagnostics without exporting live exception objects or invoking
arbitrary message callbacks. Notes remain source-visible values; host summaries
do not execute note getters or format arbitrary values in manually replaced
note lists.

Exception groups, traceback objects, specialized native exception fields,
serialization and remaining formatting families retain separate gates.

NameError and UnboundLocalError now have their own adopted native layout, with
ordinary subclass dictionaries/slots, constructors and actual-ancestry handlers.
Their scalar constructor/field-read cases explicitly shared with core-source/1
do not admit owned callbacks in that profile. Traceback objects, native error
suggestions and class-namespace deletion enrichment remain separate from these
constructor/storage contracts.

The generic subclass bases are BaseException, GeneratorExit, Exception,
AssertionError, ArithmeticError, ZeroDivisionError, OverflowError, LookupError,
IndexError, KeyError, ValueError, BufferError, TypeError, UnicodeError,
RuntimeError, SystemError and RecursionError. Native fields beyond the adopted
argument/chaining storage and ordinary dictionaries retain their named gates.

Run `examples/interpreter_exceptions.py` unchanged on CPython or in the console.
It selects reusable error types through a function, attaches notes, and retains
the original failed key, record and cause in native and ordinary fields.
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
