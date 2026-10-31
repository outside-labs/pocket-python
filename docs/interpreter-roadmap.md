# Execution consolidation and broad Python compatibility

The current finite object/construction/reflection scope is recorded in the
[O95 reconciliation](interpreter-object-scope.md) and
[O96 integrated acceptance](interpreter-object-integration.md). Earlier object
delivery sections retain their checkpoint context. Broader language, API,
package and async work continue under their named issues.

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

[INT-COMPAT-01](https://github.com/outside-labs/pocket-python/issues/99) delivers the
[versioned inventory](interpreter-compatibility.md), its
[machine-readable API boundaries](interpreter-compatibility.json) and 118
independent source/availability observations against
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

The [bounded repr/str slice](interpreter-formatting.md) is implemented, with offline
console acceptance and explicit deferred float/container/default displays. The
remaining C3 sequence continues with indexing, iteration and equality/hash.
Persistent-session work can progress alongside those language
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

The finite [O39/O40 descriptor flag slice](interpreter-abstract-flags.md) extends
#123 with owned function markers and computed property/static/class method
flags. Optional attribute lookup and truth conversion preserve callback order,
errors and lifetime bounds. Abstract class enforcement, `abc`, documentation,
live namespaces and broader descriptor reflection retain separate contracts.
Native coroutine/await and host-adapter acceptance remain open under #34.

The finite [O23/O24 class-construction slice](interpreter-subclass-initialization.md)
extends #123 with inherited subclass initialization and explicit named class
keywords. Notification order, C3/descriptor binding, native method identity and
metaclass consumption use owned execution; live namespaces, builtin layouts,
class preparation/mappings and dynamic source remain later work. Native
coroutine/await and awaited host-adapter acceptance remain open under #34.

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

## Finite ordering checkpoint

The [O12/O13/O14 ordering profile](interpreter-ordering.md) extends #123 with
four rich ordering methods and bounded list/tuple/slice comparisons. Its
112-case matrix compares independently compiled source against CPython 3.14.7
in Node/Chromium drain/step execution. Raw results, reflected priority,
descriptor errors and callback-visible list mutation retain owned execution
and resource limits. The ordered-note console combines comparison with slice
insertion and generators.

Broader namespace/identity reflection, builtin layouts, metaclass protocols and
further descriptor hashing remain finite follow-ups under #123. Async #34
now has cooperative worker quanta, session-owned parked executions and persistent
callback/event entry through [module-events/1](interpreter-events.md). Native
coroutines/await, async iteration/generators/context managers, an adopted awaited
capability and durable view/save application acceptance remain open.

Method, raw-slice and callback-bearing tuple hashing follow the [owned hash contract](interpreter-object-hashing.md).


## Scheduling and persistent event checkpoint

INT-ASYNC-01–03 deliver parked scope groups with unchanged existing resource
baselines, cooperative source worker quanta, acknowledged live output and
non-terminating cancellation. Persistent registered callbacks retain ordinary
Python module state and serialize bounded copied events. The pinned source
matrix runs in Node/Chromium with one-instruction pumping; installed offline
acceptance exercises cancellation, fresh generations and zero teardown.

This advances #34's first two application prerequisites. Native coroutine syntax,
awaitable transport, async protocols, browser event/view/storage grants and an
offline save application require their own finite contracts and evidence. #123
remains open for namespace reflection, builtin layouts, further metaclass and
reflective protocols and dynamic source admission. No release or deployment is
part of this checkpoint.

## Finite namespace reflection checkpoint

[O15–O17](interpreter-reflection.md) add stable adopted object identities,
fresh optimized-function locals/vars snapshots and custom vars/dir hooks through
owned descriptor, call and iteration phases. Captured cells and Python namespace
order remain separate from the engine's established allocation/root order. Custom
directories copy their iterable and sort bounded string names by Unicode code
point, retaining duplicates.

Live module/class/global mappings, ordinary instance dictionaries, mapping
proxies, default directories, inlined comprehension namespace rules and unboxed integer
identity remain finite follow-ups under #123. Builtin layouts, further metaclass
protocols and dynamic source admission remain open. #34 still requires native
coroutine/await and async protocols, an adopted awaited capability and a durable
offline view/save application. The [reflection example](../examples/interpreter_reflection.py)
and its acceptance evidence do not broaden host grants or package/device claims.

[O18–O20](interpreter-directory-scopes.md) extend the reflection checkpoint with
generator-expression snapshots retaining the acquired iterator as `.0`, custom
directory iterable length hints and stable owned comparison/truth sorting of
adopted entries. These protocols retain the same source profiles and host grants.
Native coroutine/await and host adapters remain separate work under #34.

## Inlined comprehension reflection checkpoint

[O21/O22](interpreter-comprehension-reflection.md) adopt fresh locals/vars
snapshots and sorted zero-argument directories inside list/dict/set
comprehensions. Optimized scopes include enclosing bindings; module/class
comprehensions expose isolated snapshots. Nested target masking, captured-cell
order and restoration retain owned execution and the existing resource rules.

Live module/class/global mappings, ordinary instance dictionaries and mapping
proxies, default directories, unboxed integer identity, builtin layouts,
further metaclass protocols and dynamic source admission remain under #123.
Native coroutine/await, async protocols, awaited capabilities and durable
offline view/save acceptance remain under #34. This checkpoint adds no host
grant, runtime dependency, release, publication or deployment.

## Ordinary sequence repetition checkpoint

[R1–R3](interpreter-repetition.md) adopt shallow list/tuple repetition and Unicode
text multiplication with primitive factors in both source profiles. Class-profile
index callbacks run after numeric/reflected candidates, preserve owned operands,
and copy lists after callback-visible mutation. Existing bytes and list in-place
resource rules remain unchanged. The composed repetition console and its exact
payload record cover offline execution and Stop/Restart.

This advances #123's arithmetic consumers. Live namespace mappings, default
directories, builtin instance layouts, further metaclass protocols and dynamic
source admission retain their finite boundaries. Native coroutine/await, async
protocols, awaited host adapters and durable view/save acceptance remain under
#34. No host grant, dependency, publication or deployment accompanies this work.

## Metaclass attribute checkpoint

[O25/O26](interpreter-metaclass-attributes.md) extend #123 with owned actual-metaclass
read/mutation hooks and native type defaults. Descriptor binding, original fallback
snapshots, metadata priority, late hook mutation and native callable identities
compose with subclass registration, generators and offline Stop/Restart. Live
namespace mappings, default directories, builtin layouts, further construction and
descriptor protocols and dynamic source remain open. Native coroutine/await,
async protocols, awaited host adapters and durable view/save acceptance remain
under #34. No dependency, host grant, publication or deployment is included.

## Nested descriptor hook checkpoint

[O27/O28](interpreter-nested-descriptors.md) extend #123 and #33 with owned
property/custom-descriptor-valued mutation and name-notification hooks. Binding
and invocation preserve original operands, exceptions, actual-type lookup,
notification snapshots and class-cell/subclass/decorator order. The field-hook
console composes validation, native mutation defaults and generators, with
offline reload, Stop/Restart and a waiting reduced-profile update.

Live namespaces, default directories, builtin layouts, further metaclass and
descriptor reflection and dynamic source retain their finite contracts. Native
coroutine/await, async protocols, awaited host adapters and durable view/save
acceptance remain under #34. No dependency, host grant, publication or deployment
is included.

## Explicit native descriptor rebinding checkpoint

[O33/O34](interpreter-native-rebinding.md) extend #123 and #33 with bound/unbound
native descriptor `__get__` over the finite adopted method/wrapper allowlist.
Actual receiver layouts, None/owner rules, recursive binding handles, native
metadata and deferred callback execution retain owned frames and shared budgets.
The [descriptor console](../examples/interpreter_native_rebinding.py) composes
rebound copies, native type checks, closures and lazy generators offline.

Live namespaces, default directories, builtin layouts, broader descriptor
reflection and dynamic source retain their finite contracts. Native coroutine/await,
async protocols, awaited host adapters and durable view/save acceptance remain
under #34. No dependency, host grant, publication or deployment is included.

## Native type reflection checkpoint

[O35/O36](interpreter-type-reflection.md) extend #123 and #33 with native
descriptor declaring-class metadata, fresh actual C3 hierarchy lists through
type.mro() and primary-base attributes. Native receiver layouts, callable
identity, metaclass reads and detached hierarchy lifetimes retain owned frames
and shared resource limits. The [hierarchy console](../examples/interpreter_type_reflection.py)
composes these operations with properties and lazy iteration offline.

Custom MRO construction, live namespace mappings, default directories, broader
descriptor reflection and builtin layouts retain finite follow-ups. Native
coroutine/await, async protocols, awaited adapters and durable view/save acceptance
remain open under #34. No dependency, host grant, publication or deployment is
included.

## Property name checkpoint

[O37/O38](interpreter-property-names.md) extend #123 and #33 with arbitrary
property name values, lazy owned getter-name lookup, independent accessor
copies and bound/unbound/rebound native name notification. Automatic class
notification preserves namespace snapshot order, aliases, inheritance and
subclass/decorator timing. Callback-bearing missing-accessor diagnostics remain
explicitly deferred. The documented execution-accounting/2 revision retains
original resource observations alongside the newly owned automatic names.

Property documentation, live namespaces, default directories, builtin layouts,
broader metaclass protocols and dynamic source remain finite follow-ups. Native
coroutine/await, async protocols, awaited host adapters and durable view/save
acceptance remain under #34. No dependency, host grant, release, publication or
deployment is included.

## Live function dictionary checkpoint

[O45/O46](interpreter-function-dictionaries.md) extend #123/#33 with live function
dictionaries and bound-method custom attribute fallback. Dictionary replacements,
collision callbacks and decorator state preserve exact identities and owned
parked lifetimes. The decorator console composes retained methods and generators.
Module/class live mappings, default directories, broader native metadata
and dynamic source retain their finite contracts. Native coroutine/await, async
protocols and host adapters remain under #34. No host grant, dependency, release
or deployment is included.

## Live instance dictionary checkpoint

[O47/O48](interpreter-instance-dictionaries.md) extend #123/#33 with live ordinary
instance dictionaries, exact replacement/sharing, deletion aliases and owned
collision callbacks. Data-descriptor priority, class-fallback snapshots, native
bypass and supplied name identity retain shared execution ownership. Dictionary
mutation preserves the native KeyError-to-AttributeError conversion; descriptor
callback errors bypass it. Module/class mappings, default directories, native
getset reflection and native async/host adapters remain open.

## Property and native callable directory checkpoint

[O53](interpreter-property-directories.md) adds fresh default property directories
and raw native binding independently of accessor callbacks, lazy names,
documents and computed flags. [O54](interpreter-native-callable-directories.md)
adds actual-layout directories for the adopted native descriptor and bound
callable allowlist. Recursive binding and retained property/view cycles preserve
owned lifetimes; Python bound methods keep their separate directory behavior.

Both new matrices pass six Node/Chromium drivers, with 510 observations and
510 zero logical teardowns. The affected method/view matrices bring the directory
total to 984 observations. Installed-wheel offline acceptance, compatibility
probes and verified example payloads record the finite scope. Ordinary instance,
class/module and wrapper/value directories, module/class-body live namespaces,
class mapping enumeration, broader builtin layouts, unread native metadata and
dynamic source remain under #123/#33. Native async/host work remains under #34.
No dependency, host grant, release, publication or deployment is included.

## Generator directory checkpoint

[O55](interpreter-generator-directories.md) extends #123/#33 with state-independent generator directories, exact native caller binding and owned suspended-frame lifetimes. The composed console covers send, close and lazy iteration offline. Listed metadata retains separate read contracts; broader layouts, live namespaces and dynamic source remain open. Native async/host adapters remain under #34.

## Native iterator directory checkpoint

[O56](interpreter-iterator-directories.md) extends #123/#33 with directories for existing native container, indexed and callable-sentinel iterators. Exact sources/sentinels survive detached native callers and parked collection. The reference audit also corrects ASCII/general Unicode and short/long range native identities. User instance/class/module/wrapper/value directories, live namespaces, unread native APIs and dynamic source retain finite follow-ups. Native async/host adapters remain under #34.

## Numeric, singleton, range and slice directory checkpoint

[O57](interpreter-numeric-directories.md) extends #123/#33 with default directories
for None, NotImplemented, bool, int, float and complex.
[O58](interpreter-sequence-directories.md) adds adopted range/raw-slice directories.
Charged native merging and owned sorting preserve actual layout names and retained
caller lifetimes. Collection leaves ranges uniterated and invokes no arbitrary
slice-field protocols; detached cyclic field graphs remain owned. Integer identity,
unread native APIs, wrapper/super namespaces, remaining default layouts, live
module/class namespaces and dynamic source retain their separate contracts.

## Ordinary container directory checkpoint

[O59](interpreter-container-directories.md) extends #123/#33/#116 with default
str/list/tuple/dict directories, raw native merge order and retained native
callers. Collection preserves cyclic contents, Unicode and iterator positions
without contained callbacks. Other default layouts, wrapper/super namespaces,
live module/class namespaces, unread APIs and dynamic source retain their finite
contracts. Native async/host adapters remain under #34.

## Set and buffer directory checkpoint

[O60](interpreter-buffer-directories.md) extends #123/#33/#117 with native
set/frozenset/bytes/bytearray/memoryview directories. Charged collection and owned
sorting preserve exact receiver graphs, cyclic hash entries, storage aliases and
released-view data boundaries. Wrapper/super and ordinary instance/class/module
directories, live namespaces, unread APIs and dynamic source retain finite
follow-ups. Native async/host adapters remain under #34.
Native async/host adapters remain under #34.

## Callable and execution type directory checkpoint

[O65](interpreter-callable-type-directories.md) extends #123/#33 with native type
directories for functions, Python methods, native descriptors/bound callables,
properties and mappingproxy views. Per-instance/function keys do not enter type
namespaces. Native ordering, binding, immutable types and ordinary advertised
namespaces use charged merging and owned sorting without reading contained values
or callable/accessor metadata.

[O66](interpreter-iterator-type-directories.md) adds generator and adopted native
iterator type directories without running bodies, advancing sources, comparing
sentinels or restoring released buffer authority. Detached native callers and
advertised cyclic generator/callable graphs retain owned parked lifetimes.

Both matrices pass six Node/Chromium drivers, totaling 1,200 source observations
with zero logical teardown failures. The existing composed resource observations
remain unchanged. Custom metaclass and remaining native type namespaces,
non-class advertised namespaces, module/wrapper/super directories, live mappings,
unread native APIs and dynamic source retain finite follow-ups under #123/#33.
Native async/host adapters remain under #34.

[O71](interpreter-wrapper-metadata.md) adopts copied wrapper metadata, live wrapper dictionaries, qualified native documents, property accessor-copy origins and super dictionary/getset reflection.

[O72](interpreter-function-state.md) adopts live function defaults, defining globals and captured builtins, including owned binding callbacks and persistent callback updates.

[O73](interpreter-code-cells.md) adopts owned verified code metadata, actual closure cells and compatible code replacement while retaining active and generator executable snapshots.

[O74](interpreter-generator-frames.md) adopts non-resuming generator/frame metadata and live optimized-frame local proxies, including cells, extras, inlined scopes and retained-frame teardown.

[O75](interpreter-integer-identity.md) completes owned integer identity, coherent `is`/`id` behavior and collection/callback lifetimes under accounting revision 12. O71–O75 complete the metadata and identity workstream; O76–O96 remain separate stages.

[O76](interpreter-advertised-directories.md) completes type/metaclass and advertised
namespace directories, hooked native qualification and abstract base checking.

[O77](interpreter-wrapper-super-directories.md) completes native wrapper and super
instance/type directories with live dictionaries and retained native callers.

[O78](interpreter-native-directory-closure.md) closes the current native directory
matrix with an 85-type audit and canonical namespace keys under accounting revision
13. O76–O78 complete the directory workstream; O79–O96 remain separate stages.

[O79](interpreter-expanded-class-bases.md) adopts expanded class headers, owned base
resolution and original-base retention. Prepared mappings and further metaclass
construction remain O80–O83.

[O80](interpreter-prepared-class-namespaces.md) adopts prepared dictionaries and
custom mapping class bodies with owned namespace callbacks and class cells.

[O81](interpreter-metaclass-factories.md) adopts callable metaclass factories,
optional preparation, exact argument identities and arbitrary decorated results.

[O82](interpreter-custom-mro.md) adopts owned custom MRO construction, atomic
hierarchy installation and native C3 recomputation. Remaining metaclass slots
are O83; storage and base reassignment remain O84–O88.

[O83](interpreter-metaclass-protocols.md) completes actual-metaclass special
protocol dispatch, including reflected priority, owned descriptors, hashing and
live mutation. O79–O83 complete the advanced construction workstream; storage
and builtin subclasses remain O84–O88.

[O84](interpreter-slots.md) adopts slots, inherited member storage, native
member descriptors and optional instance dictionary/weak-reference layouts.
Builtin payload subclasses and compatible type/base reassignment remain O85–O88.

[O85](interpreter-immutable-subclasses.md) adopts owned immutable builtin
payload subclasses, native construction, state, dispatch and base-value results.
The remaining storage stages are O86–O88.

[O86](interpreter-mutable-subclasses.md) adopts list/dict/set/bytearray payloads,
callback-visible initialization and mutation, subclass-owned buffer aliases and
native dispatch. O87–O88 finish the remaining storage workstream.

[O87](interpreter-native-object-subclasses.md) adopts property, wrapper, module
and super subtype construction, state, hooks, binding and native metadata.
Compatible class/base reassignment is the remaining storage stage, O88.

[O88](interpreter-reassignment.md) adopts compatible class and base changes,
transactional descendant MRO recomputation, live weak subclass enumeration and
type metadata mutation. O84–O88 complete slots and builtin subtype storage;
protocol completion and dynamic source/import work remain O89–O96.

[O89](interpreter-arithmetic-dispatch.md) adopts matrix multiplication and in-place
fallback, user-valued ternary power and Python 3.14 reflected ternary dispatch.
Native protocol completion remains O90.

[O90 native calls](interpreter-native-protocols.md) adopt explicit native protocol
entry points, canonical receiver/operation identities, Python method get/call
and native metadata/signature diagnostics. [Property completion](interpreter-property-diagnostics.md)
adopts missing-accessor/name diagnostics and unqualified accessor copies.
[Native attribute closure](interpreter-native-attributes.md) completes explicit
primitive/method/module/super attribute calls and super descriptor rebinding.
O89–O90 complete the arithmetic/native protocol block; O91–O96 remain.

[O91 bounded compile](interpreter-dynamic-source.md) creates owned verified code
from the admitted independent source grammar, with exec/eval/single modes,
UTF-8 and adopted buffers, optimization and shared compilation limits. Eval,
exec and dynamic import execution follow in O92–O94; O95–O96 retain final
reconciliation and integrated acceptance.

[O92 owned eval](interpreter-dynamic-source.md#o92-eval) enters admitted source
or verified code on the current machine, using live module/class namespaces,
optimized-local snapshots or exact supplied globals/locals/builtins. Callback
lookup, source diagnostics and total limits compose with O91.

[O93 owned exec](interpreter-dynamic-source.md#o93-exec) executes admitted
statements and verified code with exact namespaces and closure cells, retained
definitions, ordered mutation/failure effects and shared machine limits.

[O94 granted dynamic imports](interpreter-dynamic-source.md#o94-imports-within-registry-grants)
adopts the exact import builtin interface and captured source import callable,
with owned relative/package/fromlist callbacks, registry identity/retry and
shared limits. Dynamic execution is O91–O94; final reconciliation and integrated
O-series closure remain O95–O96. #123 and #33 remain open.

## Object scope reconciliation

[O95](interpreter-object-scope.md) reconciles the O-series corpora, all explicit
engine refusal sites, native layout/attribute/slot tables and the #99 inventory.
Completed object work is removed from remaining-task lists. Retained boundaries
have exact neighboring owners; intentional refusals are separate from positive
support evidence. #123 supplies #124/#125 with its delivered prerequisites; #33
retains its remaining C3 APIs and protocols. O96 adds the composed source,
lifecycle, offline and reduced-profile acceptance. The versioned record links
positive evidence for all 96 identifiers and the broad batch CI; #123 records
final-main verification before closure.
