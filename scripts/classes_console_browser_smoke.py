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
from examples.interpreter_functions import SOURCE as FUNCTION_SOURCE, CORE_SOURCE as CORE_FUNCTION_SOURCE
from examples.interpreter_syntax import SOURCE as SYNTAX_SOURCE, CORE_SOURCE as CORE_SYNTAX_SOURCE


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
                    assert 'integer indices and item/slice access and mutation' in page.locator('#language').inner_text()
                    assert 'iteration and containment' in page.locator('#language').inner_text()
                    assert 'equality and hashing' in page.locator('#language').inner_text()
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
                    formatting = json.loads((ROOT / 'tests/fixtures/interpreter/formatting.json').read_bytes())
                    programs.extend(c['source'] for c in formatting['cases'] if c['id'] in
                                    ['primitive-repr', 'str-signatures', 'string-unicode', 'hook-precedence',
                                     'instance-shadows', 'static-class-slots', 'property-binding-closure',
                                     'descriptor-accessed-owner', 'returned-string-identity', 'print-nested-output',
                                     'print-failure-keeps-prefix', 'active-exception'])
                    indexing = json.loads((ROOT / 'tests/fixtures/interpreter/indexing.json').read_bytes())
                    programs.extend(c['source'] for c in indexing['cases'] if c['id'] in
                                    ['index-sequences', 'index-mro-shadow-mutation', 'index-mutates-sequence',
                                     'length-index-result', 'read-raw-key', 'read-descriptor', 'slice-raw-key',
                                     'slice-constructor-preserves-keys', 'slice-step-start-stop-order',
                                     'write-delete-return-and-alias', 'write-target-order', 'raw-mutation-slices',
                                     'tuple-slice-keys', 'slice-grow-shrink-self', 'slice-extended-negative',
                                     'slice-shape-error-no-mutation', 'augmented-slice-converts-twice']
                                    and 'error_type' not in c)
                    iteration = json.loads((ROOT / 'tests/fixtures/interpreter/iteration.json').read_bytes())
                    programs.extend(c['source'] for c in iteration['cases'] if c['id'] in
                                    ['iterator-loop-else', 'iterator-loop-control', 'iterator-identity-next-default',
                                     'indexed-loop', 'callable-sentinel-loop', 'contains-result-truth',
                                     'contains-iterator-search', 'contains-optional-binding-iter',
                                     'callable-reentrant-exhaustion'])
                    equality = json.loads((ROOT / 'tests/fixtures/interpreter/equality.json').read_bytes())
                    programs.extend(c['source'] for c in equality['cases'] if c['id'] in
                                    ['eq-raw-result', 'subtype-reflected-first', 'notimplemented-default-fallback',
                                     'ne-default-result-truth', 'membership-rich-eq-truth', 'sentinel-rich-equality',
                                     'container-nested-rich-equality', 'dictionary-collision-update-delete',
                                     'hash-restore-object', 'dictionary-primitive-and-user-key',
                                     'dictionary-value-mutation-during-eq', 'hash-default-descriptor-identity'])
                    programs.append('import operator\nclass Key:\n def __hash__(self): return 7\n def __eq__(self,other): return other==7\nd={7:9}\nprint(operator.eq(Key(),7),operator.getitem(d,Key()))\n')
                    numeric = json.loads((ROOT / 'tests/fixtures/interpreter/numeric.json').read_bytes())
                    programs.extend(c['source'] for c in numeric['cases']
                                    if c['stage'] in numeric['implemented_stages'] and 'error_type' not in c)
                    sequences = json.loads((ROOT / 'tests/fixtures/interpreter/sequences.json').read_bytes())
                    programs.extend(c['source'] for c in sequences['cases']
                                    if c['stage'] in sequences['implemented_stages'] and 'error_type' not in c)
                    functions = json.loads((ROOT / 'tests/fixtures/interpreter/function-binding.json').read_bytes())
                    programs.extend(c['source'] for c in functions['cases']
                                    if c['stage'] in functions['implemented_stages'] and 'error_type' not in c)
                    programs.append(FUNCTION_SOURCE)
                    syntax = json.loads((ROOT / 'tests/fixtures/interpreter/ordinary-syntax.json').read_bytes())
                    programs.extend(c['source'] for c in syntax['cases']
                                    if c['stage'] in syntax['implemented_stages'] and 'error_type' not in c)
                    programs.append(SYNTAX_SOURCE)
                    for program in programs:
                        expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', program],
                                                           text=True, encoding='utf-8', timeout=5)
                        run(program, expected)
                        cases.append({'source_sha256': hashlib.sha256(program.encode()).hexdigest(), 'stdout': expected, 'status': 'pass'})
                    refused('class A:\n def fail(self): return 1//0\nA().fail()\n', 'ZeroDivisionError:')
                    assert 'sources/app.py:2' in page.locator('#status').inner_text()
                    assert 'fail at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused("print('never')\nclass A:\n def __add__(self,other): return 7\n", 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('A()\n', 'NameError:')
                    refused('import browser\n', 'ImportError:')
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('class-errors-refusal-fresh-state-and-unchanged-host-grants')
                    failure = next(c['source'] for c in private['cases'] if c['id'] == 'private-write-augment-delete')
                    refused(failure, 'AttributeError:')
                    assert page.locator('#result').inner_text() == '9\n'
                    assert 'read at sources/app.py:7' in page.locator('#diagnostic').inner_text()
                    collision = next(c['source'] for c in private['cases'] if c['id'] == 'parameter-collision-after-mangling')
                    refused(collision, 'SyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('private-name-errors-and-collisions-before-effects')
                    refused('class A:\n @property\n def read(self):\n  return 1//0\nA().read\n', 'ZeroDivisionError:')
                    assert 'read at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class D:\n def __set_name__(self,owner,name): raise ValueError("notify")\nclass A:\n x=D()\n', 'ValueError:')
                    assert '__set_name__ at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused('@7\ndef f(): pass\n', 'TypeError:')
                    assert 'sources/app.py:1' in page.locator('#status').inner_text()
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('descriptor-notification-and-decorator-error-locations')
                    refused('class A:\n def __call__(self):\n  return 1//0\nA()()\n', 'ZeroDivisionError:')
                    assert '__call__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n @property\n def __call__(self):\n  raise ValueError("binding")\nA()()\n', 'ValueError:')
                    assert '__call__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n __call__=None\nA()()\n', 'TypeError:')
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('implicit-call-binding-errors-and-fresh-query-state')
                    refused('class A:\n def __len__(self):\n  return 1//0\nlen(A())\n', 'ZeroDivisionError:')
                    assert '__len__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __bool__(self): return 7\nwhile A(): pass\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('class A:\n def __len__(self): return -1\nbool(A())\n', 'ValueError:')
                    refused('class A:\n @property\n def __bool__(self):\n  raise ValueError("binding")\nwhile A(): pass\n', 'ValueError:')
                    assert '__bool__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('length-truth-result-callback-binding-errors-and-fresh-state')
                    refused('class A:\n def __str__(self):\n  return 1//0\nprint("start",A())\n', 'ZeroDivisionError:')
                    assert page.locator('#result').text_content() == 'start '
                    assert '__str__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n @property\n def __str__(self):\n  raise ValueError("binding")\nstr(A())\n', 'ValueError:')
                    assert '__str__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __repr__(self): return 7\nrepr(A())\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('class A:\n @property\n def __repr__(self): raise AttributeError("missing")\nrepr(A())\n', 'UnsupportedOperationError:')
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('formatting-source-errors-result-validation-prefix-and-deferred-default')
                    refused('class K:\n def __index__(self): return "bad"\n[7][K()]\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('class A:\n @property\n def __getitem__(self):\n  raise ValueError("binding")\nA()[0]\n', 'ValueError:')
                    assert '__getitem__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    for slot, statement, params in [('__setitem__', 'a[0]=7', 'key,value'), ('__delitem__', 'del a[0]', 'key')]:
                        refused('class A:\n def '+slot+'(self,'+params+'):\n  return 1//0\na=A()\n'+statement+'\n', 'ZeroDivisionError:')
                        assert slot+' at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('a=[1,2,3]\na[::2]=[7]\n', 'ValueError:')
                    refused('a=[1]\na[:]=iter((7,))\n', 'UnsupportedOperationError:')
                    refused('print(slice(1,7)==slice(1,7))\n', 'UnsupportedOperationError:')
                    assert page.locator('#result').inner_text() == ''
                    run('print((x:=7),x)\n', '7 7\n')
                    refused("print('never')\ntype A=list[int]\n", 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused("print('never')\nｔｙｐｅ Alias=int\n", 'SyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('index-item-result-binding-body-shape-and-deferred-source-errors')
                    refused('class A:\n def __iter__(self): return [7]\niter(A())\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('class A:\n def __next__(self):\n  return 1//0\nnext(A(),7)\n', 'ZeroDivisionError:')
                    assert '__next__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n @property\n def __contains__(self):\n  raise ValueError("binding")\nprint(7 in A())\n', 'ValueError:')
                    assert '__contains__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class R:\n def __bool__(self): return 7\nclass A:\n def __contains__(self,key): return R()\nprint(7 in A())\n', 'TypeError:')
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('iteration-result-next-and-membership-binding-truth-source-errors')
                    refused('class A:\n def __eq__(self,other):\n  return 1//0\nprint(A()==7)\n', 'ZeroDivisionError:')
                    assert '__eq__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n @property\n def __eq__(self):\n  raise ValueError("binding")\nprint(A()==7)\n', 'ValueError:')
                    assert '__eq__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __hash__(self): return "bad"\nhash(A())\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('class A:\n def __eq__(self,other): return True\nhash(A())\n', 'TypeError:')
                    refused('class K:\n def __hash__(self): return 7\nhash((K(),))\n', 'UnsupportedOperationError:')
                    run(SOURCE, cases[0]['stdout'])
                    checks.append('equality-binding-body-hash-result-disabling-and-explicit-future-errors')
                    refused('print("entered")\npow(6,-1,12)\n', 'ValueError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    assert 'sources/app.py:2' in page.locator('#status').inner_text()
                    refused('print("entered")\n1<<-1\n', 'ValueError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    refused('print("entered")\n2**100000000000000000000\n', 'ExecutionLimitError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    checks.append('numeric-signature-inverse-shift-and-resource-errors-preserve-prefix')
                    refused('class A:\n def __int__(self):\n  return 1//0\nint(A())\n', 'ZeroDivisionError:')
                    assert '__int__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n @property\n def __float__(self):\n  raise AttributeError("binding")\nfloat(A())\n', 'AttributeError:')
                    assert '__float__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __complex__(self): return 7\ncomplex(A())\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('print("entered")\ncomplex("1 +2j")\n', 'ValueError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    refused('pow(1j,101)\n', 'UnsupportedOperationError:')
                    checks.append('numeric-conversion-binding-body-result-text-and-explicit-power-errors')
                    refused('class I:\n def __index__(self): return "bad"\nrange(I())\n', 'TypeError:')
                    assert 'sources/app.py:3' in page.locator('#status').inner_text()
                    refused('print("entered")\nlen(range(10**100))\n', 'OverflowError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    refused('class A:\n def __iter__(self):\n  print("bad")\n  return iter([1])\n def __len__(self): return 1\nlist(A())\n', 'UnsupportedOperationError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('class V:\n def __bool__(self): raise StopIteration("truth")\nall([V()])\n', 'StopIteration:')
                    assert '__bool__ at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __iter__(self): return self\n def __next__(self): return 1//0\nlist(A())\n', 'ZeroDivisionError:')
                    assert '__next__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('print("entered")\nlist(range(1025))\n', 'ExecutionLimitError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    checks.append('sequence-signatures-hints-callback-errors-and-resource-prefixes')
                    refused('def fail():\n return 1//0\ndef f(x=fail()): pass\n', 'ZeroDivisionError:')
                    assert 'fail at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused('class M:\n def keys(self): return ["x"]\n def __getitem__(self,key):\n  raise ValueError("mapping")\ndef f(**kw): pass\nf(**M())\n', 'ValueError:')
                    assert '__getitem__ at sources/app.py:4' in page.locator('#diagnostic').inner_text()
                    refused('print("never")\ndef f(x):\n global x\n', 'SyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('function-default-mapping-source-errors-and-declaration-validation')
                    refused('assert False,"message"\n', 'AssertionError:')
                    assert 'sources/app.py:1' in page.locator('#status').inner_text()
                    refused('f=lambda:1//0\nf()\n', 'ZeroDivisionError:')
                    assert '<lambda> at sources/app.py:1' in page.locator('#diagnostic').inner_text()
                    refused('a,b=[1]\n', 'ValueError:')
                    assert 'sources/app.py:1' in page.locator('#status').inner_text()
                    refused('print("never")\na,*b,*c=[1,2,3]\n', 'SyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('assert False,[1]\n', 'UnsupportedOperationError:')
                    checks.append('assert-lambda-unpack-original-errors-and-explicit-message-boundary')
                    context.set_offline(True)
                    page.reload()
                    ready()
                    run('class OfflineAdder:\n def __init__(self,fn): self.__fn=fn\n @property\n def __call__(self):\n  def invoke(x): return self.__fn(x)+3\n  return invoke\n@OfflineAdder\ndef doubled(x): return x*2\nprint(doubled(4),callable(doubled))\n', '11 True\n')
                    checks.append('new-callable-decorator-and-binding-source-after-offline-reload')
                    run('class OfflineQueue:\n def __init__(self,n): self.__n=n\n def __len__(self): return self.__n\n @property\n def __bool__(self):\n  def active(): return self.__n>0\n  return active\n def take(self):\n  self.__n-=1\n  return self.__n\nqueue=OfflineQueue(3)\nwhile queue: print(len(queue),queue.take())\nelse: print("empty",not queue)\n', '3 2\n2 1\n1 0\nempty True\n')
                    checks.append('new-length-truth-loop-source-after-offline-reload')
                    run('class OfflineLabel:\n def __init__(self,n): self.__n=n\n def __repr__(self): return "Label("+str(self.__n)+")"\n @property\n def __str__(self):\n  def render(): return "value="+str(self.__n)\n  return render\nlabel=OfflineLabel(7)\nprint(label,repr(label))\nprint(repr("A😀\\t"))\n', "value=7 Label(7)\n'A😀\\t'\n")
                    checks.append('new-formatting-binding-and-unicode-source-after-offline-reload')
                    run('class Key:\n def __index__(self): return -1\nclass Store:\n def __init__(self): self.__items=[3,4,5]\n @property\n def __getitem__(self):\n  def read(key): return self.__items[key]\n  return read\n def __setitem__(self,key,value): self.__items[key]=value\n def __delitem__(self,key): del self.__items[key]\nstore=Store()\nstore[Key()]+=2\nstore[::2]=(7,9)\ndel store[1]\nprint(store[0],store[Key()])\n', '7 9\n')
                    checks.append('new-index-conversion-item-binding-and-slice-mutation-source-after-offline-reload')
                    run('class OfflineStream:\n def __init__(self): self.__value=0\n def __iter__(self): return self\n @property\n def __next__(self):\n  def take():\n   if self.__value==3: raise StopIteration\n   self.__value+=1\n   return self.__value\n  return take\nstream=OfflineStream()\nprint(2 in stream,next(stream),next(stream,"done"))\nclass OfflineShelf:\n def __getitem__(self,key): return (3,7)[key]\nprint(7 in OfflineShelf(),8 not in OfflineShelf())\n', 'True 3 done\nTrue True\n')
                    checks.append('new-iterator-binding-default-and-indexed-membership-source-offline')
                    run('class OfflineContains:\n @property\n def __contains__(self):\n  def use(key): return key==7\n  return use\nclass Supply:\n def __init__(self): self.i=0\n def __call__(self):\n  self.i+=1\n  return self.i\nprint(7 in OfflineContains(),8 not in OfflineContains())\nfor x in iter(Supply(),3): print(x)\n', 'True True\n1\n2\n')
                    checks.append('new-contains-binding-and-callable-sentinel-source-offline')
                    run('class OfflineNumber:\n def __init__(self,value): self.__value=value\n @property\n def __eq__(self):\n  def compare(other):\n   if isinstance(other,OfflineNumber): return self.__value==other.__value\n   return NotImplemented\n  return compare\nprint(OfflineNumber(7)==OfflineNumber(7),OfflineNumber(7)!=OfflineNumber(8))\nprint(OfflineNumber(7) in [OfflineNumber(7)],OfflineNumber(7)==7)\n', 'True True\nTrue False\n')
                    checks.append('new-equality-binding-fallback-and-membership-source-offline')
                    run('class OfflineKey:\n def __init__(self,name): self.__name=name\n def __hash__(self): return 7\n def __eq__(self,other):\n  if not isinstance(other,OfflineKey): return NotImplemented\n  return self.__name==other.__name\na=OfflineKey("a")\nb=OfflineKey("b")\nd={a:3,b:8}\nd[OfflineKey("a")]=7\nprint(len(d),d[a],d[b],OfflineKey("a") in d)\nprint(next(iter(d)) is a)\ndel d[OfflineKey("b")]\nprint(len(d),d[a])\n', '2 7 8 True\nTrue\n1 7\n')
                    checks.append('new-hash-collision-update-key-identity-and-delete-source-offline')
                    run('mask=(1<<12)-1\nmask^=7\nparts=divmod(-41,7)\nprint(hex(mask),bin(9),oct(9),parts[0],parts[1])\nprint(pow(7,-1,19),round(1250,-2),round(1.25,1)==1.2,(10**390)/(10**390)==1.0,ord(chr(128013)))\n',
                        '0xff8 0b1001 0o11 -6 1\n11 1200 True True 128013\n')
                    checks.append('new-exact-operators-helper-rounding-and-unicode-source-offline')
                    run('class OfflineNumeric:\n def __init__(self): self.__value=7\n def __int__(self): return self.__value\n def __float__(self): return self.__value/2\n def __complex__(self): return complex(self.__value,1)\n def __abs__(self): return self.__value\n def __round__(self,n=None): return self.__value\n def __index__(self): return self.__value\na=OfflineNumeric()\nprint(int(a),float(a)==3.5,complex(a)==7+1j,abs(a),round(a),hex(a),int("10",a))\nprint(int("١٢"),float("١.٢٥")==1.25,complex("(3+4j)")==3+4j)\n',
                        '7 True True 7 7 0x7 7\n12 True True\n')
                    run('class OfflineRound:\n @property\n def __round__(self):\n  def use(digits): return digits[0][0]\n  return use\nclass OfflineImaginary:\n @property\n def __float__(self):\n  def use(): return 1.25\n  return use\nprint(round(OfflineRound(),[[7]]),complex(3+4j,OfflineImaginary())==3+5.25j)\nprint({7+0j:3}[7],hash(7+0j)==hash(7),abs(3+4j)==5.0)\n', '7 True\n3 True True\n')
                    checks.append('new-real-complex-and-owned-numeric-binding-source-offline')
                    run('class OfflineStream:\n def __init__(self): self.n=0\n def __iter__(self): return self\n def __next__(self):\n  self.n+=1\n  if self.n>3: raise StopIteration\n  return [self.n]\nsaved=tuple(OfflineStream())\na=list(range(2,10,3))\nprint(len(saved),saved[-1][0],a[1],all([1,2]),any([0,0,3]))\n', '3 3 5 True True\n')
                    run('class OfflineIndex:\n @property\n def __index__(self):\n  def use(): return 3\n  return use\nr=range(OfflineIndex(),10,OfflineIndex())\nprint(r.start,r.stop,r.step,tuple(r)[-1],any(range(1,10**100)),any([]))\n', '3 10 3 9 True False\n')
                    checks.append('new-range-construction-and-owned-consumer-source-after-offline-reload')
                    run(FUNCTION_SOURCE, '19 21 True 2 1\n23 3\n')
                    checks.append('new-default-scope-variadic-and-mapping-source-after-offline-reload')
                    run(SYNTAX_SOURCE, 'alpha 6\nbeta 6\n2 alpha 1 done\n')
                    checks.append('new-assert-walrus-lambda-unpack-and-display-source-offline')
                    busy = [
                        'class Spin:\n def __call__(self):\n  while True: pass\nSpin()()\n',
                        'class Spin:\n @property\n def __call__(self):\n  while True: pass\nSpin()()\n',
                        'class Spin:\n def __len__(self):\n  while True: pass\nlen(Spin())\n',
                        'class Spin:\n def __bool__(self):\n  while True: pass\nwhile Spin(): pass\n',
                        'class Spin:\n @property\n def __bool__(self):\n  while True: pass\nwhile Spin(): pass\n',
                        'class Spin:\n def __repr__(self):\n  print("entered")\n  while True: pass\nrepr(Spin())\n',
                        'class Spin:\n @property\n def __repr__(self):\n  print("entered")\n  while True: pass\nrepr(Spin())\n',
                        'class Spin:\n def __str__(self):\n  print("entered")\n  while True: pass\nprint("prefix",Spin())\n',
                        'class Spin:\n @property\n def __str__(self):\n  print("entered")\n  while True: pass\nprint("prefix",Spin())\n']
                    busy.extend([
                        'class Spin:\n def __index__(self):\n  while True: pass\n[7][Spin()]\n',
                        'class Spin:\n @property\n def __index__(self):\n  while True: pass\n[7][Spin():]\n',
                        'class Spin:\n def __getitem__(self,key):\n  while True: pass\nSpin()[0]\n',
                        'class Spin:\n @property\n def __getitem__(self):\n  while True: pass\nSpin()[:[7]]\n',
                        'class Spin:\n def __setitem__(self,key,value):\n  while True: pass\nSpin()[:]=[[7]]\n',
                        'class Spin:\n @property\n def __delitem__(self):\n  while True: pass\ndel Spin()[:[7]]\n'])
                    for slot, invocation in [('__iter__', 'for x in Spin(): pass'),
                                             ('__next__', 'next(Spin(),[7])'),
                                             ('__contains__', '[7] in Spin()'),
                                             ('__call__', 'next(iter(Spin(),[3]),[7])')]:
                        for binding in [False, True]:
                            busy.append('class Spin:\n '+('@property\n ' if binding else '')+
                                        'def '+slot+'(self'+(',key' if slot=='__contains__' and not binding else '')+'):\n  while True: pass\n'+invocation+'\n')
                    busy.extend([
                        'class Spin:\n def __getitem__(self,key):\n  while True: pass\nfor x in Spin(): pass\n',
                        'class R:\n def __bool__(self):\n  while True: pass\nclass Spin:\n def __contains__(self,key): return R()\n[7] in Spin()\n'])
                    for slot, invocation in [('__eq__', 'print(Spin()==[7])'),
                                             ('__ne__', 'print(Spin()!=[7])'),
                                             ('__hash__', 'd={Spin():[[7]]}')]:
                        for binding in [False, True]:
                            busy.append('class Spin:\n '+('@property\n ' if binding else '')+
                                        'def '+slot+'(self'+(',other' if slot!='__hash__' and not binding else '')+'):\n  while True: pass\n'+invocation+'\n')
                    busy.extend([
                        'while True:\n x=pow(123456789,1234567,1000000007)\n',
                        'while True:\n x=round(2.675,2)\n',
                        'class Sentinel:\n def __eq__(self,other):\n  while True: pass\ndef supply(): return [7]\nnext(iter(supply,Sentinel()),[3])\n',
                        'class K:\n def __hash__(self): return 7\n def __eq__(self,other):\n  while True: pass\nd={K():[3]}\nd[K()]=[7]\n',
                        'class R:\n def __bool__(self):\n  while True: pass\nclass K:\n def __hash__(self): return 7\n def __eq__(self,other): return R()\nd={K():[3]}\nd[K()]=[7]\n',
                        'class R:\n def __bool__(self):\n  while True: pass\nclass Spin:\n def __eq__(self,other): return R()\nprint(Spin()!=7)\n'])
                    stopped = []
                    for slot, invocation in [('__int__','int(Spin())'), ('__float__','float(Spin())'),
                                             ('__complex__','complex(Spin())'), ('__abs__','abs(Spin())'),
                                             ('__round__','round(Spin(),[[7]])')]:
                        for binding in [False, True]:
                            params = ',digits' if slot == '__round__' and not binding else ''
                            busy.append('class Spin:\n '+('@property\n ' if binding else '')+
                                        'def '+slot+'(self'+params+'):\n  while True: pass\n'+invocation+'\n')
                    for invocation in ['int("ff",base=Spin())','bin(Spin())','round(1.25,Spin())']:
                        busy.append('class Spin:\n @property\n def __index__(self):\n  while True: pass\n'+invocation+'\n')
                    for binding in [False, True]:
                        decoration = '@property\n ' if binding else ''
                        busy.append('class Spin:\n '+decoration+'def __index__(self):\n  while True: pass\nrange(Spin())\n')
                        for consumer in ['list', 'tuple']:
                            busy.append('class Spin:\n '+decoration+'def __iter__(self):\n  while True: pass\n'+consumer+'(Spin())\n')
                            busy.append('class Spin:\n def __iter__(self): return self\n '+decoration+'def __next__(self):\n  while True: pass\n'+consumer+'(Spin())\n')
                        for consumer in ['all', 'any']:
                            busy.append('class Spin:\n '+decoration+'def __bool__(self):\n  while True: pass\n'+consumer+'([Spin()])\n')
                    busy.extend([
                        'def busy():\n while True: pass\ndef f(x=busy()): pass\n',
                        'class Spin:\n def __iter__(self):\n  while True: pass\ndef f(*args): pass\nf(*Spin())\n',
                        'class Spin:\n def __iter__(self): return self\n @property\n def __next__(self):\n  while True: pass\ndef f(*args): pass\nf(*Spin())\n',
                        'class Spin:\n @property\n def keys(self):\n  while True: pass\ndef f(**kwargs): pass\nf(**Spin())\n',
                        'class Spin:\n def keys(self): return ["x"]\n @property\n def __getitem__(self):\n  while True: pass\ndef f(**kwargs): pass\nf(**Spin())\n',
                        'class K:\n def __hash__(self):\n  while True: pass\nclass M:\n def keys(self): return [K()]\n def __getitem__(self,key): return 7\ndef f(**kwargs): pass\nf(**M())\n'
                    ])
                    busy.extend([
                        'class Spin:\n @property\n def __bool__(self):\n  while True: pass\nassert Spin()\n',
                        'def busy():\n while True: pass\nf=lambda x=busy(): x\n',
                        'def busy():\n while True: pass\nf=lambda:busy()\nf()\n',
                        'class Spin:\n def __iter__(self): return self\n def __next__(self):\n  while True: pass\na,b=Spin()\n',
                        'class Spin:\n def __iter__(self):\n  self.n+=1\n  if self.n>1:\n   while True: pass\n  return self\n def __next__(self): return 7\ns=Spin()\ns.n=0\na,*b=s\n',
                        'class Spin:\n def __iter__(self): return self\n @property\n def __next__(self):\n  while True: pass\na=[0,*Spin()]\n',
                        'class M:\n @property\n def keys(self):\n  while True: pass\na={"x":1,**M()}\n',
                        'class K:\n def __hash__(self):\n  while True: pass\nclass M:\n def keys(self): return [K()]\n def __getitem__(self,key): return [7]\na={"start":[3],**M()}\n'
                    ])
                    for cycle in range(len(busy)):
                        page.fill('#input', busy[cycle % len(busy)])
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Running…'")
                        page.wait_for_timeout(25)
                        before = time.perf_counter()
                        page.click('#stop')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Stopped'")
                        assert page.locator('#result').text_content() == ''
                        stopped.append((time.perf_counter() - before) * 1000)
                        assert stopped[-1] < 3000
                        page.click('#restart')
                        ready()
                        run(SOURCE, cases[0]['stdout'])
                    checks.append('call-truth-format-index-iteration-containment-equality-hash-and-pending-bindings-stop-with-fresh-restarts')
                    context.set_offline(False)
                    shutil.rmtree(root / 'site/nested/classes')
                    shutil.copytree(root / 'reduced', root / 'site/nested/classes')
                    page.evaluate('async()=>{await(await navigator.serviceWorker.getRegistration()).update()}')
                    page.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Update ready.')")
                    run(SOURCE, cases[0]['stdout'])
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
                    run('parts=divmod(-41,7)\nprint(pow(7,-1,19),parts[0],parts[1],hex((1<<12)-1),round(1250,-2))\n', '11 -6 1 0xfff 1200\n')
                    checks.append('numeric-operators-and-helpers-retained-by-offline-core-profile-update')
                    run('a=float("١.٢٥")\nz=complex("3+4j")\nprint(int("0x_ff",0),a==1.25,z.real==3.0,z.imag==4.0,z/(1-2j)==-1+2j,isinstance(z,complex))\n', '255 True True True True True\n')
                    checks.append('real-and-complex-values-retained-by-offline-core-profile-update')
                    run('r=range(2,10,3)\na=list(r[::-1])\nb=tuple(iter(a))\nprint(r.start,r.stop,r.step,len(b),b[0],b[-1],all(b),any([0,0,3]))\n', '2 10 3 3 8 2 True True\n')
                    checks.append('range-and-primitive-consumers-retained-by-offline-core-profile-update')
                    run(CORE_FUNCTION_SOURCE, '19 21 True 2 1\n23 3\n')
                    checks.append('functions-and-primitive-mapping-forwarding-retained-after-core-profile-update')
                    run(CORE_SYNTAX_SOURCE, 'alpha 6\nbeta 6\n2 alpha 1 done\n')
                    checks.append('ordinary-syntax-retained-after-core-profile-update')
                    refused('slice(7)\n', 'NameError:')
                    refused('next(iter([]),7)\n', 'UnsupportedOperationError:')
                    refused('iter(str,7)\n', 'UnsupportedOperationError:')
                    refused('hash(7)\n', 'NameError:')
                    refused('NotImplemented\n', 'NameError:')
                    run('print(len("okay"),bool([]))\n', '4 False\n')
                    run('print(repr("A😀"),len(str()))\n', "'A😀' 0\n")
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
