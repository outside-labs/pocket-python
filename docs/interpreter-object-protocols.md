# Object reflection and arithmetic

INT-OBJECT-01 adopts finite slices against CPython 3.14.7. The authored
`object-protocols.json` reference must also execute independently in Node and
Chromium, draining and instruction-boundary drivers. Classes remain explicit in
classes-source/1; core-source/1 keeps primitive arithmetic and generator support.

| Stage | Finite contract |
| --- | --- |
| O1 | getattr(object, name[, default]), hasattr(object, name), setattr(object, name, value), delattr(object, name) on admitted class attributes. Existing descriptor precedence, Python callbacks and metadata rules apply. Names must be strings; only AttributeError is suppressed by defaults/hasattr. No lexical mangling is applied to dynamic strings. |
| O2 | Binary/reflected/in-place slots for +, -, *, /, //, %, **, shifts and bitwise operators; unary +, -, ~; divmod and two/three-argument pow. Strict right-subclass reflected overrides have priority, same-type reflected fallback is suppressed, NotImplemented advances dispatch, and in-place slots fall back to binary dispatch. Results can be arbitrary owned Python values. |
| Future | __new__, super, richer type/isinstance/issubclass, builtin subclasses, metaclasses, custom attribute hooks, ordering, dir/vars/globals/locals/id, and dynamic exec/eval/compile/import remain independently gated. Matrix multiplication requires a separate source/operator slice. |

Implicit operations consult type/MRO slots and descriptor binding, ignoring
instance shadow attributes. Signature and callback failures propagate; a method
body's AttributeError is not interpreted as a missing arithmetic method.
Descriptor callbacks and operators run on ordinary owned frames. All candidates,
operands, intermediate results and outer destinations remain rooted across
collection, stepping, cancellation and allocation failure. Attribute mutation
retains the existing rollback and bounded namespace rules. Hard teardown executes
no new user finalizers and releases all logical owners.

This delivery does not complete INT-OBJECT-01, INT-09, native extensions or async
host integration. No publication, deployment, service or dependency is selected.
See [numeric emulation](https://docs.python.org/3.14/reference/datamodel.html#emulating-numeric-types)
and [attribute builtins](https://docs.python.org/3.14/library/functions.html#getattr).
