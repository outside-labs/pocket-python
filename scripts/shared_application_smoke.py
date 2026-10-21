"""Verify shared CPython/server/browser logic and explicit offline boundaries."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Thread
from urllib.error import HTTPError
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from examples.shared_text_metrics import __main__ as shared


def smoke(channel=None):
    reference = json.loads(subprocess.check_output([sys.executable,'-m','examples.shared_text_metrics','--json'],cwd=ROOT,text=True,encoding='utf-8',timeout=10))
    expected = {item['case']:item for item in reference['cases']}
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)/'application'
        server = shared.make_server(root)
        origin = f'http://127.0.0.1:{server.server_port}'
        fixture = shared.build_fixture(root,origin)
        source_hash = hashlib.sha256(shared.computation_bytes()).hexdigest()
        assert source_hash == fixture['computation']['sha256'] == reference['computation_sha256']
        for name in ['local','error']:
            receipt = json.loads((root/name/'POCKET-PYTHON.json').read_bytes())
            source = next(item for item in receipt['sources'] if item['path']=='text_metrics.py')
            assert source['sha256']==source_hash
        for path in root.rglob('*'):
            if path.is_file():
                data = path.read_bytes()
                assert not any(marker in data for marker in [shared.SERVER_ONLY_CANARY.encode(),b'def reference_case(',b'SERVER_ONLY_CANARY'])
        thread = Thread(target=server.serve_forever,daemon=True);thread.start()
        checks = ['identical-shared-source-and-client-only-asset-closure']
        requests, errors = [], []
        try:
            for path in ['/__main__.py','/server_only.py','/private.json','/computation.py']:
                try:
                    with urlopen(origin+path,timeout=5):
                        raise AssertionError('Server source/data was served: '+path)
                except HTTPError as error:
                    assert error.code==404
                    error.close()
            checks.append('server-source-and-synthetic-record-not-served-or-bundled')
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=channel)
                try:
                    context = browser.new_context()
                    context.on('request',lambda request:requests.append((request.method,request.url)))
                    context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
                    def ready(page):
                        page.wait_for_function('document.getElementById("status").textContent==="Ready"')
                        page.wait_for_function('document.getElementById("offline").textContent==="Offline ready on this device"')
                        page.wait_for_function('navigator.serviceWorker.controller!==null')
                    def opened(path):
                        page = context.new_page();page.set_default_timeout(20000)
                        page.goto(origin+path);ready(page)
                        return page
                    def run(page,text,result):
                        page.fill('#input',text);page.click('#run')
                        page.wait_for_function('expected=>document.getElementById("result").textContent===expected',arg=result)
                    local = opened('/local/')
                    for name,value in shared.CASES.items():
                        if name in {'server-only','type-error'}:
                            continue
                        run(local,value,str(tuple(expected[name]['value']))+'\n')
                    assert not server.api_calls
                    checks.append('cpython-cli-and-local-worker-parity-without-api-calls')
                    invalid = opened('/error/')
                    invalid.fill('#input','ignored');invalid.click('#run')
                    error = expected['type-error']['error']
                    prefix = error['name']+': '+error['message']+' (text_metrics.py:'
                    invalid.wait_for_function('prefix=>document.getElementById("status").textContent.startsWith(prefix)',arg=prefix)
                    assert invalid.locator('#run').is_disabled()
                    error_location = invalid.locator('#status').inner_text()
                    checks.append('matching-language-error-with-original-source-location')
                    remote = opened('/remote/')
                    for name in shared.CASES:
                        remote.fill('#input',name);remote.click('#run')
                        remote.wait_for_function('document.getElementById("result").textContent.endsWith("\\n")')
                        assert json.loads(remote.locator('#result').inner_text())==expected[name]
                    assert server.api_calls==list(shared.CASES)
                    checks.append('declared-browser-fetch-to-stdlib-cpython-reference')
                    context.set_offline(True)
                    local.reload();ready(local)
                    run(local,shared.CASES['unicode'],str(tuple(expected['unicode']['value']))+'\n')
                    checks.append('local-computation-reloads-and-reruns-offline')
                    remote.reload();ready(remote)
                    count = len(server.api_calls)
                    remote.fill('#input','simple');remote.click('#run')
                    remote.wait_for_function('document.getElementById("status").textContent.startsWith("FetchError: Fetch failed.")')
                    assert remote.locator('#result').inner_text()==''
                    assert remote.locator('#run').is_disabled()
                    assert len(server.api_calls)==count
                    run(local,'offline still works','(19, 3, 1)\n')
                    checks.append('offline-network-failure-is-visible-without-local-fallback')
                    context.set_offline(False)
                    remote.click('#restart');ready(remote)
                    remote.fill('#input','simple');remote.click('#run')
                    remote.wait_for_function('document.getElementById("result").textContent.endsWith("\\n")')
                    assert json.loads(remote.locator('#result').inner_text())==expected['simple']
                    checks.append('network-session-restarts-after-reconnection')
                    assert not errors,errors
                    assert all(method=='GET' and url.startswith(origin+'/') for method,url in requests),requests
                    api_urls = {url for _,url in requests if '/api/' in url}
                    assert api_urls=={shared.endpoint(origin,name) for name in shared.CASES}
                    assert not any('micropython' in url.lower() or 'pyodide' in url.lower() or url.split('?')[0].endswith('.wasm') for _,url in requests)
                    checks.append('explicit-same-origin-get-network-contract')
                    return {'kind':'pocket-python-shared-application','schema_version':1,'python':reference['python'],
                            'browser':browser.version,'computation_sha256':source_hash,'source_hash_policy':'utf-8-canonical-lf',
                            'compiler_source_fingerprint':fixture['applications']['local']['compiler_source_fingerprint'],
                            'http_contract':fixture['http_contract'],'reference_cases':reference['cases'],
                            'local_error':error_location,'checks':checks}
                finally:
                    browser.close()
        finally:
            server.shutdown();server.server_close();thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel')
    parser.add_argument('--report',type=Path)
    args = parser.parse_args()
    report = smoke(args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':
    main()
