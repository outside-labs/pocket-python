# Construction, super and type relations

INT-OBJECT-01 adopts the following finite construction slices against CPython
3.14.7. `construction.json` records independent source/reference expectations;
an authored reference is not evidence that the independent engine implements it.
O3, O4 and O5 are implemented with independently executed acceptance below.
Classes remain explicit in classes-source/1 and bytecode 5. The default
core-source/1 and bytecode 4 do not gain class syntax or reflective builtins.

| Stage | Contract |
| --- | --- |
| O3 | Class calls select `__new__` through the class MRO, bind its descriptor with no instance, and pass the requested class plus original arguments. A Python function defined as `__new__` is implicitly static. `object.__new__` allocates an ordinary user instance. Only a returned instance of the requested class or its subclass is initialized, using the returned value's actual type and the original arguments. Foreign values pass through unchanged. `__init__` binds normally, can suspend, and must return None. Direct `object.__new__`/`object.__init__` validate receivers and extra arguments. Mutation, wrappers, callable descriptors, exceptions and generator returns obey the existing protocols. |
| O4 | `super(T, value)` follows the current C3 MRO after T, ignoring instance shadow attributes and binding descriptors to the original value and dynamic owner. `super(T)` and `super(T, None)` are unbound; stored unbound proxies bind as descriptors. Zero-argument `super()` reads the calling Python frame's first positional parameter and lexical `__class__` cell. Cells are filled before class decorators run, are shared with nested functions and suspended generators, and do not capture ordinary class locals. Proxy metadata `__thisclass__`, `__self__`, `__self_class__` and `__class__` is read-only. |
| O5 | `type(value)` returns canonical type identities for adopted values. `isinstance`/`issubclass` accept types and nested tuples with Python short-circuit/error order, bool/int ancestry and the adopted exception hierarchy. Three-argument `type(name, bases, namespace)` accepts a tuple of adopted bases and an ordinary dictionary with string keys. Finite metaclasses support inheritance from type, most-derived selection/conflicts, explicit `metaclass=`, and user `__new__`/`__init__` through ordinary frames and `type.__new__`/`type.__init__`. Class cells propagate through the namespace to `type.__new__`. Metadata, class decorators and `__set_name__` retain their order. |
| Future | Builtin instance layouts/subclassing, custom `__prepare__` and class-creation mappings, extra class keywords, `__init_subclass__`, `__mro_entries__`, callable metaclass factories, additional metaclass special slots beyond construction/call, custom instance/subclass checking, non-string namespace keys, unions, custom attribute hooks and dynamic source admission require separate contracts. Broader dir/vars/globals/locals/id, coroutine/async-generator and host-adapter work remain open under #123 and #34. |

O5 covers ordinary dictionary class namespaces. It does not imply an arbitrary
metaclass or builtin-subclass profile. Unsupported class-creation hooks must be
rejected before class-body or hook effects where the source/compiler can identify
them. Dynamic namespace inputs are bounded and validated before notification.
Dynamic class names are bounded strings, not necessarily Python identifiers.
Existing class-statement names remain normalized identifiers.
Type relations use bounded nesting of at most 32 class-info tuples. Reflection
returns canonical identities for the adopted value families; construction of
reflected implementation types is separately refused, except the no-argument
NoneType and NotImplementedType singletons. `dict()` is available without
arguments in classes-source/1; populated dictionary constructors remain deferred.

All constructor/type candidates, arguments, keyword values, namespace contents,
class cells, super receivers and outer destinations are explicit owned edges or
continuation roots. Python callbacks execute on the common machine. Stepping and
collection preserve pending values; cancellation, recursion/work limits and real
callback allocation failure release all logical owners. Close is idempotent and
does not execute new user finalizers. The eight existing composed resource
observations retain their exact accounting; new records have explicit costs.

Acceptance requires independently compiled source in Node and Chromium, draining
and instruction-boundary execution, callback/source-error coverage, collection
between instructions, cancellation and allocation failure. The offline console
must execute newly entered source after reload and support Stop/Restart in
constructor and descriptor callbacks. Complete engine assets and their receipt
hashes remain pinned. No dependency, service, host capability, publication or
deployment change is included.

The semantic anchors are the Python 3.14
[construction protocol](https://docs.python.org/3.14/reference/datamodel.html#object.__new__),
[class creation](https://docs.python.org/3.14/reference/datamodel.html#customizing-class-creation)
and [super builtin](https://docs.python.org/3.14/library/functions.html#super).
The pinned executable reference decides the finite cases when later patch-level
documentation differs.

## Accepted evidence

The 113-case matrix has 105 adopted comparisons and eight explicit future
refusals. Node and Chromium each pass draining and instruction-boundary execution:
452 observations, including 436 measured zero logical teardown records. Source,
corpus and driver hashes are checked against the retained reports. Dedicated
tests cover callback source frames, temporary metaclasses, missing/conflicting
class cells, notification destinations, suspended generators, every-instruction
collection, cancellation/close and real recursion/work/allocation failures.
All 385 Node tests pass, including the eight unchanged composed resource cases.

Installed offline console acceptance has 487 program comparisons, 44 acceptance
groups and 98 Stop/Restart cycles. New source composes construction, super,
metaclasses and generators after offline reload. Constructor/metaclass errors
retain their Python source diagnostics; custom preparation remains a refusal.
The waiting class-to-core update still removes class/library authority.

The [payload and source record](measurements/2026-10-26-construction.json)
contains all 38 file sizes and hashes for the 592,822-byte construction console,
including the receipt and deterministic compression observations. This is a
complete local payload measurement, with no timing, device or package claim.
