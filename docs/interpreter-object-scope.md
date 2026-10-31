# Object scope reconciliation

O95 reconciles the finite O1–O94 object/construction/reflection contract before
O96 integrated acceptance. CPython 3.14.7 remains the oracle. The
[machine-readable audit](interpreter-object-scope.json) records every O-corpus
boundary and every explicit refusal site in the current engine. Run
`python runtime/check_object_scope.py --report build/object-scope-report.json`.
CI runs this audit alongside source conformance.

The current contract includes live module/class/function/wrapper/instance
namespaces, complete native dictionaries and live proxies, owned function
state/code/cells/frames, integer identity, finite native directories, expanded
class construction/prepared mappings/factories/custom MRO, actual-metaclass
protocols, slots and builtin subtypes, compatible class/base reassignment,
arithmetic and explicit native protocols, and bounded compile/eval/exec/imports.
The original stage documents retain their checkpoint measurements. Their older
remaining-work statements are superseded by this reconciliation and the later
linked contracts, rather than reopening already delivered stages.

## Evidence rules

Every O-corpus case outside its `implemented_stages` has an exact `owner` and
`boundary`. The audit verifies this inventory against the actual corpora, source
refusal sites, native layout tables, native field/invocation owners and class
slot policy. It requires an actual positive source case for every O1–O96 identifier, rather
than a manifest entry alone. It fails when a refusal is added without reconciliation or a
compatibility row still assigns unfinished work to INT-OBJECT-01. Existing
source matrices execute all admitted behavior and require retained boundaries
to refuse explicitly; the O95 composition also exercises the formerly stale
namespace, metadata, subtype and dynamic-source claims together.

The compatibility inventory separates positive `evidence` from
`boundary_evidence`. An intentional refusal or a builtin availability probe is
not evidence for an API signature. Boundary checks earn no support credit. A
native namespace entry establishes stored metadata and binding; its separate
API is only adopted over its finite signature/operand contract. The generated
native ownership report does not invoke or certify every listed library method.

## Exact remaining boundaries

| Form | Owner or boundary |
| --- | --- |
| General sequence constructors/methods, iterable length-hint consumers, reversed protocols, range hashing, structural dictionary restart semantics | #116 |
| User-key set algebra/hashing, binary/buffer/codec APIs and bytearray resizing | #117 |
| Function-default expression grammar beyond the admitted literal forms | #118 |
| Other unadopted source grammar, AST/future/incomplete compilation modes | #119, with annotation modes #125 and async modes #34 |
| Further generator send/throw/close/yield execution signatures | #120 |
| Context managers and pattern matching | #121 |
| Exception subclasses/payloads/chaining/groups/tracebacks, including UnicodeTranslateError construction | #124 |
| Annotation/type-parameter evaluation, generic aliases/unions and class subscription | #125 |
| Serialization/reduction/state, abc/weakref/gc/debug libraries, named Unicode database, broader importlib/wildcard/library APIs | #126; package certification #128 |
| Expanded default/float/complex/container displays, recursive property diagnostic displays, formatting and f-/t-strings | #127 |
| General complex powers, non-finite numeric recovery and extra numeric methods | #184 |
| Native coroutine/await, async protocols, host adapters and durable application acceptance | #34 |
| Raw CPython/JavaScript executable data, backend function/code constructors/replacement, C ABI/layout interchange, frame tracing/jumping/clearing/bytecode positions, finalizer scheduling and raw addresses | Outside the finite independent source interface |
| Class/metadata/directory operations in the reduced core profile and legacy bytecode formats | Explicit profile boundary; classes-source/1 is the adopted object profile |

Namespace operations introduced by O67/O70/O80 remain responsible for their own
correctness. A broader dictionary/sequence boundary cannot excuse an incorrect
adopted namespace operation. Slot layout supports weak-reference storage without
adopting a weakref library or finalizer scheduler. O85/O86 subtype behavior covers
the already admitted value APIs, without expanding their constructors/methods.

The source-refusal ledger distinguishes source admission, exact neighboring API
boundaries, native tables, and internal synchronous/legacy helpers. Those helpers
cannot start owned callbacks; independently compiled classes-source/1 code uses
the owned execution paths. Their defensive errors do not defer the corresponding
adopted source feature. Unknown internal representations remain outside the
source interface. O96 must still exercise composition, failure, limits,
collection, cancellation and close.

## Parent prerequisite map

#123 supplies the object/namespace/code interface prerequisites for exception
work #124 and annotations/generics #125. Those issues may consume the delivered
interfaces; they keep their own acceptance criteria. #33 retains remaining C3
protocol/API work under #116/#117/#120/#121/#124/#125/#126/#127/#184 and any
separately adopted interfaces. Completing O96 closes #123 only. It does not close
#33, #34, #99's continuing compatibility program, or another milestone, and does
not authorize a release, publication or deployment.

O96 composes this scope through the [integrated acceptance](interpreter-object-integration.md)
and its versioned evidence. The fixed denominator is 30 remaining stages / 96
historical stages; neighboring library/API work does not extend that denominator.
