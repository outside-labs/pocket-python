# Staged Python class contract

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

The [O79–O83 construction contracts](interpreter-expanded-class-bases.md),
[prepared namespaces](interpreter-prepared-class-namespaces.md),
[callable factories](interpreter-metaclass-factories.md),
[custom MRO](interpreter-custom-mro.md) and
[actual-metaclass protocols](interpreter-metaclass-protocols.md) supersede the
earlier stage boundaries for those features below.

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
Classes/instances otherwise compare by identity. C1 defaults them to true; adopted
C3 instance length/truth protocols now override that default.

Calling a class allocates a fresh instance, resolves __init__ on its class and
calls it with the instance plus ordinary arguments. C1 initializer overrides
require Python functions or retained Python bound methods. The initializer must return
None. Without an initializer, arguments are refused. Existing positional-only,
keyword-only, immutable default and exception rules continue to apply. object(),
type(instance), isinstance(value, user_class/object) and issubclass(user_class,
user_class/object) are the initially adopted type operations; tuple class-info,
three-argument type and full builtin-type reflection are later.

__name__, __qualname__, __module__, __bases__ and __mro__ expose bounded class
metadata; instance __class__ is readable. Structural metadata mutation and raw
__dict__ access are deferred. Classes, instances and method wrappers stay inside
the arena and have no by-value transport. Adopted dictionary keys follow the
[owned equality/hash contract](interpreter-equality.md); bound-method hashing
retains a separate boundary. Other custom special methods, private
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
and side effects before exposing decorator syntax. The separately delivered
[private-name compiler](interpreter-private-names.md) covers nested scopes,
Unicode and import rules. Unsupported descriptors, special
methods and inheritance hooks must not silently behave as ordinary attributes.

## C3: adopted special methods and closure of INT-09

The [selected protocol sequence and call contract](interpreter-special-methods.md)
start with the delivered __call__/callable() and __len__/__bool__ milestones,
followed by the delivered [bounded repr/str slice](interpreter-formatting.md)
and [integer conversion/item/slice contract](interpreter-indexing.md), then
[owned iteration and containment](interpreter-iteration.md), and
[equality/hash and dictionary keys](interpreter-equality.md).
Length/truth and formatting resume operations through ordinary VM callbacks and
validated results; pending print arguments have explicit owned completions.
Choose and test an explicit special-method matrix before each extension. Cover
implicit lookup on the type, return-type validation, exception transport and
bounded recursive dispatch. __new__, arithmetic/ordering overrides,
__getattribute__/__getattr__, attribute mutation hooks and further formatting
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

## Delivered value foundation

The internal ClassRuntime now owns class/instance maps, bounded C3 order and
receiver/function method wrappers. Limits are sixteen direct bases, sixty-four
MRO entries and 128 attributes per namespace/instance. Explicit layout edges
retain bases, namespaces, receivers and lexical function graphs. Growth and
foreign-arena failures roll back mutations; cyclic graphs release with roots.
The [hashing contract](interpreter-equality.md) adds owned identity labels;
by-value transport remains deferred. Core engine locks include the changed allocation
layouts; the execution and source integration below use the same layouts.

## Verified execution foundation

Bytecode 5 distinguishes module, function and class-body records. Class creation
and attribute instructions have verified operands, captures and stack effects;
class bodies cannot be called as ordinary functions or return values explicitly.
The registry preserves these record kinds. A class body runs through ordinary
frames, shares work/memory/recursion limits, and completes before C3 construction.
Constructor completion validates None and returns the retained instance. Failed
construction and initializer-return checks report the calling class statement.

Hand-authored bytecode tests cover initialization/method execution, failure side
effects and locations, malformed records and shared resource limits. The pinned
console closure now includes the class runtime and shared special-method policy (twenty-two modules
plus two notices), while core-source/1 still compiles bytecode 4 and refuses class syntax.
The source and console integrations below retain these versioned records.

## Opt-in source execution

`compileSource(source, {languageProfile: "classes-source/1"})` and
`compileSourceModules(modules, {languageProfile: "classes-source/1"})` now parse,
bind and compile the C1 subset independently to bytecode 5. Compilation records
retain the selected profile. Omitting the option preserves core-source/1,
bytecode 4 and class-syntax refusal. Unknown profiles fail explicitly.

Class scopes retain enclosing function cells without capturing their own
namespace into methods; nested classes/functions have Python-qualified names.
Attribute assignment, augmentation and deletion preserve operand order and
evaluate receivers once. Implicit class cells, metadata overrides and later
special methods refuse before application effects. The later C2
[private-name compiler](interpreter-private-names.md) now extends this profile
with lexical name mangling, using the same verified bytecode 5 instructions.
The intrinsic object type is immutable. Class module metadata is text in C1.

Run `python runtime/check_classes.py --target node` or `--target browser`.
The expanded thirty-nine-case matrix checks adopted class/private stdout/error types against
CPython and explicitly classifies later-stage refusals. Messages, repr addresses
and generic object transport are not treated as compatible. Node tests also
cover defining-module globals, shared object identity across imports, namespace/
closure overlap, class-suite scope resets and compile/execution/C3 resource limits.

## Browser console selection

From the checkout, build the class example and serve the generated directory:

```sh
uv run python -m examples.interpreter_classes
python -m http.server 8000 --bind 127.0.0.1 --directory build/class-console
```

The editor identifies classes-source/1 and runs the Counter/StepCounter example.
After **Offline ready on this device**, newly entered class source also executes
offline. Each Run has fresh variables, classes and instances. Stop terminates a
busy worker; Restart creates a fresh session with the editor text retained.

For an existing CONSOLE-SOURCE.json selection, add
`--language-profile classes-source/1` to `pocket-python interpreter-web`.
The Python builder accepts `build_interpreter(..., language_profile='classes-source/1')`.
Omitting the selection retains core-source/1 and bytecode 4. Unknown profiles and
mismatched profile/bytecode identities fail explicitly; initialization and Ready
bind the complete selected identity. Receipts, provenance, configuration and
cache versions include that selection. Both profiles supply the same complete
engine; this is a language selection, without component pruning.

Language and library selection compose independently: core-only/1 or operator/1
retain their reviewed sources, notices and output-only/1 host boundary. Classes
gain no DOM, network, storage or file authority. Classes and bound methods remain
inside each run's arena rather than crossing the host protocol.

`python scripts/classes_console_browser_smoke.py` records twenty-six CPython source
comparisons and eleven browser acceptance groups: explicit selection, source-located
errors/refusal and fresh state, private errors and parameter collisions before
effects, descriptor/decorator error locations, call/binding failures, validated
length/truth results, optional binding fallback, short circuiting and loop control.
New callable-decorator and length/truth-loop input after offline reload, five
call/length/truth/body-binding Stop/Restart cycles, a waiting class-plus-library
to core-only update, and local static
GET-only execution. The old tab retains its selected language until closed; the
new offline application refuses classes and removed imports before recovering
with core source. CI retains this report and the Node/Chromium class corpus.
The adopted C2 descriptor/decorator matrix now passes in Node/Chromium and the
offline console; see the [implementation contract](interpreter-descriptors.md).
The Counter example uses a property, class method, static method and inherited
__call__, with callable() confirming the available type slot. Its __len__/__bool__
methods also demonstrate length, active/empty state and conditional evaluation.
The optional operator library exercises user length through truth/not_. C3 and INT-09
remain open; this development checkpoint has no PyPI release.


The indexed-object checkpoint adopts __index__, __getitem__, __setitem__ and
__delitem__, raw slice/tuple keys, builtin sequence conversion and bounded list
slice mutation. Its 89-case matrix has 81 reference comparisons and eight future
refusals. The offline console has 54 source comparisons and 15 acceptance groups,
including 15 Stop/Restart cycles. The iteration and equality/hash checkpoints
extend this baseline; these bounded protocols do not close INT-09 or the async milestone.

The current equality/hash checkpoint has 103 source cases (97 comparisons and six
explicit refusals) and 244 passing Node tests, including the unchanged composed
resource baselines. The class console has 76 comparisons, 21 acceptance groups
and 35 Stop/Restart cycles. Fresh offline source covers comparison binding,
NotImplemented, hash collisions and stored-key identity. Remaining structural
dictionary reentry, bound-method/slice hashing and ordering keep explicit gates.
