# Pocket-python 0.1.0

Experimental, dependency-free Python 3.14+ tools for audited runtime assets and
offline MicroPython applications. MIT licensed; selected runtimes and application
dependencies retain their own notices and obligations.

## Delivered behavior

- `lock-runtime`: hash an explicit local MicroPython JS/WASM/license allowlist
  and record supplied runtime version and source identity. No downloads or code
  execution occur in the command.
- `inspect`: verify a Shimify schema-1 module bundle’s file/source hashes,
  mappings and distribution notices; report direct stdlib requirements and
  separate source/bundle byte counts.
- `web`: assemble verified source and runtime snapshots into a new directory
  containing a local-only PWA, module worker, Run/Stop controls, text output and
  Python errors, web manifest, scoped service worker, notices and a hashed
  `POCKET-PYTHON.json` receipt.

The browser executes Python using the supplied MicroPython WebAssembly runtime.
Package generation never executes application code. Output is refused on
existing directories, overlapping inputs, unsafe paths, altered snapshots,
incomplete file records or missing required runtime/distribution license text.
Unlisted input files are not published. Symlink assets are unsupported.

The acceptance fixture uses the official MicroPython `1.29.0-6` npm build and a
real Shimify 0.2.0 bundle with two pure-Python modules. Its complete static PWA is
578,168 bytes, including 563,092 bytes of runtime assets/license and 102 bytes
of application source. These are uncompressed fixture measurements. No general
reduction percentage, startup gain or memory improvement is claimed.

## Validation

Fourteen local tests cover schemas, paths, hashes, provenance, snapshot mutation,
deterministic output, cache identity and safe publication. Real WASM worker
tests verify output, exceptions and terminating an infinite loop. Real Chrome
checks verify helper imports, initial execution, service-worker activation,
offline reload/rerun, URL subdirectory deployment, errors, stop/restart, local-only
requests, and preservation of unrelated/neighboring caches. CI repeats portable
tests on Linux/macOS/Windows and browser tests on Linux Chromium.

Wheel/source allowlists exclude interpreter binaries, fixtures and browser-test
dependencies. Both distributions are installed and exercised outside the source
checkout. The release workflow checks tag/version parity, reruns real-runtime
tests and distribution validation, then uses the `pypi` Trusted Publisher.

## Explicit limits and next milestones

MicroPython differs from CPython in syntax, stdlib and APIs. The builder reports
direct stdlib requirements but does not prove browser compatibility, translate
CPython-only code or install missing packages. The console worker has no
interactive stdin or synchronous DOM bridge. Worker termination resets its
in-memory state. Browser caching requires an initial load over HTTPS/localhost;
browser storage can later be evicted.

0.1 preserves the selected runtime assets. Native CPython assembly, automatic
runtime/stdlib pruning, Pyodide/PyScript adapters, resource discovery, native
installers and hosting remain subsequent target-specific milestones in
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) and the GitHub Project.
