"""Accept fresh composed source through an offline installed console."""

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
import pocket_python
from pocket_python.interpreter import build_interpreter, read_interpreter
from interpreter_browser_smoke import EXAMPLE, Handler, Server

ROOT = Path(__file__).resolve().parents[1]


def smoke(require_installed=False, containers=False, exceptions=False):
    package = Path(pocket_python.__file__).resolve()
    if require_installed:
        assert not package.is_relative_to(ROOT), 'This check requires an isolated installed distribution.'
    feature = 'exceptions' if exceptions else 'practical-containers' if containers else 'object-integration'
    corpus_path = ROOT / f'tests/fixtures/interpreter/{feature}.json'
    corpus = json.loads(corpus_path.read_bytes())
    example = (ROOT / ('examples/interpreter_exceptions.py' if exceptions else 'examples/interpreter_containers.py' if containers else 'examples/interpreter_object_integration.py')).read_text(encoding='utf-8')
    records = []
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        selected = build_interpreter(EXAMPLE.write_source(root / 'source', source=example),
                                     read_interpreter(ROOT / 'runtime', **({} if containers or exceptions else {'library_profile': 'operator/1'})),
                                     root / 'site/console', language_profile='classes-source/1')
        reduced = build_interpreter(EXAMPLE.write_source(root / 'reduced-source', source='print(42)\n'),
                                    read_interpreter(ROOT / 'runtime'), root / 'reduced')
        server = Server(('127.0.0.1', 0), partial(Handler, directory=str(root / 'site')))
        server.paths = []
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/console/'
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                try:
                    context = browser.new_context()
                    page = context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    def ready():
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Ready'")
                    def run(source, expected, error=None):
                        page.fill('#input', source)
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#status').textContent!=='Running…'")
                        status = page.locator('#status').inner_text()
                        assert status.startswith(error + ':') if error else status == 'Completed', (status, source)
                        assert page.locator('#result').inner_text() == expected, source
                    page.goto(url)
                    ready()
                    page.wait_for_function("()=>document.querySelector('#offline').textContent==='Offline ready on this device'")
                    context.set_offline(True)
                    page.reload()
                    ready()
                    for case in corpus['cases']:
                        if (case.get('modules') or
                            containers and case['stage'] not in {'LA-7', 'LA-6A'} or
                            exceptions and case['stage'] not in {'LA13', 'LA16'}):
                            continue
                        run(case['source'], case['stdout'], case.get('error_type'))
                        if case['id'] == 'dynamic-original-source-failure':
                            assert 'fail at composed-original.py:4' in page.locator('#diagnostic').inner_text(), page.locator('#diagnostic').inner_text()
                        if case['id'] == 'exception-dynamic-source-failure':
                            assert 'fail at exception-original.py:4' in page.locator('#diagnostic').inner_text()
                        if case['id'] == 'handler-notes-dynamic-failure':
                            assert 'fail at handler-notes-original.py:5' in page.locator('#diagnostic').inner_text()
                        records.append({'id': case['id'], 'status': 'pass'})
                    expected = subprocess.check_output([sys.executable, '-I', '-S', '-c', example], text=True, encoding='utf-8')
                    run(example, expected)
                    busy = 'import operator\nnamespace={"add":operator.add}\nexec("class Box:\\n __slots__=(\'value\',)\\n def __init__(self): self.value=7\\n @property\\n def field(self):\\n  print(\'entered\')\\n  while True: self.value=add(self.value,1)\\nbox=Box()\\nbox.field",namespace)\n'
                    if containers:
                        busy = 'class Key:\n def __hash__(self):\n  print("entered")\n  while True: pass\n{}.setdefault(Key(),[])\n'
                    if exceptions:
                        busy = 'class BusyError(Exception):\n def __init__(self):\n  print("entered")\n  while True: pass\nraise BusyError from None\n'
                    busy_sources = [busy]
                    if exceptions:
                        busy_sources += [
                            'def handlers():\n print("entered")\n while True: pass\ntry: raise ValueError()\nexcept handlers(): pass\n',
                            'class E(Exception):\n def __setattr__(self,name,value):\n  print("entered")\n  while True: pass\nE().add_note("detail")\n',
                        ]
                    for source in busy_sources:
                        page.fill('#input', source)
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#result').textContent==='entered\\n'")
                        page.click('#stop')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Stopped'")
                        output = page.locator('#result').inner_text()
                        page.wait_for_timeout(50)
                        assert page.locator('#result').inner_text() == output
                        page.click('#restart')
                        ready()
                        run(example, expected)
                    context.set_offline(False)
                    shutil.rmtree(root / 'site/console')
                    shutil.copytree(root / 'reduced', root / 'site/console')
                    page.evaluate('async()=>{await(await navigator.serviceWorker.getRegistration()).update()}')
                    page.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Update ready.')")
                    run(example, expected)
                    page.close()
                    probe = context.new_page()
                    old = 'pocket-python:' + url + ':' + selected['cache_version']
                    new = 'pocket-python:' + url + ':' + reduced['cache_version']
                    probe.goto(url.replace('/console/', '/missing'))
                    probe.wait_for_function('async({old,next})=>{const keys=await caches.keys();return !keys.includes(old)&&keys.includes(next)}', arg={'old': old, 'next': new})
                    probe.close()
                    context.set_offline(True)
                    page = context.new_page()
                    page.goto(url)
                    ready()
                    run('print(42)\n', '42\n')
                    if containers:
                        run('d={}\nd.setdefault(1,[]).extend([7])\nprint(list(d.values())[0].pop())\n', '7\n')
                    if exceptions:
                        run('key="missing"\ntry: {}[key]\nexcept KeyError as e: print(e.args[0] is key)\n', 'True\n')
                    run('compile("class C: pass","removed.py","exec")\n', '', 'NameError')
                    assert not errors, errors
                    context.close()
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    checks = ['fresh-offline-composed-source', 'original-dynamic-diagnostics', 'runnable-example',
              'stop-after-dynamic-descriptor-entry', 'restart-fresh-owner',
              'reduced-profile-update', 'old-cache-removed', 'core-source-boundary']
    if containers:
        checks = ['fresh-offline-container-source', 'container-callback-errors', 'runnable-example',
                  'stop-after-container-hash-entry', 'restart-fresh-owner', 'reduced-profile-update',
                  'old-cache-removed', 'core-container-apis', 'core-source-boundary']
    if exceptions:
        checks = ['fresh-offline-exception-source', 'original-dynamic-diagnostics', 'runnable-example',
                  'stop-during-exception-normalization', 'stop-during-handler-expression', 'stop-during-note-setter',
                  'restart-fresh-owner', 'reduced-profile-update',
                  'old-cache-removed', 'core-error-arguments', 'core-source-boundary']
    return {'schema_version': 1, 'suite': 'interpreter-exceptions-offline/1' if exceptions else 'interpreter-containers-offline/1' if containers else 'interpreter-object-offline/1',
            'installed_distribution_required': require_installed, 'package_origin': str(package),
            'corpus_sha256': hashlib.sha256(corpus_path.read_bytes()).hexdigest(),
            'engine_fingerprint': selected['engine']['fingerprint'], 'cases': records,
            'checks': checks, 'summary': {'pass': len(records) + len(checks), 'fail': 0}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-installed', action='store_true')
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--containers', action='store_true', help='Accept the LA-7 practical-container composition slice.')
    selection.add_argument('--exceptions', action='store_true', help='Accept the LA-13/LA-16 ordinary-exception composition slices.')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = smoke(args.require_installed, args.containers, args.exceptions)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
