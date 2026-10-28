# Metaclass attribute access

O25/O26 continue #123 against pinned CPython 3.14.7. The executable matrix is
`tests/fixtures/interpreter/metaclass-attributes.json`. Reference results alone
do not establish independent execution. The explicit classes-source/1 profile
and bytecode 5 remain the admission boundary; core admission is unchanged.

| Stage | Contract |
| --- | --- |
| O25 | A class read selects `__getattribute__` and `__getattr__` on its actual metaclass, including inherited functions, static/class methods, properties and custom descriptors. Bind with the class receiver and actual metaclass owner. Capture the fallback hook before the initial read; only AttributeError from binding, native lookup or the read body invokes it, once. `getattr` defaults and `hasattr` suppress only the terminal AttributeError. Native `type.__getattribute__` bypasses these hooks, retaining metaclass data-descriptor priority, class MRO lookup and metaclass non-data fallback. Metadata reads follow that same precedence; a metaclass `__name__` property is adopted. |
| O26 | Class assignment/deletion selects `__setattr__`/`__delattr__` on the actual metaclass, without ordinary read hooks. Ignore the result for assignment/deletion syntax and the attribute builtins. Native `type.__setattr__`/`type.__delattr__` bypass overrides and preserve metaclass data-descriptor mutation before bounded class storage. Ordinary late slot mutation affects subsequent operations. Native immutable type receivers raise TypeError. |

Explicit native helpers validate positional signatures, receiver and bounded
string names before callbacks. Unbound type helpers have canonical
`method_descriptor` identity, bare `__name__` and type-qualified `__qualname__`.
Bindings obtained through metaclass inheritance or `super` retain their class
receiver and `builtin_function_or_method` identity and have no Python `__func__`.
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
