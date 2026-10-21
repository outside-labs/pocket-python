# pocket-python 0.2.0

An experimental minor release for Python 3.14+, with no runtime dependencies
and the existing MIT license. Supplied MicroPython assembly remains supported.

## Compiled offline applications

`pocket-python compiled-web CLIENT-SOURCES.json --output NEW_DIRECTORY` and
`pocket_python.compiled.build_compiled` assemble approved Python source as a
compiled JavaScript offline application with the named text-input/1 interface.
Install `Python-JavaScript==0.2.0` explicitly for build-time compilation. The
builder checks both its version and exact adopted source fingerprint; the
published tool does not install or fetch a compiler at execution time.

Inputs explicitly grant only hashed client modules, notices and any exact Fetch
URLs. Server/private files are not selected automatically. Existing compiler
output must match deterministic recompilation of the verified source snapshot.
The builder rejects altered/rehashed JavaScript, incomplete closures and unknown
capabilities before publication. Existing output directories are preserved.

The schema-2 receipt records producer/compiler identity, sources, local import
and worker closure, maps/notices, permissions and complete payload size buckets.
Source maps may be omitted by regenerating output without dangling references.
Output is a local module worker application with Run/Stop/Restart, plain text
results, and service-worker offline reload. A new compiled cache waits until old
application tabs close before taking over; HTTPS/localhost and retained browser
storage are required. Cached computation works offline; remote Fetch has visible
errors and no fallback to server/private code.

The shared CPython/server/client text-metrics application, real Chromium offline
checks and scoped complete-application measurements accompany the checkout.
See [compiled applications](compiled-applications.md), [shared application](shared-application.md)
and [measurements](application-measurements.md) for contracts and methods.

## Interpreter status and limits

These wheel/sdist artifacts contain the `pocket_python` assembler package, not
`runtime/`'s independent VM prototype. That engine has verified bytecode values,
functions/exceptions and explicit modules; its independent source parser and
browser console remain separate roadmap milestones. This release does not claim
newly entered Python execution in the browser or a released independent engine.
The compiled profile accepts only its adopted language and host subset. Arbitrary
Python packages, native extensions, automatic runtime trimming and unlisted
profiles are not supplied. MicroPython applications still require explicitly
supplied, locked runtime assets and compatibility validation.

## Publication gates

Publish the compiler first, resolve its exact released build-tool version, and
verify source/wheel allowlists plus isolated default and compiler-enabled
installed artifacts. Require package/browser/VM CI and final main, then publish
immutable `v0.2.0` using the existing `pypi` Trusted Publisher. Compare PyPI hashes
with workflow artifacts and verify a fresh installation before closing
[REL-02](https://github.com/outside-labs/pocket-python/issues/56).
