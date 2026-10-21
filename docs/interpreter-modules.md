# Verified module registry

The first INT-07 change establishes the registry and asset-verification boundary
for module execution. It does not yet execute imports, initialize Python modules
or provide a standard-library profile. Those remain the next INT-07 change;
the issue stays open until their differential and resource cases pass.

`await verifyRegistry(manifest, assets)` accepts an explicit manifest and a Map
of relative paths to Uint8Array bytes. It snapshots caller-owned records and
buffers before asynchronous SHA-256 checks, verifies exact file closure,
validates bytecode and returns a VerifiedRegistry. Verification performs no
filesystem/network access, dynamic JavaScript imports or Python execution.
The package CLI and published 0.1.0 artifacts are unchanged.

## Registry schema 1

The manifest contains kind=`pocket-python-module-registry`, schema_version=1,
entry, roots and modules. Roots are distinct, non-overlapping relative paths.
Each module has these fields:

| Field | Contract |
| --- | --- |
| name | Bounded dotted ASCII module identity. |
| package | Boolean indicating a package namespace. Every dotted module has declared package parents. |
| bytecode | Hashed asset descriptor for a verified version 3 unit. |
| source | Optional hashed UTF-8 provenance asset; never executed. |
| imports | Unique absolute module identities granted to this module, all present in the registry. |
| licenses | One or more hashed notice descriptors; identical notices may be shared. |

Every descriptor contains path, size_bytes and lowercase SHA-256. Bytecode and
source paths lie inside declared roots. Notices can use separate LICENSES paths.
Paths reject absolute/URL forms, empty/dot/parent components, backslashes and
percent encoding. One file cannot have conflicting roles or identities.
Supplied assets must exactly equal the declared closure; missing, extra,
tampered and incorrectly sized files reject. There is no implicit lookup on
the host or support for undeclared packages/native extensions.

Bytecode JSON passes the version 3 structural/value verifier, then only validated
fields enter the frozen program snapshot. Optional source bytes are provenance,
not proof that the bytecode was compiled from that source. Independent source
compilation and corresponding receipts remain later work. Notice bytes retain
their original identity and are returned only as defensive copies.

The bounds are 64 modules, 256 files, 16 roots and 16 MiB of total supplied bytes.
Individual bytecode/source/notice limits are 1 MiB, 256 KiB and 64 KiB; per-module
imports are bounded by the module limit and notice lists by 16 entries. Version
3's function/value bounds also apply. These are bounded host registry inputs;
the later execution integration must account for active module state in the VM.

## Lookup, identity and relative resolution

The registry exposes entry, names, sizeBytes, record(name), program(name),
asset(path), parents(name) and resolve(importer, specifier, level). Records and
programs keep stable frozen identity within one registry; returned asset bytes
are copies. Program snapshots contain serialized constants, allowing future
sessions to decode independent values without sharing arena-owned objects.

Absolute imports use level 0. Relative imports resolve from the importing
package, with level 1 using the current package and higher levels moving upward.
Requests beyond the package root fail. The resolved absolute target must appear
in that importer's explicit grants. Parent namespaces are listed separately for
ordered initialization; listing parents grants no extra import authority.

Preflight failures use REGISTRY (or BYTECODE for invalid units). Undeclared and
invalid import requests use IMPORT with an ImportError/ModuleNotFoundError
diagnostic. No request triggers fallback. close() releases stored assets and
programs and makes every later lookup fail with STALE_REGISTRY.

## Next execution step

INT-07 still requires per-session module objects, cache identity, parent-before-
child initialization, relative import execution and failure cleanup, with cycle
support or explicit rejection. Registry dependency graphs can currently contain
cycles as declarations; they do not imply successful cyclic initialization.
The execution change will define a small named builtin/library profile needed
by shared fixtures and keep it separate from browser/native host capabilities.

Run `node --test runtime/module-registry.test.mjs`. Seven tests cover closed
asset/notice identities, absolute/relative grants, package parents, snapshots
across asynchronous hashes (including Buffer copies), malformed/tampered inputs,
bounded bytecode/source validation and closed-registry access. Import behavior
will receive CPython differential and real browser-worker checks with execution.
