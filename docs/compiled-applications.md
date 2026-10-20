# Compiled JavaScript offline applications

The development checkout can assemble a compiled-javascript/1 PWA. Approved
Python source is compiled at build time; a browser module worker executes the
emitted JavaScript and original compatibility helpers. The application includes
no Python interpreter, CDN imports or server computation. It does not parse new
Python source after deployment. The independent interpreter and its browser
parser remain separate milestones. Published pocket-python 0.1.0 predates this
development API and CLI command.

Install the declared build tooling and build the shared text-metrics example:

```sh
uv sync --locked --group compiled-build
uv run --no-sync python examples/compiled_text_metrics.py --output build/text-metrics
python -m http.server --bind 127.0.0.1 --directory build/text-metrics 8000
```

Open localhost:8000, wait for offline installation, then disconnect and reload.
The UI provides Text, Run, Stop, Restart, Result and status. Run processes the
current text in a module worker. Stop terminates the worker and releases the
host's subscriptions/requests; Restart creates a fresh session. HTTPS or
localhost and retained browser caches are required for offline use. Source maps
are included by default; the example also accepts --omit-source-maps.

## Explicit source and compiler inputs

The `pocket-python compiled-web CLIENT-SOURCES.json --output NEW_DIRECTORY`
command accepts a hashed client-source allowlist. The source JSON has exactly
these fields:

```json
{
  "kind": "pocket-python-client",
  "schema_version": 1,
  "target": "client",
  "entrypoint": "app",
  "source_map": true,
  "sources": [
    {"path": "app.py", "module": "app", "is_package": false,
     "role": "client-source", "size_bytes": 123, "sha256": "<actual SHA-256>"}
  ],
  "notices": [],
  "fetch_urls": []
}
```

Use actual sizes/hashes; the example's write_client helper shows how to create
records with file_record and json_bytes. Paths are relative to this JSON file's
directory. A notice has path, role=notice, size_bytes and sha256, with a nonempty
file under LICENSES/. The loader reads only selected files. Server-target roles,
unknown fields/versions, duplicate JSON fields, unsafe/colliding paths, symlinks,
hash/size mismatches and oversized files are refused. Limits are 32 source
modules, 32 notices, 1 MiB per selected file, 8 MiB total input and 256 files /
32 MiB compiled output. An unlisted server file is never recursively copied.
The explicit selection remains the developer's boundary; hashes do not identify
sensitive content or decide whether source belongs in the client.

The current text-input/1 UI binds controls named input, run, result and status.
The entry module defines an approved async main() that subscribes a callback to
on_click("run", callback). Its callback receives the text and can print results.
DOM bindings, text output and handle ownership are granted explicitly. Native
GET Fetch is available only for declared exact URLs. The initial grant syntax
accepts canonical ASCII HTTP(S) URLs with ordinary lowercase hostnames or IPv4
addresses, an explicit / path and optional nondefault port/query; credentials,
fragments, dot-path segments and URL forms requiring browser normalization are
refused. Fetch still follows the host SDK's CORS, credentials, redirect, size and
deadline policy. Network requests are not offline data storage. Unknown required
capabilities fail assembly. Arbitrary HTML/UI generation and new source input
are outside this initial UI profile.

Compilation is optional build tooling. The package's runtime dependencies remain
empty. The compiled-build group pins Python-JavaScript's source revision
35fbe6eb399f5d94e05e850eb36dbdf695e6d15a because its published 0.1.0 lacks this
compiler. Before importing the compiler, the builder checks its installed source
fingerprint across the adopted files (canonical LF line endings) and package
identity. No compiler is fetched or installed by the CLI at runtime. A different
compiler build requires an explicit integration update and compatibility checks.

To consume existing compiler output, save its manifest bytes as
COMPILED-MANIFEST.json alongside its immutable artifact files, then pass
--compiled DIRECTORY. The reader recompiles the verified client allowlist with
the pinned compiler and compares the manifest and every selected output byte.
Rehashing edited JavaScript or declaring an incomplete import graph cannot make
it pass. Input Python/JavaScript is never executed during assembly. The builder
uses known generated output, including the worker and dynamic worker asset edge,
rather than treating arbitrary JavaScript and a self-declared edge list as proof
of a complete dependency set. Validated snapshots survive later input-file
changes; altered in-memory snapshots fail validation.

## Receipt, source maps and cache updates

Output is a new directory outside all input roots; existing output, overlaps and
publication failures use the exclusive-write/rollback behavior shared with the
MicroPython builder. `application/<compiler-manifest-digest>/` holds the verified
modules, helpers, optional maps, original notices and compiler manifest. The
generated launcher and configuration have content-addressed names. The scoped
service worker uses fresh precache requests and a canonical index.html navigation
entry; all assets remain local. POCKET-PYTHON.json uses the adopted schema-2 application
identity, profile=compiled-javascript, target=client and engine=null. It records
the compiler revision/fingerprint/ABI, exact local file/import closure, licenses,
capabilities, source identities and cache version. Source entries identify
original logical source names/hashes; they are not additional output asset paths.
The host session echoes the retained compiler-manifest digest; it is an identity
check, not cryptographic authentication of a peer.

The receipt separates original source bytes, emitted module bytes, helpers,
source maps, notices, assembly modules, other local data/metadata, receipt and
complete uncompressed artifact bytes. Original source bytes are an input metric;
maps can contain those same sources. The remaining physical payload buckets sum
to the complete artifact, including the receipt, which excludes its own hash.
Compression, startup, memory and comparison with other engines require separate
measurements.

--omit-source-maps validates any original compiler snapshot first, then regenerates
the adopted artifact without map files or dangling sourceMappingURL references.
Original error locations remain available. This policy does not conceal client
executable code. Full Python traceback objects are outside the compiler profile.

Cache identity covers the complete assembled input assets and producer versions.
An updated service worker installs the new asset set and waits while any page
uses the previous version. The UI displays an update notice. Close this app's
tabs and windows, then reopen to activate the update; reloading with another tab
open keeps the current version. Current sessions and offline reloads retain
their complete document/module graph while the update waits. Activation drops
only obsolete caches for that exact scope. Neighboring apps and unrelated caches
remain. Offline reload/rerun needs a successful initial installation;
browser-managed storage can still be cleared or evicted.

Run the focused tests and real browser gate:

```sh
uv sync --locked --group compiled-build --group browser-tests
uv run --no-sync python -m unittest discover -s tests -p test_compiled.py -v
uv run --no-sync python -m playwright install chromium
uv run --no-sync python scripts/compiled_browser_smoke.py --report build/compiled-browser-report.json
```

The browser gate compares the shared computation with CPython, reloads/reruns
offline under a URL subdirectory, checks original errors with omitted maps,
terminates a busy worker, restarts, retains the installed version across two
live tabs and an offline reload while an update waits, activates after both
close, reloads the new version offline, and preserves neighboring and unrelated
caches. All observed application requests are
local static GETs; no upstream interpreter assets enter this profile. Existing
MicroPython worker/browser/offline checks continue separately. The shared
text-metrics computation and full MIT notice are attributed in the example;
compiler notices do not choose or grant a license for that project.
