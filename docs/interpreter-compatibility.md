# Python compatibility inventory

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

## Evidence and interpretation

The 121 trusted probes include representative source programs and all 71 names
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
cases earn support credit. The current observations contain 72 supported, 45
deferred and four host-restricted results, with no recorded known divergence.
These are representative observations, not a percentage of Python coverage.

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
| numeric-operations | partial | Arbitrary integers, binary64 real and owned complex values; exact integer true division, bounded powers, bitwise/shifts and primitive helpers; real/complex construction and selected numeric/index callbacks. Both source profiles admit primitive APIs; callbacks require classes-source/1. General complex powers, non-finite complex arithmetic/intermediate recovery and numeric methods remain INT-NUM-02. Broader class arithmetic and formatting remain separate. |
| string-values | partial | Unicode code-point length, concatenation, comparison, membership, indexing and slicing, including negative step. Strict UTF-8/ASCII/Latin-1 encode/decode uses the value-family contract. Broader string methods, formatting, additional codecs and non-strict codec error policies remain deferred. |
| container-values | partial | List/tuple/dict literals, item access/mutation, scalar list deletion, primitive reads, list append/aliases/in-place operations and primitive-key dictionary equivalence/order; classes-source/1 also admits bounded list/tuple RHS slice assignment/deletion. Classes-source/1 also adopts user/default dictionary keys and owned list/tuple/dictionary equality. Finite list/tuple construction preserves primitive and owned iterable elements; user length hints remain refused. Set/frozenset construction, displays, owned membership/equality, finite mutation APIs and primitive algebra are adopted. Bytes/bytearray values adopt a finite binary-sequence/codec surface. Dictionary constructors, broader methods, structural dictionary comparison mutation and remaining value/hash families are deferred. |
| expression-order | supported | Admitted expression evaluation, chained comparisons, identity/membership, short circuit and/or, not and conditional expressions. This row covers admitted value/protocol families, not every Python expression. |
| ordinary-control | supported | if/elif/else, while/for over adopted values, loop else/break/continue, return and finally control transfer. Generator, context-manager, match and async control are separate rows. |
| function-binding | partial | def, recursion, positional-only/ordinary/keyword-only parameters; literal and definition-time computed/mutable defaults and lexical closures. Global/nonlocal writes and deletion share the defining module and lexical cells. Variadic positional/keyword parameters pack fresh owned values. Positional starred calls consume owned iterables. Keyword call expansion admits owned dictionaries and keys/getitem mappings with ordered duplicate checks. Construction-hint forms and annotations remain deferred; signatures and error-message comparisons are scoped by interpreter-function-binding.md. |
| ordinary-syntax-gaps | partial | Assertions and assignment expressions in both source profiles, with owned truth callbacks and lexical scope writes. Lambda functions use ordinary parameters/defaults and lexical cells. Tuple/list/starred assignments, loop targets, and starred sequence/dictionary displays use owned iteration/mapping phases. Construction hints remain with their sequence task; assertion message formatting and comprehensions retain separate gates. |
| class-construction | partial | Explicit classes-source/1 only: user classes, bounded C3 MRO, __init__, ordinary attributes/deletion and bound methods. Builtin subclassing, __new__, super, metaclasses, implicit __class__ cells and full reflective behavior are not adopted. Builtin list/tuple bases are explicitly refused with UNSUPPORTED. |
| private-names | supported | Lexical private-name mangling in admitted class bodies, nested code, parameters/imports and metadata. No additional syntax beyond the explicit source profile. |
| descriptors-decorators | partial | Functions, properties, static/class methods, custom get/set/delete/name-notification descriptors and decorators in classes-source/1. Descriptor-valued setter/deleter/name-notification hooks and unrestricted reflection remain refused. |
| call-length-truth | supported | Type-level __call__/__len__/__bool__, callable(), len(), bool(), not and control tests in classes-source/1, including adopted descriptor binding and optional truth fallback. Length uses the explicit signed-64-bit contract; later protocols remain separate. |
| repr-str | partial | print/str display None, bool, int, strings and adopted exception messages; str() and str(s) preserve the adopted identity rules. repr covers None/bool/int/str and explicit user __repr__; type-level __str__/__repr__ callbacks and print sequencing run on the owned machine. Bytes and bytearray repr/str are adopted in both source profiles. Float/container/default-object displays, exception repr, format specifications and unadopted str/print keyword or encoding forms remain deferred. |
| indexed-user-objects | partial | __index__/__getitem__/__setitem__/__delitem__ through current type lookup and owned callbacks; raw scalar/tuple/slice keys, builtin sequence conversion, __len__ index results and bounded list/tuple RHS slice mutation. Other iterable RHS slice assignment, slice repr/hash/indices, builtin subclasses and broader numeric/sequence APIs remain deferred. |
| iterated-user-objects | partial | Owned __iter__/__next__/__contains__, indexed fallback, iter/next signatures and iterator membership search in classes-source/1. Generators/async protocols, broader iterable-consuming APIs and ordering remain separate. |
| user-equality-hash | partial | Owned __eq__/__ne__/__hash__, NotImplemented, reflected priority, bounded container equality and user dictionary keys. Structural dictionary mutation during comparison, tuples containing user instances, bound-method/slice hashing and ordering remain separately gated. |
| further-object-protocols | deferred | Arithmetic/reflected/in-place slots, __new__, metaclasses, custom attribute hooks and builtin subclassing. Each slice requires an adopted reference and owned continuation contract. |
| exceptions | partial | Adopted builtin exception classes, catch/raise/bare reraise, try/except/else/finally, active context and source tracebacks. Custom exception inheritance, explicit causes/suppression and exception groups/except* remain deferred. |
| imports | partial | Static absolute/relative imports from a finite granted source registry, packages, identity/cache, initialization order, cycles and failed-init retry. No ambient filesystem/sys.path/PyPI loader, dynamic __import__ or import hooks. Missing grants raise IMPORT/ImportError; that is an authority boundary, not proof of a missing language API. |
| generators-comprehensions | partial | Owned generator functions, yield/yield from, next/send/throw/close and shared budgets. Comprehensions and async/reflection remain separate stages. |
| context-patterns | deferred | with and synchronous context manager protocols; match/case patterns and guards. No admitted source execution. Async context managers are a separate async gate. |
| annotations-generics | deferred | Python 3.14 annotation timing, type parameters, type aliases and required generic aliases. Annotations and generic syntax are not adopted. Recognized type aliases receive UNSUPPORTED without execution support. |
| formatted-strings | deferred | f-strings and formatting grammar; t-strings, Template/Interpolation and string.templatelib APIs. Tokenizer rejects these literal forms. Server-side t-string use by a consumer does not establish browser interpreter support. |
| async-language | deferred | Native coroutine/await semantics, async iteration/generators/context managers and bounded scheduling/cancellation. Owned instruction stepping is implemented, but multiple parked owners, persistent events and native coroutine syntax are not. Host Promises are not Python coroutines. |
| dynamic-code-reflection | deferred | compile/eval/exec, dynamic imports and broader globals/locals/type/attribute reflection. Source admission, namespace/identity and target authority need separate explicit contracts. |
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
| delattr | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| dict | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| dir | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| divmod | partial | Positional-only primitive int/float quotient and remainder with owned tuple results and Python sign/zero rules. | General user arithmetic/reflected slots remain INT-OBJECT-01. |
| enumerate | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| eval | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| exec | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| filter | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| float | partial | Real primitive and Unicode text construction with exact signatures, base/underscore rules and bounded input/result work in both source profiles. Owned conversion and index fallback callbacks run in ordinary VM frames under classes-source/1. | Bytes (int/float), builtin subclasses, numeric methods and formatting remain later value/object stages. |
| format | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| frozenset | partial | Zero/one positional iterable construction, set displays, membership/equality/iteration, finite methods and primitive algebra; owned iterator/hash/equality callbacks in classes-source/1. | Broader methods, set-algebra callbacks, recursive user-key frozen hashing and comprehensions remain deferred. |
| getattr | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| globals | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| hasattr | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| hash | partial | hash(value), positional-only in classes-source/1; numeric/string/primitive tuple hashes, user __hash__ and owned default identities. | Tuple-with-instance, bound-method and slice hash families remain deferred; exact string/object hash numbers are not a cross-process guarantee. |
| help | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| hex | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| id | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| input | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| int | partial | Real primitive and Unicode text construction with exact signatures, base/underscore rules and bounded input/result work in both source profiles. Owned conversion and index fallback callbacks run in ordinary VM frames under classes-source/1. | Bytes (int/float), builtin subclasses, numeric methods and formatting remain later value/object stages. |
| isinstance | partial | isinstance(x, str/adopted exception class/user class). | Tuple/union classinfo and unadopted builtin families. |
| issubclass | partial | issubclass(user_class, user_class/object). | Full builtin, tuple/union classinfo. |
| iter | partial | Primitive iter(value); classes-source adds user __iter__, indexed fallback and iter(callable, sentinel). | Generator/async protocols and broader sequence APIs remain separate. |
| len | partial | len(admitted containers/str or classes-profile __len__). | Unadopted value families and builtin subclasses remain deferred; user index results are validated through owned conversion. |
| list | partial | Zero or one positional adopted iterable; primitives in both profiles, owned user iteration in classes-source/1 without user length hints. Lists are fresh shallow containers. | User length hints, methods, builtin subclassing and broader reflection remain separate stages. |
| locals | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| map | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| max | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| memoryview | partial | One-dimensional unsigned-byte views over owned bytes/bytearray, strided aliases, scalar writes, readonly/cached hashing, release, finite metadata and conversion methods. | Native buffers, other formats/dimensions/casts, slice mutation, context management and overflowing nested strides remain deferred. |
| min | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| next | partial | Primitive next(iterator); classes-source adds user __next__ and next(iterator, default). | Generator/async protocols and iterator reflection remain separate. |
| object | partial | object() and root base in classes-source/1. | Default displays, identity hashing, __new__ and richer object APIs. |
| oct | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| open | host-restricted | Not installed; availability probe only, never invoked. | Interactive/process/filesystem behavior needs an explicit target capability contract. |
| ord | supported | One-character Unicode strings, including non-BMP code points and lone surrogate values; positional-only argument. One-byte bytes/bytearray arguments are also adopted. |  |
| pow | partial | Two-argument real/integer power, modular integer power/inverse, and complex integer powers from -100 to 100 with finite intermediates; named base/exp/mod keywords. | Remaining complex power/recovery families are INT-NUM-02; user arithmetic slots are INT-OBJECT-01. |
| print | partial | print(*values) with default space/newline; admitted scalar/exception displays and user __str__/__repr__ callbacks. | Keyword forms and unadopted value displays. |
| property | partial | property(fget=None,fset=None,fdel=None,doc=None) and accessor decorators; classes-source/1. | General property reflection and arbitrary doc behavior. |
| range | partial | One to three positional integer/index arguments; bounded range values with attributes, truth, length, indexing, slicing, equality and iteration in both source profiles. Class index/equality callbacks use owned frames. | Range methods, hashing, repr and broader reflection remain separately gated. |
| repr | partial | repr(x), exactly one positional argument: None/bool/int/str or adopted user __repr__. Bytes/bytearray use finite binary representations. | Float/container/default-object and exception representations. |
| reversed | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| round | supported | Primitive numeric signatures in both source profiles and owned type-level callbacks in classes-source/1; see interpreter-numeric.md for the finite contract. |  |
| set | partial | Zero/one positional iterable construction, set displays, membership/equality/iteration, finite methods and primitive algebra; owned iterator/hash/equality callbacks in classes-source/1. | Broader methods, set-algebra callbacks, recursive user-key frozen hashing and comprehensions remain deferred. |
| setattr | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| slice | partial | classes-source/1: slice(stop), slice(start,stop), slice(start,stop,step), positional only; immutable raw start/stop/step fields. | Core constructor, slice.indices, repr, equality/hash and other reflection are deferred. |
| sorted | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| staticmethod | partial | staticmethod(value) and existing wrapper binding/direct-call rules; classes-source/1. | Unrestricted wrapper introspection. |
| str | partial | str() and str(x) for None/bool/int/str/adopted exceptions and user slots; existing/returned strings retain identity. Bytes/bytearray use finite binary representations. | Float/container/default-object displays, object= keyword and encoding forms. |
| sum | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| super | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
| tuple | partial | Zero or one positional adopted iterable; primitives in both profiles, owned user iteration in classes-source/1 without user length hints. Existing tuple identity and shallow elements are preserved. | User length hints, methods, builtin subclassing and broader reflection remain separate stages. |
| type | partial | type(user_instance), one argument; classes-source/1. | Full one-argument and three-argument type construction. |
| vars | deferred | Not installed; resolving this builtin name raises Python NameError. | No implementation/API support credit from the negative availability probe. |
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
