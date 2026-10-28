# Metaclass attribute access

O25/O26 continue #123 against pinned CPython 3.14.7. The executable matrix is
`tests/fixtures/interpreter/metaclass-attributes.json`. Reference results alone
do not establish independent execution. The explicit classes-source/1 profile
and bytecode 5 remain the admission boundary; core admission is unchanged.

O25 and O26 are implemented within these finite boundaries.

| Stage | Contract |
| --- | --- |
| O25 | A class read selects `__getattribute__` and `__getattr__` on its actual metaclass, including inherited functions, static/class methods, properties and custom descriptors. Bind with the class receiver and actual metaclass owner. Capture the fallback hook before the initial read; only AttributeError from binding, native lookup or the read body invokes it, once. `getattr` defaults and `hasattr` suppress only the terminal AttributeError. Native `type.__getattribute__` bypasses these hooks, retaining metaclass data-descriptor priority, class MRO lookup and metaclass non-data fallback. Metadata reads follow that same precedence; metaclass `__name__` properties, ordinary values and non-data descriptors are adopted. If the native name descriptor is hidden, class MRO namespace values precede the metaclass fallback. |
| O26 | Class assignment/deletion selects `__setattr__`/`__delattr__` on the actual metaclass, without ordinary read hooks. Ignore the result for assignment/deletion syntax and the attribute builtins. Native `type.__setattr__`/`type.__delattr__` bypass overrides and preserve metaclass data-descriptor mutation before bounded class storage. Ordinary late slot mutation affects subsequent operations. Native immutable type receivers raise TypeError. |

Explicit native helpers validate positional signatures, receiver and bounded
string names before callbacks. Unbound type helpers have canonical
`wrapper_descriptor` identity, bare `__name__` and type-qualified `__qualname__`.
Bindings obtained through metaclass inheritance or `super` retain their class
receiver and `method-wrapper` identity and have no Python `__func__`.
Native helper reads on further builtin layouts retain their existing boundaries.

Real `type()` and successful actual-type instance checks bypass advertised class
reads. Mismatched `isinstance` and invalid actual-type `super` checks may use a
class receiver's adopted advertised `__class__` read. Real valid `super` receivers
remain valid without hooks. Implicit class construction, custom checks and
special lookup bypass ordinary metaclass read hooks. A class's own hook affects
its instances, while its metaclass hook affects the class.

Live class/instance namespaces, mapping proxies, default directories, metaclass
`__class__` descriptors and layout mutation, namespace preparation, expanded
class bases/mappings, builtin instance layouts and dynamic source admission
retain their separate contracts. Unsupported special names refuse before hook
effects. `vars(class)` remains a live-namespace refusal even with read hooks.
No new source, host capability or external service is granted.

Every pending receiver, original name, fallback snapshot, descriptor closure,
mutation value and outer destination remains owned through ordinary execution
frames and continuations. Collection between instructions, parked execution,
cancellation and idempotent close must preserve/release those owners. Callback
binding/body errors retain original Python source frames. Recursion, work,
instruction and arena limits remain shared across the whole activation. Default
classes preserve all eight existing composed resource observations.

Acceptance requires Node/Chromium source comparisons with drain/step drivers,
owned lifecycle/resource tests, installed offline newly entered source,
Stop/Restart during binding/read/write phases, class-to-core update boundaries
and a complete reproducible example payload. Native async/await and awaited host
adapters remain open under #34. No dependency, release, publication or deployment
is included.

Semantic anchors: the Python 3.14 [attribute protocol](https://docs.python.org/3.14/reference/datamodel.html#customizing-attribute-access)
and pinned [type implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
The pinned executable resolves later documentation differences.

## Accepted evidence

The 102-case pinned matrix has 97 adopted comparisons and five explicit future
refusals. Node and Chromium each pass drain, instruction-boundary and parked
scope-owner execution: 612 observations and 600 measured zero logical
teardown records. Each report verifies its 58 source/driver hashes and corpus
digest. The older type-checking corpus adopts its metaclass read case. All 144
compatibility probes pass in each target, including six new positive probes.

All 1,448 Node tests pass. Dedicated tests collect between instructions and
cancel/close in read, fallback, mutation and descriptor phases, preserving
fallback snapshots, temporary class receivers, native wrappers and pending
values. Original Python frames and actual recursion/instruction/work/arena
failures are covered. The eight composed resource observations are unchanged.
The 60-test Python suite passes with one explicit optional WASM fixture skip;
archive allowlists and four isolated default/compiled installations pass.

Installed-wheel offline acceptance passes 1,146 program comparisons,
69 groups and 146 Stop/Restart cycles. Newly entered source combines
class registration, virtual metadata, audited mutation, native methods and
generators after offline reload. Descriptor/read/write bodies stop and restart;
a waiting class-to-core update refuses the class example before source effects.

The [class metadata console](../examples/interpreter_metaclass_attributes.py)
and its [source/payload record](measurements/2026-10-27-metaclass-attributes.json)
verify all 38 files and 37 receipt members at 660,355 bytes, including an identical
fresh rebuild. These are finite semantic and payload observations. Broader
object/reflection #123 and native async/host-adapter #34 remain open.
