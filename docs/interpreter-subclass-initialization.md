# Subclass initialization and class keywords

O23/O24 continue #123 against pinned CPython 3.14.7. The executable reference
matrix is `tests/fixtures/interpreter/subclass-initialization.json`. Reference
observations alone do not establish independent execution.

O23 and O24 are implemented. Their source matrix and owned lifecycle tests run
independently in the adopted class profile.

| Stage | Contract |
| --- | --- |
| O23 | After a new class has its lexical class cell filled and all adopted `__set_name__` notifications finish, resolve `__init_subclass__` after that new class in its C3 MRO. Bind with no instance and the new class as dynamic owner, then invoke exactly once. Definition-time Python functions are automatically classmethods; explicit static/class wrappers, callable descriptors and later ordinary mutation keep their own binding rules. Ignore the hook result. Errors prevent name binding, metaclass initialization and decorators while retaining prior effects. |
| O24 | Evaluate explicit named class keywords in source order after bases and before the class body. Remove `metaclass` for selection; forward remaining names/values to the metaclass call, native `type.__new__`, the inherited subclass hook and metaclass initialization. Cooperative hooks consume their own keywords and forward the rest with ordinary calls. The native object hook accepts no arguments. Native type initialization accepts keywords with its three-argument form and rejects them with its one-argument form. |

Class statements and dynamic type creation share the same notification phases.
Metaclass `__new__` can consume keywords or return a foreign value; only actual
type construction invokes the inherited hook. Parent lookup happens after
descriptor notifications, so mutation during `__set_name__` is visible. The new
class's own hook is excluded; cooperative `super()` follows the same dynamic
MRO. Definition-time wrapping also applies to ordinary dictionary namespaces
passed to `type.__new__`; later assignment does not repeat the wrapping.

The native `object.__init_subclass__` method binds to each adopted type and to
the actual class of ordinary instances. It has a retained receiver, canonical
callable identity, builtin method type/name metadata and no Python `__func__`.
Equality/hash use the adopted native bound-method rules.

All pending class objects, namespace notification snapshots, class cells,
keyword values, descriptor closures and outer destinations remain explicit
owned edges or continuation roots. Binding and hook bodies use the ordinary
execution controller, shared instruction/work/depth/arena limits and source
diagnostics. Collection between instructions and parked execution must preserve
them. Cancellation/close release owners without new Python callbacks or
finalizers; close is idempotent. Default classes without overridden hooks or
keywords retain the eight existing composed resource observations.

Only classes-source/1 and bytecode 5 admit these class protocols. Explicit named
keywords add a verified bounded class instruction; existing instructions retain
their encoding and accounting. Core-source/1 retains its class refusal. Expanded
class bases/keyword mappings, `__prepare__`, `__mro_entries__`, callable metaclass
factories, builtin instance layouts and arbitrary class-creation mappings retain
their separate boundaries. Live namespace mappings and dynamic source remain
under #123; native coroutines/await and awaited host adapters remain under #34.

Acceptance requires Node/Chromium source comparisons with drain/step drivers,
owned lifecycle/resource tests, offline newly entered source, Stop/Restart in
binding/body phases, class-to-core update boundaries and a complete reproducible
example payload. No dependency, host grant, release, publication or deployment
is included.

The bytecode-5 instruction `class-keywords(body, base_count, keyword_names)`
consumes the evaluated bases followed by one value per keyword name and produces
the class result. Names are unique normalized identifiers, at most 128; bases
retain their existing cap of 16. Verification checks class-body kind, lexical
captures and exact stack shape and freezes the keyword-name array. A sole
`metaclass` keyword retains the existing `class-meta` instruction. Earlier
bytecode versions reject the new instruction.

Semantic anchors: the Python 3.14 [class creation protocol](https://docs.python.org/3.14/reference/datamodel.html#customizing-class-creation)
and pinned [type construction implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
