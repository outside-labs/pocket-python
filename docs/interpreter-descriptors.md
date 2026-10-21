# Descriptors and decorators

INT-09 adopts three more C2 steps in the explicit classes-source/1 profile:
custom descriptors, native property/method wrappers, and decorator source. They
reuse verified bytecode 5. The default core-source/1 boundary remains unchanged.
The adopted implementation and 69-case CPython reference matrix now run in Node
and Chromium, with offline console acceptance.

## Adopted behavior

Instance lookup checks a descriptor's type for __get__, __set__ and __delete__.
A getter with a setter/deleter precedes instance storage. Otherwise an instance
field precedes a non-data getter or ordinary class attribute. A write/delete uses
the corresponding data-descriptor hook; a missing operation raises AttributeError.
A set-only descriptor without a getter does not change ordinary read precedence.
Class access supplies None and the accessed owner; inherited access supplies the
derived owner. Instance-stored descriptors and instance-stored hook overrides do
not participate in implicit lookup. Class attribute replacement stays ordinary.
The raw type-level __get__ hook receives descriptor/instance/owner directly;
mutation and notification hooks use their adopted method binding. The reference
matrix distinguishes static/class-method wrappers in these positions.

After constructing a class, notify each own namespace entry with __set_name__,
in definition order. Snapshot entries so callbacks can mutate the class without
losing later notifications. Overwrites keep a position; deletion/rebinding moves
it. Inherited and later-added attributes receive no automatic notification.
Callback failure propagates its original Python exception and does not publish
the new class binding, matching the pinned Python 3.14 reference.

Property supplies getter/setter/deleter access and accessor-copy methods. Static
methods return the wrapped value; class methods bind the accessed class. Decorator
expressions evaluate in source order and apply in reverse before the final binding.
Class construction/notification finishes before applying class decorators.

References: [descriptor protocol](https://docs.python.org/3.14/howto/descriptor.html),
[property and method builtins](https://docs.python.org/3.14/library/functions.html),
and [definition/decorator execution](https://docs.python.org/3.14/reference/compound_stmts.html#function-definitions).

## Bounded implementation

Python descriptor hooks run in ordinary VM frames, with shared execution, work,
memory, recursion and cancellation limits. Set/delete results are ignored. Source
locations and exception unwinding retain the attribute operation or constructing
class statement. Pending calls, constructor completion and notification snapshots
must expose all owned values as explicit arena roots. Close releases cyclic graphs
and leaves zero logical bytes/roots/frames; no physical memory bound is inferred.

Property wrappers retain fget/fset/fdel; accessor-copy methods retain their property.
Static/class-method wrappers retain their wrapped value. These values stay in the
arena, have no by-value host transport, and do not gain dictionary-key hashing.
Property accepts the adopted fget/fset/fdel positional/keyword forms. Staticmethod
and classmethod accept one positional value. Initializers remain Python functions,
retained Python bound methods or native method wrappers around Python functions.

Decorator lists have at most sixteen expressions and share compiler work/name/
instruction limits. Temporary values cannot appear in the class namespace. Original
function/class metadata, private-name context and source spans remain intact.
No new dependency, host grant, opcode or engine fallback is introduced. Updated
fingerprints identify the compiler/runtime; installed caches keep their complete
previous graph until a waiting update activates.

Nested descriptor-valued mutation/notification hook binding, property documentation/reflection,
metaclasses, builtin subclassing, implicit class cells/super and custom attribute/
arithmetic/iteration hooks remain refused until their own matrices are adopted.
This stage does not promise full Python or arbitrary package compatibility.

## Verification and delivery

`tests/fixtures/interpreter/descriptors.json` contains 69 original source programs,
explicit stdout/error-type expectations, and custom/native/decorator/deferred tags.
Run the oracle with `python runtime/check_classes.py --reference-only --corpus
tests/fixtures/interpreter/descriptors.json`. Reference mode never claims VM support.

Deliver five focused stages: contract/reference evidence; custom descriptor VM
continuations and notifications; native wrappers; decorator parsing/lowering;
and offline-console acceptance. Each implemented stage adds its Node/Chromium
comparisons, malformed/resource/teardown checks and retained input hashes.
C3 special methods, async integration and alpha publication retain separate gates.


The complete source report contains 66 adopted CPython stdout/error-type
comparisons and three explicit refusals. Reference validation always covers all 69
programs. During staged development, `--stages` selects source cases and reports
the omitted stages without treating them as implemented.

The console example combines a private field, property setter, inherited class
method constructor and static method. Fifteen source comparisons and eight browser
acceptance groups cover fresh sessions, callback/decorator locations, new decorated
source after offline reload, property-getter Stop/Restart and a waiting update to
the reduced core language/library selection. No hosted deployment follows from
these local checks; DEMO-01 tracks the public console destination and acceptance.
