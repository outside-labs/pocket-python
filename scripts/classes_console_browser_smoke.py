"""Accept explicit class-profile source execution and offline profile updates."""

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
import time

from playwright.sync_api import sync_playwright

from interpreter_browser_smoke import EXAMPLE, Handler, Server
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from examples.interpreter_classes import SOURCE


def smoke(channel=None):
    checks, cases = [], []
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        source = EXAMPLE.write_source(root / 'source', source=SOURCE)
        engine = read_interpreter(ROOT / 'runtime', library_profile='operator/1')
        selected = build_interpreter(source, engine, root / 'site/nested/classes', language_profile='classes-source/1')
        core = build_interpreter(EXAMPLE.write_source(root / 'core-source', source='print(7)\n'),
                                 read_interpreter(ROOT / 'runtime'), root / 'reduced')
        assert selected['engine']['fingerprint'] == core['engine']['fingerprint']
        assert selected['engine']['bytecode_version'] == 5 and core['engine']['bytecode_version'] == 4
        server = Server(('127.0.0.1', 0), partial(Handler, directory=str(root / 'site')))
        server.paths = []
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        requests, errors = [], []
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=channel)
                try:
                    context = browser.new_context()
                    context.on('request', lambda request: requests.append((request.method, request.url)))
                    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                    page = context.new_page()
                    url = origin + '/nested/classes/'

                    def ready():
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Ready'")
                        page.wait_for_function("()=>document.querySelector('#offline').textContent==='Offline ready on this device'")
                        page.wait_for_function('()=>navigator.serviceWorker.controller!==null')

                    def run(source, expected):
                        page.fill('#input', source)
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Completed'")
                        assert page.locator('#result').inner_text() == expected

                    def refused(source, prefix):
                        page.fill('#input', source)
                        page.click('#run')
                        page.wait_for_function("prefix=>document.querySelector('#status').textContent.startsWith(prefix)", arg=prefix)

                    page.goto(url)
                    ready()
                    assert 'classes-source/1' in page.locator('#language').inner_text()
                    assert 'private names' in page.locator('#language').inner_text()
                    assert 'callable objects and length/truth protocols' in page.locator('#language').inner_text()
                    assert page.locator('#input').input_value() == SOURCE
                    checks.append('explicit-class-profile-ready-and-initial-source')
                    corpus = json.loads((ROOT / 'tests/fixtures/interpreter/classes.json').read_bytes())
                    programs = [SOURCE] + [c['source'] for c in corpus['cases'] if c['id'] in
                                           ['diamond-mro', 'class-free-local-overlap', 'unicode-class']]
                    programs.append('import operator\nclass A:\n def __init__(self,n): self.n=n\n def add(self,x): return operator.add(self.n,x)\n def __len__(self): return self.n\nprint(A(7).add(5),operator.truth(A(0)),operator.not_(A(0)))\n')
                    private = json.loads((ROOT / 'tests/fixtures/interpreter/private-names.json').read_bytes())
                    programs.extend(c['source'] for c in private['cases'] if c['id'] in
                                    ['private-class-value', 'subclass-private-fields', 'nested-private-class', 'normalized-unicode-prefix'])
                    descriptors = json.loads((ROOT / 'tests/fixtures/interpreter/descriptors.json').read_bytes())
                    programs.extend(c['source'] for c in descriptors['cases'] if c['id'] in
                                    ['data-descriptor-before-instance-storage', 'set-name-definition-order',
                                     'classmethod-alternate-constructor', 'decorator-expression-and-application-order',
                                     'property-decorator-get-set-delete', 'class-decorator-after-name-notification'])
                    calls = json.loads((ROOT / 'tests/fixtures/interpreter/special-calls.json').read_bytes())
                    programs.extend(c['source'] for c in calls['cases'] if c['id'] in
                                    ['instance-shadow-direct-versus-implicit', 'property-call-binding',
                                     'callable-decorator-instance', 'class-call-slot-binds-derived-owner',
                                     'callable-query-has-no-binding-effects'])
                    truth = json.loads((ROOT / 'tests/fixtures/interpreter/length-truth.json').read_bytes())
                    programs.extend(c['source'] for c in truth['cases'] if c['id'] in
                                    ['length-custom-descriptor-owner', 'truth-static-class-property',
                                     'truth-binding-attributeerror-default', 'condition-short-circuit-retains-operands',
                                     'condition-while-continue-break-finally', 'condition-binding-property-resumes-expression'])
                    for program in programs:
                        expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', program],
                                                           text=True, encoding='utf-8', timeout=5)
                        run(program, expected)
                        cases.append({'source_sha256': hashlib.sha256(program.encode()).hexdigest(), 'stdout': expected, 'status': 'pass'})
                    refused('class A:\n def fail(self): return 1//0\nA().fail()\n', 'ZeroDivisionError:')
                    assert 'sources/app.py:2' in page.locator('#status').inner_text()
                    assert 'fail at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused("print('never')\nclass A:\n def __index__(self): return 7\n", 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('A()\n', 'NameError:')
                    refused('import browser\n', 'ImportError:')
                    run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    checks.append('class-errors-refusal-fresh-state-and-unchanged-host-grants')
                    failure = next(c['source'] for c in private['cases'] if c['id'] == 'private-write-augment-delete')
                    refused(failure, 'AttributeError:')
                    assert page.locator('#result').inner_text() == '9\n'
                    assert 'read at sources/app.py:7' in page.locator('#diagnostic').inner_text()
                    collision = next(c['source'] for c in private['cases'] if c['id'] == 'parameter-collision-after-mangling')
                    refused(collision, 'SyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    checks.append('private-name-errors-and-collisions-before-effects')
                    refused('class A:\n @property\n def read(self):\n  return 1//0\nA().read\n', 'ZeroDivisionError:')
                    assert 'read at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class D:\n def __set_name__(self,owner,name): raise ValueError("notify")\nclass A:\n x=D()\n', 'ValueError:')
                    assert '__set_name__ at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused('@7\ndef f(): pass\n', 'TypeError:')
                    assert 'sources/app.py:1' in page.locator('#status').inner_text()
                    run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    checks.append('descriptor-notification-and-decorator-error-locations')
                    refused('class A:\n def __call__(self):\n  return 1//0\nA()()\n', 'ZeroDivisionError:')
                    assert '__call__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n @property\n def __call__(self):\n  raise ValueError("binding")\nA()()\n', 'ValueError:')
                    assert '__call__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n __call__=None\nA()()\n', 'TypeError:')
                    run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    checks.append('implicit-call-binding-errors-and-fresh-query-state')
                    refused('class A:\n def __len__(self):\n  return 1//0\nlen(A())\n', 'ZeroDivisionError:')
                    assert '__len__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __bool__(self): return 7\nwhile A(): pass\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('class A:\n def __len__(self): return -1\nbool(A())\n', 'ValueError:')
                    refused('class A:\n @property\n def __bool__(self):\n  raise ValueError("binding")\nwhile A(): pass\n', 'ValueError:')
                    assert '__bool__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    checks.append('length-truth-result-callback-binding-errors-and-fresh-state')
                    context.set_offline(True)
                    page.reload()
                    ready()
                    run('class OfflineAdder:\n def __init__(self,fn): self.__fn=fn\n @property\n def __call__(self):\n  def invoke(x): return self.__fn(x)+3\n  return invoke\n@OfflineAdder\ndef doubled(x): return x*2\nprint(doubled(4),callable(doubled))\n', '11 True\n')
                    checks.append('new-callable-decorator-and-binding-source-after-offline-reload')
                    run('class OfflineQueue:\n def __init__(self,n): self.__n=n\n def __len__(self): return self.__n\n @property\n def __bool__(self):\n  def active(): return self.__n>0\n  return active\n def take(self):\n  self.__n-=1\n  return self.__n\nqueue=OfflineQueue(3)\nwhile queue: print(len(queue),queue.take())\nelse: print("empty",not queue)\n', '3 2\n2 1\n1 0\nempty True\n')
                    checks.append('new-length-truth-loop-source-after-offline-reload')
                    busy = [
                        'class Spin:\n def __call__(self):\n  while True: pass\nSpin()()\n',
                        'class Spin:\n @property\n def __call__(self):\n  while True: pass\nSpin()()\n',
                        'class Spin:\n def __len__(self):\n  while True: pass\nlen(Spin())\n',
                        'class Spin:\n def __bool__(self):\n  while True: pass\nwhile Spin(): pass\n',
                        'class Spin:\n @property\n def __bool__(self):\n  while True: pass\nwhile Spin(): pass\n']
                    stopped = []
                    for cycle in range(len(busy)):
                        page.fill('#input', busy[cycle % len(busy)])
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Running…'")
                        page.wait_for_timeout(25)
                        before = time.perf_counter()
                        page.click('#stop')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Stopped'")
                        stopped.append((time.perf_counter() - before) * 1000)
                        assert stopped[-1] < 3000
                        page.click('#restart')
                        ready()
                        run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    checks.append('call-length-truth-and-pending-bindings-stop-with-five-fresh-restarts')
                    context.set_offline(False)
                    shutil.rmtree(root / 'site/nested/classes')
                    shutil.copytree(root / 'reduced', root / 'site/nested/classes')
                    page.evaluate('async()=>{await(await navigator.serviceWorker.getRegistration()).update()}')
                    page.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Update ready.')")
                    run(SOURCE, 'Count: 7\nClass: StepCounter\nCallable: True\nLength: 7 Active: True\nEmpty: yes\n')
                    page.close()
                    probe = context.new_page()
                    old = 'pocket-python:' + url + ':' + selected['cache_version']
                    new = 'pocket-python:' + url + ':' + core['cache_version']
                    probe.goto(origin + '/missing')
                    probe.wait_for_function('''async({old,newCache})=>{
                      const keys=await caches.keys();return !keys.includes(old)&&keys.includes(newCache);
                    }''', arg={'old': old, 'newCache': new})
                    context.set_offline(True)
                    page = context.new_page()
                    page.goto(url)
                    ready()
                    assert 'core-source/1' in page.locator('#language').inner_text()
                    assert page.locator('#input').input_value() == 'print(7)\n'
                    refused("print('never')\nclass Removed: pass\n", 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('import operator\n', 'ImportError:')
                    refused('callable(print)\n', 'NameError:')
                    run('print(len("okay"),bool([]))\n', '4 False\n')
                    run('print(7)\n', '7\n')
                    checks.append('waiting-class-to-core-update-removes-class-and-library-authority-offline')
                    assert not errors and all(method == 'GET' and url.startswith(origin + '/') for method, url in requests)
                    checks.append('only-local-static-gets-and-no-unhandled-page-errors')
                    browser_version = browser.version
                    context.close()
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    return {'schema_version': 1, 'suite': 'class-console-browser/1', 'source_execution': True,
            'language_profile': 'classes-source/1', 'browser': browser_version, 'engine': selected['engine'],
            'script_sha256': hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
            'cases': cases, 'checks': checks, 'stop_ms': stopped,
            'summary': {'pass': len(cases) + len(checks), 'fail': 0}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = smoke(args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
