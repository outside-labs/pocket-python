"""Measure complete source-engine profiles with explicit timing and memory scopes."""

import argparse
from datetime import UTC, datetime
from functools import partial
import gzip
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
from importlib.metadata import version
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tarfile
import tempfile
from threading import Thread
import time
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from examples import interpreter_console
from examples.shared_text_metrics import __main__ as shared
from pocket_python import __version__
from pocket_python.assets import ArtifactError, check_names, file_record, json_bytes, read_asset, read_runtime
from pocket_python.bundles import read_bundle
from pocket_python.compiled import build_compiled
from pocket_python.interpreter import build_interpreter, read_interpreter
from pocket_python.web import _publish, build_web
from _measurement_browser import worker_heap

BUCKETS = ['engine_bytes', 'bridge_bytes', 'library_bytes', 'application_source_bytes',
           'generated_module_bytes', 'helper_bytes', 'source_map_bytes', 'notice_bytes',
           'data_bytes', 'assembly_module_bytes', 'receipt_bytes']
BRIDGES = {'interpreter-host.mjs', 'interpreter-worker.mjs', 'browser-protocol.mjs',
           'library-selection.mjs', 'library-catalog.mjs', 'browser-host.mjs', 'browser-worker.mjs'}
INPUTS = ['', 'A😀 é\nline two', 'a\u00a0b']


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def workload():
    body = 'for text in ' + repr(tuple(INPUTS)) + ':\n    result=metrics(text)\n    print(result[0],result[1],result[2])\n'
    source = shared.computation_bytes().decode('utf-8') + '\n' + body
    expected = ''.join(' '.join(map(str, shared.metrics(text))) + '\n' for text in INPUTS)
    actual = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', source], text=True, encoding='utf-8', timeout=5)
    if actual != expected:
        raise AssertionError('The shared source program differs from its reference computation.')
    return {'inputs': INPUTS, 'source': source, 'body': body, 'expected_stdout': expected,
            'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
            'computation_sha256': hashlib.sha256(shared.computation_bytes()).hexdigest()}


def payload(directory, receipt):
    directory = Path(directory)
    records = receipt['files']
    names = [item['path'] for item in records] + ['POCKET-PYTHON.json']
    check_names(names)
    if set(names) != {path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file()}:
        raise ArtifactError('Measured payload has unrecorded or missing files.')
    data = read_asset(directory, 'POCKET-PYTHON.json', max_bytes=1048576)
    if json.loads(data) != receipt:
        raise ArtifactError('Measured receipt differs from its snapshot.')
    files = {'POCKET-PYTHON.json': data}
    counts = {key: 0 for key in BUCKETS}
    counts['receipt_bytes'] = len(data)
    details = []
    for record in records:
        name = record['path']
        content = read_asset(directory, name, max_bytes=record['size_bytes'])
        if file_record(name, content) != {key: record[key] for key in ['path', 'sha256', 'size_bytes']}:
            raise ArtifactError('Measured file hash/size differs: ' + name)
        files[name] = content
        base = name.rsplit('/', 1)[-1]
        role = record.get('role')
        if name == 'service-worker.js' or name == receipt.get('launcher', 'app.js'):
            bucket = 'assembly_module_bytes'
        elif base in BRIDGES or name == 'worker.js':
            bucket = 'bridge_bytes'
        elif role == 'notice' or '/LICENSES/' in name or '/licenses/' in name or name.startswith('runtime/') and base in receipt['runtime']['license_files']:
            bucket = 'notice_bytes'
        elif role == 'engine' or name.startswith('runtime/'):
            bucket = 'engine_bytes'
        elif role == 'library':
            bucket = 'library_bytes'
        elif role == 'source' or name.endswith('.py'):
            bucket = 'application_source_bytes'
        elif role in {'executable-module', 'compatibility-helper', 'source-map'}:
            bucket = {'executable-module': 'generated_module_bytes', 'compatibility-helper': 'helper_bytes', 'source-map': 'source_map_bytes'}[role]
        elif role in {None, 'data'}:
            bucket = 'data_bytes'
        else:
            raise ArtifactError('Unsupported measured file role: ' + str(role))
        counts[bucket] += len(content)
        details.append({**file_record(name, content), 'bucket': bucket, 'gzip_bytes': len(gzip.compress(content, compresslevel=9, mtime=0))})
    details.append({**file_record('POCKET-PYTHON.json', data), 'bucket': 'receipt_bytes', 'gzip_bytes': len(gzip.compress(data, compresslevel=9, mtime=0))})
    counts['complete_payload_bytes'] = sum(map(len, files.values()))
    counts['gzip_file_transfer_bytes'] = sum(item['gzip_bytes'] for item in details)
    if sum(counts[key] for key in BUCKETS) != counts['complete_payload_bytes'] or counts['complete_payload_bytes'] != receipt['size']['artifact_bytes']:
        raise ArtifactError('Measured payload buckets differ from the complete receipt size.')
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, content in sorted(files.items()):
            item = tarfile.TarInfo(name)
            item.size, item.mode, item.mtime = len(content), 0o644, 0
            archive.addfile(item, io.BytesIO(content))
    compressed = gzip.compress(stream.getvalue(), compresslevel=9, mtime=0)
    counts.update(canonical_tar_bytes=len(stream.getvalue()), gzip_tar_bytes=len(compressed), gzip_tar_sha256=hashlib.sha256(compressed).hexdigest())
    return counts, sorted(details, key=lambda item: item['path']), compressed


def source_bundle(root, source):
    root.mkdir(parents=True)
    files = {'_sources/app.py': source.encode(), 'run.py': b'# Measurement source launcher\n',
             'LICENSES/source.txt': (ROOT / 'LICENSE').read_bytes().replace(b'\r\n', b'\n')}
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    record = file_record('_sources/app.py', files['_sources/app.py'])
    manifest = {'schema_version': 1, 'mode': 'modules', 'entrypoint': '_sources/app.py', 'launcher': 'run.py',
                'stdlib_modules': [], 'distributions': [], 'sources': [{'module': '__main__', 'output': '_sources/app.py',
                'sha256': record['sha256'], 'size_bytes': record['size_bytes'], 'distribution': None}],
                'files': [file_record(name, data) for name, data in sorted(files.items())]}
    (root / 'SHIMIFY-MANIFEST.json').write_bytes(json_bytes(manifest))
    return read_bundle(root)


def prepare(root, program, *, compiled=False, micropython=None):
    source = interpreter_console.write_source(root / 'source', source=program['source'])
    variants = []
    for name, library in [('source-core', 'core-only/1'), ('source-operator', 'operator/1')]:
        destination = root / 'site' / name
        before = time.perf_counter_ns()
        receipt = build_interpreter(source, read_interpreter(ROOT / 'runtime', library_profile=library), destination, title='Shared source computation')
        variants.append({'id': name, 'mode': 'source', 'library_profile': library, 'receipt': receipt, 'directory': destination,
                         'build_ns': time.perf_counter_ns() - before})
    if compiled:
        app = 'from JavaScript.browser import on_click\nfrom text_metrics import metrics\nasync def display(unused):\n'
        app += ''.join('    ' + line + '\n' for line in program['body'].splitlines())
        app += 'async def main():\n    await on_click("run", display)\n'
        client = shared.client_sources(root / 'compiled-source', app)
        destination = root / 'site/compiled'
        before = time.perf_counter_ns()
        receipt = build_compiled(client, destination, title='Shared compiled computation', omit_source_maps=True)
        variants.append({'id': 'compiled', 'mode': 'compiled', 'receipt': receipt, 'directory': destination, 'build_ns': time.perf_counter_ns() - before})
    if micropython is not None:
        runtime = read_runtime(micropython, Path(micropython) / 'runtime-lock.json')
        bundle = source_bundle(root / 'micropython-source', program['source'])
        destination = root / 'site/micropython'
        before = time.perf_counter_ns()
        receipt = build_web(bundle, runtime, destination, title='Shared MicroPython computation')
        variants.append({'id': 'micropython', 'mode': 'micropython', 'receipt': receipt, 'directory': destination, 'build_ns': time.perf_counter_ns() - before})
    return variants


PROBE = r'''({mode,expected})=>{
  window.profileSample={ready_ms:null,offline_ms:null,workers_created:0,live_workers:0};
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
    constructor(...args){super(...args);window.profileSample.workers_created++;window.profileSample.live_workers++;this.counted=true;}
    terminate(){if(this.counted){window.profileSample.live_workers--;this.counted=false;}super.terminate();}
  };
  const output=()=>document.getElementById(mode==='micropython'?'output':'result');
  const readyStatus=mode==='micropython'?'Finished':'Ready';
  const scan=()=>{
    if(window.profileSample.ready_ms===null&&document.getElementById('status')?.textContent===readyStatus&&
       (mode!=='micropython'||output()?.textContent===expected))window.profileSample.ready_ms=performance.now();
    if(window.profileSample.offline_ms===null&&document.getElementById('offline')?.textContent==='Offline ready on this device')window.profileSample.offline_ms=performance.now();
  };
  new MutationObserver(scan).observe(document,{subtree:true,childList:true,characterData:true});
  window.runProfileSample=source=>new Promise((resolve,reject)=>{
    const begin=performance.now();let first=null;
    const watch=new MutationObserver(()=>{
      if(output().textContent===expected&&first===null)first=performance.now()-begin;
      const complete=mode==='source'?document.getElementById('status').textContent==='Completed':
        mode==='micropython'?document.getElementById('status').textContent==='Finished':true;
      if(first!==null&&complete&&!document.getElementById('run').disabled){
        clearTimeout(timer);watch.disconnect();resolve({output_ms:first,completed_ms:performance.now()-begin,
          stdout:output().textContent,workers_created:window.profileSample.workers_created,live_workers:window.profileSample.live_workers});
      }
    });
    const timer=setTimeout(()=>{watch.disconnect();reject(new Error('Measured corpus output timed out: '+document.getElementById('status').textContent));},10000);
    watch.observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
    if(mode==='source')document.getElementById('input').value=source;
    document.getElementById('run').click();
  });
}'''


def browser_observations(root, rows, program, repeats, channel):
    from playwright.sync_api import sync_playwright
    server = Server(('127.0.0.1', 0), partial(Handler, directory=str(root / 'site')))
    server.paths = []
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    errors, requests = [], []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=channel)
            try:
                for row in rows:
                    def context():
                        current = browser.new_context()
                        current.on('request', lambda request: requests.append((request.method, request.url)))
                        current.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                        current.add_init_script('(' + PROBE + ')(' + json.dumps({'mode': row['mode'], 'expected': program['expected_stdout']}) + ')')
                        return current

                    def ready(page):
                        page.wait_for_function("()=>window.profileSample?.ready_ms!==null&&window.profileSample?.offline_ms!==null")
                        page.wait_for_function('()=>navigator.serviceWorker.controller!==null')
                        value = page.evaluate('()=>window.profileSample')
                        for key in ['ready_ms', 'offline_ms']:
                            if type(value[key]) not in (int, float) or not math.isfinite(value[key]) or value[key] < 0:
                                raise AssertionError('Missing/nonfinite browser observation.')
                        return value

                    def sample(page):
                        observed = ready(page)
                        observed['workload'] = page.evaluate('source=>window.runProfileSample(source)', program['source'])
                        return observed

                    cold, warm, heaps = [], [], []
                    url = origin + '/' + row['id'] + '/'
                    for _ in range(repeats):
                        with context() as current:
                            page = current.new_page()
                            page.goto(url)
                            cold.append(sample(page))
                    with context() as current:
                        page = current.new_page()
                        page.goto(url)
                        sample(page)
                        for _ in range(repeats):
                            page.reload()
                            warm.append(sample(page))
                        current.set_offline(True)
                        page.reload()
                        sample(page)
                    if row['mode'] != 'micropython':
                        for _ in range(repeats):
                            with context() as current:
                                page = current.new_page()
                                page.goto(url)
                                ready(page)
                                before = worker_heap(browser, page)
                                observation = page.evaluate('source=>window.runProfileSample(source)', program['source'])
                                after = worker_heap(browser, page)
                                heaps.append({'after_ready': before, 'after_corpus_output': after, 'stdout': observation['stdout']})
                    row['browser'] = {'cold_context_samples': cold, 'installed_warm_samples': warm, 'worker_heap_samples': heaps,
                        'median_cold_ready_ms': statistics.median(item['ready_ms'] for item in cold),
                        'median_warm_ready_ms': statistics.median(item['ready_ms'] for item in warm),
                        'median_warm_output_ms': statistics.median(item['workload']['output_ms'] for item in warm),
                        'startup_boundary': 'navigation-to-auto-run-Finished (includes engine and corpus)' if row['mode'] == 'micropython' else 'navigation-to-worker/application-Ready (before corpus)',
                        'run_boundary': 'click-to-observed-corpus-stdout; source waits for terminal completion before the next sample',
                        'worker_memory_status': 'unavailable: schema-1 shell terminates its worker at completion' if row['mode'] == 'micropython' else 'observed after forced GC in separate untimed contexts',
                        'offline_reload_and_corpus': 'pass'}
                if errors or not all(method == 'GET' and url.startswith(origin + '/') for method, url in requests):
                    raise AssertionError(('Nonlocal/nonstatic request or unhandled browser error', errors))
                return {'version': browser.version, 'channel': channel, 'playwright': version('playwright'), 'requests': 'local-static-GET-only',
                        'memory_api': 'CDP HeapProfiler.collectGarbage then Runtime.getHeapUsage for the dedicated worker'}
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def node_observations(program, profile, repeats):
    catalog = read_interpreter(ROOT / 'runtime', library_profile=profile)
    files = dict(catalog.files)
    libraries = [] if profile == 'core-only/1' else [{'name': 'operator', 'package': False, 'imports': [],
        'source': files['library/operator.py'].decode(), 'notice': files['licenses/POCKET-PYTHON.txt'].decode()}]
    timing, memory = [], []
    for mode, observations in [('timing', timing), ('memory', memory)]:
        for _ in range(repeats):
            request = {'mode': mode, 'source': program['source'], 'profile': profile, 'libraries': libraries,
                       'expected_stdout': program['expected_stdout'], 'repeats': repeats}
            before = time.perf_counter_ns()
            data = subprocess.check_output(['node', *(['--expose-gc'] if mode == 'memory' else []),
                str(ROOT / 'runtime/measure-profiles.mjs')], input=json.dumps(request), text=True, encoding='utf-8', timeout=30)
            observation = json.loads(data)
            observation['subprocess_wall_ns'] = time.perf_counter_ns() - before
            observations.append(observation)
    return {'timing_process_samples': timing, 'memory_process_samples': memory,
            'median_import_ms': statistics.median(item['import_ms'] for item in timing),
            'median_cold_run_ms': statistics.median(item['cold']['total_ms'] for item in timing),
            'median_warm_run_ms': statistics.median(statistics.median(run['total_ms'] for run in item['warm']) for item in timing),
            'max_accounted_live_bytes': max(item['observation']['logical']['peakBytes'] for item in memory)}


def measure(output, *, repeats=3, compiled=False, micropython=None, browser=True, channel=None):
    if type(repeats) is not int or not 3 <= repeats <= 31:
        raise ValueError('Use 3–31 samples per condition.')
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Choose a new measurement output directory.')
    program = workload()
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        variants = prepare(root, program, compiled=compiled, micropython=micropython)
        rows, archives = [], {}
        for variant in variants:
            receipt = variant['receipt']
            sizes, records, compressed = payload(variant['directory'], receipt)
            row = {'id': variant['id'], 'mode': variant['mode'], 'profile': receipt.get('profile', 'micropython') + '/1',
                   'engine': receipt.get('engine', receipt.get('runtime')), 'library_profile': receipt.get('library_profile'),
                   'host_profile': receipt.get('host_profile'), 'producer': receipt.get('producer'), 'capabilities': receipt.get('capabilities'),
                   'source_execution': variant['mode'] != 'compiled', 'accepts_new_source_in_this_ui': variant['mode'] == 'source',
                   'sizes': sizes, 'files': records, 'build_ns': variant['build_ns'], 'browser': None, 'node': None}
            if variant['mode'] == 'source':
                row['node'] = node_observations(program, variant['library_profile'], repeats)
            rows.append(row)
            archives[variant['id'] + '.tar.gz'] = compressed
        browser_info = browser_observations(root, rows, program, repeats, channel) if browser else None
        scripts = ['scripts/interpreter_measurements.py', 'scripts/_measurement_browser.py', 'runtime/measure-profiles.mjs',
                   'runtime/library-profiles.mjs', 'runtime/library-selection.mjs', 'runtime/library-catalog.mjs']
        report = {'kind': 'pocket-python-interpreter-measurements', 'schema_version': 1, 'suite': 'interpreter-profiles/1',
                  'collected_at_utc': datetime.now(UTC).isoformat(), 'repository_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  'working_tree_modified': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)),
                  'pocket_python': __version__, 'python': platform.python_version(), 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
                  'host': {'system': platform.system(), 'release': platform.release(), 'machine': platform.machine(), 'processor': platform.processor()},
                  'browser': browser_info, 'samples_per_condition': repeats, 'workload': program,
                  'scripts_sha256': {name: hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() for name in scripts},
                  'compression': {'files': 'independent gzip level9 mtime0; payload bytes only, no HTTP/TLS framing', 'archive': 'canonical sorted USTAR mode0644 mtime0 then gzip level9 mtime0', 'zlib': zlib.ZLIB_RUNTIME_VERSION},
                  'methods': {'browser_cold': 'Fresh context per sample; same browser process and uncontrolled OS caches. DOM mutation observation from navigation; profile-specific startup boundaries are recorded.',
                              'browser_warm': 'Installed same-version service-worker cache; untimed warm-up then reload/run observations. Offline reload/output verified separately.',
                              'browser_memory': 'Dedicated-worker CDP V8 heap/embedder/backing storage bytes after forced GC, in separate untimed contexts. Excludes page, service worker, cache, process RSS, peak allocations and unreported native/Wasm memory. No transport quiescence is asserted for the compiled adapter.',
                              'node_timing': 'Fresh process per sample: engine module import, first compile/registry/run and repeated runs with fresh registries/arenas. Includes library verification in each compilation. Warm summary is the median of per-process medians; nested runs are not independent processes. No forced GC in timing processes.',
                              'node_memory': 'Separate --expose-gc processes: process.memoryUsage bytes after forced GC at imported baseline, compiled registry, completed live session and teardown. Arena peakBytes accounts logical VM/registry allocations, excluding parser/host/V8 RSS. No peak RSS claim.',
                              'comparison': 'Same canonical computation, three inputs and stdout. Adapters, source compilation, worker reuse and startup boundaries differ; no universal startup/memory ranking. Full/reduced source rows retain the same engine; only explicit library/data/metadata selection differs.'},
                  'profiles': rows, 'unavailable_profiles': [
                      {'id': 'compiled', 'reason': 'Pass --compiled with the declared pinned compiler tooling.'}] if not compiled else []}
        if micropython is None:
            report['unavailable_profiles'].append({'id': 'micropython', 'reason': 'Supply an explicit verified runtime directory with --micropython-runtime.'})
        report['unavailable_profiles'] += [{'id': 'wasm-vm', 'gate': 'INT-WASM-03'}, {'id': 'async-host-modules', 'gate': 'INT-10'}]
        _publish(output, {'report.json': json_bytes(report), **archives})
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--compiled', action='store_true')
    parser.add_argument('--micropython-runtime', type=Path)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--channel')
    args = parser.parse_args()
    report = measure(args.output, repeats=args.repeats, compiled=args.compiled, micropython=args.micropython_runtime,
                     browser=not args.no_browser, channel=args.channel)
    print(json.dumps({'profiles': [row['id'] for row in report['profiles']], 'browser': report['browser']}))
