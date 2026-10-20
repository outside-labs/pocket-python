"""Verify compiled PWA computation, offline reload, lifecycle and scoped updates."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

from pocket_python.compiled import build_compiled


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('compiled_example', ROOT / 'examples/compiled_text_metrics.py')
EXAMPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXAMPLE)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        # Updates deliberately replace files within one timestamp second. Force
        # fresh fixture bytes; Last-Modified alone cannot distinguish them.
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        self.server.paths.append(self.path)
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(ThreadingHTTPServer):
    # Module-worker startup and precaching use concurrent connection pools.
    request_queue_size = 128


def smoke(channel):
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        client = EXAMPLE.write_client(root / 'client')
        application = root / 'nested/app'
        receipt = build_compiled(client, application, title='Text metrics')
        neighbor = build_compiled(client, root / 'neighbor', title='Neighbor')
        special = EXAMPLE.APP.replace('import on_click', 'import on_click, write_text').replace('    print(metrics(text))', '''    if text == "error":
        error = TypeError("requested error")
        raise error
    if "!" in text:
        await write_text("status", "Working")
        total = 0
        for first in text:
            for second in text:
                for third in text:
                    total = total + 1
    print(metrics(text))''')
        special_client = EXAMPLE.write_client(root / 'special-client', app=special)
        build_compiled(special_client, root / 'checks', omit_source_maps=True)
        expected = json.loads(subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', EXAMPLE.COMPUTATION + '\nimport json\nprint(json.dumps([str(metrics(text)) for text in ["", "A😀 é\\nline two", "a\\u00a0b"]]))'], text=True, encoding='utf-8', timeout=10))
        server = Server(('127.0.0.1', 0), partial(Handler, directory=str(root)))
        server.paths = []
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        checks, requests = [], []
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=channel)
                try:
                    context = browser.new_context()
                    context.on('request', lambda request: requests.append((request.method, request.url)))
                    errors, failed = [], []
                    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                    context.on('requestfailed', lambda request: failed.append((request.url, request.failure)))
                    page = context.new_page()
                    page.set_default_timeout(20000)
                    def ready(page, *, update=False):
                        try:
                            page.wait_for_function('document.getElementById("status").textContent==="Ready"', timeout=20000)
                        except Exception as error:
                            raise AssertionError({'url': page.url, 'status': page.locator('#status').inner_text(), 'offline': page.locator('#offline').inner_text(), 'visibility': page.evaluate('document.visibilityState'), 'errors': errors, 'failed': failed, 'workers': [worker.url for worker in page.workers], 'service_workers': page.evaluate('async()=>({controller:navigator.serviceWorker.controller?.state,controllerURL:navigator.serviceWorker.controller?.scriptURL,registrations:await Promise.all((await navigator.serviceWorker.getRegistrations()).map(async reg=>({scope:reg.scope,active:reg.active?.state,installing:reg.installing?.state,waiting:reg.waiting?.state,same:reg.active===navigator.serviceWorker.controller}))),caches:await caches.keys()})'), 'paths': server.paths[-35:]}) from error
                        label = 'Update ready.' if update else 'Offline ready on this device'
                        page.wait_for_function('label=>document.getElementById("offline").textContent.startsWith(label)', arg=label)
                        page.wait_for_function('navigator.serviceWorker.controller!==null')
                    def reload(page):
                        with page.expect_navigation(wait_until='load'):
                            page.evaluate('location.reload()')
                    def run(page, text, expected):
                        page.fill('#input', text)
                        page.click('#run')
                        page.wait_for_function('expected=>document.getElementById("result").textContent===expected', arg=expected)
                    page.goto(origin + '/nested/app/')
                    ready(page)
                    for text, value in zip(['', 'A😀 é\nline two', 'a\u00a0b'], expected):
                        run(page, text, value + '\n')
                    checks.append('cpython-browser-worker-computation')
                    context.set_offline(True)
                    reload(page); ready(page)
                    run(page, 'A😀 é\nline two', expected[1] + '\n')
                    page.click('#stop')
                    assert page.locator('#status').inner_text() == 'Stopped'
                    page.click('#restart');ready(page)
                    run(page, 'offline', '(7, 1, 1)\n')
                    context.set_offline(False)
                    checks.append('offline-reload-run-stop-restart-subdirectory')
                    sibling = context.new_page();sibling.goto(origin + '/neighbor/');ready(sibling)
                    page.evaluate("caches.open('unrelated-application-cache')")
                    checks.append('neighbor-scope-installation')
                    failure = context.new_page();failure.goto(origin + '/checks/');ready(failure)
                    failure.fill('#input', 'error');failure.click('#run')
                    failure.wait_for_function('document.getElementById("status").textContent.startsWith("TypeError: requested error (app.py:")')
                    assert failure.locator('#run').is_disabled()
                    failure.click('#restart');ready(failure)
                    run(failure, 'again', '(5, 1, 1)\n')
                    checks.append('source-errors-with-omitted-maps-and-recovery')
                    failure.fill('#input', '!' * 1024);failure.click('#run')
                    failure.wait_for_function('document.getElementById("status").textContent==="Working"')
                    failure.click('#stop')
                    assert failure.locator('#status').inner_text() == 'Stopped'
                    failure.click('#restart');ready(failure)
                    run(failure, 'restarted', '(9, 1, 1)\n')
                    checks.append('busy-worker-termination-and-fresh-restart')
                    second = context.new_page();second.goto(origin + '/nested/app/');ready(second)
                    updated_client = EXAMPLE.write_client(root / 'updated-client', app=EXAMPLE.APP.replace('print(metrics(text))', 'print("updated", metrics(text))'))
                    updated_root = root / 'updated'
                    updated = build_compiled(updated_client, updated_root, title='Updated metrics')
                    assert receipt['cache_version'] != updated['cache_version']
                    for path in updated_root.rglob('*'):
                        if path.is_file():
                            target = application / path.relative_to(updated_root)
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copyfile(path, target)
                    old_key = 'pocket-python:' + origin + '/nested/app/:' + receipt['cache_version']
                    new_key = 'pocket-python:' + origin + '/nested/app/:' + updated['cache_version']
                    page.evaluate('async()=>{await(await navigator.serviceWorker.getRegistration()).update()}')
                    page.wait_for_function('async()=>{const reg=await navigator.serviceWorker.getRegistration();return reg.waiting?.state==="installed"&&reg.active===navigator.serviceWorker.controller}')
                    page.wait_for_function('document.getElementById("offline").textContent.startsWith("Update ready.")')
                    page.wait_for_function('async keys=>{const all=await caches.keys();return all.includes(keys[0])&&all.includes(keys[1])}', arg=[old_key, new_key])
                    keys = page.evaluate('caches.keys()')
                    assert 'unrelated-application-cache' in keys
                    assert 'pocket-python:' + origin + '/neighbor/:' + neighbor['cache_version'] in keys
                    context.set_offline(True)
                    run(page, 'still current', '(13, 2, 1)\n')
                    page.close()
                    assert second.evaluate('async()=>{const reg=await navigator.serviceWorker.getRegistration();return reg.waiting?.state==="installed"&&reg.active===navigator.serviceWorker.controller}')
                    reload(second);ready(second, update=True)
                    assert second.title() == 'Text metrics'
                    run(second, 'second tab', '(10, 2, 1)\n')
                    second.close()
                    sibling.wait_for_function('async scope=>{const reg=await navigator.serviceWorker.getRegistration(scope);return reg.active?.state==="activated"&&!reg.waiting&&!reg.installing}', arg=origin + '/nested/app/')
                    sibling.wait_for_function('async keys=>{const all=await caches.keys();return all.includes(keys[1])&&!all.includes(keys[0])}', arg=[old_key, new_key])
                    context.set_offline(False)
                    page = context.new_page();page.set_default_timeout(20000)
                    page.goto(origin + '/nested/app/');ready(page)
                    assert page.title() == 'Updated metrics'
                    run(page, 'fresh', 'updated (5, 1, 1)\n')
                    context.set_offline(True)
                    reload(page);ready(page);run(page, 'fresh', 'updated (5, 1, 1)\n')
                    assert page.title() == 'Updated metrics'
                    context.set_offline(False)
                    checks.append('waiting-update-retains-live-tabs-then-activates-offline')
                    checks.append('scoped-cache-cleanup-and-offline-updated-reload')
                    assert all(method == 'GET' and url.startswith(origin + '/') for method, url in requests), requests
                    assert not any('micropython' in url.lower() or 'pyodide' in url.lower() or url.split('?')[0].endswith('.wasm') for _, url in requests)
                    checks.append('local-assets-only-no-interpreter-or-server-execution')
                    return {'schema_version': 1, 'browser': browser.version, 'profile': 'compiled-javascript/1', 'engine': None,
                            'checks': checks, 'artifact_bytes': receipt['size']['artifact_bytes'], 'cache_version': receipt['cache_version']}
                finally:
                    browser.close()
        finally:
            server.shutdown();server.server_close();thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = smoke(args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
