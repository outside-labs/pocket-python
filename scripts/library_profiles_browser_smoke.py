"""Verify selected and reduced library console artifacts, including offline removal."""

import argparse
from functools import partial
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

from interpreter_browser_smoke import EXAMPLE, Handler, Server
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]


def smoke(channel=None):
    checks, common = [], []
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        source = EXAMPLE.write_source(root / 'input')
        core_engine = read_interpreter(ROOT / 'runtime')
        full_engine = read_interpreter(ROOT / 'runtime', library_profile='operator/1')
        core = build_interpreter(source, core_engine, root / 'site/core', title='Core library profile')
        full = build_interpreter(source, full_engine, root / 'site/nested/full', title='Operator library profile')
        reduced = build_interpreter(source, core_engine, root / 'reduced', title='Reduced library profile')
        bad = build_interpreter(source, full_engine, root / 'site/bad', title='Changed library')
        (root / 'site/bad' / bad['libraries'][0]['source']['path']).write_bytes(b'changed library source')
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
                    context = browser.new_context()
                    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                    context.on('request', lambda request: requests.append((request.method, request.url)))

                    def ready(page):
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Ready'")
                        page.wait_for_function("()=>document.querySelector('#offline').textContent==='Offline ready on this device'")
                        page.wait_for_function('()=>navigator.serviceWorker.controller!==null')

                    def run(page, source, expected):
                        page.fill('#input', source)
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Completed'")
                        assert page.locator('#result').inner_text() == expected

                    def refused(page, source, prefix):
                        page.fill('#input', source)
                        page.click('#run')
                        page.wait_for_function("prefix=>document.querySelector('#status').textContent.startsWith(prefix)", arg=prefix)

                    core_page, full_page = context.new_page(), context.new_page()
                    core_page.goto(origin + '/core/')
                    full_page.goto(origin + '/nested/full/')
                    ready(core_page)
                    ready(full_page)
                    assert 'core-only/1' in core_page.locator('#libraries').inner_text()
                    assert 'operator/1' in full_page.locator('#libraries').inner_text()
                    for text in ['', 'A😀 é\nline two', 'a\u00a0b']:
                        program = EXAMPLE.COMPUTATION + '\nvalue=metrics(' + repr(text) + ')\nprint(value[0],value[1],value[2])\n'
                        expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', program], text=True, encoding='utf-8', timeout=5)
                        for page in [core_page, full_page]:
                            run(page, program, expected)
                        common.append({'source_sha256': hashlib.sha256(program.encode()).hexdigest(), 'stdout': expected, 'status': 'pass'})
                    checks.append('full-reduced-cpython-source-equivalence')
                    refused(core_page, 'import operator', 'ImportError:')
                    run(full_page, 'import operator\nprint(operator.add(9007199254740993,1))', '9007199254740994\n')
                    refused(full_page, 'import operator\noperator.floordiv(1,0)', 'ZeroDivisionError:')
                    assert 'sources/operator.py:' in full_page.locator('#status').inner_text()
                    assert 'sources/operator.py:' in full_page.locator('#diagnostic').inner_text()
                    refused(full_page, 'import browser', 'ImportError:')
                    checks.append('selected-library-import-diagnostics-and-unchanged-host-authority')
                    context.set_offline(True)
                    full_page.reload()
                    ready(full_page)
                    run(full_page, 'from operator import mul\nprint(mul(6,7))', '42\n')
                    full_page.click('#stop')
                    full_page.click('#restart')
                    ready(full_page)
                    run(full_page, 'import operator\nprint(operator.getitem([3,8],1))', '8\n')
                    checks.append('selected-library-offline-reload-stop-and-restart')
                    context.set_offline(False)
                    damaged = context.new_page()
                    damaged.goto(origin + '/bad/')
                    damaged.wait_for_function("()=>document.querySelector('#status').textContent.includes('Application asset hash differs:')")
                    damaged.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Offline unavailable:')")
                    assert len(damaged.workers) == 0
                    damaged.close()
                    checks.append('changed-library-refused-before-worker-ready-and-cache-install')
                    shutil.rmtree(root / 'site/nested/full')
                    shutil.copytree(root / 'reduced', root / 'site/nested/full')
                    full_page.evaluate('async()=>{await(await navigator.serviceWorker.getRegistration()).update()}')
                    full_page.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Update ready.')")
                    run(full_page, 'import operator\nprint(operator.add(1,2))', '3\n')
                    full_page.close()
                    old_cache = 'pocket-python:' + origin + '/nested/full/:' + full['cache_version']
                    new_cache = 'pocket-python:' + origin + '/nested/full/:' + reduced['cache_version']
                    core_page.wait_for_function('''async({oldCache,newCache})=>{
                      const keys=await caches.keys();return !keys.includes(oldCache)&&keys.includes(newCache);
                    }''', arg={'oldCache': old_cache, 'newCache': new_cache})
                    context.set_offline(True)
                    full_page = context.new_page()
                    full_page.goto(origin + '/nested/full/')
                    ready(full_page)
                    assert full_page.title() == 'Reduced library profile'
                    refused(full_page, 'import operator', 'ImportError:')
                    assert full_page.evaluate("async path=>(await fetch('./'+path)).status", full['libraries'][0]['source']['path']) == 404
                    checks.append('full-to-reduced-update-removes-library-grants-and-cached-source')
                    assert not errors, errors
                    assert all(method == 'GET' and url.startswith(origin + '/') for method, url in requests)
                    version = browser.version
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    return {'schema_version': 1, 'suite': 'library-profile-console/1', 'browser': version, 'source_execution': True,
            'engine': core['engine'], 'profiles': [core['library_profile'], full['library_profile']],
            'payload_bytes': {'core': core['size'], 'operator': full['size']}, 'common_cases': common,
            'checks': [{'id': item, 'status': 'pass'} for item in checks],
            'script_sha256': hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
            'summary': {'pass': len(checks) + len(common), 'fail': 0}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path, default=Path('build/library-console-browser-report.json'))
    args = parser.parse_args()
    report = smoke(args.channel)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
