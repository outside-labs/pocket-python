# Pocket-python implementation plan

## Purpose

Package a Python application with a small, explicit interpreter/runtime payload.
Support a native application route and a client-side browser/PWA route without
requiring an end user to install Python. The released baseline assembles existing
interpreters. The forward program adds our compiler-produced JavaScript profile
and a separately staged independent interpreter.

Distribution name: `pocket-python`. Python import: `pocket_python`. CLI:
`pocket-python`. Local project: `Projects/pocket_python`. The outside-labs
repository and its GitHub Project track the canonical issue queue. Requires
Python 3.14+ to build artifacts; browser application syntax must independently
match the chosen interpreter. No runtime dependencies in the packaging tool.

## Coordinated program adopted 2026-10-20

Three parts have separate implementation and compatibility contracts. Open
issues and plans do not mean those features have shipped.

1. **Smaller source artifacts:** Shimify owns module reachability, bounded
   cross-module symbol extraction, resources, provenance and measurements.
2. **Our compiler and browser applications:** Python-JavaScript owns validated
   Python-to-JavaScript compilation and browser adapters. Pocket-python owns
   verified profiles, application assembly and offline delivery. Approved shared
   logic runs under CPython on the server and compiled code on the client;
   entrypoints and platform adapters remain explicit.
3. **Our independent interpreter:** pocket-python initially owns the plan and
   queue for a new engine that executes newly entered Python source locally.
   The separate interpreter plan defines language stages, architecture decisions,
   native/browser delivery, conformance and resource limits.

The compiler and independent interpreter must work without MicroPython or
Pyodide. An optional upstream CPython WebAssembly build is an existing-engine
distribution, not the independent interpreter. MicroPython, Pyodide and PyScript
remain separate optional compatibility routes. No silent fallback or arbitrary
package compatibility is implied.

Related plans:

- [Source reduction](https://github.com/outside-labs/shimify/blob/main/IMPLEMENTATION_PLAN03.md)
- [Compiler/browser target](https://github.com/outside-labs/Python-JavaScript/blob/main/IMPLEMENTATION_PLAN.md)
- [Application assembly](https://github.com/outside-labs/pocket-python/blob/main/IMPLEMENTATION_PLAN.md)
- [Independent interpreter](https://github.com/outside-labs/pocket-python/blob/main/IMPLEMENTATION_PLAN_INTERPRETER.md)

The compiler repository became public on 2026-10-20. Project visibility remains
separate; application artifacts still include only explicitly selected files.

## Common acceptance application

The adopted [browser host protocol](docs/browser-host-protocol.md) defines the
versioned capability, value, request and worker-lifetime contract. Its first UI
uses named text controls and events; Fetch, virtual files and persistence remain
separately granted adapters.

Use a small text_metrics application: shared Python computation counts
characters, words and lines; a local pure-Python helper and immutable constants
establish module boundaries, with an unused utility for reduction. Start the
compiler with a single-module equivalent, then add local imports. Adopt results
for empty strings, Unicode/astral characters, whitespace, invalid arguments and
numeric boundaries through the source-language contract.

Run shared logic through a CPython 3.14 CLI and local standard-library HTTP test
endpoint. The browser has a text area, a button and visible results; computation
runs offline. The interpreter later accepts this source as new input after
deployment. Keep server-only adapters/data outside client allowlists. No new
framework or external service is needed for this acceptance application.

Retain packaging==25.0 as Shimify's independent real-package module regression.
For resource work, extend the local fixture with one named UTF-8 stop-word file.
The new compiler/interpreter need not support the whole packaging library to
meet their first milestones.

## Feasibility and product boundary

**Feasible:** combine Shimify’s reduced source with an existing relocatable
CPython runtime for native distribution, or MicroPython/Pyodide WebAssembly for
browser execution. Source reduction and runtime size are distinct. Browser
applications can be installed/cached as PWAs when every required asset is local.

**Requires target-specific proof:** prune optional CPython standard-library
modules, extensions and shared libraries. Preserve interpreter startup, codecs,
import machinery, exception handling, native ABI and transitive dependencies.
Neither a static import list nor one successful trace establishes a safe
deletion allowlist. Link-time removal of VM internals is a later research path.

**Compatibility choice:** MicroPython offers a smaller runtime and a restricted
Python/stdlib subset. Pyodide offers broader CPython compatibility at a larger
footprint. PyScript is an optional integration layer using these runtimes;
it does not make arbitrary CPython dependencies MicroPython-compatible.
Do not silently fall back between implementations. Desktop extensions cannot
be copied unchanged to WebAssembly.

## 0.1.0 release contract

Deliver a useful experimental build-time toolkit:

1. Lock an explicit allowlist of caller-supplied runtime assets with relative
   portable paths, SHA-256, sizes, implementation/version/source identity and
   required nonempty license files. Never download or execute a runtime while
   locking it. Verify every locked file before assembly.
2. Inspect a Shimify schema-1 module bundle, checking manifest/file/source
   hashes and the supported unchanged-module layout. Describe direct stdlib
   requirements and distinguish incomplete runtime closure from compatibility.
   Reject tampering and unsafe paths without importing application code.
3. Build an entirely local-asset MicroPython PWA from a verified Shimify bundle
   and a verified runtime lock. Copy sources and notices, create a module worker,
   output/error/stop controls, a web manifest, and a cache-versioned service
   worker. All URLs are relative so subdirectory deployment works.
4. Validate a deliberately portable app with a pinned real MicroPython WASM
   distribution, including first run, Python errors, worker stop/restart, cache
   installation and offline reload. Synthetic fixtures alone are insufficient
   evidence of runtime integration. CI runs a pinned real-runtime smoke check.
5. Build and verify clean wheel/sdist artifacts, installed CLI, metadata and
   source allowlists on Linux/macOS/Windows. Publish only after passing main CI
   and a working PyPI publication identity. Record artifact hashes and a fresh
   registry installation.

0.1 does not provide a newly compiled interpreter, arbitrary CPython-to-
MicroPython translation, automatic runtime trimming, Pyodide/PyScript adapters,
native installers, automatic third-party package installation or cloud hosting.
Its delivered small-runtime route is MicroPython in the browser; native runtime
assembly has an explicit next milestone below.

## Architecture and file contracts

### Runtime lock

`pocket-python lock-runtime ROOT --runtime-version VERSION --source-url URL
--file micropython.mjs --file micropython.wasm --license-file LICENSE
--output runtime-lock.json` records a `pocket-python-runtime` schema-1 object.
The initial supported implementation is `micropython`; the entrypoint is
`micropython.mjs` alongside `micropython.wasm`. Require explicit files rather
than recursively publishing arbitrary directory contents. Reject traversal,
backslashes, absolute paths, symbolic links, case collisions, reserved Windows
names, URL query/fragment characters and file/directory collisions.

Asset identity pins supplied bytes, not their trustworthiness or licensing
compatibility. Preserve the upstream source URL and nonempty version string;
license text is copied unchanged. A lock makes the assembly repeatable but does
not establish that an arbitrary JS/WASM pair is ABI-compatible. Real-runtime
tests establish the supported example’s integration.

### Source bundle input

`pocket-python inspect BUNDLE` validates `SHIMIFY-MANIFEST.json`, every listed
file, source/output mapping, source hashes and required notices. Never copy
unlisted input files. Read snapshots once and use those verified bytes in the
output so a source changing after validation cannot change the emitted bytes.
The input must use `mode=modules`, `_sources/`, a script entrypoint and the
documented launcher. Extraction output can be consumed by a tiny script first
bundled with `shimify modules`; do not assume every extraction is an executable.

Return source/artifact/runtime byte counts separately. Standard-library imports
remain requirements; the builder does not certify that MicroPython implements
every requested module/API. The initial demonstrated acceptance app uses only
plain syntax and local pure-Python helper imports. Browser-only imports and
resource handling require a later explicit Shimify adapter/profile.

### Browser artifact

`pocket-python web BUNDLE --runtime ROOT --runtime-lock LOCK --output NEW_DIR`
creates `index.html`, `app.js`, `worker.js`, `service-worker.js`,
`manifest.webmanifest`, local runtime assets, source files, notices and
`POCKET-PYTHON.json`. Include a generated icon and app name. Use DOM text output;
never insert Python output as HTML. Escape app titles through the HTML encoder.

The module worker calls the existing `loadMicroPython` API, creates a virtual
application directory, writes the verified sources, prepends the source root to
Python’s import path, and executes the original script as `__main__`. It does
not run the CPython-specific source-bundle launcher. Worker termination stops
long computations without blocking browser controls. No synchronous DOM bridge
or SharedArrayBuffer is required by the initial worker-only console contract.

The service worker precaches every emitted runtime/source/UI asset and serves
only same-origin requests within the application scope. Cache identity includes
all file hashes so changed app/runtime bytes produce a new cache. Preserve other
applications’ caches; activation removes only old caches for this scope. Await
successful installation before showing offline readiness. HTTPS or localhost
is required. First installation needs a server; offline cache can later be
evicted by the browser. `file://` is unsupported. App-origin data is exposed
to client code by design; never package secrets.

Output must be a new directory outside all input roots. Preflight all files,
stage then exclusively publish, and roll back only files created by this build.
Do not overwrite a previous build or follow source symlinks. The manifest hashes
files (excluding its own self-hash) and records provenance, selected runtime,
source/runtime/total byte counts and the intentionally limited compatibility
claim. Actual compression, startup and memory are not inferred from source size.

## Delivered 0.1 queue and existing-runtime proposals

| Task | Deliverable | Dependency | Acceptance |
| --- | --- | --- | --- |
| INIT-01 | Plan, uv package/CLI, explicit runtime locks and bundle inspection | None | Deterministic schemas, hashes, tamper/path/license/overwrite tests; no execution |
| WEB-01 | Local-asset MicroPython worker/PWA builder | INIT-01 | Correct FS mapping, relative URLs, notices/hashes, safe output, stop/error UI, cache scope |
| QA-01 | Real runtime and offline conformance | WEB-01 | Pinned WASM; real worker run/error/stop; install+offline reload; subpath deployment; portability CI |
| REL-01 | Validate/publish 0.1.0 | QA-01 | Clean distributions, installed commands, tag/version parity, passing main CI, PyPI installation/digests |
| NATIVE-01 | Full supplied relocatable CPython runtime assembly | INIT-01 | Select one OS/architecture/ABI; preserve all runtime files/licenses/modes; move and launch without host Python |
| TRIM-01 | Opt-in optional stdlib/runtime pruning | NATIVE-01 | Pin bootstrap and recursive import/native closure; original/reduced differential suite; size measurements |
| PYODIDE-01 | Broader CPython-compatible web adapter | QA-01 | Lock full JS/WASM/stdlib/data/wheel closure; network/filesystem diagnostics; offline real-runtime tests |
| PYSCRIPT-01 | Optional browser integration profile | WEB-01 | Explicit pinned integration assets, DOM/event contract and worker isolation requirements |
| TRACE-01 | Runtime evidence and budgets | NATIVE-01 | Opt-in execution, timeout, per-target evidence; observations do not prove absence; cold/warm/memory/size separated |

The first four tasks form a focused rolling PR batch; dependent work stacks.
Squash passing PRs oldest first, preserve open dependency bases, reconcile and
retarget descendants, require fresh checks, then verify final main. Publication
is explicitly requested for this initial version, conditional on these gates.
Existing-runtime proposals remain optional and target-specific, without gating
compiler/interpreter delivery. TRACE-01 now tracks native runtime evidence;
MEASURE-01 owns cross-profile footprint reporting.

The adopted [application profile contract](docs/application-profiles.md) specifies
profile/version identities, manifest fields, verified compiler assets and the
server/client boundary. Its schema is a future implementation contract.

## Forward application queue

| Task | Scope | Depends on | Readiness |
| --- | --- | --- | --- |
| [pocket/PROFILE-01](https://github.com/outside-labs/pocket-python/issues/16) | Define versioned compiled and interpreter application profiles | Released foundation | Ready |
| [pocket/HOST-01](https://github.com/outside-labs/pocket-python/issues/17) | Specify the browser host and worker bridge | [pocket/PROFILE-01](https://github.com/outside-labs/pocket-python/issues/16), [js/PARSE-01](https://github.com/outside-labs/Python-JavaScript/issues/11) | Blocked |
| [pocket/WEB-03](https://github.com/outside-labs/pocket-python/issues/18) | Assemble compiler-produced offline browser applications | [pocket/PROFILE-01](https://github.com/outside-labs/pocket-python/issues/16), [pocket/HOST-01](https://github.com/outside-labs/pocket-python/issues/17), [js/QA-03](https://github.com/outside-labs/Python-JavaScript/issues/25) | Blocked |
| [pocket/E2E-01](https://github.com/outside-labs/pocket-python/issues/19) | Verify shared server and client Python application logic | [pocket/WEB-03](https://github.com/outside-labs/pocket-python/issues/18), [js/QA-03](https://github.com/outside-labs/Python-JavaScript/issues/25) | Blocked |
| [pocket/MEASURE-01](https://github.com/outside-labs/pocket-python/issues/20) | Report comparable source, compiler and interpreter footprints | [pocket/E2E-01](https://github.com/outside-labs/pocket-python/issues/19), [js/PERF-01](https://github.com/outside-labs/Python-JavaScript/issues/26) | Blocked |
| [pocket/CPY-WASM-01](https://github.com/outside-labs/pocket-python/issues/21) | Evaluate an independently built upstream CPython browser profile | [pocket/PROFILE-01](https://github.com/outside-labs/pocket-python/issues/16) | Triage |
| [pocket/NATIVE-01](https://github.com/outside-labs/pocket-python/issues/5) | Select and assemble a supplied relocatable CPython runtime | Released foundation | Triage |
| [pocket/TRIM-01](https://github.com/outside-labs/pocket-python/issues/6) | Prove bounded optional-runtime trimming | [pocket/NATIVE-01](https://github.com/outside-labs/pocket-python/issues/5) | Triage |
| [pocket/PYODIDE-01](https://github.com/outside-labs/pocket-python/issues/7) | Define an optional broader CPython browser profile | Released foundation | Triage |
| [pocket/PYSCRIPT-01](https://github.com/outside-labs/pocket-python/issues/8) | Define an optional PyScript integration profile | [pocket/HOST-01](https://github.com/outside-labs/pocket-python/issues/17) | Triage |
| [pocket/TRACE-01](https://github.com/outside-labs/pocket-python/issues/22) | Collect native runtime evidence and budgets | [pocket/NATIVE-01](https://github.com/outside-labs/pocket-python/issues/5) | Triage |

PROFILE-01 and the interpreter language contract INT-01 are Ready design tasks.
HOST-01 follows PROFILE-01 and the compiler language contract. Compiled artifacts
identify ES modules, helpers, static imports, source maps, notices and profile
versions; they are not MicroPython asset locks. Preserve schema-1 behavior and
version incompatible contracts explicitly.

WEB-03 adds compiled offline assembly after compiler/browser conformance.
E2E-01 proves shared CPython/server and client logic with separate entrypoints.
MEASURE-01 delivers compiler reporting first and accepts interpreter measurements
when INT-WEB-01 exists. Native/trim/Pyodide/PyScript/upstream CPython WASM lanes
remain optional with explicit target/fixture decisions.

## Part 3: independent interpreter

[IMPLEMENTATION_PLAN_INTERPRETER.md](IMPLEMENTATION_PLAN_INTERPRETER.md) specifies
language stages, toolchain/ownership decisions, bytecode/VM, values and memory,
functions/exceptions/imports, independent source parsing, an offline browser
console, classes/async, measurement and alpha-candidate gates.

The first backend is the owner-selected JavaScript VM. A later C/Rust-to-
WebAssembly backend remains in INT-WASM-01 through INT-WASM-03, with explicit
toolchain, implementation and cross-backend integration gates.

The interpreter must execute newly entered source on the device. Packaging
CPython or invoking the ahead-of-time JavaScript compiler does not satisfy it.
The native/CLI harness and browser worker use adopted engine semantics through
explicit platform adapters. Interpreter delivery does not depend on completing
the ahead-of-time compiler or native CPython packaging.

## Delivery, readiness and measurement

Issues and Projects hold current state; plans describe architecture/acceptance.
Ready means adopted scope and finished dependencies; Blocked means unfinished
dependencies; Triage means an optional or unselected extension. A contract or
architecture task may be Ready while later implementation awaits its decisions.
Do not mark a feature Done for documenting it. Update dependent readiness after
merges; Task, Order, Dependencies, Target and Readiness make the queue explicit.

Use rolling batches of 3-5 focused PRs. Start CI, continue independent work or
stack dependent changes, squash passing changes in dependency order and verify
final main. Preserve parent branches while open dependents target them;
reconcile, retarget and recheck descendants before deleting dependency bases.

Compare supported behavior before footprints. Separate source bytes, generated
code/helpers, interpreter assets, data/notices, source maps, complete uncompressed
bytes and compressed transfer. Record tool/engine/host versions, cold/warm
startup and memory method. No fixed size/performance/compatibility claim follows
from this roadmap. Incomplete import reports and unobserved dependencies never
authorize removal.

Keep releases/tags immutable. New runtime dependencies, services, engine
repository/package identity, release uploads and deployment retain their explicit
scope/decision requirements. This planning update changes no runtime dependencies
and publishes no package.

## Testing and release policy

Use stdlib unittest and temporary trees for path/hash/schema validation,
collisions, symlink escapes, source mutation, empty licenses, output overlap,
deterministic artifacts and rollback. Execute only known acceptance fixtures.
No arbitrary application is run by the build commands. Validate generated JS
syntax and run the real worker in Node plus a real browser’s service-worker
cache/offline behavior. Test at a URL subdirectory and confirm no CDN request is
needed. Browser storage and installed-PWA affordances vary across platforms.

The tool’s source uses MIT. Runtime artifacts and application dependencies keep
their own notices; copying them does not certify redistribution compliance.
Do not include interpreter binaries/test fixtures in the PyPI wheel: the package
is a build tool, while generated applications contain caller-selected assets.

Use a `v0.1.0` release tag matching metadata and GitHub Actions OIDC through a
`pypi` environment. A new project may require its owner to register a pending
Trusted Publisher with PyPI. If that external account action is unavailable,
finish and validate the complete release candidate and report the exact
publication blocker; never claim an unpublished package is available.

## Risks and decision points

- Arbitrary Python dynamic features prevent automatic minimality guarantees.
- MicroPython syntax/stdlib behavior differs from CPython; test each application.
- Native runtimes carry ABI, OS, relocation and shared-library dependencies.
- Runtime licenses and source obligations require artifact-specific review.
- Offline behavior depends on complete precaching, origin scope and browser
  storage; runtime/network assets cannot be fetched lazily from a CDN.
- Application source and data are delivered to clients and are inspectable.
- No fixed reduction percentage, startup gain or maximum memory is promised.

## Reference basis (reviewed 2026-10-18)

- [Shimify 0.2 plan](https://github.com/outside-labs/shimify/blob/main/IMPLEMENTATION_PLAN02.md)
- [MicroPython WebAssembly embedding API](https://github.com/micropython/micropython/blob/master/ports/webassembly/README.md)
- [MicroPython library subsets](https://docs.micropython.org/en/latest/library/index.html)
- [Pyodide compatibility constraints](https://pyodide.org/en/stable/usage/wasm-constraints.html)
- [PyScript offline assets](https://docs.pyscript.net/2026.7.3/user-guide/offline/)
- [Service worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)

The independent engine now has [INT-05 lifetime and resource control](docs/interpreter-memory.md): explicit roots, cyclic-graph accounting, retained session values and owned host handles. New-source browser execution remains staged behind the parser and host-integration milestones.


WEB-03 implements compiled-javascript/1 offline assembly with an explicit hashed
client source allowlist and optional existing compiler artifact. Pinned compiler
source verification and deterministic recompilation establish the local module,
worker/helper, source-map and notice closure before publication. The schema-2
receipt records client-only identities, capabilities, exact assets/imports and
separate physical payload costs. The text-input/1 UI runs in a worker with
Run/Stop/Restart; real-browser acceptance covers CPython computation parity,
offline reload/rerun, errors without maps, busy-worker termination, subdirectory
hosting and cache updates preserving neighbor scopes. Installed sessions keep
their version while an update waits; closing the app's tabs/windows activates
the new complete asset set. Existing MicroPython
regressions remain. The [compiled application guide](docs/compiled-applications.md)
describes the adopted UI/capability/input limits. The compiler is optional pinned
build tooling; runtime dependencies stay empty. New-source interpretation remains
INT-08/INT-WEB-01. No release or deployment was published.

E2E-01 adds the [shared server/browser example](docs/shared-application.md).
The same canonical-LF computation runs directly under CPython and as a compiled
browser worker. Separate local, remote-reference and invalid-input adapters make
network behavior explicit. A stdlib HTTP fixture exposes only named reference
cases; source allowlists exclude its implementation and synthetic server-only
record. Browser checks compare outputs/errors, prove that local execution makes
no API call, retain offline local reruns and expose disconnected Fetch failure
without silently switching execution targets. No framework/runtime dependency,
production server or broader Python compatibility is introduced.

MEASURE-01 provides [versioned complete application measurements](docs/application-measurements.md).
Equivalent mapped/map-omitted compiled PWAs share a source/workload/UI comparison
set, explicit physical/compressed payload buckets, raw full-build/readiness and
separate dedicated-worker heap observations. Matching compiler component evidence
is retained with different startup boundaries clearly identified. Unavailable
interpreter profiles carry gates/reasons instead of fabricated estimates; matched
source-interpreter producers join after INT-WEB-01/INT-11. No general runtime
savings are inferred from source removal or a single host's measurements.

## 0.2.0 publication plan

[REL-02](https://github.com/outside-labs/pocket-python/issues/56) publishes the
merged compiled offline assembler after Python-JavaScript 0.2.0 publication.
The build-only compiler pin adopts that published version, exact source identity
and release provenance. The [release contract](docs/release-0.2.0.md) covers both
compiled and supplied MicroPython profiles; runtime dependencies remain empty.
Independent VM prototypes remain outside PyPI artifacts until their separate
source/parser/browser/release gates. Strict allowlists, isolated default/compiler
installs, final package/browser/VM CI, PyPI/workflow hashes and fresh installs
remain publication gates. INT-08 is the next implementation task.

### Independent source console checkpoint (2026-10-21)

INT-WEB-01 delivers development `interpreter-web`: an explicit source/notice
allowlist, the pinned independent JavaScript engine, a source editor and a
complete offline application profile. The [console guide](docs/interpreter-console.md)
records the output-only host boundary, limits, fresh-state run semantics and
build/use instructions. Chromium acceptance proves newly entered source after
offline reload, interruption/restart, diagnostics, failed-install/update handling,
waiting updates and scoped cache cleanup. Node/Chromium engine conformance and
existing compiled/MicroPython regressions remain required in CI.

Class/descriptor semantics, async browser host integration and measured profile
inclusion remain the next interpreter tasks. Native C/Rust WebAssembly remains
the later planned backend. Published versions remain Shimify 0.3.0,
Python-JavaScript 0.2.0 and pocket-python 0.2.0; the independent runtime is still
excluded from that pocket-python release and needs INT-REL-01 before publication.
