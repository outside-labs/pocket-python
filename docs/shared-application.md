# Shared server and browser computation

E2E-01 provides a bounded development example of one supported Python computation
running under CPython 3.14 and as emitted code in a browser worker. The example
uses Python's standard-library HTTP server. It adds no framework, service or
package runtime dependency. The released 0.1.0 predates the compiled build API;
run these commands from the development checkout.

```sh
uv sync --locked --group compiled-build
uv run --no-sync python -m examples.shared_text_metrics --json
uv run --no-sync python -m examples.shared_text_metrics \
  --output build/shared-text-metrics --port 8000
```

The --json command prints the CPython reference outcomes. The serving command creates a
new output directory and serves it on localhost:8000. Existing output is refused.
The server binds only 127.0.0.1. Stop it with Ctrl+C. A different port is embedded
in the remote adapter's explicit Fetch grants when building that fixture.

The landing page links three explicit adapters:

- Local text metrics accepts ordinary text and executes metrics in the worker.
  After offline installation it reloads and runs without a reference endpoint.
- Server reference cases accepts one of empty, simple, whitespace, unicode,
  non-ascii-space, server-only or type-error. Run requests that named case from
  the local CPython reference server and prints its versioned JSON result.
- Invalid-input demonstration passes None to the local computation. Run displays
  TypeError("text must be str") with its original text_metrics.py location.

The computation counts Unicode code points, words separated by the adopted ASCII
separator set, and LF-based lines. It accepts builtin str; invalid input raises
the adopted TypeError. Browser textarea line-ending normalization is a UI rule;
the shared input cases use LF and do not pretend an HTML textarea preserves CR.
These adapters share the supported computation and result/error contract. They
do not make arbitrary server modules, installed packages or full Python features
translatable. Native packaging and the new-source interpreter remain separate.

## Source selection and server boundary

examples/shared_text_metrics/computation.py contains the shared computation.
Its bytes with canonical LF line endings are the exact text_metrics.py client
source. The reference report, fixture manifest and compiled source records retain
the same SHA-256, size and hash policy. This avoids treating platform checkout
line-ending conversion as a different computation.

The source originates in Shimify's adopted text_metrics fixture at
b48ed1778270508007d75b861dc117ad4ddc4f2b. The builder retains its exact MIT notice
under LICENSES/shimify.txt. This notice does not choose a license for the compiler.

Client source allowlists select app.py, text_metrics.py and the notice. The
compiler emits only reachable modules: the remote adapter needs its network
adapter rather than the computation module. The local/error adapters import the
same computation executed by CPython. The server entry module, HTTP routing and
sample-record dictionary are never client inputs. A unique synthetic server-only
record stays outside emitted files, including source maps. It is test data rather
than a credential or imported personal data. The endpoint exposes its computed
counts without returning the original record.

FIXTURE.json identifies the common source, explicit client allowlist, server
adapter, result contract, case names and each compiled application's receipt.
POCKET-PYTHON.json and the retained compiler manifest provide the local asset,
source, capability and notice records. Each app uses the compiled profile's scoped
cache and waiting-update lifecycle; close its tabs/windows to activate an update.
The fixture serves only the assembled output tree, so requests for server source
and private fixture files return 404.

## HTTP and offline behavior

GET /api/metrics?case=CASE selects one declared reference case. The JSON body uses
kind=shared-text-metrics-result and schema_version=1, with case, value and error.
Successful computation has a three-integer value array and error=null. Invalid
computation input has value=null and an error object with name/message. The HTTP
statuses are respectively 200 and 400. Missing, duplicate, extra or unknown query
fields/cases fail with 400/404 before invoking the computation. There is no write
endpoint. Reference responses use Cache-Control: no-store.

The remote compiled adapter grants only the exact known local URLs and uses the
existing native Fetch text bridge. Its JSON response is displayed as text; a JSON
parser or general browser URL encoder is not silently added to the language
profile. Network errors display FetchError and close that worker session; Restart
after reconnecting creates a new one. HTTP language-error responses remain the
explicit result contract. The local app has no Fetch grant and continues running
while the remote endpoint is unavailable. A disconnected remote request never
returns a stale successful result or silently runs on another execution target.

## Verification

```sh
uv sync --locked --group compiled-build --group browser-tests
uv run --no-sync python -m unittest discover -s tests -p test_shared_application.py -v
uv run --no-sync python -m playwright install chromium
uv run --no-sync python scripts/shared_application_smoke.py \
  --report build/shared-application-browser-report.json
```

The tests compare the CPython CLI, HTTP results and browser computations/errors;
verify common-source hashes and server-only byte exclusion; reject malformed
requests; observe only declared local GET reference calls; reload/rerun the local
app offline; and confirm visible disconnected Fetch failure plus recovery. The
browser report records versions, exact shared source/compiler identities, reference
outcomes and the original invalid-input location. Timing and footprint comparisons
are separate measurement work.
