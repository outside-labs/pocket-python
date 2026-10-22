# Independent Python interpreter implementation plan

Part 3 of the coordinated Python application program; adopted 2026-10-20.
Planning/issue owner: pocket-python. This records delivered prototype stages and future work; released
pocket-python 0.2.0 assembles compiled and supplied MicroPython applications.

The development source-console milestone now runs newly entered Python offline
in Chromium, using our independent parser/compiler/VM. Measured optional library
profiles now have full/reduced and complete-application evidence. Class foundations,
private names and adopted descriptors/decorators now run in Node and Chromium.
Special call and length/truth protocols now have shared admission, resumable
dispatch and offline acceptance. Execution ownership is consolidated. The
versioned compatibility inventory orders the remaining C3 protocols, broad
language/library work and persistent async applications;
the application-alpha publication gates remain open.

## Goal and ownership

Develop progressively broad Python 3.14+ language, builtin and standard-library
coverage through our own execution engine, usable from a native/CLI harness and
browser worker. Finite language/application profiles are delivery checkpoints
within that continuing implementation program. After initial loading and
caching, users can enter new Python source, run it locally, observe results and
errors, interrupt long computation and restart offline.

Execution must not delegate to CPython, MicroPython, Pyodide, our ahead-of-time
JavaScript application compiler or a server. Build/test tools may use pinned
CPython as an oracle. The browser source-execution milestone includes an
independent tokenizer, parser, binding/compiler passes and VM on the client.

The selected first implementation is a JavaScript VM under runtime/ in this
repository. Node hosts CLI/tests and the same engine runs in a browser worker.
[Architecture and prototype evidence](docs/interpreter-architecture.md) record
the decision. A later C/Rust-to-WebAssembly backend remains planned separately. Keep engine/build inputs isolated from
the dependency-free Python packaging CLI. Do not implicitly create a repository,
change visibility or choose a distribution identity. Third-party implementation
code needs recorded ownership, notices and licenses; rebranding an existing
interpreter does not satisfy independent-engine acceptance.

## Consolidation and continuing compatibility adopted 2026-10-21

The [execution and compatibility roadmap](docs/interpreter-roadmap.md) records the
implemented five-part consolidation before further C3 feature implementation:
execution/ownership contract, exhaustive pending-operation roots, owned Execution
with safe-boundary stepping, shared operation/builtin phases, and scheduled module
initialization. The [execution contract](docs/execution-contract.md) and
[compatibility/payload record](docs/measurements/2026-10-22-execution-consolidation.json)
cover the owned instruction/module driver and unchanged composed resource
baselines. The existing JavaScript VM, front end, values, bytecode 4/5,
capability model, synchronous facade and fresh-run console remain the baseline.

- [INT-EXEC-01](https://github.com/outside-labs/pocket-python/issues/94): Adopt the consolidated execution and ownership contract.
- [INT-EXEC-02](https://github.com/outside-labs/pocket-python/issues/95): Centralize pending operation ownership.
- [INT-EXEC-03](https://github.com/outside-labs/pocket-python/issues/96): Extract owned execution state with safe-boundary stepping.
- [INT-EXEC-04](https://github.com/outside-labs/pocket-python/issues/97): Share operation phases and builtin dispatch.
- [INT-EXEC-05](https://github.com/outside-labs/pocket-python/issues/98): Schedule module initialization on the execution machine.

[INT-COMPAT-01](https://github.com/outside-labs/pocket-python/issues/99) tracks broad language/library
coverage independently of game requirements. The delivered
[inventory](docs/interpreter-compatibility.md) records 30 feature surfaces, all
71 builtin-function names and 25 finite linked work packages, including functions/scopes, ordinary
builtins, generators, comprehensions, context managers, pattern matching,
coroutines/async generators, annotations, t-strings, object protocols and selected
real pure-Python packages. Initial application-profile completion does not close
this wider goal. Keep Python-version, target, language, stdlib, package and native
ABI promises separate; the pinned 3.14.7 oracle changes only deliberately.

The [bounded repr/str slice](docs/interpreter-formatting.md) is implemented. Next,
resume indexed-object, iteration and equality/hash protocols while the
persistent-session/host program advances through its own contracts. INT-09 and
INT-10 stay open; the execution foundation is delivered, while their remaining
protocols, parked ownership, events and host/async behavior still require
implementation. The mobile
inference/animation [feasibility task](https://github.com/outside-labs/pocket-python/issues/100) is a
separate Triage track with minimum devices, assets and budgets still to select.
Spatial UI browser adaptation, optional expose_api services, Shimify reduction and
AOT compilation remain explicit cooperating boundaries. Their product milestones
do not gate unrelated Python conformance. The later C/Rust/Wasm path is retained.

## Relationship to source reduction and compilation

Shimify reduces source dependencies; Python-JavaScript compiles approved
application code before deployment; pocket-python assembles either compiler
artifacts or interpreter assets/verified sources with host adapters. An optional
upstream CPython WASM build remains an existing-engine distribution.

Share fixtures, source locations, artifact identities, conformance reporting
and the host protocol where useful. The interpreter does not inherit the
compiler's ECMAScript-oriented compatibility objects or interchangeable IR/
bytecode. Shared formats require a versioned compatibility contract. Host
bridges do not change Python language semantics.

## Common acceptance application

Use a small text_metrics application: shared Python computation counts
characters, words and lines; a local pure-Python helper and immutable constants
establish module boundaries, with an unused utility for reduction. Start the
compiler with a single-module equivalent, then add local imports. Adopt results
for empty strings, Unicode/astral characters, whitespace, invalid arguments and
numeric boundaries through the source-language contract.

Run shared logic through a CPython 3.14 CLI and local standard-library HTTP test
endpoint. The browser has a text area, a button and visible results; computation
runs offline. The interpreter later accepts this source as new input after
deployment. Keep server-only adapters/data outside client allowlists. No new
framework or external service is needed for this acceptance application.

Retain packaging==25.0 as Shimify's independent real-package module regression.
For resource work, extend the local fixture with one named UTF-8 stop-word file.
The new compiler/interpreter need not support the whole packaging library to
meet their first milestones.

[The adopted language contract](docs/interpreter-language.md) and its CPython
reference corpus define the first semantic decisions. The corpus is reference
evidence, not an already implemented engine. The adopted
[conformance harness](docs/interpreter-conformance.md) runs feature-tagged engine
fixtures in Node and browser workers with explicit unsupported-case reporting.
The first [verified bytecode core](docs/interpreter-bytecode.md) implements
bounded integer/boolean arithmetic and branches; source parsing and the remaining
language/object stages stay explicit dependencies.

## Staged compatibility

Python 3.14 is the initial reference grammar/semantics, not a promise of complete
3.14 support. Track supported/rejected/deferred syntax, operations, builtins,
stdlib, host APIs and package/ABI behavior separately. Unsupported behavior
raises source-located errors instead of invoking another engine.

| Stage | Required proof | Explicitly later |
| --- | --- | --- |
| A: bounded VM | Chosen reproducible toolchain, our verified bytecode/execution loop, expressions/control flow, adopted scalar/container semantics and resource limits in a native harness. | Independent source parsing, broad stdlib, classes and async. |
| B: language core | Functions, argument/default binding, scopes/closures, exceptions, explicit modules, small library and independent source parser/compiler. | General packages, full reflection, generators and CPython extensions. |
| C: browser source execution | New source entered after deployment runs locally, including offline reload, output/errors, interrupt and restart. | Broad class support and full asynchronous host integration. |
| D: application alpha | Adopted classes/descriptors/decorators, async/host adapters, measured profiles and documented native/browser conformance. | Full Python compatibility, arbitrary pip packages, C ABI and automatically minimal VM generation. |

The first console does not wait for full classes/async. INT-REL-01 is the later
application-alpha candidate gate; earlier stages provide reviewable checkpoints.
Select version numbers and publication separately from this roadmap.

## Architecture decisions and invariants

- Start with the selected JavaScript VM and preserve the same Python semantic
  corpus for a later C/Rust-to-WebAssembly backend. Select C versus Rust and its
  toolchain after a measured JavaScript baseline, not by assuming equivalence.
- Separate tokenizer/indentation/grammar, bindings/scopes, compiler, verified
  bytecode and VM. Early VM fixtures may use build-time CPython ast; stage C
  parses new source independently on the device.
- Define our bytecode version, operands, stack/register discipline, control flow,
  value ABI and source spans. Reject unknown/malformed input. CPython .pyc is
  not an implicitly compatible execution format.
- Specify Python integer precision, Unicode, truthiness, equality/hash, container
  mutation, evaluation order and errors. Never silently substitute JavaScript
  Number/string/container behavior; reject unimplemented cases explicitly.
- Choose allocation/collection and cycle policy before broad object graphs.
  Account for closure/host-handle ownership, recursion/stack growth, allocation
  pressure, teardown and stale handles.
- Budget instructions and expensive primitive operations, with cancellation
  and exception unwinding. Browser worker termination remains a final stop path.
- Define verified module roots, import caching/order and small named library
  profiles. No implicit host imports, pip installer, CPython native extensions,
  unrestricted filesystem or undeclared networking in the first milestone.
- Use a versioned host protocol for serialized values/errors, output, DOM/events,
  Fetch, virtual files and persistence. DOM runs on the main thread; worker
  requests are asynchronous with explicit ownership/cancellation.
- Workers separate engine state and protect responsiveness; they are not a
  security boundary for arbitrary same-origin code. Host capabilities carry
  application authority. A hostile multi-user execution service is outside
  this initial local-application contract.

## Ordered interpreter queue

| Task | Scope | Depends on | Readiness at adoption |
| --- | --- | --- | --- |
| [pocket/INT-01](https://github.com/outside-labs/pocket-python/issues/23) | Specify independent interpreter language stages and compatibility | Released foundation | Ready |
| [pocket/INT-02](https://github.com/outside-labs/pocket-python/issues/24) | Establish the selected JavaScript VM architecture and prototype | [pocket/INT-01](https://github.com/outside-labs/pocket-python/issues/23) | Blocked |
| [pocket/INT-QA-01](https://github.com/outside-labs/pocket-python/issues/25) | Establish interpreter differential and negative conformance | [pocket/INT-02](https://github.com/outside-labs/pocket-python/issues/24) | Blocked |
| [pocket/INT-03](https://github.com/outside-labs/pocket-python/issues/26) | Implement versioned bytecode, validation and the execution loop | [pocket/INT-QA-01](https://github.com/outside-labs/pocket-python/issues/25) | Blocked |
| [pocket/INT-04](https://github.com/outside-labs/pocket-python/issues/27) | Implement core Python values and container semantics | [pocket/INT-03](https://github.com/outside-labs/pocket-python/issues/26) | Blocked |
| [pocket/INT-05](https://github.com/outside-labs/pocket-python/issues/28) | Implement memory lifetime, execution budgets and host handles | [pocket/INT-04](https://github.com/outside-labs/pocket-python/issues/27) | Blocked |
| [pocket/INT-06](https://github.com/outside-labs/pocket-python/issues/29) | Implement functions, scopes, closures and exceptions | [pocket/INT-05](https://github.com/outside-labs/pocket-python/issues/28) | Blocked |
| [pocket/INT-07](https://github.com/outside-labs/pocket-python/issues/30) | Implement explicit module loading and a small standard library | [pocket/INT-06](https://github.com/outside-labs/pocket-python/issues/29) | Blocked |
| [pocket/INT-08](https://github.com/outside-labs/pocket-python/issues/31) | Implement an independent source parser and bytecode compiler | [pocket/INT-07](https://github.com/outside-labs/pocket-python/issues/30) | Blocked |
| [pocket/INT-WEB-01](https://github.com/outside-labs/pocket-python/issues/32) | Deliver an offline browser interpreter console and application profile | [pocket/INT-08](https://github.com/outside-labs/pocket-python/issues/31), [pocket/HOST-01](https://github.com/outside-labs/pocket-python/issues/17) | Blocked |
| [pocket/INT-09](https://github.com/outside-labs/pocket-python/issues/33) | Extend class, descriptor and decorator semantics | [pocket/INT-WEB-01](https://github.com/outside-labs/pocket-python/issues/32) | Blocked |
| [pocket/INT-10](https://github.com/outside-labs/pocket-python/issues/34) | Implement asynchronous execution and browser host adapters | [pocket/INT-WEB-01](https://github.com/outside-labs/pocket-python/issues/32) | Blocked |
| [pocket/INT-11](https://github.com/outside-labs/pocket-python/issues/35) | Measure interpreter profiles and bounded component inclusion | [pocket/INT-WEB-01](https://github.com/outside-labs/pocket-python/issues/32) | Blocked |
| [pocket/INT-REL-01](https://github.com/outside-labs/pocket-python/issues/36) | Validate an independent interpreter alpha candidate | [pocket/INT-09](https://github.com/outside-labs/pocket-python/issues/33), [pocket/INT-10](https://github.com/outside-labs/pocket-python/issues/34), [pocket/INT-11](https://github.com/outside-labs/pocket-python/issues/35), [pocket/MEASURE-01](https://github.com/outside-labs/pocket-python/issues/20) | Blocked |

At adoption INT-01 was Ready; INT-02 followed its language contract. INT-QA-01 establishes
the harness before VM implementation and grows with every feature. INT-WEB-01
requires the independent parser and HOST-01, not the completed ahead-of-time
compiler. Classes, async and measurement follow the console milestone along
their own dependencies; the alpha candidate requires their recorded evidence.

## Later C/Rust WebAssembly implementation

The first engine is the JavaScript VM. The second route remains explicit planned
work, with separate toolchain/ABI, implementation and integration gates:

| Task | Deliverable | Depends on |
| --- | --- | --- |
| [INT-WASM-01](https://github.com/outside-labs/pocket-python/issues/40) | Specify the later C/Rust WebAssembly backend | pocket/INT-11 |
| [INT-WASM-02](https://github.com/outside-labs/pocket-python/issues/41) | Implement the C/Rust native and WebAssembly engine | pocket/INT-WASM-01 |
| [INT-WASM-03](https://github.com/outside-labs/pocket-python/issues/42) | Integrate and compare JavaScript and WebAssembly interpreter backends | pocket/INT-WASM-02, pocket/MEASURE-01 |

Both backends use the adopted Python corpus and host protocol; bytecode/ABI
compatibility needs explicit proof or versioned translation. C/Rust owns its
allocation/GC and value behavior, with no automatic engine fallback.

## Verification and candidate gates

Compare values, errors and observable side effects with pinned CPython in test
harnesses only. Encode large integers, Unicode/surrogates, NaN/infinities/signed
zero and exceptions without losing distinctions through JSON. Track intentional
unsupported cases and platform differences in a versioned compatibility matrix.

Add feature-tagged syntax/scope/closure/argument/import/mutation/traceback tests,
bounded malformed-source/bytecode fuzzing, instruction/memory/recursion budgets,
GC/stale-handle checks, exception unwinding and repeated stop/restart. Every
interpreter PR extends the corpus; a late QA milestone is not a substitute.

Test actual browser new-source execution, offline reload, URL subdirectories,
cache upgrades, host callback cleanup and absence of remote/runtime fallback.
Verify native builds and complete asset/license closure. Compare footprints,
startup and memory only over common supported behavior. Excluding optional
modules requires pinned bootstrap/transitive closure and differential evidence;
a static source report never authorizes VM/object-model removal.

Prepare a candidate with reproducible build receipts, native/browser evidence,
compatibility limits, isolated installs and licenses before a separate release
decision. Do not replace existing releases or introduce a remote execution
service as an implementation shortcut.

## Delivery, readiness and measurement

Issues and Projects hold current state; plans describe architecture/acceptance.
Ready means adopted scope and finished dependencies; Blocked means unfinished
dependencies; Triage means an optional or unselected extension. A contract or
architecture task may be Ready while later implementation awaits its decisions.
Do not mark a feature Done for documenting it. Update dependent readiness after
merges; Task, Order, Dependencies, Target and Readiness make the queue explicit.

Use rolling batches of 3-5 focused PRs. Start CI, continue independent work or
stack dependent changes, squash passing changes in dependency order and verify
final main. Preserve parent branches while open dependents target them;
reconcile, retarget and recheck descendants before deleting dependency bases.

Compare supported behavior before footprints. Separate source bytes, generated
code/helpers, interpreter assets, data/notices, source maps, complete uncompressed
bytes and compressed transfer. Record tool/engine/host versions, cold/warm
startup and memory method. No fixed size/performance/compatibility claim follows
from this roadmap. Incomplete import reports and unobserved dependencies never
authorize removal.

Keep releases/tags immutable. New runtime dependencies, services, engine
repository/package identity, release uploads and deployment retain their explicit
scope/decision requirements. This planning update changes no runtime dependencies
and publishes no package.

## Related plans and specifications

- [Application assembly](IMPLEMENTATION_PLAN.md)
- [Source reduction](https://github.com/outside-labs/shimify/blob/main/IMPLEMENTATION_PLAN03.md)
- [Compiler/browser target](https://github.com/outside-labs/Python-JavaScript/blob/main/IMPLEMENTATION_PLAN.md)
- [Python 3.14 language reference](https://docs.python.org/3.14/reference/)
- [Python 3.14 data model](https://docs.python.org/3.14/reference/datamodel.html)
- [Python WebAssembly availability](https://docs.python.org/3.14/library/intro.html#webassembly-platforms)

## Development checkpoint: 2026-10-20

INT-01, INT-02, INT-QA-01 and INT-03 are merged. The development checkout now
implements [INT-04 values and staged containers](docs/interpreter-values.md)
with tagged None/bool/int/float/str, tuples/lists/dicts, aliases, indexing/slicing,
key equality and iteration. Bytecode version 2 has Node/browser differential
fixtures and explicit rejection of unimplemented operations. INT-05 adds
[rooted lifetime, allocation budgets and host handles](docs/interpreter-memory.md);
source parsing remains INT-08.
The JavaScript VM remains first, with the later C/Rust WebAssembly route retained.
Published 0.1.0 artifacts are unchanged; live delivery status is in the Issues
and Project, while the table above preserves the adopted dependency sequence.


INT-05 uses host JavaScript GC with explicit VM roots and iterative cyclic-graph
accounting at safe points. Supported object allocations, mutable growth, scalar
root/edge costs, active scopes, work and handles have deterministic limits.
Retained session results and declared host callback captures use owned leases;
stale/foreign handles and failed allocations are explicit. Teardown releases
all entries and attempts every native disposer. Shared interpreter-memory/1
checks run in Node and browser workers alongside the existing language corpus.
Python calls/closure cells and exception handlers remain INT-06; this milestone
provides and tests their root/scope ownership primitives. Accounting describes
defined logical byte costs, not process RSS or actual host collection timing.
No runtime dependency, package release or backend/toolchain choice changed.


INT-06 adds [version 3 functions, scopes and exception unwinding](docs/interpreter-functions.md).
It implements iterative call frames, positional/keyword/default binding, rooted
lexical cells and closures, recursion, structured loop/try/except/else/finally
completion and source-located traceback propagation. CPython differential and
resource cases run in Node and Chromium, with remaining boundaries recorded.
Fixtures use trusted build-time AST lowering; independent source parsing remains
INT-08. Explicit modules and the small named library follow in INT-07. Published
artifacts are unchanged.

INT-07 combines the [verified module registry and execution profile](docs/interpreter-modules.md):
explicit roots/grants, hashed source/bytecode/notices, per-session module/cache
identity, ordered initialization, relative imports, failure cleanup and explicit
cycle rejection. Version 4 preserves defining-module globals/defaults/closures
and exception identities across imports. A supplied Python operator profile and
small builtin subset run through this VM; the unchanged shared text-metrics
computation passes Node/Chromium differential and resource checks. Independent
source parsing is next in INT-08; published artifacts remain unchanged.

## Assembler release boundary

The authorized pocket-python 0.2.0 publication includes the compiled and supplied
MicroPython assemblers. Independent `runtime/` prototypes remain outside its
wheel/sdist; source parsing, browser-console adoption and INT-REL-01 are separate
interpreter gates. [REL-02](https://github.com/outside-labs/pocket-python/issues/56)
records publication verification. INT-08 remains next and is not a release claim.

## Independent source tokenizer

INT-08 now has an independent bounded tokenizer in `runtime/source-tokens.mjs`,
with UTF-8 locations, indentation, literal decoding and pinned Unicode 16
identifier data. [The source front-end contract](docs/interpreter-source.md)
describes resource/cancellation limits and explicit exclusions. Eight unit groups,
500 seeded malformed inputs and 205 CPython lexical comparisons pass in Node
and Chromium. This is lexical analysis, not source execution; the remaining
INT-08 work is statement/expression parsing, bindings and verified bytecode
compilation. The source engine and browser console are still unreleased.

## Independent source execution delivered

INT-08 now delivers our own tokenizer/parser, lexical scope and closure binding,
immutable-default validation and version-4 bytecode compiler in Node and Chromium
workers. New source is compiled locally and executed by our VM; CPython is only
a test oracle. The [core-source/1 contract](docs/interpreter-source.md) names its
grammar, builtin/value exclusions, provenance, explicit import grants and
compilation/execution budgets. Source syntax errors, unsupported features,
evaluation order, Unicode bindings, exception traces, modules, aliases and
teardown have differential/policy coverage. Older bytecode fixture profiles
remain separate; deferred source features are never credited as executed.

Next is INT-WEB-01 (#32): an offline source console/application profile using
this engine, output/errors, interrupt/restart and reload validation. It is ready
after INT-08 integration; class/async/performance and INT-REL-01 remain later
gates. The C/Rust-to-WebAssembly option stays in INT-WASM-01–03. Published
assembler 0.2.0 artifacts exclude `runtime/`; no independent-engine release is
claimed by these implementation milestones.

### Source console integration stages (2026-10-21)

INT-WEB-01 begins with a versioned, output-only host/worker adapter using the
independent source engine. The [console contract](docs/interpreter-console.md)
records initialization, tagged source, fresh per-run registries, bounded
messages/output/memory, source diagnostics, deadlines and immediate worker
termination. Node state-machine tests exercise these paths. Follow with explicit
engine/source application assembly and the editor, then real-browser offline,
subdirectory, update and regression acceptance before closing the milestone.
The adapter stage alone is not an offline-console or publication claim.

The second integration stage adds development `interpreter-web` assembly and an
editor with output, source diagnostics and main-thread stop/restart controls.
The explicit client-source/notice allowlist and pinned twenty-asset engine graph
are hashed without executing input. The schema-2 receipt records complete local
closure, notices, source/engine identity and bytes. Initial source/configuration
are verified, and service-worker precaching checks SHA-256 integrity while
retaining the established waiting-update lifecycle. Focused assembly and installed
artifact checks accompany this stage; comprehensive browser acceptance is next.

### Browser source milestone accepted (2026-10-21)

INT-WEB-01 now delivers a complete independent source console. Fresh Chromium
applications pass seven comparisons against CPython's shared computation and
nine acceptance groups covering new source after offline reload in a URL
subdirectory, original source errors, fresh state, responsive interruption,
repeated restart, explicit grants and bounded messages/allocations/work, host
output-error recovery, deadlines, stale/malformed sessions and listener cleanup.
Integrity failure refuses an initial install; a missing update asset preserves
the old offline graph. Complete updates wait for all old tabs to close and clean
only that scope's prior cache. Existing compiled/MicroPython regressions remain
in CI alongside interpreter conformance; reports retain engine/tool hashes.

Following the console and profile measurements, the next unblocked work is
INT-09's staged class/descriptor contracts and INT-10's coroutine/scheduling/host
contracts. INT-WASM-01 can specify the later backend using the recorded baseline.
No broad package support, general physical-memory/startup claim or independent-
engine release follows from these milestones. INT-REL-01 remains gated on the
remaining language and host stages.

### Optional library profiles (2026-10-21)

INT-11 begins with reviewed core-only/1 and operator/1 library selections and an
explicit output-only/1 host-module boundary. The [profile contract](docs/interpreter-profiles.md)
records source/notice hashes, snapshots, grants, missing-feature diagnostics and
full/reduced differential tests. Both profiles retain the complete engine; no VM
internals are removed. Console assembly and measured payload/startup/memory
observations follow as focused stages before accepting INT-11.

The second INT-11 stage adds explicit console library selection, source/notice
verification before Ready and versioned profile receipts. Full and reduced
artifacts retain the same twenty-two core engine assets. Optional Python library
bytes and their grants are separate. Browser checks prove common behavior,
source diagnostics, offline restart, tamper refusal and full-to-reduced updates
that remove the library cache and authority. Transitive bootstrap tests keep
language compilation/execution in the worker. Measurement follows next.

The third INT-11 stage adds the [reproducible measurement tool](docs/interpreter-measurements.md).
It verifies complete payload buckets and canonical compression, compares the
shared corpus across explicit source/compiled/supplied-engine profiles, and
records cold/warm browser and Node observations. Logical arena, process memory
and dedicated-worker CDP observations retain separate scopes. CI collects both
Node-only and real-browser reports; a clean-commit baseline and review complete
the acceptance evidence.

### Profile baseline accepted (2026-10-21)

INT-11 records [the clean-commit five-sample baseline](docs/interpreter-measurements.md#recorded-baseline-2026-10-21)
and its raw versioned report. The full/reduced source consoles retain the same
complete engine, explicit bootstrap closure, verified library/notice selection
and output-only host grants. Forty Node and Chromium source-profile cases plus
the browser library/cache acceptance suite prove common behavior and intentional
missing-library diagnostics. The complete payload/compression and cold/warm/
memory tool also reproduces the shared CPython corpus through compiled and
explicitly supplied MicroPython artifacts online and offline.

Core source totals 269,574 bytes (78,117 independently gzipped); operator/1 adds
2,901 bytes overall including 457 Python library-source bytes. Actual engine,
bridge, data, notice, source and receipt buckets are retained. Startup boundaries,
worker reuse and observed process/worker memory scopes differ across adapters
and are labeled; no general VM minimality or physical-memory bound is inferred.
CI retains fresh Node-only and four-profile browser reports. Classes/async and
alpha publication remain separate gates; no package release accompanies INT-11.

### Class foundation delivered (2026-10-21)

INT-09's [C1/C2/C3 contract](docs/interpreter-classes.md) now has C1 implementation
through source execution and the offline browser console. Explicit classes-source/1
compiles verified bytecode 5: class namespaces, bounded C3 inheritance, instance
attributes, bound methods and initialization. The default core-source/1 still
emits bytecode 4 and refuses class syntax. Both selections use the complete engine.

Class-body/function records, operands, captures and stack effects are verified.
Class namespaces, instance maps, method receivers/functions and enclosing cells
use explicit arena edges, allocation rollback and cyclic-graph collection.
Execution shares existing work/memory/recursion limits and source-located errors;
class bodies finish before type construction, and initializers must return None.
Lexical binding preserves class namespace/outer-cell overlap without capturing a
class namespace into its methods. Thirty-nine source/refusal cases compare with
CPython in Node/Chromium, alongside malformed-record and resource tests.

`interpreter-web --language-profile classes-source/1` and the class example select
the profile explicitly. Application/receipt/configuration identity and Ready
bind its language/bytecode version. Dedicated Chromium checks cover CPython examples,
new class source after offline reload, errors/refusals, fresh state, Stop/Restart
and a waiting class-plus-library to core-only update. Wheel/sdist installation
checks assemble both languages with both library selections from supplied assets.

INT-09 remains In Progress for C2 descriptors/decorators/private-name mangling
and C3 individually adopted special methods. Native subclassing, metaclasses,
reflection and full Python package compatibility retain their gates. INT-10 async
and the later C/Rust WebAssembly backend remain planned separately; the independent
engine's alpha publication still requires INT-REL-01. No package release accompanies C1.

### Private-name compiler delivered (2026-10-21)

The next INT-09 step adopts [C2 private-name rules](docs/interpreter-private-names.md)
with 34 CPython reference cases, including nested scopes, inheritance collisions,
Unicode, parameter collisions and explicit synthetic imports. The compiler now
lowers names before binding under classes-source/1, using existing bytecode 5.
Node/Chromium compare all 34 cases; source tests cover generated-name budgets,
collisions before effects and unchanged explicit module grants. Original names,
source spans, literals and call keywords remain available unchanged where required.
The console's Counter example now uses a private field; sixteen Chromium cases/
groups verify common class/private behavior, source errors, collisions before
effects, new private input after offline reload, private-method Stop/Restart and
waiting updates. Descriptors, decorators and individually adopted special methods
remain later C2/C3 work. No new host grant, opcode, dependency or publication follows.

### Descriptor/decorator contract adopted (2026-10-21)

INT-09 next adopts [custom descriptors, native wrappers and decorators](docs/interpreter-descriptors.md)
with 69 stage-tagged CPython reference programs. Delivery separates rooted VM
continuations/__set_name__, property/staticmethod/classmethod values, decorator
source and offline-console acceptance. Source namespace order, callback exceptions,
pre-binding decorator failures and shared resource/teardown checks are required.
The contract alone does not widen source acceptance or complete C2/INT-09.


### C2 custom descriptor implementation

The explicit classes profile now runs type-level __get__, __set__, __delete__ and
__set_name__ hooks in ordinary VM frames. Data/non-data precedence, inherited
owners, namespace definition order and snapshot notifications share the existing
work, recursion, cancellation and memory bounds. Failed notifications preserve the
previous class binding and propagate the original CPython 3.14 exception.

All 69 descriptor/decorator reference cases remain checked. Source reports select
the 33 implemented custom descriptor cases and explicitly list omitted native and
decorator stages; those stages remain subsequent work. The original class/private
matrices still run in full. No publication or default core-profile change follows.


### C2 native property and method wrappers

The classes profile now owns immutable property, staticmethod and classmethod
wrappers. Property callbacks and accessor copies retain their functions; class
methods bind the accessed owner, including inherited alternate constructors.
Initializers and custom descriptor mutation/notification hooks use the adopted
native method binding; the raw __get__ slot retains its separate calling rule.

The selected source matrix now covers all 54 custom/native cases and two explicit
refusals in Node and Chromium. Wrapper edges, retained closures, callback failures
and invalid arguments have focused tests. Decorator source remains the next step.


### C2 decorator source implementation

The explicit classes profile now parses at most sixteen decorators per definition,
evaluates their expressions in source order and applies them in reverse. Class
creation and notifications complete before class decorators run; the final binding
is stored only after successful application. Decorators preserve enclosing closure
resolution, textual private-name context and original function/class metadata.

All 69 descriptor/decorator source cases now run in Node and Chromium: 66 adopted
comparisons and three explicit deferred refusals. Focused checks cover the decorator
count limit before effects, failure locations, retained old bindings, closure and
private decorator expressions. The default core profile continues to refuse this
syntax. Offline console acceptance is the final step of this batch.


### C2 console acceptance checkpoint

The Counter/StepCounter example now uses a private field, property setter,
inherited class method constructor and static method. Fifteen CPython source
comparisons and eight Chromium acceptance groups cover these features, callback
and decorator errors, newly entered decorated source after offline reload,
property-getter Stop/Restart with three fresh sessions and scoped updates that
remove both the class language and optional library authority.

C2's adopted private/descriptor/decorator scope is implemented. All 69 source
cases run in Node and Chromium (66 reference comparisons, three explicit refusals),
alongside the full 39 class and 34 private-name matrices. INT-09 stays open for
C3's individually adopted special methods; nested hook binding/reflection and
alpha publication retain separate gates. Public console hosting is tracked by
DEMO-01; spatial-ui's existing HOST-01 includes its current dashboard. No provider,
deployment, new dependency or package publication is introduced by this batch.


A focused follow-up adds a native property-valued mutation-hook reference case.
Nested descriptor binding for setters, deleters and notifications now refuses
explicitly for both custom and property descriptors. The full matrix has 69
programs: 66 adopted comparisons and three deferred refusals. No runtime behavior
for unadopted nested binding is presented as a Python-compatible call error.


### C3 protocol sequence and call contract adopted (2026-10-21)

The next INT-09 batch adopts a [shared special-method policy and resumable dispatch](docs/interpreter-special-methods.md).
First implement __call__ and a non-invoking callable() query, then length/truth,
formatting, indexed objects, iteration/membership and equality/hash through their
own matrices. Postpone __new__, custom attribute hooks, arithmetic and metaclasses.
The existing synchronous primitive operations cannot execute Python callbacks;
pending operations must resume through ordinary VM frames and explicit roots.

The first 63-program CPython matrix separates 41 call cases, 14 callable-query
cases and eight future-protocol refusals. Delivery uses five focused steps:
contract/reference evidence, shared admission policy, resumable call execution,
callable queries and offline console acceptance. The contract alone changes no
source acceptance. Additive support retains classes-source/1 and bytecode 5;
engine fingerprints distinguish builds. INT-09 and alpha publication remain open.


### Shared class special-method policy

Class definitions, direct attribute admission and mutation now consult one
immutable class-policy module from both compiler and runtime. Scoped metadata
validation stays explicit. The pinned engine closure includes the reviewed policy
module and import edges. This refactor keeps the C2 surface unchanged; __call__
and the later C3 protocols are still refused until their execution step lands.


### C3 instance call execution

Implicit __call__ now resolves on the instance type and uses the adopted descriptor
binding independently of ordinary instance attribute lookup. Resumable invocation
retains original arguments/keywords and receivers, while callbacks run through
ordinary frames. An iterative call-task dispatcher also carries constructor,
notification and ignored-mutation completions without recursive host dispatch.
Python frames and frame-free callable redirect cycles have explicit depth limits.

The 41 implemented call cases and eight future-protocol refusals pass in Node and
Chromium. All 63 CPython reference cases remain validated; fourteen callable-query
cases are explicitly omitted from source reports until the next step. Focused
checks exercise pending temporary roots, original tracebacks, recursive redirects,
work, cancellation, memory exhaustion and zero logical teardown accounting.


### C3 callable queries

The explicit classes profile now supplies callable() as a one-positional-argument
query. It examines type-level call presence without binding descriptors, invoking
user code or promising that invocation will succeed. Native function/method/class
and static-wrapper classifications retain their ordinary call behavior; instance
shadows and later type-slot mutation are covered separately.

All 63 source cases now run in Node and Chromium: 55 CPython comparisons and eight
explicit future-protocol refusals. Tests also cover invalid query arguments, user
binding shadows, an intentionally busy descriptor that must never execute during
a query, and unchanged core-profile builtin lookup. Console acceptance follows.


### C3 call-console checkpoint

The Counter example now uses inherited __call__ and callable(). Twenty CPython
source comparisons and nine Chromium acceptance groups cover explicit/implicit
lookup, properties/descriptors and callable decorators, original callback/binding
errors, new callable-decorator source after offline reload, call/body binding Stop
with three fresh Restarts, and waiting updates that remove class source, callable()
and the optional library together. The full 63-case call matrix accompanies the
39 class, 34 private-name and 69 descriptor matrices in Node/Chromium.

The first selected C3 call protocol is implemented; INT-09 stays open for
length/truth, formatting, indexed objects, iteration/membership and equality/hash.
Further construction/attribute/arithmetic/metaclass semantics, async/host work,
later C/Rust WebAssembly and publication retain their separate gates.


### Native-wrapper depth compatibility

A focused follow-up keeps the new implicit call depth counter on callable-instance
redirects. Unwrapping existing native static/bound wrappers remains iterative and
work-bounded, preserving its C2 depth behavior. The expanded static-call reference
case checks eighty wrappers through both direct invocation and an instance type
slot, while a focused low-depth test retains the redirect-cycle regressions.


### C3 length/truth contract

The [length/truth contract](docs/interpreter-special-methods.md#length-and-truth-contract)
selects __len__/__bool__, signed-64-bit nonnegative lengths, actual bool results,
type-level descriptor binding and the reference's optional-binding distinction.
The authored 93-case matrix separates length, truth, control flow and six later
protocol refusals. All recorded stdout/error types must pass CPython reference
validation before source admission; this first checkpoint enables no new syntax.

Delivery proceeds through a focused contract/reference PR, resumable operation/
branch/loop implementation with resource and differential checks, then offline
console acceptance. Preserve core-source/1, bytecode 5 for explicit classes,
existing compatibility matrices, logical ownership and the output-only host.
INT-09 remains open for formatting and subsequent C3 protocols. Async, the later
C/Rust WebAssembly path, alpha publication and hosting retain separate tasks.


### C3 length/truth execution checkpoint

The shared policy now admits __len__/__bool__. Resumable VM unary operations handle
len(), bool(), not, branches/jumps and while without executing callbacks inside
ValueRuntime. Result completions enforce bool and signed-64-bit length contracts;
optional binding recovery preserves the pinned reference's AttributeError behavior.
Receivers, expression operands and outer completions retain explicit roots.

All 93 length/truth cases pass in Node/Chromium: 87 CPython comparisons and six
future refusals. The existing 63-call and 39-class matrices promote their length/
truth examples to adopted stages. Twelve focused units plus a verified-bytecode
regression cover control flow, source errors, logical roots, exception/finally
behavior, depth, work, cancellation and actual callback OOM. The complete Node
suite now has 152 tests. Offline-console acceptance follows as a separate PR.


### C3 length/truth console checkpoint

The offline class console accepts the adopted length/truth matrix. Twenty-six
CPython source comparisons and eleven browser groups cover results, binding/body
errors, optional binding fallback, short circuiting, loops and optional operator
truth/not_. New private-state queue source executes length and property-bound
truth through while/else after offline reload. Five Stop/Restart cycles cover
existing calls and new length/truth callbacks and pending bindings; waiting
updates remove class/library selection while retaining primitive core builtins.

The 93-case length/truth matrix has 87 adopted comparisons and six later refusals
in Node/Chromium. The full 63-call, 69-descriptor, 39-class and 34-private-name
matrices remain required, alongside 152 Node tests, Python/distribution checks,
core/library console acceptance and exact-revision retained reports. C3 length/
truth is delivered; next adopt __repr__/__str__ with resumable output/formatting
and validated strings. INT-09 and the later async/Wasm/publication gates stay open.

### Broad compatibility and formatting checkpoint (2026-10-22)

The versioned inventory now records 30 language/platform surfaces, all 71 names
in the built-in-functions index and 25 linked finite work packages. Its 118
observations keep positive source comparisons, known diagnostic divergences,
deferred APIs and host restrictions separate. CPython 3.14.7 and Unicode 16.0.0
remain pinned; live documentation 3.14.9 does not upgrade language support.

[INT-STR-01](https://github.com/outside-labs/pocket-python/issues/107) fixes str(s)
identity. [INT-REPR-01](https://github.com/outside-labs/pocket-python/issues/108),
[INT-REPR-02](https://github.com/outside-labs/pocket-python/issues/109) and
[INT-REPR-03](https://github.com/outside-labs/pocket-python/issues/110) deliver the
bounded contract, owned VM execution and offline-console acceptance. Primitive
repr/str() work in core source; custom __repr__/__str__ require the explicit class
profile. Strict result checks, MRO/descriptor lookup, nested output ordering,
source errors, recursion, pauses, cancellation and OOM use the common machine.
Default/float/container displays and full format/encoding forms remain deferred.

The formatter has 67 source cases: 58 CPython comparisons and nine future
refusals, executed in Node and Chromium with drain and instruction stepping.
The class console has 38 source comparisons, 13 acceptance groups and nine
Stop/Restart cycles, including new source offline and waiting profile updates.
The [complete payload record](docs/measurements/2026-10-22-formatting.json) keeps
the old Counter fixture unchanged for comparison: 334,620 to 354,645 bytes;
its new formatting example adds 223 source bytes, for 354,868 bytes total.
These are uncompressed complete offline applications, with no startup/speed claim.
The prior consolidation record uses a different fixture and remains unchanged.

The existing eight composed resource baselines are unchanged. The engine closure
now includes 25 modules and both notices; independent-engine assets remain outside
released distributions until INT-REL-01. Next, classify recognized unsupported
syntax in [INT-DIAG-01](https://github.com/outside-labs/pocket-python/issues/111)
and adopt indexed-object protocols in
[INT-INDEX-01](https://github.com/outside-labs/pocket-python/issues/112).
General function/value/library work remains ordered in the inventory. INT-09,
INT-10, the mobile feasibility decision and the later C/Rust/Wasm path stay open.

### Unsupported-syntax diagnostic checkpoint

INT-DIAG-01 recognizes valid assignment expressions and type aliases without
adopting execution. Eighty source/refusal cases cover both source profiles,
malformed forms, UTF-8 spans, generic-alias parameters and no application effects;
the existing source matrix also checks type as an ordinary identifier. Deferred
nodes never leave parsing. Other unadopted grammar keeps its own refusal boundary.
The inventory's two diagnostic divergences are now deferred observations with
UNSUPPORTED, earning no execution support credit. The next task is INT-INDEX-01,
through a pinned contract, owned read/conversion and mutation/slice operations,
then offline-console acceptance. The semantic oracle remains CPython 3.14.7.
