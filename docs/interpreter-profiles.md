# Explicit interpreter library profiles

INT-11 first separates optional Python library assets from the complete source
engine. The initial profiles are `core-only/1` (no library modules) and
`operator/1` (the existing eleven-function Python operator implementation).
Both retain `core-source/1`, bytecode 4 and the complete JavaScript parser/VM.
They do not select different Python arithmetic or object semantics.

## Selection and authority

`runtime/library-profiles.mjs` exposes `libraryProfile`, `verifyLibraries` and
`compileProfileSource`. Callers supply the selected profile's exact module list,
source text, original notice and explicit import grants. There is no module
search, download, source-discovered grant or automatic fallback. Unknown profile
versions fail with LIBRARY_PROFILE. Module source/notice mismatches fail with
LIBRARY_INTEGRITY before application execution.

The reviewed catalog fixes each module's identity, package flag, grants and
source/notice hash and byte count. Selection records, grants and entry byte views
are copied before asynchronous hashing. The returned catalog/selection graph is
immutable. Registry verification subsequently compiles every selected module,
checks the source/bytecode/notice closure and grants only selected library names
to the application. Package-parent and transitive-grant rules remain the
[module registry contract](interpreter-modules.md). A library profile cannot
remove parser, verifier, value, memory or loader internals.

`python scripts/lock_library_profiles.py` checks the generated JavaScript and
Python catalogs. `--write` refreshes them after review; it reads known sources
without importing them. The optional operator source remains ordinary Python,
including its visible wrapper frames and normal initialization/cache rules.
The supported functions are add, sub, mul, floordiv, mod, eq, lt, neg, not_, truth
and getitem. Other names and broader stdlib compatibility remain unadopted.

The adopted host-module profile is `output-only/1`, requiring output/1 and
providing no Python host modules. Optional DOM, Fetch, files and persistence
profiles remain unavailable until INT-10 adopts asynchronous language semantics.
Requesting one returns UNAVAILABLE, without silently selecting another engine
or granting network/storage access. Library selection never widens host grants.

## Verification and delivery stages

`node --test runtime/library-profiles.test.mjs` checks common behavior, explicit
imports, missing/changed selections and notices, immutable snapshots, budgets,
cancellation and teardown. `python runtime/check_library_profiles.py --target
node` (or browser) runs forty source/selection cases: six common computations in
both profiles, eleven operator functions plus an exception in full/reduced
selections, and four profile/host/budget policies. CPython supplies the reference
stdout and error types. Missing-library cases intentionally refuse; Python
wrapper tracebacks are retained and are not equated with native stdlib frames.

The development console builder now selects these profiles explicitly:

```sh
uv run pocket-python interpreter-web build/console-source/CONSOLE-SOURCE.json \
  --engine runtime --library-profile operator/1 --output build/operator-console
```

The default remains core-only/1. The engine snapshot carries its selected library
identity and only the optional source files belonging to that selection. Both
profiles preserve the identical core-engine fingerprint. The receipt separately
records library/source/notice hashes and bytes, profile fingerprint, grants and
physical paths. Source and notice assets are verified before worker startup;
the worker independently verifies the catalog before Ready. No selection widens
the output-only host profile. Hashes/versioned cache paths prevent mixing graphs.

The worker retains language compilation/execution. The main-thread host imports
only protocol, selection and catalog modules. Tests verify the transitive static
bootstrap graph and refuse a missing required VM dependency. The real browser
suite also verifies full/reduced shared-source results, library error locations,
offline reload/restart, tampered source refusal and a full-to-reduced update that
removes both grants and the cached optional source. Existing console acceptance
remains mandatory.

The [measurement tool and methods](interpreter-measurements.md) distinguish
engine, library, data, bridge and source bytes; full/reduced behavior; compression
policy; startup boundaries; logical arena accounting and observed browser/process
memory. Static source counts do not prove general minimality or whole-process
memory bounds.
