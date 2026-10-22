# Execution consolidation and broad Python compatibility

Adopted direction: 2026-10-21. Runtime baseline:
[`56b99ff08b469eae38d023d8bee9b9f8bbd9877a`](https://github.com/outside-labs/pocket-python/commit/56b99ff08b469eae38d023d8bee9b9f8bbd9877a).
Issues and Project fields record current delivery state. The execution
consolidation below is implemented; the linked baseline records the preceding
engine used for compatibility comparisons.

## Continuing objective

Develop a broadly useful, independent implementation of Python 3.14 and later
versions, including language semantics, builtins, useful standard-library coverage
and verified pure-Python packages. The application profiles and first interactive
products are intermediate delivery milestones. General language work has its own
queue and acceptance evidence; a game or dashboard requirement is one source of
priorities, alongside semantic prerequisites and package coverage.

Keep five compatibility questions separate: language behavior, available library
APIs, a particular package's supported use, browser/host facilities, and native
extension ABI compatibility. A feature or package is supported after its source
executes on the independent engine and its adopted cases pass on the named target.
Application-profile completion does not close the broader implementation program.

Python 3.14 remains the reference language, with CPython 3.14.7 pinned as the test
oracle. Later Python versions require recorded semantic differences, fixtures and
explicit profile/oracle decisions. A build-time Python version requirement is a
different promise from the Python syntax and behavior the client can execute.

## Execution foundation adopted

Retain the JavaScript VM, independent parser/compiler, verified bytecode, Python
values, class model, explicit capabilities and offline assembly. The iterative
dispatcher now runs as an owned execution machine. The C/Rust-to-Wasm path remains
separately planned in [INT-WASM-01 #40](https://github.com/outside-labs/pocket-python/issues/40)
and its implementation/integration tasks.

An execution owns frames, block/loop/try state, pending operation records, source
cursors, exceptions, counters and temporary roots. A control completion, an
operation continuation and a scheduling suspension have distinct meanings. User
protocol callbacks use ordinary Python frames; primitive operations stay direct
and synchronous. The existing synchronous execute API and fresh-run console remain
compatibility entry points for the owned machine.

Give pending operations exhaustive transition/root handling. Ownership transfers
retain the new owner before releasing the old owner. Root enumeration, metadata
bounds and accounting changes need explicit contracts. Retain the current root
multiset and costs during the initial ownership extraction. Changes to logical
work/memory accounting require a deliberate resource-contract revision and fresh
threshold evidence. Logical quotas and host/GPU memory observations remain
separately scoped.

Preserve bytecode 4/core-source/1 and bytecode 5/classes-source/1 during this
consolidation. Add no language feature or host grant through structural migration.
Each new engine file belongs to the pinned asset/notice closure; the independent
engine remains outside released Python distributions until its release gate.

The [execution contract](execution-contract.md) maps the existing owners and
transitions; its composed fixtures pin the initial accounting rules.

## Five-part execution consolidation

| Task | Reviewable result | Dependency |
| --- | --- | --- |
| [INT-EXEC-01](https://github.com/outside-labs/pocket-python/issues/94) | Execution/control/operation/suspension contract, root-owner map and missing composed characterization cases. | Existing source engine. |
| [INT-EXEC-02](https://github.com/outside-labs/pocket-python/issues/95) | Bounded pending-operation construction and exhaustive roots, preserving the initial root multiset and cost rules. | INT-EXEC-01. |
| [INT-EXEC-03](https://github.com/outside-labs/pocket-python/issues/96) | Owned Execution and synchronous facade; test-only safe-boundary stepping and idempotent close. | INT-EXEC-02. |
| [INT-EXEC-04](https://github.com/outside-labs/pocket-python/issues/97) | Shared call/unary/builtin phases and destinations on the same machine and unwinder. | INT-EXEC-03. |
| [INT-EXEC-05](https://github.com/outside-labs/pocket-python/issues/98) | Module initialization scheduled as owned records/frames; existing import/cache/cycle behavior retained. | INT-EXEC-04. |

The batch implements all five tasks. The [execution contract](execution-contract.md#owned-module-initialization)
and [compatibility/payload record](measurements/2026-10-22-execution-consolidation.json)
describe instruction stepping, owned module plans and retained resource rules.
The existing eight composed cases retain every recorded resource field, and
Node/browser CI runs all adopted/refusal matrices with both execution drivers.

Each PR preserves observed evaluation order, single evaluation, exception classes
and original source locations, descriptor binding, truth-specific optional lookup,
class creation effects, wrapper-depth behavior and module identity. Force pauses
at supported safe boundaries and compare outputs, side effects, errors and
teardown with uninterrupted execution. Cover nested protocols, imports and
finally together, including OOM/cancellation during ownership transfer. Fix any
unexplained semantic or accounting change before broadening the migration.

The parent [INT-09 #33](https://github.com/outside-labs/pocket-python/issues/33)
retains its delivered class/call/length/truth checkpoints. Remaining protocol
implementation and [INT-10 #34](https://github.com/outside-labs/pocket-python/issues/34)
use the shared foundation. The completed consolidation does not complete either
parent milestone; repr/str and the remaining protocol slices, persistent events,
parked ownership and host/async work retain their own acceptance criteria.

## Broader language and library program

[INT-COMPAT-01](https://github.com/outside-labs/pocket-python/issues/99) establishes a versioned coverage inventory against
the [language reference](https://docs.python.org/3.14/reference/index.html), builtins
and selected library APIs. Each entry records exact scope, supported/partial/
deferred/host-restricted status, target, Python version, independent execution
evidence and next task. The table below defines work areas for that inventory;
it makes no new support claim.

| Work area | Further implementation scope |
| --- | --- |
| Object protocols | Finish repr/str/format, indexing, iteration/membership and equality/hash; then arithmetic/reflected/in-place methods, richer attribute hooks, metaclasses and builtin subclassing through their own cases. |
| Ordinary values and builtins | Numeric constructors/conversions and integer true division; range/enumerate/zip; practical string/list/tuple/dict APIs; sets, bytes and buffer behavior. |
| Functions and scopes | Definition-time computed/mutable defaults, global/nonlocal mutation, argument packing/unpacking, full binding errors, annotations and type-parameter behavior. |
| Syntax and control | Unpacking and remaining expression/statement forms, comprehensions, generators/yield-from, context managers, pattern matching and exception groups. |
| Async language | Native coroutines, await, async iteration/generators/context managers and explicitly bounded scheduling/cancellation; coroutine construction and host Promises have distinct contracts. |
| Errors and introspection | Exception subclassing/chaining, traceback fidelity, supported reflection and dynamic class/type behavior, with explicit limits. |
| Imports and libraries | Broader package/relative/circular-import semantics as adopted; selected json/math/random, collections/itertools/functools, dataclasses/typing and other useful modules with finite API contracts. |
| Python 3.14+ features | Structured t-string values and interpolation/formatting order, annotation semantics and later version deltas. Record source, runtime and library prerequisites individually. |
| Real packages | Author small composed fixtures, then certify selected real pure-Python package uses with complete source/assets/notices and declared unsupported APIs. |

Use application and package fixtures to reveal missing prerequisites, while
maintaining language-reference-driven coverage independently. Reusing a reviewed,
licensed pure-Python library can reduce duplicate work; it still requires engine
conformance and explicit inclusion. Shimify's source closure establishes which
files are selected, not whether all their Python behavior is implemented.

The remaining C3 sequence resumes with repr/str, then indexing, iteration and
equality/hash. Persistent-session work can progress alongside those language
slices after the common foundation. The game, mobile-model trial and completion
of a UI framework are not prerequisites for unrelated language conformance.

## Persistent applications and repository boundaries

INT-10 proceeds through cooperative quanta/parked ownership, persistent named
callbacks and serialized events, one adopted awaitable host capability, then a
small offline view/save application. Quanta preserve an activation's total
budget. Host replies enqueue work, with reentry, stale-generation, duplicate,
cancellation and exactly-once completion rules. Existing console runs continue
to start fresh sessions.

| Project | Integration responsibility and evidence |
| --- | --- |
| pocket-python | Independent Python rules/state, execution/session/scheduling, explicit host capabilities and verified offline assets. |
| spatial_ui | Typed event and view/scene contract, keyed layout, safe dynamic bindings, focus/accessibility and motion. Its server demo hosting task remains separate from a new browser adapter. |
| Shimify | Bounded source reduction, resources, hashes and notices. Interpreter/package compatibility remains independently tested. |
| Python-JavaScript | Explicit AOT alternative for its supported source; common domain fixtures and host schemas can be shared under a versioned contract. |
| expose_api | Optional CPython services for saves/content/synchronization or inference, with a separately adopted application protocol, persistence/auth and offline failure policy. |
| Browser adapters | Native rendering/animation, durable storage and optimized inference behind bounded value/capability contracts. |

Start spatial_ui integration with its [input](https://github.com/outside-labs/spatial_ui/issues/7),
[motion](https://github.com/outside-labs/spatial_ui/issues/6) and
[world](https://github.com/outside-labs/spatial_ui/issues/9) contracts. A small
browser facade permits an early pilot; eventual t-string and library coverage
remain language work. Its current server callback route is not an offline
browser callback implementation. expose_api's server API and the client host
protocol need an explicit transport/capability contract; credentials stay with
the server or their declared owner.

[APP-MODEL-01](https://github.com/outside-labs/pocket-python/issues/100) tracks an independent mobile inference/animation
feasibility prototype. Exact devices, model/runtime assets and measured budgets
remain to be selected. A useful on-device experience on actual iPhone/iPad is an
evidence gate; desktop or emulated-browser execution cannot certify it. The
proposed hatch-monsters slice uses model dialogue/action suggestions, validated
Python rules and revisioned state, browser animation and versioned domain saves.
Model tensor execution belongs in an optimized adapter.

## Compatibility and delivery gates

Language semantics, selected stdlib/package use and host APIs have separate
matrices. CPython's [native extension interface](https://docs.python.org/3.14/extending/extending.html)
has its own runtime/ABI requirements; broad Python source support or a future
Wasm evaluator does not establish it. Browser processes, filesystem/network
authority, threads and native embedding need explicit target-specific contracts.

Retain source-level Node/browser differential and refusal reports, composed
ownership tests, malformed-input checks, offline updates and full asset/license
closure. Add device coverage where a product makes a device promise. Keep
structural consolidation, accounting optimization, language expansion and product
performance evidence distinguishable.

[INT-REL-01 #36](https://github.com/outside-labs/pocket-python/issues/36) remains
the independent-engine alpha gate. Application alpha is a finite supported
release, followed by continuing broad compatibility work. Package publication,
hosting, model selection/downloads and new services retain their own concrete
decisions and acceptance criteria.
