# Independent Python interpreter implementation plan

Part 3 of the coordinated Python application program; adopted 2026-10-20.
Planning/issue owner: pocket-python. This records delivered prototype stages and future work; released
pocket-python 0.2.0 assembles compiled and supplied MicroPython applications.

## Goal and ownership

Implement a defined Python language subset through our own execution engine,
usable from a native/CLI harness and browser worker. After initial loading and
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

| Task | Scope | Depends on | Readiness |
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

INT-01 is Ready; INT-02 follows its language contract. INT-QA-01 establishes
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
