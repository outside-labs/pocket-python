# Staged Python class contract

INT-09 adopts the following stages before adding class execution. The existing
core-source/1 source profile and bytecode 3/4 behavior remain available. New
syntax is selected explicitly through classes-source/1, using verified bytecode
5. No engine fallback, package compatibility or alpha publication follows from
this contract. CPython 3.14 supplies the reference only in tests.

## C1: class foundation

Each executed class statement creates a distinct VM-owned class. Its bases are
evaluated once, left to right, then its ordinary namespace body runs before type
construction. A failed body/construction does not replace the previous binding.
The implicit base is the VM-owned object class. Explicit user-class multiple
inheritance uses bounded C3 linearization, including diamond order and refusal
of duplicate/inconsistent bases. Subclassing native/builtin classes is later.

Class bodies resolve their own bound namespace entries first. An unbound class
local falls back to globals/builtins; a class is not an enclosing lexical scope
for methods. Methods and nested classes can retain enclosing function cells
through a class, even when the class also binds the same name. Class names are
published only after successful construction. Existing source binding limits,
work/recursion budgets and source tracebacks apply to body execution.

Instances have separate bounded attribute maps and retain their class. Reads
prefer an instance entry, then the class's C3 namespace lookup. A Python function
found there creates a fresh bound-method wrapper holding the function and
receiver. Class access returns the original function. Ordinary instance shadowing,
class replacement and deletion preserve existing retained method bindings.
Bound methods compare by receiver/function identity and expose __self__/__func__.
Classes/instances otherwise compare by identity and have default true truthiness.

Calling a class allocates a fresh instance, resolves __init__ on its class and
calls it with the instance plus ordinary arguments. The initializer must return
None. Without an initializer, arguments are refused. Existing positional-only,
keyword-only, immutable default and exception rules continue to apply. object(),
type(instance), isinstance(value, user_class/object) and issubclass(user_class,
user_class/object) are the initially adopted type operations; tuple class-info,
three-argument type and full builtin-type reflection are later.

__name__, __qualname__, __module__, __bases__ and __mro__ expose bounded class
metadata; instance __class__ is readable. Structural metadata mutation and raw
__dict__ access are deferred. Classes, instances and method wrappers stay inside
the arena and have no by-value transport. Dictionary keys involving these values
require a later identity-hash contract. Other custom special methods, private
name mangling, metaclasses, slots, super(), descriptors and decorators are
explicitly refused in C1 rather than given partial Python semantics.

## C2: descriptors and decorators

Before widening source acceptance, implement and test data-descriptor precedence
over instance storage, non-data-descriptor precedence after instance storage, and
the descriptor class's __get__/__set__/__delete__ lookup. Class access passes None
as the instance and the accessed owner. AttributeError and descriptor side
effects remain observable. Include read-only properties, setters/deleters,
staticmethod and classmethod binding, inherited descriptors and __set_name__.

Decorator expressions evaluate in source order; application proceeds in reverse
order after constructing the function/class. Cover replacement objects, errors
and side effects before exposing decorator syntax. Add private-name mangling
with nested class/function and Unicode cases. Unsupported descriptors, special
methods and inheritance hooks must not silently behave as ordinary attributes.

## C3: adopted special methods and closure of INT-09

Choose and test an explicit special-method matrix before each extension. Cover
implicit lookup on the type, return-type validation, exception transport and
bounded recursive dispatch. __new__, arithmetic/comparison overrides,
__getattribute__/__getattr__, attribute mutation hooks, iteration and formatting
remain refused until their individual cases and resource rules are adopted.
Metaclasses, __prepare__, __mro_entries__, __init_subclass__, __classcell__/zero-
argument super, reflection and arbitrary builtin subclassing retain separate gates.
INT-09 remains open until its adopted stages and refusal matrix have implementation
evidence; the class foundation alone does not satisfy the whole issue.

## Memory, verification and delivery

Class namespaces, bases/MRO, instance fields, method receivers/functions, code,
globals and captured cells are explicit arena edges. Bounded creation/lookup/C3
work polls cancellation. Failed mutations restore the previous map and accounting.
Class/instance/method cycles must collect after roots are released; close must
leave zero logical bytes/roots/frames. No Python destructor or host finalizer is
introduced. Arena accounting is separate from JavaScript GC and process RSS.

`tests/fixtures/interpreter/classes.json` records stage-tagged original programs
and explicit stdout/error-type expectations. `python runtime/check_classes.py
--reference-only` independently verifies them with CPython, without claiming VM
support. Implementation adds Node/Chromium comparisons, structured refusal,
malformed bytecode, memory/cancellation and offline console checks. Earlier
source, modules, libraries and console suites remain mandatory. Adoption is
delivered first; values, execution, source and browser integration use focused
stacked PRs, with INT-09 progress recorded in the issue and Project.

References: [Python data model](https://docs.python.org/3.14/reference/datamodel.html),
[class execution and name binding](https://docs.python.org/3.14/reference/executionmodel.html),
and the [descriptor guide](https://docs.python.org/3.14/howto/descriptor.html).
