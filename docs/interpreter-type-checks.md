# Custom instance and subclass checking

The next finite #123 slices adopt custom type checking against CPython 3.14.7.
The `type-checks.json` source corpus is executable reference evidence; stages
become implemented only after independent execution and ownership checks pass.
The explicit classes-source/1 profile and bytecode 5 remain the admission boundary.

| Stage | Contract |
| --- | --- |
| O9 | `isinstance(value, classinfo)` first accepts an exact actual-type identity. Otherwise custom `__instancecheck__` is selected through classinfo's actual type, bypassing class/instance shadows and ordinary attribute hooks. Classes bind the metaclass descriptor to the class and its actual metaclass; ordinary checker instances bind their actual type's descriptor. Inherited functions, static/class methods, properties and custom descriptors use ordinary frames. The returned value undergoes owned Python truth conversion. Native `type.__instancecheck__` bypasses custom checking, accepts real subtypes first and then uses the adopted advertised `__class__` lookup. |
| O10 | `issubclass(derived, classinfo)` selects `__subclasscheck__` through classinfo's actual type before validating derived. Custom hooks also run for self and real subtype relationships. Descriptor binding and result truth conversion follow O9. Native `type.__subclasscheck__` bypasses custom hooks and checks adopted actual type ancestry; advertised `__class__` does not make an ordinary instance into a class. |
| Base | Nested class-info tuples run left to right and stop at the first true result or error. An empty tuple returns false even for an invalid derived argument. Existing bool/int and exception ancestry remain adopted. |
| Future | Abstract class-like objects advertising `__bases__`, unions, generic aliases, custom metaclass attribute access, namespace preparation and mappings remain separately gated. Broader dir/vars/globals/locals/id and dynamic source admission remain under #123. Persistent scheduling, async syntax and host capabilities remain under #34. |

Hooks are ordinary special methods, not automatically class methods. A hook
defined on the checked class itself does not override its metaclass's hook.
An instance checker ignores an instance shadow. Explicit calls preserve the
hook's original result; the builtins convert it to bool. `NotImplemented` has
its adopted Python 3.14 truth error, rather than meaning default fallback.
Missing hooks use the native checking contract. Non-callable hooks, descriptor
binding failures and callback/truth errors propagate, including AttributeError
and StopIteration. A binding AttributeError never requests a native fallback.

The builtins and native type defaults require exactly two positional arguments
(including the receiver for native defaults). Signatures are validated before
callbacks. Native defaults require an adopted type receiver. Class-info tuple
nesting remains bounded at 32; callback recursion, work, instructions and arena
allocations share the activation limits. Non-type checkers without a custom hook
retain an explicit refusal if abstract `__bases__` lookup would be required.
Class and metaclass creation/mutation admit only the adopted special names.

Checked values, checker objects, pending descriptors, truth values and enclosing
tuple destinations must remain explicit roots. Binding, invocation and truth
conversion use the existing execution machine and ordinary owned frames. Every
instruction can be followed by collection. Cancellation, resource failures and
idempotent close release all logical owners without executing further callbacks.
The eight existing composed resource observations retain their exact accounting.

Acceptance requires independently compiled Node and Chromium source with drain
and instruction-boundary drivers, source diagnostics, collection, cancellation,
recursion/work/allocation failures, followed by installed offline execution and
Stop/Restart inside binding, checking and truth callbacks. Engine assets and
receipt hashes stay pinned. No dependency, host authority, publication or
deployment change accompanies these protocols.

Semantic anchors: Python's [custom checking protocol](https://docs.python.org/3.14/reference/datamodel.html#customizing-instance-and-subclass-checks)
and the pinned [CPython implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c).
The pinned executable decides the finite cases when later documentation differs.
