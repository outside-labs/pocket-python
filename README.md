# Pocket-python

Pocket-python builds offline browser applications from explicit verified client
sources. The compiled profile runs emitted JavaScript and selected helpers in a
module worker. The supplied MicroPython profile runs compatible Python through
WebAssembly. Both use local assets and a service worker for cached reloads.

Requires Python 3.14+ to build artifacts and compatibility with the selected
compiler/runtime profile. The tool has zero runtime dependencies and uses the
MIT license. Version 0.2.0 is experimental.

```sh
python -m pip install pocket-python==0.2.0 shimify==0.3.0
pocket-python --help
```

## Build a compiled application

Install the optional compiler explicitly when using this profile:

```sh
python -m pip install Python-JavaScript==0.2.0
pocket-python compiled-web CLIENT-SOURCES.json --output build/compiled-web
```

The [compiled application guide](docs/compiled-applications.md) defines the hashed
client-source allowlist, named text-input UI, source-map policy, exact compiler
identity and offline update lifecycle. Compiler installation is build tooling;
the CLI never installs it automatically. Generated applications contain no Python
interpreter and parse no new source after deployment.

See [0.2.0 release notes](docs/release-0.2.0.md) for the published scope.

## Build a supplied MicroPython application

First create a portable source bundle with
[Shimify](https://github.com/outside-labs/shimify). Supply a MicroPython
WebAssembly distribution containing `micropython.mjs`, `micropython.wasm` and
its license text; use the official
[WebAssembly port](https://github.com/micropython/micropython/tree/master/ports/webassembly)
or the official npm package described in
[PyScript’s offline guide](https://docs.pyscript.net/2026.7.3/user-guide/offline/).

```sh
shimify modules path/to/app.py --output build/source
pocket-python inspect build/source
pocket-python lock-runtime path/to/runtime --runtime-version VERSION \
  --source-url https://example.org/upstream-runtime-release \
  --file micropython.mjs --file micropython.wasm --license-file LICENSE \
  --output build/runtime-lock.json
pocket-python web build/source --runtime path/to/runtime \
  --runtime-lock build/runtime-lock.json --output build/web --title "My Python App"
python -m http.server 8000 --bind 127.0.0.1 --directory build/web
```

Replace VERSION and the source URL with the identity of the supplied upstream
release. Open `http://localhost:8000`, let the app finish installing its cache,
and wait for **Offline ready on this device** before disconnecting. Run starts
a fresh worker; Stop terminates it, including an infinite computation. Python
output is rendered as text. Deploy the generated directory to a static HTTPS
server; relative URLs support deployment under a subdirectory. `file://`
execution is unsupported.

`web` writes to a new directory outside input roots. It preserves only recorded
source/runtime files and notices and adds `POCKET-PYTHON.json` with hashes,
runtime identity and separate source/runtime/total byte counts. Generation
does not run application code. The published tool contains no interpreter
binary and does not download one automatically.

## Reproduce the pinned example

In a checkout, the build-only helper downloads and checks the official
MicroPython `1.29.0-6` fixture and upstream license. The committed input is a
real Shimify 0.2 bundle with a local helper import:

```sh
uv sync --locked
uv run python scripts/prepare_runtime.py
uv run pocket-python inspect tests/fixtures/hello
uv run pocket-python web tests/fixtures/hello --runtime build/runtime \
  --runtime-lock build/runtime/runtime-lock.json --output build/demo
python -m http.server 8000 --bind 127.0.0.1 --directory build/demo
```

The demonstrated PWA totals 578,168 uncompressed bytes, including 563,092 bytes
of runtime assets/license and 102 bytes of application source. These measurements
describe the tested fixture; source reduction, compressed transfer size, startup
time and memory are separate quantities.

## Development and verification

```sh
uv sync --locked --group browser-tests --group compiled-build
UV_PYTHON=3.14.7 uv run --no-sync python scripts/run_tests.py focused --feature native-descriptors
uv run --no-sync python scripts/run_tests.py python
```

On PowerShell set `$env:UV_PYTHON = "3.14.7"` for interpreter differential checks.
The `python` suite supplies the real-WASM fixture path automatically.
Playwright is a pinned build-only group; it is not a package runtime dependency.
See [validation suites](docs/testing.md) for the shared local/CI runner and focused
feature checks.

PRs run parallel Node/Chromium regression coverage and Linux/macOS/Windows
packaging checks. Main pushes run a short installed-wheel and interpreter-startup
smoke. Exhaustive validation, including measurements and standalone reference
runs, runs nightly, on manual dispatch and for release tags/publication validation.

## Compatibility and roadmap

MicroPython provides a subset of Python and its standard library. Test every
application against the actual selected runtime: a valid Shimify CPython source
bundle does not establish browser compatibility. Native extensions, OS process
APIs, resources and dynamic imports need explicit adapters or a different
runtime profile. The initial console has no interactive stdin or DOM bridge.
Browser cache persistence and PWA installation affordances vary by platform.

Version 0.2.0 delivers compiled JavaScript applications and supplied MicroPython
WebAssembly applications. The separately staged [independent interpreter](IMPLEMENTATION_PLAN_INTERPRETER.md)
now parses newly supplied Python in Node and browser workers. Its prototype remains in the
repository and is excluded from this PyPI release. Shimify owns source reduction,
Python-JavaScript owns compilation, and pocket-python owns assembly and the
interpreter queue. Native CPython assembly/trimming, an upstream CPython WebAssembly build, Pyodide and
PyScript remain optional profiles with separate compatibility/test gates.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md),
[release notes](docs/release-0.2.0.md), and the
[GitHub Project](https://github.com/orgs/outside-labs/projects/13).
Runtime and dependency licenses remain applicable; preserve and review their
upstream notices before distributing generated applications.

The development [independent VM value model](docs/interpreter-values.md) executes
our own versioned bytecode in Node and browser workers. It covers staged Python
scalars, containers and iteration; the [source front end](docs/interpreter-source.md) now handles new source in
Node/browser workers. The development [source console](docs/interpreter-console.md)
adds a local editor, explicit independent-engine assembly and verified offline
source execution, stop/restart and scoped updates in Chromium. Runtime assets
remain excluded from the 0.2.0 distributions.

The explicit [class-source profile](docs/interpreter-classes.md) adds class bodies,
C3 inheritance, attributes, initialization, bound methods, [private names](docs/interpreter-private-names.md),
adopted [descriptors, properties and decorators](docs/interpreter-descriptors.md),
and [callable objects plus length/truth protocols](docs/interpreter-special-methods.md),
with [bounded repr/str formatting](docs/interpreter-formatting.md) and
[integer conversion and item/slice protocols](docs/interpreter-indexing.md) plus
[iteration and containment](docs/interpreter-iteration.md) and
[equality and hashing](docs/interpreter-equality.md),
[numeric construction, operators and conversion hooks](docs/interpreter-numeric.md),
[bounded range, list/tuple construction and all/any](docs/interpreter-sequences.md), Node/Chromium
and offline-console checks. Build its example with
`uv run python -m examples.interpreter_classes`. The default core-source/1 profile
remains available; further special protocols and async follow separate stages.

Both profiles support [expanded function binding](docs/interpreter-function-binding.md):
computed/mutable defaults, global/nonlocal state, variadic parameters and owned
starred calls. Run `uv run python -m examples.interpreter_functions` for a class
mapping example, or add `--core` for dictionary forwarding without class syntax.
The [ordinary syntax profile](docs/interpreter-ordinary-syntax.md) adds assertions,
assignment expressions, lambda functions, unpacking targets and starred sequence/
dictionary displays. Try `uv run python -m examples.interpreter_syntax`, with
`--core` available for ordinary row values.

The [value-family profile](docs/interpreter-value-families.md) adds sets/frozensets,
bytes/bytearrays, strict UTF-8/ASCII/Latin-1 codecs and one-dimensional logical
memoryviews. Run `uv run python -m examples.interpreter_values`, or add `--core`
for primitive keys. Broader set methods, bytearray resizing, buffer casts and
native buffers retain explicit future boundaries.

The [generator profile](docs/interpreter-generators.md) adds owned suspended
functions, yield-from delegation, next/send/throw/close and scoped list/dict/set/
generator comprehensions in both profiles. [Object protocols](docs/interpreter-object-protocols.md)
add attribute reflection and forward/reflected/in-place arithmetic in the class
profile. Run `python -m examples.interpreter_generators`, adding `--core` for
generators without classes. The finite [construction profile](docs/interpreter-construction.md)
adds owned __new__/__init__, super and lexical __class__ cells, type relations
and type-derived metaclasses with ordinary dictionary namespaces. Run
`python -m examples.interpreter_construction` for a console composing these
protocols with suspended generators. The
[instance attribute profile](docs/interpreter-attribute-hooks.md) adds owned
__getattribute__/__getattr__, write/delete hooks, native object defaults and
advertised class checks. Run `python -m examples.interpreter_attributes` for a
console composing hooks, reflection and generators. The finite
[type-checking profile](docs/interpreter-type-checks.md) adds owned metaclass
and ordinary checker `__instancecheck__`/`__subclasscheck__`, descriptor binding,
truth conversion and native type defaults. Run
`python -m examples.interpreter_type_checks` for a composed console. Builtin
instance layouts,
custom namespace preparation, broader reflection and async retain separate
contracts.

The finite [type-reflection profile](docs/interpreter-type-reflection.md) adds
native descriptor declaring types, fresh C3 hierarchy lists and primary-base
attributes. Run `python -m examples.interpreter_type_reflection` for a console
composing hierarchy inspection, detached native methods and lazy iteration.
Custom MRO construction, default directories and live namespace mappings remain
separate contracts.

The finite [abstract-flag profile](docs/interpreter-abstract-flags.md) adds owned
function markers and computed property/static/class method flags, including
optional lookup, truth callbacks and read-only descriptor metadata. The
[descriptor-flags console](examples/interpreter_abstract_flags.py) composes
live marker changes, accessor copies and lazy iteration.

The finite [property-name profile](docs/interpreter-property-names.md) adds
mutable property names, lazy getter-name lookup and native name notification.
Run `python -m examples.interpreter_property_names` for a console composing
accessor copies, detached native methods and generators.

The finite [ordering profile](docs/interpreter-ordering.md) adds rich ordering
methods and bounded list/tuple/slice comparisons, including reflected priority,
raw results and callback-visible mutation. Run
`python -m examples.interpreter_ordering` for an ordered-note console composing
comparison, slice insertion and suspended iteration.

The [reflection profile](docs/interpreter-reflection.md) adds stable object
identities, shallow function and generator-expression namespace snapshots,
and custom dictionary/directory hooks. [Directory copying](docs/interpreter-directory-scopes.md)
adopts length hints and stable ordering through Python comparison callbacks.
Run `python -m examples.interpreter_reflection` for a console combining those
protocols. Finite default [function](docs/interpreter-function-directories.md),
[bound method](docs/interpreter-method-directories.md) and
[class namespace view](docs/interpreter-namespace-view-directories.md)
directories preserve native names and owned receiver lifetimes. Function and
method lists include the callable's live dictionary keys.
Run `python -m examples.interpreter_method_directories` or
`python -m examples.interpreter_namespace_view_directories` for composed examples.

The [numeric type directory contract](docs/interpreter-numeric-type-directories.md)
adds sorted and raw native directories for bool/int/float/complex and the types of
None/NotImplemented, preserving canonical native binding and ordinary advertised
type namespaces. Run `python -m examples.interpreter_numeric_type_directories`
for the composed console. Listed names retain their separate read/API boundaries.

The [container type directory contract](docs/interpreter-container-type-directories.md)
adds the native sequence/container/buffer type namespaces, preserving contents,
iterator positions, aliases and released-view data restrictions. Run
`python -m examples.interpreter_container_type_directories` for the composed console.
Broader live namespace mappings and other default directories retain separate
contracts.

[Comprehension reflection](docs/interpreter-comprehension-reflection.md) exposes
fresh enclosing function snapshots inside list/dict/set comprehensions, and
isolated snapshots for module/class comprehensions. Nested targets, captured
cells and escaped values retain Python namespace order and owned lifetimes.

[Sequence repetition](docs/interpreter-repetition.md) adopts shallow list/tuple
copies and Unicode text multiplication, including owned index callbacks after
arithmetic fallback. Run `python -m examples.interpreter_repetition` for a console
combining aliases, callback-visible mutation and generators.

[Subclass initialization](docs/interpreter-subclass-initialization.md) adds
inherited registration hooks after descriptor notifications and cooperative
class keywords through type/metaclass construction. Run
`python -m examples.interpreter_subclass_initialization` for a class registration
console combining these protocols with suspended iteration.

[Nested descriptor hooks](docs/interpreter-nested-descriptors.md) bind
property/custom-descriptor-valued setters, deleters and name notifications
through ordinary owned execution. Run
`python -m examples.interpreter_nested_descriptors` for a field validation console
combining these hooks with native mutation defaults and generators.

[Native descriptor operations](docs/interpreter-native-descriptors.md) expose
explicit property get/set/delete and static/class method binding with retained
receiver identities. Run `python -m examples.interpreter_native_descriptors`
for a console combining validated fields, alternate construction and explicit
method owners.

The finite [documentation profile](docs/interpreter-documentation.md) adds
function/class docstrings, owned function documentation and eager property
documentation with callback-aware accessor copies. Run
`python -m examples.interpreter_documentation` for a console combining exact
documents, native copies, property notification names and lazy generators.
Native/wrapper documentation, live namespaces and broader layouts retain their
own contracts.

The finite [function identity metadata profile](docs/interpreter-function-metadata.md)
adds exact mutable function names, definition-time module snapshots and live
read-only bound-method metadata. Run `python -m examples.interpreter_function_metadata`
to combine retained methods, property names, custom metadata lookup and lazy
generators in the offline console.

The [continuing interpreter roadmap](docs/interpreter-roadmap.md) targets broad
Python 3.14+ compatibility through finite supported profiles. Execution ownership
is consolidated; the [coverage inventory](docs/interpreter-compatibility.md)
records current language/builtin boundaries and ordered follow-up tasks.
Persistent applications and mobile inference feasibility have separate tracks.

The development [library profiles](docs/interpreter-profiles.md) select core-only/1
or the supplied operator/1 Python library without changing the complete engine.
The [measured baseline](docs/interpreter-measurements.md) records verified payload,
compression, cold/warm startup and separately scoped memory observations for
source, compiled and supplied MicroPython artifacts over a common computation.

Development sessions now have [explicit roots, allocation limits and owned host handles](docs/interpreter-memory.md), with shared Node/browser lifetime checks. New source uses the independent source front end.

The [compiled JavaScript PWA builder](docs/compiled-applications.md) now packages verified client modules and original helpers for browser-worker execution, offline reload and scoped updates. Build the text-metrics example with the optional pinned compiled-build tooling; the builder is included in 0.2.0.

The development [shared server/browser example](docs/shared-application.md) runs
the same supported computation under CPython and in a compiled browser worker,
with explicit network reference calls and offline failure checks.

Development [version 3 functions and exception unwinding](docs/interpreter-functions.md)
add argument binding, lexical closures, recursion and source-located handlers.
The same bytecode runs in Node and browser workers; source parsing remains INT-08.

Development [version 4 verified modules](docs/interpreter-modules.md) add explicit
imports, session cache identity, relative packages and a supplied small library
profile. The original text-metrics computation runs through this independent VM;
newly entered source uses the independent source front end.

[Live function dictionaries](docs/interpreter-function-dictionaries.md) expose
custom decorator state through functions and retained bound methods, with live
replacement aliases and owned collision callbacks. Run
`python -m examples.interpreter_function_dictionaries` for the decorator console.

The finite [generator directory profile](docs/interpreter-generator-directories.md) adds state-independent names and retained native directory callers. Run `python -m examples.interpreter_generator_directories` for a composed console. Listed generator metadata retains its separate read contract.

The finite [native iterator directory profile](docs/interpreter-iterator-directories.md) covers the adopted container, indexed and callable-sentinel iterator layouts. Directory collection preserves iteration state, source/sentinel ownership and native caller identities. Run `python -m examples.interpreter_iterator_directories` for the composed console.

The finite [numeric and singleton directory profile](docs/interpreter-numeric-directories.md) covers None, NotImplemented, bool, int, float and complex values. Run `python -m examples.interpreter_numeric_directories` for a composed console. Native method names and integer identity retain their existing separate boundaries.

The finite [range and slice directory profile](docs/interpreter-sequence-directories.md) preserves large-range iteration state and arbitrary cyclic slice fields without invoking their protocols. Run `python -m examples.interpreter_sequence_directories` for the composed console. Listed native methods retain their separate API contracts.
