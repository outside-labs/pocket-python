"""Report complete compiled PWA costs without inventing interpreter comparisons."""

import argparse
from datetime import UTC, datetime
from functools import partial
import gzip
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
import io
import json
import math
import os
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
sys.path.insert(0,str(ROOT))
from examples.shared_text_metrics import __main__ as shared
from pocket_python import __version__
from pocket_python.assets import ArtifactError, check_names, file_record, json_bytes, read_asset
from pocket_python.compiled import build_compiled, compile_client
from pocket_python.web import _publish
from _measurement_browser import PAGE_OBSERVER, ready, worker_heap


BUCKETS = ['application_source_bytes','generated_module_bytes','helper_bytes','interpreter_asset_bytes','source_map_bytes',
           'notice_bytes','assembly_module_bytes','data_metadata_bytes','receipt_bytes']
WORKLOAD_INPUTS = [('empty',''),('unicode','A😀 é\nline two'),('non-ascii-space','a\u00a0b')]


def workload():
    return [{'id':name,'input':text,'expected_stdout':str(shared.metrics(text))+'\n'} for name,text in WORKLOAD_INPUTS]


def installed_compiler_hashes():
    import JavaScript
    root = Path(JavaScript.__file__).parent
    return {path.relative_to(root).as_posix():hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
            for path in sorted(root.rglob('*')) if path.is_file() and path.suffix in {'.py','.mjs'}}


def read_component_report(path):
    path = Path(path).absolute()
    data = read_asset(path.parent,path.name,max_bytes=2_097_152)
    def invalid_constant(value):
        raise ValueError('Nonfinite measurement value: '+value)
    report = json.loads(data,parse_constant=invalid_constant)
    if (not isinstance(report,dict) or report.get('kind')!='python-javascript-compiler-measurements'
            or type(report.get('schema_version')) is not int or report['schema_version']!=1
            or report.get('suite')!='compiler-footprint/1'):
        raise ValueError('Unsupported compiler component report schema.')
    if report.get('compiler_source_sha256')!=installed_compiler_hashes():
        raise ValueError('Component report describes a different installed compiler source build.')
    conformance = report.get('helper_conformance',{})
    if conformance.get('node')!='pass' or conformance.get('browser')!='pass':
        raise ValueError('Component report requires passing Node and browser reference observations.')
    browser = report.get('browser')
    if not isinstance(browser,dict) or any(not isinstance(browser.get(key),str) or not browser[key] for key in ['version','playwright_version']):
        raise ValueError('Component report must identify its browser and tooling versions.')
    rows = [row for row in report.get('applications',[]) if row.get('fixture')=='text-metrics']
    expected = {'required-maps','required-no-maps','all-profile-maps','all-profile-no-maps'}
    if len(rows)!=4 or {row.get('variant') for row in rows}!=expected:
        raise ValueError('Component report lacks the adopted shared-computation variants.')
    source_hash = hashlib.sha256(shared.computation_bytes()).hexdigest()
    for row in rows:
        sources = [source for source in row.get('sources',[]) if source.get('path')=='text_metrics.py']
        if len(sources)!=1 or sources[0].get('sha256')!=source_hash:
            raise ValueError('Component report describes a different shared computation.')
        if row.get('language_profile')!='python-browser-modules/1':
            raise ValueError('Unsupported component comparison profile.')
        counts = row.get('sizes',{})
        if any(type(counts.get(key)) is not int or counts[key]<0 for key in ['input_source_bytes','complete_payload_bytes','gzip_file_transfer_bytes']):
            raise ValueError('Component size metrics must be nonnegative integer bytes.')
        if not row.get('browser'):
            raise ValueError('Component browser measurements are absent.')
    return report, data


def payload(root, receipt):
    """Account only a fresh builder-owned artifact, verifying every file byte."""
    root = Path(root)
    records = receipt['files']
    paths = [record['path'] for record in records]+['POCKET-PYTHON.json']
    check_names(paths)
    actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()}
    if set(paths)!=actual:
        raise ArtifactError('Application payload contains undeclared or missing files.')
    receipt_data = read_asset(root,'POCKET-PYTHON.json',max_bytes=1_048_576)
    if json.loads(receipt_data)!=receipt:
        raise ArtifactError('Application receipt snapshot changed.')
    counts = {key:0 for key in BUCKETS}
    files, file_records = {}, []
    roles = {'executable-module':'generated_module_bytes','compatibility-helper':'helper_bytes',
             'source-map':'source_map_bytes','notice':'notice_bytes','data':'data_metadata_bytes'}
    for record in records:
        path = record['path']
        data = read_asset(root,path,max_bytes=record['size_bytes'])
        if file_record(path,data)!={key:record[key] for key in ['path','size_bytes','sha256']}:
            raise ArtifactError('Application file differs from its receipt: '+path)
        if record['role'] not in roles:
            raise ArtifactError('Unsupported application payload role.')
        role = 'assembly_module_bytes' if path in {receipt['launcher'],'service-worker.js'} else roles[record['role']]
        counts[role] += len(data)
        files[path] = data
        file_records.append({**file_record(path,data),'bucket':role,'gzip_bytes':len(gzip.compress(data,compresslevel=9,mtime=0))})
    files['POCKET-PYTHON.json'] = receipt_data
    counts['receipt_bytes'] = len(receipt_data)
    file_records.append({**file_record('POCKET-PYTHON.json',receipt_data),'bucket':'receipt_bytes',
                         'gzip_bytes':len(gzip.compress(receipt_data,compresslevel=9,mtime=0))})
    counts.update(input_source_bytes=sum(source['size'] for source in receipt['sources']),
                  complete_payload_bytes=sum(len(data) for data in files.values()),
                  gzip_file_transfer_bytes=sum(record['gzip_bytes'] for record in file_records))
    if (counts['complete_payload_bytes']!=receipt['size']['artifact_bytes']
            or sum(counts[key] for key in BUCKETS)!=counts['complete_payload_bytes']):
        raise ArtifactError('Application payload size accounting differs from its receipt.')
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as archive:
        for name,data in sorted(files.items()):
            item = tarfile.TarInfo(name)
            item.size=len(data);item.mode=0o644;item.mtime=0
            archive.addfile(item,io.BytesIO(data))
    compressed = gzip.compress(stream.getvalue(),compresslevel=9,mtime=0)
    counts.update(canonical_tar_bytes=len(stream.getvalue()),gzip_tar_bytes=len(compressed),
                  gzip_tar_sha256=hashlib.sha256(compressed).hexdigest())
    return counts,sorted(file_records,key=lambda item:item['path']),compressed


def prepare(root, repeats):
    client = shared.client_sources(root/'inputs',shared.LOCAL_APP)
    compile_client(client)  # Warm compiler imports and the Unicode repr table.
    rows = []
    for name,omit in [('compiled-maps',False),('compiled-no-maps',True)]:
        samples,original = [],None
        for index in range(repeats):
            destination = root/'site'/name if index==0 else root/'build-samples'/name/str(index)
            before = time.perf_counter_ns()
            receipt = build_compiled(client,destination,title='Text metrics',omit_source_maps=omit)
            samples.append(time.perf_counter_ns()-before)
            if original is not None and original!=receipt:
                raise AssertionError('Application build changed between samples.')
            original = receipt
        directory = root/'site'/name
        counts,records,compressed = payload(directory,original)
        row = {'id':name,'status':'measured','profile':'compiled-javascript/1','engine':None,
               'source_map':not omit,'source_execution':'ahead-of-time','new_source_after_deployment':False,
               'ui_profile':'text-input/1','common_features':['unicode-codepoint-str','ascii-word-separators','lf-lines','integer-tuples','local-worker','dom-events','text-output','offline-reload'],
               'versions':{'pocket_python':__version__,'compiler':original['producer'],'host_protocol':'pocket-python-host/1'},
               'capabilities':original['capabilities'],'sources':original['sources'],
               'sizes':counts,'files':records,'build_ns':samples,'median_build_ns':statistics.median(samples),
               'cache_version':original['cache_version'],'browser':None}
        rows.append((row,directory,compressed))
    return rows


class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size=128


def observe(root, rows, *, repeats, channel):
    from playwright.sync_api import sync_playwright
    server = Server(('127.0.0.1',0),partial(Handler,directory=str(root/'site')))
    thread = Thread(target=server.serve_forever,daemon=True);thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    requests,errors = [],[]
    entries = workload()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=channel)
            def context(instrument=True):
                current = browser.new_context()
                current.on('request',lambda request:requests.append((request.method,request.url)))
                current.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
                if instrument:
                    current.add_init_script(PAGE_OBSERVER)
                return current
            def sample(page):
                ready(page)
                observation = page.evaluate('window.measurement')
                if any(type(value) not in (int,float) or not math.isfinite(value) or value<0 for value in observation.values()):
                    raise AssertionError('Missing/nonfinite page readiness observation.')
                observation['workload'] = page.evaluate('entries=>window.measureWorkload(entries)',entries)
                return observation
            try:
                for row,_,_ in rows:
                    url = origin+'/'+row['id']+'/'
                    cold,warm,memory = [],[],[]
                    for _ in range(repeats):
                        with context() as current:
                            page=current.new_page();page.set_default_timeout(20000);page.goto(url)
                            cold.append(sample(page))
                    with context() as current:
                        page=current.new_page();page.set_default_timeout(20000);page.goto(url);sample(page)
                        for _ in range(repeats):
                            page.reload();warm.append(sample(page))
                        current.set_offline(True);page.reload();sample(page)
                    for _ in range(repeats):
                        # Keep timing observation separate from forced-GC memory.
                        with context() as current:
                            page=current.new_page();page.set_default_timeout(20000);page.goto(url);ready(page)
                            before=worker_heap(browser,page)
                            observed=page.evaluate('entries=>window.measureWorkload(entries)',entries)
                            after=worker_heap(browser,page)
                            memory.append({'after_ready':before,'after_observed_workload':after,'workload_outputs':[item['stdout'] for item in observed]})
                    row['browser']={'cold_context_samples':cold,'installed_warm_samples':warm,'worker_heap_samples':memory,
                                    'median_cold_ready_ms':statistics.median(item['ready_ms'] for item in cold),
                                    'median_installed_warm_ready_ms':statistics.median(item['ready_ms'] for item in warm),
                                    'offline_reload_and_workload':'pass'}
                if errors:
                    raise AssertionError(('Unhandled browser errors',errors))
                if not all(method=='GET' and url.startswith(origin+'/') for method,url in requests):
                    raise AssertionError('The local application made nonlocal/nonstatic requests.')
                if any('micropython' in url.lower() or 'pyodide' in url.lower() or url.split('?')[0].endswith('.wasm') for _,url in requests):
                    raise AssertionError('An upstream interpreter entered the compiled profile.')
                return {'version':browser.version,'channel':channel,'playwright_version':version('playwright'),
                        'requests':'local-static-GET-only','worker_memory_api':'CDP Runtime.getHeapUsage after HeapProfiler.collectGarbage'}
            finally:
                browser.close()
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)


def measure(output, component_report, *, repeats=5, browser=True, channel=None):
    if type(repeats) is not int or not 3<=repeats<=31:
        raise ValueError('Use 3–31 samples per condition.')
    output=Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Choose a new measurement output directory.')
    component,component_data=read_component_report(component_report)
    with tempfile.TemporaryDirectory() as temporary:
        root=Path(temporary)
        rows=prepare(root,repeats)
        browser_info=observe(root,rows,repeats=repeats,channel=channel) if browser else None
        report={'kind':'pocket-python-application-measurements','schema_version':1,'suite':'browser-python-footprints/1',
                'collected_at_utc':datetime.now(UTC).isoformat(),'repository_revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                'working_tree_modified':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),
                'python':platform.python_version(),'host':{'system':platform.system(),'release':platform.release(),'machine':platform.machine(),'processor':platform.processor(),'logical_cpu_count':os.cpu_count()},
                'browser':browser_info,'samples_per_condition':repeats,'workload':workload(),
                'common_computation':{'name':'text_metrics.metrics','sha256':hashlib.sha256(shared.computation_bytes()).hexdigest(),'hash_policy':'utf-8-canonical-lf'},
                'scripts':{name:hashlib.sha256((ROOT/'scripts'/name).read_bytes()).hexdigest() for name in ['measure_applications.py','_measurement_browser.py']},
                'compression':{'files':'independent gzip level 9, mtime 0; HTTP/TLS framing excluded','archive':'canonical USTAR then gzip level 9, mtime 0','zlib_version':zlib.ZLIB_RUNTIME_VERSION},
                'methods':{'build':'Warm compiler; full source verification, compilation, receipt generation and filesystem publication into a new directory. Omit-maps validates the declared mapped input and recompiles without maps, matching the adopted builder option.',
                           'cold':'Fresh browser context per sample; performance.now from document navigation to observed Ready and Offline-ready mutations, then three observed text-input computations. Browser process and OS caches remain shared/uncontrolled.',
                           'warm':'One installed context, untimed warm-up, then same-version reloads with the installed service-worker cache. Offline reload/workload verified separately without ranking it as an online startup sample.',
                           'memory':'Separate fresh contexts: dedicated-worker V8 used/total heap, embedder heap and backing storage in bytes after forced GC at Ready and after observed outputs. Transport quiescence is not asserted. Excludes page/service-worker/cache/process RSS, peak memory and native/code allocations outside CDP.',
                           'comparison':'Only mapped versus omitted-map PWAs share the same UI, input workload and observation boundary. The related compiler report measures synchronous components with a different harness/startup boundary and is not directly ranked against the complete PWA.'},
                'comparison_sets':[{'id':'compiled-source-map-policy','profiles':[row['id'] for row,_,_ in rows],
                                    'same_computation':True,'same_workload':True,'same_ui_profile':True}],
                'profiles':[row for row,_,_ in rows],
                'unavailable_profiles':[{'id':'independent-javascript','status':'deferred','gate':'INT-WEB-01','reason':'The source parser and comparable browser application are not available; partial VM tests are not this workload.'},
                                        {'id':'independent-webassembly','status':'planned','gate':'INT-WASM-03','reason':'The later C/Rust WebAssembly route remains planned.'},
                                        {'id':'micropython','status':'not-measured','reason':'The existing schema-1 script shell has no equivalent adopted text-input/1 adapter; no unlike UI/workload comparison is inferred.'},
                                        {'id':'pyodide','status':'not-adopted','gate':'PYODIDE-01'}],
                'related_component_report':{'file':'compiler-component-report.json','sha256':hashlib.sha256(component_data).hexdigest(),
                                            'kind':component['kind'],'schema_version':component['schema_version'],
                                            'compiler_version':component['compiler_version'],'python':component['python'],'node':component['node'],
                                            'browser':{key:component['browser'][key] for key in ['version','playwright_version']},
                                            'host':component['host'],'methods':component['methods'],
                                            'direct_startup_or_memory_comparison':False,
                                            'shared_computation_variants':[{'id':row['variant'],'sizes':row['sizes']} for row in component['applications'] if row['fixture']=='text-metrics']}}
        files={'report.json':json_bytes(report),'compiler-component-report.json':component_data}
        files.update({row['id']+'.tar.gz':compressed for row,_,compressed in rows})
        _publish(output,files)
        return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--compiler-report',type=Path,required=True)
    parser.add_argument('--repeats',type=int,default=5)
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--channel')
    args=parser.parse_args()
    try:
        report=measure(args.output,args.compiler_report,repeats=args.repeats,browser=not args.no_browser,channel=args.channel)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({'report':str(args.output/'report.json'),'profiles':[row['id'] for row in report['profiles']],
                      'browser':report['browser'],'unavailable_profiles':[row['id'] for row in report['unavailable_profiles']]}))


if __name__=='__main__':
    main()
