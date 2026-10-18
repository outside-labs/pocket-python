# Pocket-python implementation plan

## Purpose

Package a Python application with a small, explicit interpreter/runtime payload.
Support a native application route and a client-side browser/PWA route without
requiring an end user to install Python. Start with existing interpreters and
auditable assembly rather than designing a new Python implementation.

Distribution name: `pocket-python`. Python import: `pocket_python`. CLI:
`pocket-python`. Local project: `Projects/pocket_python`. The outside-labs
repository and its GitHub Project track the canonical issue queue. Requires
Python 3.14+ to build artifacts; browser application syntax must independently
match the chosen interpreter. No runtime dependencies in the packaging tool.

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

## Ordered queue and acceptance gates

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
Later milestones remain open proposals with concrete fixture-selection gates.

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
