# Pocket-python

Pocket-python packages explicit Python runtime assets and Shimify source
bundles into offline MicroPython browser applications. Python runs on the
client through WebAssembly, with a worker for execution and a service worker
for cached reloads. No application server executes the Python code.

Requires Python 3.14+ to build artifacts; the generated application must also
be compatible with the selected MicroPython runtime. The tool has zero runtime
dependencies and uses the MIT license. Version 0.1.0 is experimental.

```sh
python -m pip install pocket-python==0.1.0 shimify==0.2.0
pocket-python --help
```

## Build a browser application

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
uv sync --locked --group browser-tests
uv run python scripts/prepare_runtime.py
POCKET_PYTHON_RUNTIME=build/runtime uv run python -m unittest discover -s tests -v
uv run python -m playwright install chromium
uv run --group browser-tests python scripts/browser_smoke.py
uv build
uv run python scripts/check_distributions.py
```

On PowerShell set `$env:POCKET_PYTHON_RUNTIME = "build/runtime"` before tests.
Without an explicit runtime fixture path, the real-WASM test is skipped.
Use `--channel chrome` with the browser script to test an installed Chrome.
Playwright is a pinned build-only group; it is not a package runtime dependency.
CI runs real-runtime tests on Linux, macOS and Windows and offline Chromium
tests on Linux. Distribution checks verify allowlists, metadata, source parity
and both installed wheel/source artifacts outside the checkout.

## Compatibility and roadmap

MicroPython provides a subset of Python and its standard library. Test every
application against the actual selected runtime: a valid Shimify CPython source
bundle does not establish browser compatibility. Native extensions, OS process
APIs, resources and dynamic imports need explicit adapters or a different
runtime profile. The initial console has no interactive stdin or DOM bridge.
Browser cache persistence and PWA installation affordances vary by platform.

The first small-runtime route is MicroPython WebAssembly. Native relocatable
CPython assembly and subsequent bootstrap-aware trimming are planned separately;
0.1 does not trim/rebuild CPython. Broader CPython browser compatibility through
Pyodide and optional PyScript integration are later profiles.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md),
[release notes](docs/release-0.1.0.md), and the
[GitHub Project](https://github.com/orgs/outside-labs/projects/13).
Runtime and dependency licenses remain applicable; preserve and review their
upstream notices before distributing generated applications.
