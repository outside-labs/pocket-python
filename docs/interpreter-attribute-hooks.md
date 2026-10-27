# Instance attribute hooks and advertised classes

The next finite #123 slices use CPython 3.14.7 as their executable reference.
`attribute-hooks.json` records 76 source cases. Reference expectations do not
establish implementation; each stage is enabled only with independent execution
and its ownership tests. Classes remain explicit in classes-source/1, bytecode 5.

| Stage | Contract |
| --- | --- |
| O6 | Ordinary instance reads select `__getattribute__` through the actual type's C3 MRO. Only `AttributeError`, including descriptor-binding errors, enables type-selected `__getattr__`; its own failure is propagated once. The default read retains data-descriptor, instance and non-data-descriptor precedence. `object.__getattribute__` bypasses custom hooks and never invokes the missing-attribute fallback. Functions, static/class methods and descriptor-valued hooks bind through ordinary owned frames. Instance shadows do not replace implicit hooks. |
| O7 | Writes/deletes select `__setattr__`/`__delattr__` through the actual type, ignoring instance shadows. Implicit mutation ignores the hook's return value; explicit calls preserve it. Direct `object.__setattr__`/`object.__delattr__` bypass custom hooks while retaining existing properties, descriptors, bounded mutation and rollback on allocation failure. Missing/erroring mutation never invokes `__getattr__`. |
| O8 | Ordinary instance `__class__` reads obey custom hooks and class descriptors/values; the native default otherwise returns the actual type. `type(value)`, implicit protocols and successful actual-type checks bypass advertised identities. `isinstance` traverses bounded nested class-info tuples in order, checking the actual type before an advertised class for each valid candidate. `AttributeError` in the advertised read means false; other exceptions propagate. `super` first accepts real instance/subtype relationships, then tries an advertised class. A missing/invalid/unrelated advertised class produces `TypeError`; other lookup failures propagate. |
| Future | Custom metaclass attribute/instance/subclass hooks, namespace preparation, class keywords, `__init_subclass__`, `__mro_entries__`, builtin layouts, `__dict__`/mapping proxies, dir/vars/globals/locals/id and dynamic source admission retain separate contracts. Async scheduling and host capabilities remain under #34. |

The existing bounded string-name contract applies: at most 256 JavaScript code
units, no identifier normalization for reflective calls, and no private-name
mangling of supplied strings. Unsupported special attributes retain their
explicit refusal before custom hook effects. Signatures and name types are
validated before callbacks. Native object defaults in this slice accept ordinary
user instances; builtin layouts, class receivers and their mutation protocols
remain separately gated. `__class__` assignment remains refused.

Ordinary syntax and getattr/hasattr share the read pipeline. The optional
reflection wrappers suppress only a final `AttributeError`, after the missing
hook has had its opportunity. An explicit `a.__getattribute__(name)` is an
ordinary attribute read followed by a call; it is not the implicit dispatch
operation. Construction, arithmetic, iteration, truth/length, hashing and other
special protocols continue to select slots through the actual type, bypassing
these instance hooks. Class-object reads keep their adopted metaclass behavior.

All receivers, names, pending values, fallback arguments, advertised classes,
super types and outer destinations must be explicit operation/continuation
roots. Descriptor binding and hook invocation use the common execution machine,
with collection between instructions, shared recursion/work/allocation limits,
source-located errors, cancellation and idempotent close. A fallback does not
run on cancellation or resource failure. Logical teardown must reach zero;
the eight existing composed resource observations retain their exact values.

Acceptance requires Node and Chromium source execution with drain/step drivers,
resource interruption and callback lifetime checks, followed by installed offline
console execution and Stop/Restart inside hooks. Engine assets and receipt hashes
stay pinned. No dependency, service, host grant, publication or deployment changes.

Semantic anchors: Python's [attribute-access model](https://docs.python.org/3.14/reference/datamodel.html#customizing-attribute-access),
[special-method lookup](https://docs.python.org/3.14/reference/datamodel.html#special-method-lookup),
[isinstance](https://docs.python.org/3.14/library/functions.html#isinstance) and
[super](https://docs.python.org/3.14/library/functions.html#super). The pinned
executable reference decides these finite cases if later documentation differs.

O6 is implemented through owned read operations. The initial 33 O6 cases pass
Node drain/step execution; descriptor binding, original fallback snapshots,
source errors, every-instruction collection, cancellation and real resource
limits have dedicated tests. O7/O8 still require their implementation slices.
