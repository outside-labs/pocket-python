# Python compatibility inventory

The [O95 reconciliation](interpreter-object-scope.md) defines current object
scope and exact boundary owners. Earlier delivery descriptions below retain
their checkpoint context; the machine-readable inventory owns current rows.

This inventory adopts CPython **3.14.7** as the semantic oracle on Node and
Chromium. The [machine-readable inventory](interpreter-compatibility.json)
records exact scopes, gaps, source evidence and ordered issue links. The live
Python 3.14 documentation described 3.14.9 when checked on 2026-10-22; it does
not silently change the oracle. Later patch/minor and Unicode changes require
recorded deltas, executable cases and a deliberate profile decision.

A supported row describes only its named scope. Partial rows expose the missing
forms. Deferred rows earn no support credit; host-restricted rows require an
explicit target authority contract. The core profile remains the default; class
syntax and its additional builtins require classes-source/1. This inventory is
a continuing program beyond the first application profile.

The [O59 container directory contract](interpreter-container-directories.md)
adds sorted/default and raw native directories for str/list/tuple/dict, preserving
contents, cyclic graphs, iterator positions and exact native receiver binding.
Listed native APIs retain separate read and operation boundaries.

The [O67 live namespace contract](interpreter-module-namespaces.md) adopts shared module/global dictionaries, live writes/deletes and owned module hooks. The [O68 class body contract](interpreter-class-body-namespaces.md) adds live body dictionaries, lexical/global scope ordering, metadata/cell propagation and comprehension walrus binding. Prepared mappings are delivered by O80.

The [O69 native namespace contract](interpreter-native-namespaces.md) materializes complete own dictionaries for source classes and every adopted native layout, with stable descriptors, native storage fields, exact namespace keys and explicit owners for deferred APIs.

The [O60 set/buffer directory contract](interpreter-buffer-directories.md) adds
set/frozenset/bytes/bytearray/memoryview layouts, preserving hash entries, mutable
storage, view aliases and directories after release. Released-view data access,
unread APIs and core-profile directory admission retain explicit boundaries.

The [O61 instance directory contract](interpreter-instance-directories.md) adds
root/ordinary instances, optional dictionary/class reads, exact key identities and
live inherited source/dynamic class namespace merging. Further custom metaclass
namespace reflection and non-class advertised namespaces retain explicit refusals.

The [O62 class directory contract](interpreter-class-directories.md) adds ordinary
source/dynamic class directories and native type.__dir__ binding, preserving live
depth-first base merging and retained class graphs. Further native type layouts
and custom metaclass namespace reflection remain separate.

The [O63 numeric type directory contract](interpreter-numeric-type-directories.md)
adds bool/int/float/complex/NoneType/NotImplementedType directories, native raw
order and bound receiver identity, including ordinary advertised type namespaces.
Native entry reads and type mapping access remain separate contracts.

The [O64 container type directory contract](interpreter-container-type-directories.md)
adds str/list/tuple/dict/range/slice/set/frozenset/bytes/bytearray/memoryview type
directories. Enumeration preserves existing contents, iterator state, aliases and
released-view data restrictions. Further builtin and metaclass namespaces remain
separate contracts.

The [O21/O22 comprehension contract](interpreter-comprehension-reflection.md) adds optimized enclosing and isolated module/class comprehension snapshots, with nested target masking, captured-cell ordering and restored bindings.

## Evidence and interpretation

The 753 trusted probes include representative source programs and all 71 names
in the Python 3.14 built-in-functions index. Builtin exceptions and constants are
separate language/value surfaces. A positive callable(NAME) result proves name
availability only, not every signature or value family. Negative availability
observations do not count as Python compatibility. Restricted names are resolved
but never invoked by the oracle. The isolated oracle uses -S; help is normally
injected by site and is absent in that environment as well as in this engine. The full existing source, class, private-name,
descriptor, protocol, module and library matrices remain the detailed evidence.
Fixture-compiled bytecode alone does not prove independent source admission.

Run the probes with the pinned environment:

```sh
python runtime/check_compatibility.py --target node --report build/compatibility-node-report.json
python runtime/check_compatibility.py --target browser --report build/compatibility-browser-report.json
```

Each report hashes its inventory, corpus and implementation inputs, records the
actual source output/diagnostic/phase and checks logical teardown. A passing
observation means the recorded behavior was reproduced. Only supported positive
cases earn support credit. The current observations contain 562 supported, 73
deferred and four host-restricted results, with no recorded known divergence.
These are representative observations, not a percentage of Python coverage.

The [O23/O24 subclass contract](interpreter-subclass-initialization.md) adds
inherited initialization after descriptor notifications, cooperative C3 binding,
native bound method identities and explicit class keyword propagation through
type/metaclass construction. Expanded class bases/keyword mappings and custom
namespace preparation retain their separate boundaries.

The function-binding and ordinary-syntax contracts adopt their finite signatures
and expression/target forms. Type aliases, annotations and broader formatting
remain separate boundaries. The [value-family contract](interpreter-value-families.md)
adds 122 semantic cases and 14 explicit future refusals in classes-source/1,
with 103 shared core observations. Each profile runs in Node/Chromium with drain
and instruction-boundary drivers. Broader builtin APIs remain in their existing
issue families; availability alone never certifies an entire type or module.

## Language and platform surfaces

| Surface | Status | Exact current scope and remaining work |
| --- | --- | --- |
| lexical-unicode | supported | Unicode identifiers normalized with pinned Unicode data; Unicode strings, raw/triple strings, explicit/implicit line joining and indentation within core-source/1. The exact admitted grammar is documented in interpreter-language.md; other literal families have separate rows. |
| numeric-operations | partial | Arbitrary integers, binary64 real and owned complex values; exact integer true division, bounded powers, bitwise/shifts and primitive helpers; real/complex construction and selected numeric/index callbacks. Both source profiles admit primitive APIs; callbacks require classes-source/1. General complex powers, non-finite recovery and extra numeric methods remain #184; expanded formatting remains #127. |
| string-values | partial | Unicode code-point length, concatenation, comparison, membership, indexing and slicing, including negative step. Strict UTF-8/ASCII/Latin-1 encode/decode uses the value-family contract. Bounded repetition preserves code points and supports primitive factors in both profiles, with owned index callbacks in classes-source/1. Broader string methods, formatting, additional codecs and non-strict codec error policies remain deferred. |
| container-values | partial | List/tuple/dict literals, item access/mutation, scalar list deletion, primitive reads, list append/aliases/in-place operations and primitive-key dictionary equivalence/order; classes-source/1 also admits bounded list/tuple RHS slice assignment/deletion. Classes-source/1 also adopts user/default dictionary keys and owned list/tuple/dictionary equality. Finite list/tuple construction preserves primitive and owned iterable elements; user length hints remain refused. Set/frozenset construction, displays, owned membership/equality, finite mutation APIs and primitive algebra are adopted. Bytes/bytearray values adopt a finite binary-sequence/codec surface. Ordinary list/tuple repetition makes shallow copies with primitive factors in both profiles and owned index callbacks in classes-source/1. Dictionary constructors, broader methods, structural dictionary comparison mutation and remaining value/hash families are deferred. |
| expression-order | supported | Admitted expression evaluation, chained comparisons, identity/membership, short circuit and/or, not and conditional expressions. This row covers admitted value/protocol families, not every Python expression. |
| ordinary-control | supported | if/elif/else, while/for over adopted values, loop else/break/continue, return and finally control transfer. Generator, context-manager, match and async control are separate rows. |
| function-binding | partial | def, recursion, positional-only/ordinary/keyword-only parameters; literal and definition-time computed/mutable defaults and lexical closures. Global/nonlocal writes and deletion share the defining module and lexical cells. Variadic positional/keyword parameters pack fresh owned values. Positional starred calls consume owned iterables. Keyword call expansion admits owned dictionaries and keys/getitem mappings with ordered duplicate checks. Function source docstrings use pinned indentation cleanup; arbitrary owned __doc__ assignment/deletion and live read-only bound-method reads are adopted. Exact mutable Python function names and definition-time module snapshots; live read-only bound-method metadata uses owned callable lookup. Live function dictionaries and bound-method custom attribute fallback retain exact identities, replacement snapshots and owned collision/read/descriptor callbacks (O45/O46). Construction-hint forms and annotations remain deferred; signatures and error-message comparisons are scoped by interpreter-function-binding.md. |
| ordinary-syntax-gaps | partial | Assertions and assignment expressions in both source profiles, with owned truth callbacks and lexical scope writes. Lambda functions use ordinary parameters/defaults and lexical cells. Tuple/list/starred assignments, loop targets, and starred sequence/dictionary displays use owned iteration/mapping phases. Construction hints remain with their sequence task; assertion message formatting and comprehensions retain separate gates. |
| class-construction | partial | Explicit classes-source/1: user classes, bounded C3 MRO, owned __new__/__init__, conditional runtime-type initialization, descriptors, bound methods, lexical __class__ cells and explicit/zero-argument super. Finite metaclasses adopt type-derived inheritance, selection/conflicts, __new__/__init__/__call__, descriptor binding and class-cell propagation with ordinary dictionary namespaces. Inherited __init_subclass__ runs after descriptor notifications with owned C3/descriptor binding, automatic definition-time classmethod wrapping and explicit named class keyword forwarding through type/metaclass construction. Finite actual-metaclass attribute reads/mutations and native type defaults use owned descriptor binding, original fallback snapshots, metadata precedence and reflected native wrapper identities. Finite native descriptor __objclass__ metadata, type.mro() fresh C3 lists and primary-base reflection preserve actual types and owned receiver lifetimes. Ordinary class docstrings, default None documentation and instance shadowing are adopted. Expanded class headers, owned MRO entry resolution/original bases, prepared mapping bodies, callable factories and custom metaclass MRO construction are adopted by O79–O82. O83 applies the finite 72-name actual-metaclass slot inventory with owned reflected dispatch, descriptors, hashing and mutation. O84–O88 add slots, native payload subtypes, property/wrapper/module/super subtypes, compatible class/base reassignment and live weak subclass enumeration. Generic/annotation, context, buffer, formatting, exception and async protocols remain #125/#121/#117/#127/#124/#34. Native ABI/layout interchange is outside the source interface. |
| private-names | supported | Lexical private-name mangling in admitted class bodies, nested code, parameters/imports and metadata. No additional syntax beyond the explicit source profile. |
| descriptors-decorators | partial | Functions, properties, static/class methods, custom get/set/delete/name-notification descriptors and decorators in classes-source/1. Property/custom-descriptor-valued mutation and name-notification hooks bind and invoke through owned frames, preserving original failures and notification snapshots. Explicit native property get/set/delete and static/class method __get__ have bound/unbound wrapper identities, positional validation and owned callback/receiver lifetimes. Class methods wrapping native callables preserve Python method identity, callable metadata and equality distinction from native wrappers. Native property accessor copies retain None accessors and shallow identities; explicit Python function binding preserves receiver/function identity, ignored owners and lazy invocation. Explicit native method/wrapper descriptor rebinding covers the finite O33/O34 allowlist, with actual-layout validation, ignored owners, native callable identities and owned receiver lifetimes. Finite native descriptor __objclass__ metadata, type.mro() fresh C3 lists and primary-base reflection preserve actual types and owned receiver lifetimes. Property __name__ preserves arbitrary assigned values, lazy owned getter lookup, deletion and accessor-copy independence. Native __set_name__ supports bound/unbound/rebound calls and automatic namespace snapshot notification. Function abstract markers and computed read-only property/static/class method flags use owned optional lookup and truth conversion, preserving lookup-only AttributeError suppression, order, live changes and callback failures. Eager optional getter documentation, explicit documents, exact owned mutation/deletion and origin-sensitive accessor copies preserve lookup-only AttributeError suppression and post-callback notification names. Live function dictionaries and bound-method custom attribute fallback retain exact identities, replacement snapshots and owned collision/read/descriptor callbacks (O45/O46). O69–O90 add materialized native dictionaries, wrapper metadata, native documentation, property copies/subtypes, owned name diagnostics and explicit native protocols. Recursive container/default displays remain #127; annotations/type parameters #125; serialization and weakref libraries #126. |
| call-length-truth | supported | Type-level __call__/__len__/__bool__, callable(), len(), bool(), not and control tests in classes-source/1, including adopted descriptor binding and optional truth fallback. Length uses the explicit signed-64-bit contract; later protocols remain separate. |
| repr-str | partial | print/str display None, bool, int, strings and adopted exception messages; str() and str(s) preserve the adopted identity rules. repr covers None/bool/int/str and explicit user __repr__; type-level __str__/__repr__ callbacks and print sequencing run on the owned machine. Bytes and bytearray repr/str are adopted in both source profiles. Float/container/default-object displays, exception repr, format specifications and unadopted str/print keyword or encoding forms remain deferred. |
| indexed-user-objects | partial | __index__/__getitem__/__setitem__/__delitem__ through current type lookup and owned callbacks; raw scalar/tuple/slice keys, builtin sequence conversion, __len__ index results and bounded list/tuple RHS slice mutation. Other iterable RHS slice assignment and broader sequence APIs remain #116; slice display #127 and expanded buffer APIs #117. |
| iterated-user-objects | partial | Owned __iter__/__next__/__contains__, indexed fallback, iter/next signatures and iterator membership search in classes-source/1. Async protocols and broader iterable-consuming APIs remain separate; generators have their own finite adopted profile. |
| user-equality-hash | partial | Owned __eq__/__ne__/__hash__, NotImplemented, reflected priority, bounded container equality and user dictionary keys. Four rich ordering methods and bounded list/tuple/slice comparisons use the owned machine. Ordinary Python bound methods and finite native methods have stable receiver/operation hashes. Raw slice fields and callback-bearing tuple keys use owned sequential hashes. Structural dictionary mutation during comparison and range hashing remain #116; user-key set ordering/algebra remains #117. |
| further-object-protocols | partial | Owned binary/reflected/in-place arithmetic, unary slots, divmod and power; construction, super, finite metaclasses, instance attribute hooks and custom type checks. Four rich ordering methods and bounded list/tuple/slice comparisons preserve descriptor binding, raw results and callback-visible mutation. Ordinary Python bound methods and finite native methods have stable receiver/operation hashes. Raw slice fields and callback-bearing tuple keys use owned sequential hashes. Stable adopted object IDs, optimized function namespace snapshots and custom vars/dir hooks are implemented. Generator-expression snapshots and custom directory length hints and stable owned rich ordering are adopted. Inlined list/dict/set comprehensions expose enclosing optimized snapshots or isolated module/class comprehension namespaces, including nested targets and captured-cell order. Ordinary list/tuple/text repetition preserves shallow aliases, Unicode code points and owned index fallback after arithmetic candidates. Finite actual-metaclass attribute reads/mutations and native type defaults use owned descriptor binding, original fallback snapshots, metadata precedence and reflected native wrapper identities. Property/custom-descriptor-valued mutation and name-notification hooks bind and invoke through owned frames, preserving original failures and notification snapshots. O53 adds fresh default property directories and raw native directory binding without reading lazy names, accessor metadata or abstract flags. O54 adds actual-layout directories for the adopted native method/wrapper descriptors and bound callables, retaining recursive native binding, hook isolation and receiver chains. O65 adds callable, descriptor, property and mappingproxy type directories with canonical native binding, raw namespace order and ordinary advertised namespaces; callable/accessor metadata and per-instance keys remain separate. O66 adds generator and adopted native iterator type directories, preserving generator state, iterator positions, sentinel isolation and released buffer authority through canonical native binding and owned namespace merging. O89 completes matrix and in-place matrix dispatch, user-valued ternary power and Python 3.14 reflected ternary power with owned operands and optional binding semantics. O67–O94 complete live namespaces, native dictionaries/proxies, metadata/code/cells/frames/identity, all finite directory layouts, metaclass construction/slots, builtin storage/subtypes/reassignment and owned compile/eval/exec/granted imports. Remaining sequence, value, generator, context, exception, annotation, text, library and async APIs retain #116/#117/#120/#121/#124/#125/#127/#126/#34; raw backend/ABI/frame-debug interfaces remain excluded. |
| exceptions | partial | Adopted builtin exception classes, catch/raise/bare reraise, try/except/else/finally, active context and source tracebacks. Custom exception inheritance, explicit causes/suppression and exception groups/except* remain deferred. |
| imports | partial | Static absolute/relative imports from a finite granted source registry, packages, identity/cache, initialization order, cycles and failed-init retry. O94 adds dynamically selected granted names, the exact __import__ interface, captured import-callable lookup and package/fromlist callbacks. Registry-only imports retain the existing direct initialization-cycle boundary. Ambient filesystem/network/sys.path loaders, wildcard import statements and broader importlib hooks remain separate library/authority contracts. |
| generators-comprehensions | partial | Generator functions, yield/yield from, next/send/one-argument throw/close with owned suspended frames and shared budgets. Scoped list/dict/set/generator comprehensions with eager outer iterator acquisition. Generator-expression locals/vars snapshots and dir names expose .0, bound targets and captured cells. Inlined list/dict/set comprehensions expose enclosing optimized snapshots or isolated module/class comprehension namespaces, including nested targets and captured-cell order. Async generators, frame objects, multi-argument throw and comprehension assignment expressions remain separate stages. |
| context-patterns | deferred | with and synchronous context manager protocols; match/case patterns and guards. No admitted source execution. Async context managers are a separate async gate. |
| annotations-generics | deferred | Python 3.14 annotation timing, type parameters, type aliases and required generic aliases. Annotations and generic syntax are not adopted. Recognized type aliases receive UNSUPPORTED without execution support. |
| formatted-strings | deferred | f-strings and formatting grammar; t-strings, Template/Interpolation and string.templatelib APIs. Tokenizer rejects these literal forms. Server-side t-string use by a consumer does not establish browser interpreter support. |
| async-language | deferred | Native coroutine/await semantics, async iteration/generators/context managers and bounded scheduling/cancellation. Parked ownership, cooperative worker quanta/live output/cancellation and module-events/1 persistent callback queues are implemented. Native coroutine/await syntax, async protocols and awaited host capabilities remain deferred; host Promises are not Python coroutines. |
| dynamic-code-reflection | partial | Owned reflection and identity, live module/class/function/wrapper namespaces, function defaults/namespaces, verified code/cells, generator/source-frame metadata and optimized frame-local proxies in classes-source/1. O91–O93 add bounded compile, owned eval/exec, exact namespaces, closure-cell execution and shared total limits. O94 admits dynamic names within exact registry grants and captured import callables. AST/future/annotation/async modes, raw CPython/JavaScript executable interchange, frame tracing/jumping, ambient loaders and source grammar outside the admitted profile retain their explicit owners/boundaries. |
| selected-library-apis | partial | core-only/1 has no library modules; operator/1 includes exactly add, sub, mul, floordiv, mod, eq, lt, neg, not_, truth, getitem from own Python source. No whole-stdlib claim. json/math/random and licensed pure-Python colorsys API pilots require qualification. collections/itertools/functools/dataclasses/typing remain later API-selection decisions. |
| real-package-certification | deferred | A pinned package and exact entry-point use with source/resource/license closure, original/reduced differential execution and offline checks. No general package certification. Shimify reachability is not interpreter compatibility; spatial_ui/expose_api and compiler integrations retain consumer-specific contracts. |
| browser-capabilities | host-restricted | Offline browser worker with explicit source/assets/import grants; no ambient Python process/filesystem/network/device capabilities. Durable sessions/storage, event/view adapters and one bounded awaited host capability remain under INT-10. Device inference needs separate real-device evidence in APP-MODEL-01. |
| native-abi | host-restricted | Independent JavaScript values and VM, with a separately planned C/Rust-to-Wasm backend. No CPython C-extension ABI, native pointers, process/thread or arbitrary native module compatibility. A Wasm backend alone does not establish CPython ABI support. |
| later-python-versions | deferred | Reference oracle remains CPython 3.14.7; the live 3.14 documentation describes 3.14.9 at inventory adoption. A documentation or build-Python update does not upgrade language support. Semantic/Unicode deltas and profile decisions require explicit tested adoption. |

## Builtin API boundaries

| Builtin | Status | Current signature/value boundary | Missing forms |
| --- | --- | --- | --- |
| abs | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| aiter | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| all | partial | Exactly one positional adopted iterable; owned iteration and short-circuit truth callbacks in classes-source/1, primitive execution in core-source/1. | Unadopted iterable/value families, including generators, remain separately gated. |
| anext | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| any | partial | Exactly one positional adopted iterable; owned iteration and short-circuit truth callbacks in classes-source/1, primitive execution in core-source/1. | Unadopted iterable/value families, including generators, remain separately gated. |
| ascii | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| bin | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| bool | partial | bool() / bool(x) on admitted primitive/user values; classes truth protocols. | Other unadopted value families. |
| breakpoint | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| bytearray | partial | Finite binary construction, ASCII literals, indexing/slicing/iteration/membership, scalar bytearray writes, strict UTF-8/ASCII/Latin-1 conversion and binary repr/str. | Broader methods/codecs, non-strict errors, bytes user length hints and bytearray resizing remain deferred. |
| bytes | partial | Finite binary construction, ASCII literals, indexing/slicing/iteration/membership, scalar bytearray writes, strict UTF-8/ASCII/Latin-1 conversion and binary repr/str. | Broader methods/codecs, non-strict errors, bytes user length hints and bytearray resizing remain deferred. |
| callable | partial | callable(x), exactly one positional argument, classes-source/1. | Availability does not imply support for every Python callable kind. |
| chr | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| classmethod | partial | classmethod(callable), classes-source/1 and accessed-owner binding. | Unrestricted wrapper introspection. |
| compile | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| complex | partial | Owned immutable Cartesian values, literal/text/real/complex construction, real/imag keywords and attributes, finite basic arithmetic, equality/truth/hash and bounded integer powers. Owned conversion and index fallback callbacks run in ordinary VM frames under classes-source/1. | General powers, non-finite arithmetic/recovery families, numeric methods, formatting and builtin subclasses remain later boundaries. |
| delattr | partial | Positional reflection on adopted class attributes, descriptors and owned instance/metaclass hooks, including property/custom-descriptor-valued delete hooks. | Live namespaces, default directories, layout mutation and further metaclass protocols remain separate. |
| dict | partial | No-argument dict() in classes-source/1; dictionary literals and existing owned operations retain their separate contracts. | Populated dictionary construction and broader dictionary methods remain deferred. |
| dir | partial | Zero-argument optimized function and generator-expression names; actual-type/metaclass __dir__, owned iterable copying with custom length hints and stable rich less-than/truth ordering of adopted entries, preserving duplicates and identities. | Default directories, module/class namespaces and length hints for other iterable consumers remain separate. |
| divmod | partial | Positional-only primitive int/float quotient and remainder with owned tuple results and Python sign/zero rules. | General user arithmetic/reflected slots remain INT-OBJECT-01. |
| enumerate | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| eval | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| exec | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| filter | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| float | partial | Real primitive and Unicode text construction with exact signatures, base/underscore rules and bounded input/result work in both source profiles. Owned conversion and index fallback callbacks run in ordinary VM frames under classes-source/1. | Bytes (int/float), builtin subclasses, numeric methods and formatting remain later value/object stages. |
| format | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| frozenset | partial | Zero/one positional iterable construction, set displays, membership/equality/iteration, finite methods and primitive algebra; owned iterator/hash/equality callbacks in classes-source/1. | Broader methods, set-algebra callbacks, recursive user-key frozen hashing and comprehensions remain deferred. |
| getattr | partial | Positional reflection on adopted class attributes, descriptors and owned instance/metaclass hooks. | Live namespaces, default directories, layout mutation and further metaclass protocols remain separate. |
| globals | deferred | The builtin name resolves; module namespace invocation explicitly refuses pending its live namespace contract. | Availability alone earns no API support credit; optimized snapshots and custom hooks have separate implementation tasks. |
| hasattr | partial | Positional reflection on adopted class attributes, descriptors and owned instance/metaclass hooks. | Live namespaces, default directories, layout mutation and further metaclass protocols remain separate. |
| hash | partial | hash(value), positional-only in classes-source/1; numeric/string/primitive tuple hashes, user __hash__ and owned default identities. Ordinary Python bound methods and finite native methods have stable receiver/operation hashes. Raw slice fields and callback-bearing tuple keys use owned sequential hashes. | Property accessor and further reflective hash families remain deferred; exact string/object hash numbers are not a cross-process guarantee. |
| help | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| hex | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| id | supported | Positional id(value) for adopted arena objects, canonically interned integers and None/bool singletons in classes-source/1; stable across collection, cells, containers and persistent callbacks. | Canonical integer identity is adopted by O75; addresses and cross-session guarantees remain outside the contract. |
| input | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| int | partial | Real primitive and Unicode text construction with exact signatures, base/underscore rules and bounded input/result work in both source profiles. Owned conversion and index fallback callbacks run in ordinary VM frames under classes-source/1. | Bytes (int/float), builtin subclasses, numeric methods and formatting remain later value/object stages. |
| isinstance | partial | Adopted type relationships, canonical native identities, bool/int and exception ancestry, nested class-info tuples and advertised instance classes with short-circuit/error order in classes-source/1. Metaclass and ordinary checker hooks use owned descriptor/truth phases and native type defaults. | Unions and abstract __bases__ spoofing remain deferred; tuple nesting is bounded. |
| issubclass | partial | Adopted type relationships, canonical native identities, bool/int and exception ancestry, nested class-info tuples with short-circuit/error order in classes-source/1. Metaclass and ordinary checker hooks use owned descriptor/truth phases and native type defaults. | Unions and abstract __bases__ spoofing remain deferred; tuple nesting is bounded. |
| iter | partial | Primitive iter(value); classes-source adds user __iter__, indexed fallback and iter(callable, sentinel). | Generator/async protocols and broader sequence APIs remain separate. |
| len | partial | len(admitted containers/str or classes-profile __len__). | Unadopted value families and builtin subclasses remain deferred; user index results are validated through owned conversion. |
| list | partial | Zero or one positional adopted iterable; primitives in both profiles, owned user iteration in classes-source/1 without user length hints. Lists are fresh shallow containers. | User length hints, methods, builtin subclassing and broader reflection remain separate stages. |
| locals | partial | Fresh shallow snapshots of bound parameters, locals and free cells in optimized functions, lambdas and generators including inlined comprehension snapshots, plus generator-expression .0/target/free-cell namespaces; classes-source/1. | Live mappings, frame objects remain separate. |
| map | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| max | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| memoryview | partial | One-dimensional unsigned-byte views over owned bytes/bytearray, strided aliases, scalar writes, readonly/cached hashing, release, finite metadata and conversion methods. | Native buffers, other formats/dimensions/casts, slice mutation, context management and overflowing nested strides remain deferred. |
| min | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| next | partial | Primitive next(iterator); classes-source adds user __next__ and next(iterator, default). | Generator/async protocols and iterator reflection remain separate. |
| object | partial | Root object identity, no-argument construction and finite object.__new__/__init__ for ordinary user instances in classes-source/1. | Default displays, builtin instance allocation and broader reflection remain separately gated. |
| oct | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| open | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| ord | supported | One-character Unicode strings, including non-BMP code points and lone surrogate values; positional-only argument. One-byte bytes/bytearray arguments are also adopted. |  |
| pow | partial | Two-argument real/integer power, modular integer power/inverse, and complex integer powers from -100 to 100 with finite intermediates; named base/exp/mod keywords. | Remaining complex power/recovery families are INT-NUM-02; user arithmetic slots are INT-OBJECT-01. |
| print | partial | print(*values) with default space/newline; admitted scalar/exception displays and user __str__/__repr__ callbacks. | Keyword forms and unadopted value displays. |
| property | partial | Three accessor arguments, accessor decorators and bound/unbound native operations/copies in classes-source/1. None copy replacements retain the accessor. Property names and computed abstract flags use owned lookup and mutation contracts. | Documentation/dictionary reflection, documentation-sensitive getter copies and arbitrary doc behavior remain deferred. |
| range | partial | One to three positional integer/index arguments; bounded range values with attributes, truth, length, indexing, slicing, equality and iteration in both source profiles. Class index/equality callbacks use owned frames. | Range methods, hashing, repr and broader reflection remain separately gated. |
| repr | partial | repr(x), exactly one positional argument: None/bool/int/str or adopted user __repr__. Bytes/bytearray use finite binary representations. | Float/container/default-object and exception representations. |
| reversed | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| round | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| set | partial | Zero/one positional iterable construction, set displays, membership/equality/iteration, finite methods and primitive algebra; owned iterator/hash/equality callbacks in classes-source/1. | Broader methods, set-algebra callbacks, recursive user-key frozen hashing and comprehensions remain deferred. |
| setattr | partial | Positional reflection on adopted class attributes, descriptors and owned instance/metaclass hooks, including property/custom-descriptor-valued setter hooks. | Live namespaces, default directories, layout mutation and further metaclass protocols remain separate. |
| slice | partial | classes-source/1: slice(stop), slice(start,stop), slice(start,stop,step), positional only; immutable raw start/stop/step fields. | Raw-field equality, inequality and ordering use the owned machine; core constructor, slice.indices, repr, hash and broader descriptor APIs are deferred. |
| sorted | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| staticmethod | partial | staticmethod(value) and existing wrapper binding/direct-call rules; classes-source/1. | Unrestricted wrapper introspection. |
| str | partial | str() and str(x) for None/bool/int/str/adopted exceptions and user slots; existing/returned strings retain identity. Bytes/bytearray use finite binary representations. | Float/container/default-object displays, object= keyword and encoding forms. |
| sum | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| super | partial | Explicit bound/unbound and zero-argument super with lexical class cells, current C3 lookup, descriptors and proxy metadata in classes-source/1. | Builtin instance layouts, custom __class__ hooks and proxy reinitialization remain separate. |
| tuple | partial | Zero or one positional adopted iterable; primitives in both profiles, owned user iteration in classes-source/1 without user length hints. Existing tuple identity and shallow elements are preserved. | User length hints, methods, builtin subclassing and broader reflection remain separate stages. |
| type | partial | Canonical type identities for adopted values and three-argument type construction with tuple bases and a bounded string-key dictionary namespace; finite type.__new__/__init__/__call__, native type checking defaults, checking-callable identities, metaclass selection and owned metaclass attribute hooks/native type defaults. | Custom namespace mappings, callable factories, builtin instance subclasses and further metaclass special slots remain gated. |
| vars | partial | Zero-argument optimized function and generator-expression snapshots; one positional user instance reads __dict__ through owned descriptors and read hooks, returning its result unchanged. Ordinary instance and Python function dictionaries are live, with exact replacement/sharing identities and owned collision callbacks. | Module/class dictionaries and mapping proxies remain separate. |
| zip | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| __import__ | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |

## Ordered finite work packages

The canonical queue is GitHub Issues/Project 13. Dependencies express semantic
prerequisites; related work can use focused stacked PRs. The parent class #33 and
async #34 milestones remain open. Work order also considers general package use,
not only the game or first application. Each package below has a finite API/form
list and its own acceptance criteria. A large package can deliver smaller PRs;
unlisted behavior remains deferred until another explicit contract adopts it.

| Task | Order | Prerequisites | Required result |
| --- | --- | --- | --- |
| [INT-STR-01](https://github.com/outside-labs/pocket-python/issues/107) | 227 | INT-COMPAT-01 | Return an existing Python string unchanged from str(s), including closure-held and container-held aliases. Compare source behavior with CPython 3.14.7 in Node and Chromium; cover rooting, resource failure and zero teardown. Update the compatibility observation and asset locks. |
| [INT-REPR-01](https://github.com/outside-labs/pocket-python/issues/108) | 228 | INT-STR-01 | Specify type-slot lookup, descriptor binding, fallback precedence, actual-string return validation, print sequencing and nested output/error effects. Author executable CPython 3.14.7 cases and explicit deferred cases for default object displays, float/container formatting and format specifications. Reference-only success must not claim engine support. |
| [INT-REPR-02](https://github.com/outside-labs/pocket-python/issues/109) | 229 | INT-REPR-01 | Adopt __repr__/__str__ for user instances, repr(None/bool/int/str), str() and the existing scalar str forms; retain explicit refusals for unadopted value families. Use the owned operation machine, ordinary callback frames and exhaustive roots. Preserve print argument order and callback output, Python exceptions/source frames, stepping, cancellation, OOM and zero teardown. Pin Unicode printability for string repr; include its complete generator/data/license and asset closure. |
| [INT-REPR-03](https://github.com/outside-labs/pocket-python/issues/110) | 229.5 | INT-REPR-02 | Add newly entered formatting source after offline reload, binding/body/result failures, pending-hook Stop/Restart and profile-update acceptance. Update the compatibility inventory, source matrices, engine/asset locks, payload evidence and implementation plans. Keep the parent class milestone open for later protocols. |
| [INT-DIAG-01](https://github.com/outside-labs/pocket-python/issues/111) | 231 | INT-COMPAT-01 | Recognize assignment expressions and type aliases as valid but unadopted forms, with UNSUPPORTED diagnostics and source spans. Preserve SyntaxError for malformed source, no partial execution, all existing parser checks and a pinned source/refusal comparison for each form. |
| [INT-INDEX-01](https://github.com/outside-labs/pocket-python/issues/112) | 232 | INT-REPR-03 | Specify and implement __index__, __getitem__, __setitem__ and __delitem__ through type lookup and owned continuations, including slice operands. Test single evaluation, strict index results, mutation/alias effects, callback failures, resource interruption and teardown. Keep unadopted arithmetic slots refused. |
| [INT-ITER-01](https://github.com/outside-labs/pocket-python/issues/113) | 233 | INT-INDEX-01 | Adopt __iter__, __next__, __contains__, StopIteration, iter(x), next(it, default), iter(callable, sentinel), for loops and indexed iteration fallback in a finite reference matrix. Specify dispatch/fallback order and exception boundaries; verify paused loops, early exits, cancellation and roots. Async iteration is a separate milestone. |
| [INT-EQ-01](https://github.com/outside-labs/pocket-python/issues/114) | 234 | INT-ITER-01 | Adopt __eq__, __ne__, __hash__, NotImplemented and hash(), including subtype priority, hash disabling and dictionary invariants. Separate identity hashing from serialized values; verify mutation, recursive callbacks, failed comparisons and resource teardown. |
| [INT-NUM-01](https://github.com/outside-labs/pocket-python/issues/115) | 235 | INT-INDEX-01 | Specify int/float/complex constructors and complex arithmetic, integer true division, power and bitwise operators; abs, divmod, pow, round, bin, oct, hex, chr and ord with explicit supported signatures. Adopt each API only with overflow, rounding, mixed-value, invalid-input and Node/browser source evidence. Arbitrary integers must not silently pass through lossy JavaScript numbers. |
| [INT-NUM-02](https://github.com/outside-labs/pocket-python/issues/184) | 235.9 | INT-NUM-01 | Remaining numeric methods, general complex power and non-finite arithmetic/recovery; select and verify each finite family before adoption. |
| [INT-SEQ-01](https://github.com/outside-labs/pocket-python/issues/116) | 236 | INT-ITER-01, INT-EQ-01 | Inventory and adopt exact signatures for list, tuple, dict, range, slice, enumerate, zip, reversed, all, any, sum, min, max, sorted, map and filter. Add an explicit API table for string split/join/strip/replace/find, list append/extend/pop, tuple count/index and dict get/keys/values/items/update. Preserve aliasing, iteration order, callbacks and bounded work; anything outside that table remains deferred. |
| [INT-VALUES-01](https://github.com/outside-labs/pocket-python/issues/117) | 237 | INT-EQ-01, INT-NUM-01 | Specify set/frozenset and bytes/bytearray construction, literals and membership/index/slice behavior; explicitly scope memoryview to owned logical buffers. Keep native memory addresses, process buffers and arbitrary host object access outside the value contract. Cover hashing, Unicode encoding errors, alias mutation and quotas. |
| [INT-FUNC-01](https://github.com/outside-labs/pocket-python/issues/118) | 238 | INT-ITER-01 | Adopt definition-time computed/mutable defaults, global/nonlocal writes, *args/**kwargs parameters and starred calls. Preserve default identity, closure cells, single evaluation/order, duplicate keyword/binding errors and exception cleanup; record every supported signature with source cases. |
| [INT-SYNTAX-01](https://github.com/outside-labs/pocket-python/issues/119) | 239 | INT-FUNC-01, INT-DIAG-01 | Adopt assert, lambda, assignment expressions, tuple/list/starred assignment unpacking and starred collection displays. Specify binding/evaluation order, short circuit behavior and malformed-versus-unsupported diagnostics; test actual source rather than fixture-only bytecode. |
| [INT-10](https://github.com/outside-labs/pocket-python/issues/34) | 240 | See existing issue | Parked ownership/quanta; persistent callbacks/events; one awaited host capability; offline view/save application; native coroutine/async iterator/generator/context syntax through their own reference cases. |
| [INT-GEN-01](https://github.com/outside-labs/pocket-python/issues/120) | 241 | INT-ITER-01, INT-FUNC-01 | Specify generator construction, yield/yield from, send/throw/close and suspended ownership before admitting the syntax. Adopt list/dict/set/generator comprehensions with Python scope and evaluation order. Cover finally, exhaustion, exceptions and cancellation. Coordinate parked ownership with #34 without requiring the full async application milestone. |
| [INT-WITH-01](https://github.com/outside-labs/pocket-python/issues/121) | 242 | INT-INDEX-01, INT-ITER-01, INT-EQ-01 | Adopt with/__enter__/__exit__, multi-item and nested contexts with suppression/unwinding cases. Separately adopt literal/capture/sequence/mapping/class/OR patterns, guards and bindings. Async context managers remain under #34. |
| [INT-ERROR-01](https://github.com/outside-labs/pocket-python/issues/124) | 243 | INT-OBJECT-01 | Adopt exception subclasses, raise-from, cause/context/suppression metadata and bare reraises; preserve original source tracebacks. Adopt ExceptionGroup/BaseExceptionGroup and except* splitting/merging only after a reference matrix, including finally interactions and resource interruption. |
| [INT-OBJECT-01](https://github.com/outside-labs/pocket-python/issues/123) | 244 | INT-EQ-01, INT-FUNC-01 | Specify __new__, super, richer type/isinstance/issubclass, builtin subclassing and metaclass construction as separate reviewed protocol slices. Adopt getattr/setattr/delattr/hasattr, dir/vars/globals/locals/id and arithmetic/reflected/in-place slots only through explicit type/identity/mutation contracts. Separate dynamic exec/eval/compile/__import__ source admission from host grants. |
| [APP-MODEL-01](https://github.com/outside-labs/pocket-python/issues/100) | 245 | See existing issue | Separate mobile inference/animation feasibility prototype with explicit device/assets/budget selection. |
| [INT-ANNOT-01](https://github.com/outside-labs/pocket-python/issues/125) | 246 | INT-FUNC-01, INT-OBJECT-01 | Adopt annotated assignments/functions, lazy annotation evaluation, type parameters, type aliases and required generic-alias behavior against CPython 3.14.7. Specify namespace timing, errors and introspection; coordinate typing library APIs separately. Preserve deliberate version/profile decisions. |
| [INT-TEXT-01](https://github.com/outside-labs/pocket-python/issues/127) | 247 | INT-REPR-03, INT-SEQ-01, INT-ANNOT-01 | Adopt Python float and recursive container repr/str, object defaults, ascii, format/__format__, f-strings and explicit format-spec grammar with exact API cases. Adopt t-string Template/Interpolation values and string.templatelib APIs with interpolation evaluation/order/escaping cases. Link the spatial_ui browser pilot only after its actual syntax/API prerequisites pass. |
| [INT-LIB-01](https://github.com/outside-labs/pocket-python/issues/126) | 248 | INT-NUM-01, INT-SEQ-01, INT-SYNTAX-01 | Create separate API profiles for json loads/dumps (basic JSON values and error behavior), math sqrt/floor/ceil/isfinite and random.Random seeded random/randrange/choice; do not imply whole-module support. Evaluate licensed CPython colorsys rgb_to_hsv/hsv_to_rgb as a small pure-Python reuse pilot after its measured syntax/API prerequisites pass. Preserve source provenance/notices and run unreduced/reduced source independently. Record collections/itertools/functools/dataclasses/typing as later API-selection decisions, not certified packages. |
| [INT-PKG-01](https://github.com/outside-labs/pocket-python/issues/128) | 249 | INT-LIB-01 | Select one small package/use and a pinned source/license only after a prerequisite probe; record exact entry points, dependency/source/resource closure and omitted APIs. Execute the original and Shimify-reduced use on the independent engine in Node/Chromium, including offline behavior and complete notices. Keep spatial_ui, expose_api and Python-JavaScript integration claims separate until their consumer contracts pass. |
| [INT-VERSION-01](https://github.com/outside-labs/pocket-python/issues/122) | 251 | INT-COMPAT-01 | Compare current 3.14 maintenance documentation/changes with pinned CPython 3.14.7 and record relevant semantic deltas as executable cases. Keep the existing oracle/profile until an explicit tested decision. Later Python minor versions require their own syntax, behavior, Unicode and profile decisions; documentation availability alone never upgrades support. |
| [INT-WASM-01](https://github.com/outside-labs/pocket-python/issues/40) | 270 | See existing issue | Specify the later C/Rust-to-Wasm backend. No CPython ABI support is implied. |

## Libraries, packages and repository integration

Only core-only/1 and the selected operator/1 API profile are implemented.
INT-LIB-01 selects exact json/math/random APIs and evaluates a licensed colorsys
source pilot after its syntax/API dependencies pass. It does not mark those
modules implemented. Any reused code needs a pinned origin, license/notices,
complete closure, and independently executed unreduced/reduced source cases.
Source reduction in Shimify selects source; execution here establishes behavior.

INT-PKG-01 separately qualifies one bounded real package use. spatial_ui's
browser adapter, t-string requirements, expose_api's optional online service and
Python-JavaScript's compiler alternative keep their own consumer contracts.
Application/host integration is not evidence for unrelated language semantics.
Native C-extension ABI support is unimplemented and host-restricted; the planned
C/Rust-to-Wasm backend alone cannot establish it. Hosting, model downloads,
publication and new services retain their separate decisions and release gates.

References: [language](https://docs.python.org/3.14/reference/index.html),
[grammar](https://docs.python.org/3.14/reference/grammar.html),
[builtins](https://docs.python.org/3.14/builtins/functions.html),
[data model](https://docs.python.org/3.14/reference/datamodel.html) and
[template values](https://docs.python.org/3.14/library/string.templatelib.html).

The INT-INDEX-01 [finite contract](interpreter-indexing.md) is delivered through
focused contract, owned read/conversion, mutation/slice and offline-console steps
[#135–138](https://github.com/outside-labs/pocket-python/issues/135). Reference-only
results do not change the inventory support classifications.

The [method hashing contract](interpreter-object-hashing.md) adopts ordinary bound methods and finite native methods, including dictionary keys and unhashable receivers.

## Metaclass attribute checkpoint

The finite [O25/O26 contract](interpreter-metaclass-attributes.md) adds actual-metaclass
attribute read/mutation hooks, native type defaults, original AttributeError fallback
snapshots, metadata descriptor priority and native wrapper identities. Implicit
special lookup and real type checks retain their priority. Live namespace mappings,
default directories, layout mutation, namespace preparation and further protocols
remain separate; #123 and native async/host-adapter #34 remain open.

The finite [O31/O32 contract](interpreter-descriptor-binding.md) adds native
property getter/setter/deleter copies and explicit Python function binding.
None replacements retain the selected accessor; binding retains the original
function and target without running their callbacks. Native callable metadata,
receiver validation, parked ownership and lazy generators have pinned cases.
Live mappings, default directories, broader native
rebinding and builtin layouts remain separate follow-ups under #123/#33.

The finite [O35/O36 contract](interpreter-type-reflection.md) adds canonical
native descriptor `__objclass__` metadata, bound/unbound `type.mro()` and
read-only primary-base reflection. Returned C3 lists preserve actual types and
are independent of the stored hierarchy. Receiver validation, native callable
identity, metaclass reads and parked lifetimes have pinned source cases. Custom
metaclass MRO construction and hooked native method qualification retain explicit
refusals; live namespaces, default directories and broader layouts remain open.

The finite [O39/O40 contract](interpreter-abstract-flags.md) adds arbitrary owned
function abstract markers and computed read-only property/static/class method
flags. Accessors are inspected in order using optional lookup and truth
conversion, with lookup-only AttributeError suppression, live marker changes
and original callback frames. Its 108-case source matrix includes 104 adopted
comparisons and four explicit future refusals. Twelve representative probes
extend the inventory to 212 observations per target. Abstract class enforcement,
`abc`, arbitrary function dictionaries and broader metadata remain separate.

The finite [O41/O42 contract](interpreter-documentation.md) adds function/class
source docstrings, arbitrary owned function documents and live read-only bound
method reads. Properties perform eager optional getter lookup and retain exact
documents through mutation/deletion and origin-sensitive accessor copies.
Lookup-only AttributeError suppression, callback-visible name changes, native
copy forms and parked ownership have pinned observations. Source indentation
cleanup follows CPython 3.14.7. Native/wrapper documentation, live namespaces and
broader metadata remain separate.

The finite [O43/O44 contract](interpreter-function-metadata.md) adds exact mutable
Python function names, definition-time module snapshots and live read-only bound
method metadata. Owned callable lookup preserves custom read/descriptor/fallback
hooks and source errors, while direct native reads retain their bypass behavior.
Its 86-case matrix has 83 adopted comparisons and three explicit refusals; fourteen
representative probes extend this inventory to 242 observations per target.
Native/wrapper metadata, broader live namespaces and the
async/browser-adapter work under #34 retain their separate contracts.

[O45/O46](interpreter-function-dictionaries.md) add live function dictionaries,
replacement aliases, ordinary marker storage and owned bound-method attribute
fallback. Their 83-case matrix and 23 representative probes retain explicit
native-wrapper/structural-collision boundaries. Module/class
live mappings, default directories and async/browser adapters remain separate.

[O47/O48](interpreter-instance-dictionaries.md) add live ordinary instance
dictionaries, lazy materialization, exact replacement/sharing and deletion
aliases. Attribute reads/mutations retain dictionary and class-fallback snapshots,
explicit supplied names and owned collision callbacks. Read errors preserve
their original exceptions; native dictionary mutation converts KeyError to
AttributeError while data-descriptor callbacks bypass that conversion.
Module/class mappings, default directories, getset reflection and native
coroutine/await/browser host adapters remain separate contracts.

[O49](interpreter-class-namespaces.md) adds fresh live read-only keyed class
namespace views. Lookup, membership and get return stored own values without
descriptor binding, preserve metaclass priority and retain detached classes.
Enumeration, native layouts and callback-bearing query keys remain separate.

[O50](interpreter-function-directories.md) adds fresh default function
directories and raw native directory calls. Private dictionary copies preserve
key identities while native merging and sorting use owned callbacks. Listing
a native name does not adopt its metadata API; other default layouts remain open.

[O51](interpreter-method-directories.md) adds default bound Python method
directories, native directory binding and ordinary callable dictionary lookup.
Private copies preserve identities through native merge and sorting callbacks;
lookup-only AttributeError recovery preserves merge and sort failures. Native
builtin methods and other default layouts retain separate contracts.

[O52](interpreter-namespace-view-directories.md) adds native directory names
for adopted class namespace mappingproxy views, raw native ordering and bound
receiver metadata. Class contents and metaclass hooks do not contribute names.
Listing deferred mapping methods does not adopt enumeration, length or copy;
retained native callers keep detached live class views alive.

[O65](interpreter-callable-type-directories.md) adds callable, descriptor, property
and mappingproxy type directories. [O66](interpreter-iterator-type-directories.md)
adds generator and adopted native iterator type directories. Canonical native
binding, raw namespace order, fresh sorted results and ordinary advertised
namespaces preserve existing owned merging and sorting. Collection reads no
callable/accessor metadata and neither resumes generators nor advances iterators.
The combined 200-case matrix passes six Node/Chromium drivers. Listed names retain
their separate API boundaries; live mappings, custom metaclass and remaining
native type namespaces, module/wrapper/super directories and dynamic source remain
open.

The [O70 live mapping proxy contract](interpreter-class-mapping-proxies.md) completes namespace iteration, live views, owned callback lookups, copying, equality and unions across source and native class dictionaries.

[O75 integer identity](interpreter-integer-identity.md) adopts session-owned scalar identities and consistent `is`/`id` behavior, including collection and callback lifetimes. Equal integers may be interned; numeric addresses and CPython interning choices are not comparison targets.
