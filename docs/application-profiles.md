# Application profile contract

Adopted for PROFILE-01. The released schema-1 MicroPython runtime lock and
source-bundle commands remain unchanged. This document defines future profile
implementation. WEB-03 now implements the compiled schema-2 output through
[compiled-web and its verified client-source input](compiled-applications.md);
the development `interpreter-web` command now assembles the
[source console](interpreter-console.md) with its explicitly supplied independent
engine. Its Chromium acceptance suite verifies actual new source after offline
reload, scoped updates and stop/restart under INT-WEB-01.

## Identity and compatibility

An application selects exactly one profile and version. No automatic fallback
changes its language semantics, host APIs or execution location.

| Profile | Executed input | Required engine/assets |
| --- | --- | --- |
| `micropython` / 1 | Verified Python source supported by the selected runtime | Explicit existing schema-1 MicroPython JS/WASM lock. |
| `compiled-javascript` / 1 | Compiler-produced ES module entrypoint | Verified emitted modules and required compatibility helpers; no Python interpreter. |
| `in-house-interpreter` / 1 | Verified initial Python source and newly entered source in the console | Our identified engine, independent parser/compiler/VM and output-only host bridge. |

Profile version identifies the integration contract, independently of engine,
compiler, package and bytecode versions. A profile declares its supported
language/host features; matching syntax or an import name does not establish
compatibility. CPython bytecode is not our interpreter's bytecode.

The existing lock identifies runtime assets, not an entire compiled application.
Keep its reader and semantics intact. New application manifests use
`kind = "pocket-python-application"`, `schema_version = 2`; unknown kinds,
versions, profiles and bytecode versions are rejected. Existing commands must
not reinterpret schema 1 as this schema.

## Manifest fields

| Field | Contract |
| --- | --- |
| `kind`, `schema_version` | Exact application format identity above. |
| `profile`, `profile_version` | One profile from the table and supported integration version. |
| `target` | `client` for browser assembly. A server build is a separate input and entrypoint. |
| `producer` | Tool name/version and language/target profile identities. |
| `entrypoint` | Recorded relative file path and kind: `es-module`, `python-source` or `bytecode`, as allowed by the profile. |
| `engine` | Implementation/version and asset entrypoint for interpreted profiles; `null` for compiled JavaScript. |
| `files` | Sorted unique records: relative path, exact byte count, lowercase SHA-256 and role. |
| `imports` | Sorted static module edges between recorded local files. No unspecified lazy dependencies. |
| `licenses` | Recorded nonempty notice/license paths with original attribution. |
| `capabilities` | Explicit required host capability identifiers, versioned by HOST-01. Unknown required capabilities fail. |
| `sources` | Source identities/hashes and optional original-to-generated mapping for diagnostics/provenance. |

Roles distinguish source, executable module, compatibility helper, engine,
stdlib, data, source map and notice. The role does not make a file trustworthy.
All referenced paths, including entrypoints, module edges, maps, data and notices,
must have exactly one file record; every executable or data dependency must be
recorded. There is no broad recursive copy or automatic package/network fetch.

Compiler output identifies emitted ES modules, static imports, required helpers,
compiler/profile versions, source maps and upstream notices. Reject unknown
compiler/profile combinations and unsupported dependencies with clear diagnostics.
The compiler remains responsible for preserving its approved Python semantics.

For interpreter artifacts, identify the exact engine and library/bytecode
versions. A source-input browser profile must include its independent parser and
compiler as well as the VM. An engine that only runs precompiled input cannot
claim new-source execution. Packaging an upstream engine does not satisfy the
independent-interpreter profile.

The interpreter engine record also names its backend: `javascript-vm` first,
with a later explicit `wasm-vm` backend. Backend, bytecode and host ABI versions
must agree or use a declared translation; never silently change backend.

## Validation and assembly

Validate schema/types, profile compatibility, complete references, path safety,
file counts and application size limits before copying. Reuse current portable
path rules: no traversal, absolute paths, backslashes, symlinks, ambiguous/case-
colliding names, URL query/fragment characters or file/directory collisions.

Read supplied files once, verify their hashes and sizes, and assemble those
verified bytes. Recheck any mutable in-memory snapshots before publication.
Hash/version the complete emitted asset set for scoped cache updates. Output is
a new directory outside input roots, with current exclusive-publication and
rollback behavior. Assembly never executes input Python, JavaScript or bytecode.

JavaScript imports require an explicit supported local static-module form; reject
remote URLs, computed imports and unresolved bare specifiers. Validate known
compiler output rather than treating a manifest's edge list as proof that
arbitrary JavaScript has no additional network or executable dependencies.
Runtime network operations are separate host capabilities, not import closure.

Source maps are an explicit output option: every retained map/source is hashed
and included in cache/provenance closure. Omitted source maps must not leave
dangling references; public exception messages must still be useful. This option
does not conceal client executable code.

The application receipt records source, emitted modules/helpers, engine assets,
data/notices/maps and complete uncompressed bytes separately. Compression,
startup and memory require measurements rather than arithmetic on source size.

## Server/client boundary

Build server and client entrypoints with separate explicit file/dependency
allowlists. Do not feed an entire server checkout to browser assembly. A server
path/role is rejected in a client manifest; browser output contains only selected
client source, generated artifacts, runtime and data.

E2E-01 must assert that server-only adapters, test credentials and private data
are absent. File hashes and declared roles do not discover secrets or prove a
developer chose the correct boundary. The chosen application contract supplies
that boundary. Shared pure computation runs under CPython and the selected
client profile, while filesystem/network/UI adapters remain explicit.

## Implementation gates

The [browser host protocol](browser-host-protocol.md) defines versioned
message/value/error/capability shapes and callback lifetime for HOST-01.
WEB-03 implements schema ingestion and compiled PWA assembly with tamper/path/
closure/cache regression cases. INT-WEB-01 implements the independent engine's
profile and newly entered source. They require real execution, offline reload,
subdirectory, error, stop/restart and complete local asset tests. Existing
MicroPython tests remain mandatory; documenting these profiles adds no engine.
