# Verified modules and the small library profile

INT-07 combines a verified module registry with version 4 bytecode execution.
Node and browser workers use the same module/session implementation. Input is
verified bytecode; trusted CPython AST lowering builds fixtures only. The independent
[source front end](interpreter-source.md) now produces verified units from new
source in Node/browser workers. Published pocket-python 0.2.0 excludes the engine.

## Registry schema 1

`await verifyRegistry(manifest, assets)` takes an explicit manifest and a Map of
relative paths to Uint8Array bytes. It snapshots records and buffers before
asynchronous SHA-256 checks, verifies exact closure and bytecode, then returns a
VerifiedRegistry. Verification performs no filesystem/network access, dynamic
JavaScript imports or Python execution.

The manifest contains kind=`pocket-python-module-registry`, schema_version=1,
entry, roots and modules. Roots are distinct, non-overlapping relative paths.

| Module field | Contract |
| --- | --- |
| name | Bounded dotted ASCII module identity. |
| package | Boolean package namespace; every dotted module has declared package parents. |
| bytecode | Hashed descriptor for a verified version 3 or 4 unit. |
| source | Optional hashed UTF-8 provenance asset; never executed. |
| imports | Unique absolute identities granted to this module, all declared in the registry. |
| licenses | One or more hashed notices; identical notices may be shared. |

Descriptors contain path, size_bytes and lowercase SHA-256. Bytecode/source
paths lie inside declared roots; notices may use separate LICENSES paths.
Paths reject absolute/URL forms, empty/dot/parent components, backslashes and
percent encoding. Files cannot have conflicting roles/identities. Supplied
assets exactly equal the declared closure: missing, extra, tampered and
incorrectly sized files reject. There is no implicit host/package lookup.

Bytecode passes the function/value verifier before validated fields enter a
frozen serialized program snapshot. Sources are provenance, not proof that the
bytecode was compiled from them. The source front-end builder separately compiles its supplied source and
records the generated identity; raw registry provenance alone is not proof. Asset getters return defensive copies; records/programs keep stable frozen
identity within one registry. Sessions decode their own arena-owned values.

Bounds are 64 modules, 256 files, 16 roots and 16 MiB total asset bytes. Individual
bytecode/source/notice limits are 1 MiB, 256 KiB and 64 KiB. Empty source assets
are valid provenance for empty modules; bytecode/notices must be nonempty. A module has at most
64 import grants and 16 notices; version 3's function/value bounds also apply.

Registry methods are record(name), program(name), asset(path), parents(name),
resolve(importer, specifier, level) and close(), with entry/names/sizeBytes
properties. Relative level 1 uses the importing package; higher levels move
upward. Beyond-root requests fail. The absolute target must be explicitly
allowed. Parent namespaces grant no extra import authority. Closing releases
stored inputs and rejects subsequent access with STALE_REGISTRY.

## Session execution and identity

`new ModuleSession(registry, {memoryLimits})` owns an arena and one persistent
module cache. `run(options, onOutput)` initializes the registry entry with normal
import semantics; its __name__ is its registry identity. Package parents
initialize first. Repeated runs return the same frozen identity receipt without
reexecuting a ready module. The receipt contains no Python object graph.
`read(name)` serializes an entry export using the adopted value transport;
function/module encoding remains unavailable. close() releases all state.

Version 4 adds these instructions to the existing function/value format:

| Instruction | Behavior |
| --- | --- |
| import(specifier, level, root) | Static import through the owning module's grants; returns the target or, for an unaliased dotted import, its root package. |
| import-from(name) | Resolves an export or an explicitly granted declared child module. |
| module-get(name) | Reads a module namespace export or the adopted bound list.append; arbitrary object/host attributes are unsupported. |

Ordinary dotted imports request the root namespace; alias lowering then reads
each namespace component, preserving package bindings that shadow submodules.
From-import lowering requests the full module before resolving its exports.

Version 3 rejects these opcodes. Version 4 requires a branded execution context
with a verified registry and its own arena; raw units cannot supply host imports.
Functions use their defining module's globals, constants and default pool.
Lexical closures, recursive calls, reexports and builtin identities retain their
meaning across module boundaries.

A cache entry moves from initializing to ready. Ready imports share one Python
module object. Successful child initialization publishes it on its package.
Failure removes that module's entry, releases transient frames and permits a
later retry; already successful dependencies remain cached. Original exception
objects, context and source tracebacks propagate through imports and finally.
Private temporary root leases preserve exceptions during nested loader cleanup.

The first cycle policy rejects any requested target already initializing with
an explicit ImportError. Parent-namespace traversal can pass an initializing
package while loading a different child. Partial-module cyclic access, including
`from . import child` requesting the initializing package itself, is outside this
profile; a package can use `from .child import name` without requesting itself.
Registry graphs may declare cycles, but they do not imply executable cyclic
initialization. Dynamic __import__, star imports, import hooks, namespace-package
search, arbitrary pip installation and CPython native extensions are unavailable.

## Builtin and library profile

The named core-modules/1 profile extends the existing print/str/len fixture
subset with isinstance(value, str) and checks against adopted exception classes.
Other class specifications remain UNSUPPORTED. Missing exports/attributes and
import failures use adopted ImportError, ModuleNotFoundError and AttributeError
classes with source locations. Virtual __name__, __package__ and __file__ values
come from registry records; no host filesystem is exposed. Import diagnostics
can omit host-specific path text.

runtime/library/operator.py is our small Python operator profile: add, sub, mul,
floordiv, mod, eq, lt, neg, not_, truth and getitem. It executes through the same
VM as application code. Applications explicitly include its source/bytecode,
hashes, MIT notice and import grants like any other module. It has no privileged
loader path or implicit availability. Other standard-library names require a
separately adopted, supplied implementation; browser/native host adapters remain
separate capabilities. Python wrapper frames remain visible in its tracebacks.

## Ownership, limits and teardown

The session owns its cache root lease and a declared host allocation for the
registry's raw asset bytes. Module values own namespaces/code pools; functions
own their defining graphs. Cache, module and closure cycles use iterative arena
accounting. This is logical accounting, not whole-process RSS or host GC timing.

Instruction, value/collection work, cancellation and output budgets span every
module initialization in one run. Python calls use iterative frames; module
initialization uses bounded synchronous loader reentry, at most 16 levels,
subject to arena scope limits. Output is limited to 65,536 UTF-16 units across
all modules. Hard resource/unsupported failures bypass Python except/finally and
release every transient scope; cached successful dependencies can survive a
failed entry until close. Host callback reentry or teardown during a run rejects.

## Verification

```sh
node --test runtime/module-registry.test.mjs runtime/modules.test.mjs
python runtime/check_conformance.py --engine vm4 --report build/modules-node-report.json
python runtime/check_conformance.py --engine vm4 --target browser --report build/modules-browser-report.json
```

The module corpus compares stdout, adopted errors/context and original source
frame/line order with isolated CPython imports. Separate policy/resource cases
require explicit cycle/grant/host/attribute failures, shared budgets and teardown.
Reports retain every module's source/bytecode/notice identity, tool/input digests,
host/reference versions and source_execution=false. The operator cases compare
its supported API values with CPython's operators.

The same shared text-metrics source used by Shimify, the application compiler and
assembled PWA runs here as a verified module: 581 canonical UTF-8 bytes,
SHA-256 cd0fc16e047b4c81230a1272446b0257ef741f937b1ea0857d2a94bb3d0bb350.
The computation is unchanged, including Unicode, whitespace and None errors.
Node 24.19.0 and Chromium 156.0.8078.4 passed all 26 module cases against CPython
3.14.7. Native tests additionally cover retained cache identity, independent
arenas, retries, cancellation, initialization depth, combined output limits,
callback failures and closed sessions. CI retains both target reports.

The `core-source/1` integration adds pinned Unicode 16 identifier operands,
compiler-private local slots, version-4 in-place arithmetic and receiver-owned
list.append. bool(0/1 arguments), iter(1) and next(1) join the named module builtin
set. Version 3 retains its ASCII operands and rejects the new in-place opcodes.
See the source profile for exact extension/repetition and unsupported call forms.
