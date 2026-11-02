# Ordinary exception semantics

Track A [#600](https://github.com/outside-labs/pocket-python/issues/600) adopts
focused exception slices under [#124](https://github.com/outside-labs/pocket-python/issues/124),
using CPython 3.14.7 as the semantic oracle. Bytecode 4/5 retain their existing
profile identities; legacy bytecode 2/3 keeps its earlier constructor boundary.
LA-28B preserves version-3 scalar SyntaxError-family message rendering rather
than selecting uninitialized native fields. Modern construction and explicit
native message initialization retain their adopted field semantics.

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
| LA-18 | `AttributeError(*args, name=None, obj=None)`, native member fields, subclasses, owned constructors and descriptors | Explicit fields retain arbitrary values without callbacks. Replacement/deletion, initializer bypass and partial state on invalid keywords match the pinned oracle. LA-23 adds automatic ordinary-read enrichment; write/delete metadata retains its separate field-read gate. |
| LA-19 | Composed native-field record failures, modules, dynamic source diagnostics, causes/notes and generator suspension; installed offline stop/restart | The 233-case corpus records 225 semantic/error comparisons, eight explicit refusals and 48 explicitly shared core cases. The runnable example retains the failed record/key by identity; native field callbacks and suspended cleanup share existing resource limits. |
| LA-20A | Native exception lookup at each position of the actual MRO | A native base's inherited entry cannot hide a later base's own initializer, string slot or member. Mixed generic/name/attribute bases preserve native keyword initialization, explicit descriptor identity, super and slotted subclass storage. Direct native lookup keeps its inherited behavior. |
| LA-20 | `ImportError(*args, name=None, path=None, name_from=None)` and `ModuleNotFoundError`; mutable `msg`/`name`/`path`/`name_from`, native initializers/descriptors and subclasses | A single positional argument initializes `msg`. Native `__str__` selects an exact str `msg`; other values, including string subclasses, fall back to the retained BaseException argument display contract. Generic BaseException initialization preserves native fields. Invalid keywords replace `args` but preserve the old fields. Automatic import-failure metadata enrichment remains an explicit field-read refusal. |
| LA-21 | StopIteration subclasses, native construction/initialization and independent `value` storage | Native `__new__` leaves `value` None; native initialization selects the first argument. BaseException initialization and `args` replacement preserve `value`. Native deletion clears it to None. Iterator exhaustion and PEP 479 use actual ancestry, including custom MROs, while the declared solid layout owns storage. User-class generator `throw` normalization remains #120. |
| LA-21A | `yield from` forwards independent native `StopIteration.value` | Delegation consumes the native value rather than `args[0]`, including subclass exceptions, explicit None and temporary aliases. Native extraction bypasses owned `value` properties. The retained result shares parked collection, cancellation and close ownership. |
| LA-22 | Composed import/exhaustion record sources, modules, dynamic source, suspended cleanup, native text selection and delegated return values; installed offline cancellation/restart | The automated corpus has 310 cases: 301 semantic/error comparisons, nine explicit refusals and 53 shared core cases. Two pinned-reference crash probes remain separately recorded divergences with safe interpreter checks on Node and the installed offline Chromium console. |
| LA-23 | Runtime AttributeError `name`/`obj` enrichment on ordinary reads, `getattr`, descriptors, module hooks and native missing reads | Existing native fields, including an explicitly supplied None, suppress enrichment. Original error/key/receiver identity survives owned setters and their failures. This slice belongs to classes-source/1. Write/delete enrichment remains separately gated. |
| LA-24 | Native runtime import message identity and registry-backed missing from-import `name`/`path`/`name_from` | Registry modules retain their original source path, including after namespace file replacement/deletion. User-raised errors retain their own fields. Policy denials keep their registry semantics and do not grant host imports. Custom module specs, source module subtypes and provenance callbacks retain a field-read boundary under #124. |
| LA-25 | Composed runtime metadata across module calls, dynamic source, cause/note handlers and suspended cleanup; installed offline stop/restart during enrichment setters | The corpus records 359 cases: 351 semantic/error comparisons and eight explicit refusals, with 53 cases shared by core-source/1. Node and Chromium pass every drain, step and parked driver. The installed-wheel offline console passes 59 checks. |
| LA-26 | SyntaxError/IndentationError/TabError layouts, subclasses, native initializers and nine mutable native fields; iterable detail conversion and plain native messages | Four, six or seven details succeed. Five details publish fields before TypeError; other invalid counts leave old detail fields intact after replacing args/msg. Detail conversion ignores length hints. Native location rendering follows in LA-27; parser-generated fields remain gated. |
| LA-27 | Native SyntaxError message/location rendering, basename selection, exact-int line selection and owned message callbacks | Filename/line values are read before message callbacks; native fields bypass owned getters. String-subclass filenames render their native content, while bool/int-subclass line numbers are ignored. The deterministic profile uses POSIX separators and signed 64-bit C long overflow behavior; Windows differences are separately recorded. |
| LA-28 | Composed structured syntax failures across modules, dynamic source, causes/notes and suspended cleanup; installed offline detail/message cancellation and core-profile updates | The corpus has 438 cases: 430 semantic/error comparisons, eight explicit refusals and 76 shared core cases. Node/Chromium pass every driver, with 71 installed-wheel offline checks. Two pinned-reference crash and two host qualifications remain separate from these counts. |

LA-32 adds `UnicodeEncodeError(encoding, object, start, end, reason, /)`,
native allocation/initialization, independent fields and compatible subclasses.
Encoding, object and reason require strings and retain subtype identity. Native
index conversion runs between object and reason validation; failed initialization
keeps old fields and callback mutations after replacing args. Numeric members
accept native integers without index callbacks. Explicit native allocation leaves
object fields absent and numeric fields zero. Runtime codec metadata retains a
separate contract. Scalar construction/read cases are
explicitly shared with core-source/1; native descriptors and callbacks require
classes-source/1. The pinned
[initializer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L3640-L3670)
defines the validation/publication order.

LA-33 adopts native encoding messages. Reason formatting precedes encoding
formatting; both callbacks finish before native object/start/end are read.
An absent object renders an empty string before callbacks. Deleted reason or
encoding renders `<NULL>`, independently of explicit None. Valid single-character
ranges use lowercase two-, four- or eight-digit escapes; other ranges retain
their native positions and signed 64-bit end-minus-one. Native reads bypass
subclass properties, while ordinary `str` honors subclass overrides. Copied host
diagnostics do not execute these callbacks. See the pinned
[renderer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L3673-L3734).

LA-34 composes encoding exceptions with record subclasses, module-owned cycles,
dynamic source frames, causes/notes and suspended generator cleanup.
`examples/interpreter_encoding_exceptions.py` runs unchanged on CPython and in
the offline console. Installed offline acceptance includes fresh source, Stop
and Restart during index/reason/encoding callbacks and a reduced-profile scalar
program. The eight deterministic execution observations retain revision 22.
UnicodeDecodeError follows in LA-35–LA-37; runtime encoding metadata is adopted by LA-38/LA-39.

LA-35 adopts `UnicodeDecodeError(encoding, object, start, end, reason, /)`,
native fields/descriptors/initialization and compatible subclasses. Bytes and
bytes subtypes retain identity; bytearrays and contiguous adopted memoryviews
produce a fresh immutable bytes payload while args retain the original buffer.
Buffer acquisition/copying follows encoding, index and reason validation, so
index callbacks can mutate or release the input. Noncontiguous views raise
BufferError; released views raise ValueError. Owned `__bytes__` is not invoked.
Failed acquisition preserves old fields and callback mutations after replacing
args. Numeric members and native field independence follow LA-32. Native decode
messages follow in LA-36; runtime decoding metadata is adopted by LA-41/LA-42. The
pinned [initializer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L3755-L3796)
defines the copying order.

LA-36 adds native byte/range rendering. Reason formatting precedes encoding
formatting, then native object/start/end are read after both callbacks. A valid
single-byte range uses two lowercase hexadecimal digits; all other ranges keep
their original positions. Missing fields, native property bypass, temporary
callback results, shared work limits and copied host summaries follow LA-33.
Replacing object with a mutable buffer does not repeat constructor conversion;
the renderer requires bytes, including bytes subtypes. See the pinned
[renderer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L3799-L3860).

LA-29 adds `UnicodeTranslateError(object, start, end, reason, /)`, five native
fields, native initializers/descriptors and subclasses. Object/reason require
strings and retain subtype identity. Construction converts start/end in order
through `__index__`, with signed 64-bit bounds; numeric member assignment accepts
integers without index callbacks. Argument replacement precedes validation,
while successful field publication follows it. The exact contract follows the
pinned [native initializer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L3625-L3643).
LA-30 adds native translation rendering; encoding/decoding follow in LA-32–LA-37.
Deleted object/reason fields read as None independently of args and dictionaries.
Owned callbacks preserve their mutations when validation fails. The explicitly
shared scalar core-source/1 cases do not admit owned callbacks in that profile.

Native `UnicodeTranslateError.__str__` follows the pinned
[renderer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L3647-L3697).
An absent object renders an empty string before invoking any reason callback.
Otherwise the native reason is formatted first, then object/start/end are read,
including changes made by that callback. One valid character uses a lowercase
hex escape of width two, four or eight; other ranges use their original numeric
positions and the signed 64-bit end-minus-one value. Native field reads bypass
owned properties. Deleted reason storage renders `<NULL>`, while an explicit
None renders `None`. Argument replacement and the unused encoding field do not
alter this selection. Host summaries retain copied safe diagnostics without
running these source-level formatting callbacks.

LA-31 composes native translation errors with module-owned record subclasses,
dynamic source, causes/notes and suspended generator cleanup. Run
`examples/interpreter_translation_exceptions.py` unchanged on CPython or in the
offline console: a record validator retains the original record/text and reports
the rejected code-point location. The exception corpus now records 543 cases:
535 semantic/error comparisons and eight explicit refusals, including 109 cases
explicitly shared with core-source/1. The four existing host/crash qualifications
remain outside these successful differential counts. These are finite corpus
observations, not an overall Python-completion percentage.

The installed offline acceptance adds Stop/Restart inside native index and reason
callbacks, a fresh restart owner and a reduced-profile translation program. The
eight deterministic execution resource observations retain accounting revision
22. This accepts the UnicodeTranslateError slice while #124 and A2 remain open
for groups/except*, traceback objects/mutation, note rendering/export, remaining
native metadata. General exception
representations and formatting remain under #127.

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

Two delegated-value probes are recorded separately in the corpus's
`reference_boundaries`: deleting `StopIteration.value`, or bypassing native
initialization in a subclass, then exhausting that iterator through `yield from`.
Both isolated CPython 3.14.7 macOS arm64 probes exited with SIGSEGV (-11).
The pinned [native extraction code](https://github.com/python/cpython/blob/v3.14.7/Objects/genobject.c#L635-L649)
appears to explain this through its unchecked native payload reference. These
are retained divergences under #120, excluded from successful differential
counts. Separate interpreter tests require safe None results and complete
logical teardown; automated reference checks do not execute the crashing probes.

Two additional host qualifications record SyntaxError basename and C-long
width differences. The interpreter uses POSIX `/` separators and a signed
64-bit C long for deterministic native location rendering on every host.
Windows CPython uses `\` separators and a 32-bit C long, so those cases differ.
The corpus records exact outputs for each reference host, and conformance
reports expose the declared reference contract, actual reference host and
qualification list. These qualifications remain under #124 and are excluded
from successful differential counts; they are checked separately in Node and
the installed offline console.
Expected Windows outputs are derived from the pinned renderer/separator source
and its C-long width; the separate interpreter probes verify the deterministic
profile. These observations do not certify native Windows rendering parity.

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
`examples/interpreter_native_exceptions.py` adds a named record registry and an
owned cursor: ImportError retains the source name/path, and a StopIteration
subclass retains its independent exhaustion value. Both examples run unchanged
on the pinned reference and in the offline console.
The exact corpus is included in the shared Node/Chromium matrix:

```sh
python scripts/run_tests.py focused --feature exceptions --feature object-scope-inventory
python scripts/run_tests.py browser-conformance --feature exceptions
python scripts/object_integration_browser_smoke.py --exceptions
```

Exception groups/except*, traceback objects/mutation and note rendering/export,
write/delete attribute and custom import provenance enrichment, parser-generated SyntaxError fields and remaining native metadata remain #124. Generator throw of a user
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

LA-23 follows the pinned [attribute-context implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/object.c#L1177-L1202).
Native absence is distinct from explicit None. Enrichment assigns `name` before
`obj` through ordinary exception attribute setters; setter failure replaces the
lookup failure. Direct native generic lookup enriches its missing-member error,
while an AttributeError raised inside its property callback remains unchanged
until an ordinary read surrounds that operation. Previously populated errors
retain their first receiver when reused.

LA-24 follows the native fields in the pinned [from-import failure path](https://github.com/python/cpython/blob/v3.14.7/Python/ceval.c#L2980-L3138).
The registry supplies implicit source provenance; its original filename is an
owned value, shared with the initial module `__file__`. The default native name
uses the current string `__name__` by identity, or None for an absent/nonstring
name. Native messages share the lazily materialized first argument. Custom
`__spec__`, source module subtype provenance and owned namespace-key callbacks
require a separate contract: the original ImportError is still raised/caught,
but its unresolved provenance fields refuse when read. Missing registry records
carry their requested module name internally; verified source grants normally
reject undeclared requests as policy ImportErrors before that lookup occurs.

`examples/interpreter_error_metadata.py` runs unchanged on the pinned reference
and the offline console. A reusable field reader wraps a runtime AttributeError
while retaining the exact record/key as its cause. Offline acceptance also
checks dynamic source frames, interrupted enrichment setters, fresh restart
owners and a reduced-profile cache update. These observations do not widen the
core profile to owned callbacks or the classes-only `getattr` builtin.

LA-26 follows the pinned [SyntaxError initializer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L2544-L2586).
The native fields are `msg`, `filename`, `lineno`, `offset`, `text`, `end_lineno`,
`end_offset`, `print_file_and_line` and `_metadata`. Values retain identity and
remain independent of args and instance dictionaries; deletion resets a field
to None. No arguments preserve existing msg/details, one or more arguments
replace msg, and exactly two arguments convert the second value into details.
Unknown keywords fail before replacing args. Conversion completes before count
validation and ignores owned length hints, matching the pinned
[sequence conversion](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c#L1866-L1937).
Explicit native new leaves fields None; generic BaseException initialization
preserves them. Compatible generic bases share storage; conflicting structured
layouts are rejected. Parser-generated native fields retain their field-read
gate, while existing copied diagnostic messages remain available.

LA-27 follows the pinned [native renderer](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c#L2625-L2692).
No filename/line suffix preserves an exact string message's identity. A suffix
produces a native string after the message callback completes, using the
previously read native filename and exact-int line number. Overflow renders -1;
offset/text/end/metadata/print flags do not affect `str`. Host summaries retain
their safe copied-diagnostic contract and do not invoke message callbacks.

`examples/interpreter_syntax_exceptions.py` runs unchanged on CPython and the
offline console. It reports a record location while retaining the original
token in details/metadata and preserving the cause and note. LA-28 also accepts
original dynamic source frames, module-created cycles, generator cleanup
failures and cancellation during native detail iteration or message callbacks.
All eight existing deterministic resource observations retain revision 22.

These two batches keep A2 and #124 open for groups/except*, traceback objects
and mutation, note rendering/export, write/delete attribute metadata, custom
import provenance, parser-generated syntax fields, remaining native metadata
and the declared host qualifications. Remaining general displays/formatting
stay under #127. Package/library qualification and candidate/release gates keep
their separate evidence requirements.


LA-37 accepts composed decoding failures across modules, dynamic source and
suspended generator cleanup, including copied buffers after release of their
original input graph. Run `examples/interpreter_decoding_exceptions.py` unchanged
on CPython or in the offline console. Installed acceptance adds fresh source,
original dynamic diagnostics, Stop/Restart in index/reason/encoding callbacks
and a reduced-profile bytes program.

The combined exception corpus records 940 cases: 929 semantic/error comparisons
and 11 explicit refusals, with 267 cases explicitly shared by core-source/1.
Six host/crash/cache qualifications remain separate. These finite
observations do not measure overall Python completion. The eight deterministic
resource cases retain accounting revision 22. Explicit Encode/Decode
construction, native fields, subclasses and rendering are adopted. Runtime
encoding metadata is adopted through LA-40 and decoding metadata through
LA-43. The one-byte bytes-cache identity qualification retains #117. Groups/except*, traceback objects/mutation, note rendering/export,
remaining attribute/import/parser metadata and general representations retain
their existing #124/#127 owners. A2 and candidate/release gates remain open.

LA-38 adopts runtime strict ASCII/Latin-1 encoding failures in `str.encode` and
`bytes`/`bytearray` string constructors. The native fields and five arguments
share the canonical codec/reason values and retain the original string,
including its subtype identity. Positions count Unicode code points and cover
the first contiguous unencodable run, following the pinned
[one-byte encoder](https://github.com/python/cpython/blob/v3.14.7/Objects/unicodeobject.c#L6917-L7090).
Native fields remain independent of later argument replacement. Aliases and
string-subtype codec options use their native content without invoking user
formatting. Source rendering uses the adopted native renderer; host summaries
keep the copied diagnostic message. UTF-8 surrogate metadata follows in LA-39;
automatic decoding fields follow in LA-41/LA-42.

LA-39 adopts strict UTF-8 surrogate failures with canonical `utf-8` encoding and
`surrogates not allowed` reason. The first contiguous surrogate run uses source
code-point positions, including after astral characters. The original string
and its subtype remain shared by the native object field and args; rendering
reads native content without calling the input's `__str__`. Existing successful
UTF-8 encoding and the finite codec/error-policy admission are unchanged.

LA-40 accepts runtime encoding failures across modules, dynamic source, notes,
causes and suspended generator cleanup. Run
`examples/interpreter_runtime_encoding.py` unchanged on CPython or in the offline
console. Installed acceptance exercises fresh source, original dynamic frames,
Stop/Restart in runtime-error rendering and reduced-profile runtime metadata.
All eight deterministic execution observations retain accounting revision 22.

LA-41 adopts strict ASCII decoder metadata through bytes/bytearray methods and
native bound/unbound entry points. The canonical `ascii` encoding and
`ordinal not in range(128)` reason identify the first invalid byte. Native
object and args share an immutable exact-bytes snapshot, including when the
receiver is a mutable buffer or subtype. Subsequent buffer mutation and argument
replacement preserve that snapshot. UTF-8 metadata follows in LA-42.

General bytes interning remains #117: CPython can reuse its one-byte bytes
singleton for decoder snapshots, whereas this profile creates a fresh snapshot.
The named `runtime-decode-single-byte-cache-identity` divergence is recorded and
checked separately from successful differential observations. Snapshot content,
argument/native sharing and exact bytes type are adopted for every length.

LA-42 adopts strict UTF-8 decoder metadata and the pinned
[failure selection](https://github.com/python/cpython/blob/v3.14.7/Objects/unicodeobject.c#L4978-L5072).
Invalid leading bytes cover one byte; a failed continuation excludes that byte
from the native range; truncated valid prefixes extend to the input's end.
Overlong encodings, surrogate encodings and values above U+10FFFF fail at the
second-byte restriction before later truncation is considered. Canonical
`utf-8`, native snapshot/args sharing and all three exact reason strings are
adopted. The matrix includes every possible leading byte and continuation
boundaries for each special leading-byte family. The #117 bytes-cache identity
qualification remains separate.

LA-44 adopts native `name`/`obj` fields for failed generic writes to `object`
and dictionary-free source instances. A missing class attribute records the
original receiver and key; a read-only non-data attribute leaves both fields
absent (reading as None). Syntax, `setattr` and explicit native object setters
share that selection. String-subtype keys passed to `setattr` retain identity
without formatting callbacks. Owned setters and descriptors keep the exception
they raise, without automatic outer-write enrichment. Argument replacement
does not release the independent native fields. This follows the pinned
[generic storage failure paths](https://github.com/python/cpython/blob/v3.14.7/Objects/object.c#L1820-L1917).
Other native mutation layouts and deletion metadata retain #124. LA-44A accepts
string-subtype names in native object/module mutation wrappers and native
method/super/object/type/module getters. Validation reads the native string
payload without calling `__str__`, while dispatch retains the original key.
Type namespace writes using subtype keys retain their owned-hash publication
gate under #124, recorded as a separate corpus refusal.
Generated diagnostic wording retains its existing copied-message contract.

LA-45 adopts selective deletion fields for dictionary-free source instances,
empty native slots, string-subtype names and explicitly replaced/reset instance
dictionaries. Missing dictionary entries retain receiver/name identity even
when a class value exists. Empty slots and read-only non-data attributes leave
both fields absent; owned hooks/descriptors keep their own exceptions. Native
dictionary mutation converts a callback's KeyError (including subclasses) into
a fresh AttributeError without retaining the discarded callback as its context.
That conversion also publishes fields for the existing generic write path.

Exact-string deletion metadata from original instance storage retains a named
field-read refusal under #124. CPython's shared-key cache and inline-storage
transitions can select either empty or populated native fields, including after
cache exhaustion. This profile does not track that native state. It still
raises/catches the original AttributeError and preserves copied diagnostics;
subtype names, replacement, self-assignment and dictionary deletion take the
qualified dictionary path. Other native/module/class mutation layouts remain
separately owned. The pinned [inline failure path](https://github.com/python/cpython/blob/v3.14.7/Objects/dictobject.c#L6505-L6565)
defines this retained distinction.

LA-46 accepts generic mutation failures across modules, dynamic source, causes,
notes and suspended generator cleanup. Run
`examples/interpreter_attribute_mutations.py` unchanged on CPython or in the
offline console. Installed acceptance checks original dynamic write/delete
frames, fresh source and receivers, Stop/Restart in a setter and dictionary
comparison callback, and the reduced profile's mutation-builtin boundary.
The 88 new corpus cases contain 85 supported comparisons and three explicit
refusals, with one additional reference crash qualified separately. These
finite results do not measure overall Python completion. Core admission is
unchanged; six host/crash/cache qualifications remain separate. A2, groups/except*,
tracebacks, note export, remaining native metadata and library/package/candidate
gates remain open.

LA-43 accepts runtime decoding failures across modules, dynamic source, notes,
causes and suspended generator cleanup. Run
`examples/interpreter_runtime_decoding.py` unchanged on CPython or in the offline
console. It repairs an original mutable record while preserving the error
snapshot. Installed acceptance adds original dynamic diagnostics, released
input graphs, Stop/Restart in runtime-error rendering and reduced-profile
decoder metadata. The eight deterministic execution resource observations
retain revision 22. Groups/except*, traceback objects/mutation, note export and
remaining attribute/import/parser metadata retain #124; wider codec/error-policy
APIs and bytes-cache identity retain #117; general formatting remains #127.

LA-46A qualifies `delete-metadata-callback-mutates-dictionary`: replacing the
original instance dictionary from inside its key comparison produced SIGSEGV
(-11) in three of sixteen isolated pinned CPython 3.14.7 macOS arm64 probes.
Two Linux CI reference invocations also crashed before case diagnostics were
available. The input remains checked for safe interpreter results and logical
teardown in Node and the installed offline console; automated differential
runs exclude it. The pinned [borrowed dictionary path](https://github.com/python/cpython/blob/v3.14.7/Objects/dictobject.c#L6505-L6558)
is consistent with a lifetime problem across that callback, but does not by
itself establish the root cause. Failed reference subprocesses now identify
the corpus input and exit code or timeout, preserving the original failure.

LA-47 adopts module mutation failures. Missing deletions preserve the original
module and string key, including string subtypes, independently of args.
Read-only module dictionaries and missing property setters/deleters leave both
native fields absent. Source module subclasses use their ordinary dictionary
storage without the original-instance shared-key qualification. Native module
wrappers and owned hooks/descriptors retain their existing dispatch order.
Dictionary comparison KeyError subclasses become a fresh populated
AttributeError; other callback errors keep their identity. The pinned
[generic mutation implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/object.c#L1820-L1917)
defines this selection. Direct construction of the reflected module type retains
its existing boundary; registry modules and adopted module subclasses supply
the tested receivers. Other native mutation layouts remain separately gated.
