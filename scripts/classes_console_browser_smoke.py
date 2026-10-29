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
from examples.interpreter_values import SOURCE as VALUES_SOURCE, CORE_SOURCE as CORE_VALUES_SOURCE
from examples.interpreter_generators import SOURCE as GENERATOR_SOURCE, CORE_SOURCE as GENERATOR_CORE_SOURCE
from examples.interpreter_construction import SOURCE as CONSTRUCTION_SOURCE
from examples.interpreter_attributes import SOURCE as ATTRIBUTE_SOURCE
from examples.interpreter_type_checks import SOURCE as TYPE_CHECK_SOURCE
from examples.interpreter_ordering import SOURCE as ORDERING_SOURCE
from examples.interpreter_reflection import SOURCE as REFLECTION_SOURCE
from examples.interpreter_repetition import SOURCE as REPETITION_SOURCE
from examples.interpreter_subclass_initialization import SOURCE as SUBCLASS_SOURCE
from examples.interpreter_metaclass_attributes import SOURCE as METACLASS_SOURCE
from examples.interpreter_nested_descriptors import SOURCE as NESTED_DESCRIPTOR_SOURCE
from examples.interpreter_native_descriptors import SOURCE as NATIVE_DESCRIPTOR_SOURCE
from examples.interpreter_descriptor_binding import SOURCE as DESCRIPTOR_BINDING_SOURCE
from examples.interpreter_native_rebinding import SOURCE as NATIVE_REBINDING_SOURCE
from examples.interpreter_type_reflection import SOURCE as TYPE_REFLECTION_SOURCE
from examples.interpreter_property_names import SOURCE as PROPERTY_NAMES_SOURCE
from examples.interpreter_abstract_flags import SOURCE as ABSTRACT_FLAGS_SOURCE
from examples.interpreter_documentation import SOURCE as DOCUMENTATION_SOURCE
from examples.interpreter_function_metadata import SOURCE as FUNCTION_METADATA_SOURCE
from examples.interpreter_function_dictionaries import SOURCE as FUNCTION_DICTIONARIES_SOURCE
from examples.interpreter_instance_dictionaries import SOURCE as INSTANCE_DICTIONARIES_SOURCE
from examples.interpreter_class_namespaces import SOURCE as CLASS_NAMESPACES_SOURCE
from examples.interpreter_function_directories import SOURCE as FUNCTION_DIRECTORIES_SOURCE
from examples.interpreter_method_directories import SOURCE as METHOD_DIRECTORIES_SOURCE
from examples.interpreter_namespace_view_directories import SOURCE as NAMESPACE_VIEW_DIRECTORIES_SOURCE


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
                        prefixes = [prefix] if isinstance(prefix, str) else prefix
                        page.wait_for_function("prefixes=>prefixes.some(prefix=>document.querySelector('#status').textContent.startsWith(prefix))", arg=prefixes)

                    page.goto(url)
                    ready()
                    assert 'classes-source/1' in page.locator('#language').inner_text()
                    assert 'private names' in page.locator('#language').inner_text()
                    assert 'integer indices and item/slice access and mutation' in page.locator('#language').inner_text()
                    assert 'iteration and containment' in page.locator('#language').inner_text()
                    assert 'equality and hashing' in page.locator('#language').inner_text()
                    assert 'sets, bytes, bytearrays and memoryviews' in page.locator('#language').inner_text()
                    assert 'construction, super and finite metaclasses' in page.locator('#language').inner_text()
                    assert 'instance attribute hooks and advertised class identities' in page.locator('#language').inner_text()
                    assert 'custom instance/subclass checks' in page.locator('#language').inner_text()
                    assert 'list/tuple/slice comparisons' in page.locator('#language').inner_text()
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
                    values = json.loads((ROOT / 'tests/fixtures/interpreter/value-families.json').read_bytes())
                    programs.extend(c['source'] for c in values['cases'] if c['id'] in [
                        'set-star-display', 'set-algebra', 'set-mutation', 'set-frozen-key', 'set-mutable-lookup',
                        'set-owned-callbacks', 'set-owned-equality', 'set-star-evaluation-order', 'set-named-expression',
                        'bytes-literals', 'bytes-slices', 'bytes-membership', 'bytes-arithmetic', 'bytes-utf8',
                        'bytes-codec-keywords', 'bytes-index-protocol', 'bytes-hook-descriptor', 'bytes-repr',
                        'view-basic', 'view-alias', 'view-stride', 'view-owner-lifetime', 'view-released-equality',
                        'view-released-hash-cached', 'view-binary-operations', 'view-byte-index-callback'])
                    programs.append(VALUES_SOURCE)
                    generators = json.loads((ROOT / 'tests/fixtures/interpreter/generators.json').read_bytes())
                    objects = json.loads((ROOT / 'tests/fixtures/interpreter/object-protocols.json').read_bytes())
                    construction = json.loads((ROOT / 'tests/fixtures/interpreter/construction.json').read_bytes())
                    attributes = json.loads((ROOT / 'tests/fixtures/interpreter/attribute-hooks.json').read_bytes())
                    type_checks = json.loads((ROOT / 'tests/fixtures/interpreter/type-checks.json').read_bytes())
                    ordering = json.loads((ROOT / 'tests/fixtures/interpreter/ordering.json').read_bytes())
                    object_hashing = json.loads((ROOT / 'tests/fixtures/interpreter/object-hashing.json').read_bytes())
                    reflection = json.loads((ROOT / 'tests/fixtures/interpreter/reflection.json').read_bytes())
                    repetition = json.loads((ROOT / 'tests/fixtures/interpreter/repetition.json').read_bytes())
                    subclasses = json.loads((ROOT / 'tests/fixtures/interpreter/subclass-initialization.json').read_bytes())
                    metaclasses = json.loads((ROOT / 'tests/fixtures/interpreter/metaclass-attributes.json').read_bytes())
                    nested_descriptors = json.loads((ROOT / 'tests/fixtures/interpreter/nested-descriptors.json').read_bytes())
                    native_descriptors = json.loads((ROOT / 'tests/fixtures/interpreter/native-descriptors.json').read_bytes())
                    descriptor_binding = json.loads((ROOT / 'tests/fixtures/interpreter/descriptor-binding.json').read_bytes())
                    native_rebinding = json.loads((ROOT / 'tests/fixtures/interpreter/native-rebinding.json').read_bytes())
                    type_reflection = json.loads((ROOT / 'tests/fixtures/interpreter/type-reflection.json').read_bytes())
                    property_names = json.loads((ROOT / 'tests/fixtures/interpreter/property-names.json').read_bytes())
                    abstract_flags = json.loads((ROOT / 'tests/fixtures/interpreter/abstract-flags.json').read_bytes())
                    documentation = json.loads((ROOT / 'tests/fixtures/interpreter/documentation.json').read_bytes())
                    function_metadata = json.loads((ROOT / 'tests/fixtures/interpreter/function-metadata.json').read_bytes())
                    function_dictionaries = json.loads((ROOT / 'tests/fixtures/interpreter/function-dictionaries.json').read_bytes())
                    instance_dictionaries = json.loads((ROOT / 'tests/fixtures/interpreter/instance-dictionaries.json').read_bytes())
                    class_namespaces = json.loads((ROOT / 'tests/fixtures/interpreter/class-namespaces.json').read_bytes())
                    function_directories = json.loads((ROOT / 'tests/fixtures/interpreter/function-directories.json').read_bytes())
                    method_directories = json.loads((ROOT / 'tests/fixtures/interpreter/method-directories.json').read_bytes())
                    namespace_view_directories = json.loads((ROOT / 'tests/fixtures/interpreter/namespace-view-directories.json').read_bytes())
                    for corpus in [namespace_view_directories, method_directories, function_directories, class_namespaces, instance_dictionaries, function_dictionaries, generators, objects, construction, attributes, type_checks, ordering, object_hashing, reflection, repetition, subclasses, metaclasses, nested_descriptors, native_descriptors, descriptor_binding, native_rebinding, type_reflection, property_names, abstract_flags, documentation, function_metadata]:
                        programs.extend(c['source'] for c in corpus['cases']
                                        if c['stage'] in corpus['implemented_stages'] and 'error_type' not in c)
                    programs.append(NAMESPACE_VIEW_DIRECTORIES_SOURCE)
                    programs.append(METHOD_DIRECTORIES_SOURCE)
                    programs.append(FUNCTION_DIRECTORIES_SOURCE)
                    programs.append(CLASS_NAMESPACES_SOURCE)
                    programs.append(GENERATOR_SOURCE)
                    programs.append(CONSTRUCTION_SOURCE)
                    programs.append(ATTRIBUTE_SOURCE)
                    programs.append(TYPE_CHECK_SOURCE)
                    programs.append(ORDERING_SOURCE)
                    programs.append(REFLECTION_SOURCE)
                    programs.append(REPETITION_SOURCE)
                    programs.append(METACLASS_SOURCE)
                    programs.append(NESTED_DESCRIPTOR_SOURCE)
                    programs.append(NATIVE_DESCRIPTOR_SOURCE)
                    programs.append(DESCRIPTOR_BINDING_SOURCE)
                    programs.append(NATIVE_REBINDING_SOURCE)
                    programs.append(TYPE_REFLECTION_SOURCE)
                    programs.append(PROPERTY_NAMES_SOURCE)
                    programs.append(ABSTRACT_FLAGS_SOURCE)
                    programs.append(DOCUMENTATION_SOURCE)
                    for program in programs:
                        expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', program],
                                                           text=True, encoding='utf-8', timeout=5)
                        run(program, expected)
                        cases.append({'source_sha256': hashlib.sha256(program.encode()).hexdigest(), 'stdout': expected, 'status': 'pass'})
                    refused('class A:\n def fail(self): return 1//0\nA().fail()\n', 'ZeroDivisionError:')
                    assert 'sources/app.py:2' in page.locator('#status').inner_text()
                    assert 'fail at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused("print('never')\nclass A:\n def __matmul__(self,other): return 7\n", 'UnsupportedSyntaxError:')
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
                    run('print(slice(1,7)==slice(1,7))\n', 'True\n')
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
                    run('class K:\n def __hash__(self): return 7\nprint(hash((K(),))==hash((K(),)))\n', 'True\n')
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
                    refused('class K:\n def __hash__(self):\n  raise ValueError("key")\nset([K()])\n', 'ValueError:')
                    assert '__hash__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('print("entered")\n"é".encode("ascii")\n', 'UnicodeEncodeError:')
                    assert page.locator('#result').inner_text() == 'entered\n'
                    refused('b"\\xff".decode()\n', 'UnicodeDecodeError:')
                    refused('a=memoryview(b"a"); a.release(); len(a)\n', 'ValueError:')
                    refused('a=bytearray(b"abc"); a[1:]=b"d"\n', 'UnsupportedOperationError:')
                    checks.append('value-family-key-codec-release-and-deferred-resize-errors')
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
                    run(VALUES_SOURCE, 'sets 2 True True\ntext Café afé False\nview CBA 3 -1\n')
                    run('class Byte:\n @property\n def __bytes__(self): return lambda: "café".encode()\nraw=bytes(Byte()); a=bytearray(raw); v=memoryview(a)[::-1]; v[0]=ord(b"!")\nprint(raw.decode(),a[-1],v[0],len({frozenset([1,2]),frozenset([2,1])}))\n', 'café 33 33 1\n')
                    checks.append('new-sets-codecs-bytes-binding-and-buffer-alias-source-offline')
                    generator_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', GENERATOR_SOURCE], text=True, encoding='utf-8')
                    run(GENERATOR_SOURCE, generator_expected)
                    checks.append('new-generators-comprehensions-reflection-and-arithmetic-source-offline')
                    refused('def g():\n yield 1\n raise StopIteration("escaped")\na=g()\nnext(a)\nnext(a)\n', 'RuntimeError:')
                    refused('class A:\n @property\n def x(self): raise ValueError("body")\nhasattr(A(),"x")\n', 'ValueError:')
                    refused('class A:\n def __add__(self,x): raise KeyError("body")\nA()+1\n', 'KeyError:')
                    checks.append('generator-and-object-body-errors-retain-offline-diagnostics')
                    run(CONSTRUCTION_SOURCE, 'construction True True offline\nvalues 4 5 Note\ndynamic True offline\n')
                    run('class OfflineBase:\n def __new__(cls,x): return super().__new__(cls)\n def __init__(self,x): self.x=x\nclass OfflineChild(OfflineBase):\n def __init__(self,x): super().__init__(x+1)\n def values(self):\n  yield self.x\n  yield __class__.__name__\na=OfflineChild(7)\ng=a.values()\nprint(next(g),next(g),isinstance(a,(str,OfflineBase)),issubclass(OfflineChild,OfflineBase))\n', '8 OfflineChild True True\n')
                    checks.append('new-construction-super-metaclass-and-generator-source-offline')
                    refused('class A:\n def __new__(cls): raise ValueError("new")\nA()\n', 'ValueError:')
                    assert '__new__ at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __init__(self): return 7\nA()\n', 'TypeError:')
                    refused('class M(type):\n def __new__(meta,name,bases,ns): raise KeyError("meta")\nclass A(metaclass=M): pass\n', 'KeyError:')
                    assert '__new__ at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    refused('class M(type):\n def __new__(meta,name,bases,ns):\n  del ns["__classcell__"]\n  return type.__new__(meta,name,bases,ns)\nclass A(metaclass=M):\n def f(self): return __class__\n', 'RuntimeError:')
                    refused('class A:\n def f(self): return super().missing\nA().f()\n', 'AttributeError:')
                    refused('class M(type):\n @classmethod\n def __prepare__(meta,name,bases): return {}\n', 'UnsupportedSyntaxError:')
                    checks.append('constructor-super-metaclass-errors-and-future-hooks-retain-offline-diagnostics')
                    identity = 'class A: pass\nclass B:\n @property\n def __class__(self):\n  print("hook")\n  return A\nb=B()\n'
                    for expression in ['b.__class__', 'getattr(b,"__class__")', 'isinstance(b,A)', 'super(A,b)']:
                        run(identity + expression + '\n', 'hook\n')
                    checks.append('advertised-class-identities-execute-offline-hooks-when-required')
                    run(ATTRIBUTE_SOURCE, 'attributes 8 offline\nidentity True True True\nmissing True False\n')
                    checks.append('new-instance-attribute-hooks-compose-with-generators-and-reflection-offline')
                    for slot, signature, invocation in [
                        ('__getattribute__', 'self,name', 'A().x'),
                        ('__getattr__', 'self,name', 'getattr(A(),"x",7)'),
                        ('__setattr__', 'self,name,value', 'A().x=7'),
                        ('__delattr__', 'self,name', 'del A().x')]:
                        refused('class A:\n def '+slot+'('+signature+'):\n  raise ValueError("hook")\n'+invocation+'\n', 'ValueError:')
                        assert slot+' at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    refused('class A:\n def __getattribute__(self,name): print("never")\ngetattr(A(),"__weakref__")\n', 'UnsupportedOperationError:')
                    assert page.locator('#result').inner_text() == ''
                    run('class M(type):\n print("body")\n def __getattribute__(cls,name): return 7\nclass A(metaclass=M): pass\nprint(A.x)\n', 'body\n7\n')
                    assert page.locator('#result').inner_text() == 'body\n7\n'
                    checks.append('instance-hook-errors-and-deferred-reflection-retain-offline-boundaries')
                    run(TYPE_CHECK_SOURCE, 'virtual True True\nactual False False True\nvalues 7 8 True\nnative method_descriptor builtin_function_or_method __instancecheck__\n')
                    checks.append('new-custom-checking-composes-with-descriptors-truth-generators-and-native-defaults-offline')
                    for slot, builtin, argument in [('__instancecheck__', 'isinstance', '7'), ('__subclasscheck__', 'issubclass', 'int')]:
                        refused('class M(type):\n def '+slot+'(cls,obj):\n  raise ValueError("check")\nclass A(metaclass=M): pass\n'+builtin+'('+argument+',A)\n', 'ValueError:')
                        assert slot+' at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                        refused('class D:\n def __get__(self,obj,owner):\n  raise AttributeError("binding")\nclass M(type): '+slot+'=D()\nclass A(metaclass=M): pass\n'+builtin+'('+argument+',A)\n', 'AttributeError:')
                        assert '__get__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                        refused('class Truth:\n def __bool__(self):\n  raise ValueError("truth")\nclass M(type):\n def '+slot+'(cls,obj): return Truth()\nclass A(metaclass=M): pass\n'+builtin+'('+argument+',A)\n', 'ValueError:')
                        assert '__bool__ at sources/app.py:3' in page.locator('#diagnostic').inner_text()
                    checks.append('custom-check-binding-body-and-truth-errors-retain-offline-source-diagnostics')
                    for slot in ['__instancecheck__', '__subclasscheck__']:
                        refused('type(type.'+slot+')()\n', 'TypeError:')
                        refused('int.'+slot+'.__func__\n', 'AttributeError:')
                    checks.append('native-checking-callable-identities-metadata-and-construction-refusal-offline')
                    run(ORDERING_SOURCE, 'queue offline review save\nprefix True True\nslice True True\ndecision True True\n')
                    run('class A:\n def __eq__(self,other):\n  x[0]=3\n  y[0]=7\n  return False\nx=[A()]\ny=[A()]\nprint(x<y)\n', 'True\n')
                    checks.append('new-ordering-sequence-mutation-and-slice-source-after-offline-reload')
                    for source, prefix, frame in [
                        ('class A:\n @property\n def __lt__(self): raise ValueError("binding")\nA()<7\n', 'ValueError:', '__lt__ at sources/app.py:3'),
                        ('class A:\n def __lt__(self,other): raise ValueError("body")\nA()<7\n', 'ValueError:', '__lt__ at sources/app.py:2'),
                        ('class R:\n def __bool__(self): raise ValueError("truth")\nclass A:\n def __eq__(self,other): return R()\nslice(A())<slice(A())\n', 'ValueError:', '__bool__ at sources/app.py:2'),
                    ]:
                        refused(source, prefix)
                        assert frame in page.locator('#diagnostic').inner_text()
                    refused('class A: pass\na=A()\na<=a\n', 'TypeError:')
                    run('print(hash(slice(1,7))==hash(slice(1,7)))\n', 'True\n')
                    checks.append('ordering-binding-body-truth-errors-and-adopted-slice-hash-offline')
                    for case in object_hashing['cases']:
                        if 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('method-slice-and-tuple-hash-signatures-and-errors-offline')
                    run(REFLECTION_SOURCE, 'same True True\nfields revision title 2\nsnapshot True False True\nordered revision title\nscope True True True\ninline True False True\nescaped True 2\nisolated True True\nclass True\n')
                    for case in reflection['cases']:
                        if case['stage'] not in reflection['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                        else:
                            run(case['source'], case['stdout'])
                    checks.append('identity-snapshots-and-custom-reflection-execute-after-offline-reload')
                    checks.append('reflection-source-errors-and-live-namespace-refusals-remain-explicit-offline')
                    checks.append('generator-expression-iterator-snapshots-and-owned-directory-hints-and-ordering-compose-offline')
                    checks.append('optimized-and-isolated-comprehension-snapshots-compose-after-offline-reload')
                    refused('print("must not execute")\ny=9\nr=[lambda a=(y:=7):a for x in [1]]\n', 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('comprehension-lambda-default-bindings-refuse-before-offline-effects')
                    run(REPETITION_SOURCE, 'copies True 1 2 1\nevents run save run save\nbanner 6 True\nmutation 2 4 finish finish\ninplace True 6 True\n')
                    for case in repetition['cases']:
                        if case['stage'] not in repetition['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('sequence-repetition-aliases-unicode-mutation-and-generators-compose-offline')
                    checks.append('repetition-index-errors-overflow-and-deferred-forms-retain-offline-boundaries')
                    run(SUBCLASS_SOURCE, 'registered 1 True\nschema note 2 title True\ndynamic 2 True draft dynamic\nnames Note Draft\n')
                    for case in subclasses['cases']:
                        if case['stage'] not in subclasses['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('class-registration-notifications-keywords-metaclasses-and-generators-compose-offline')
                    checks.append('subclass-binding-errors-native-methods-and-deferred-class-forms-retain-offline-boundaries')
                    run(METACLASS_SOURCE, 'schema Note note-draft 2 True\naudit 4 set:kind delete:temporary False\nversions 2 3\nnative 3 True method-wrapper\n')
                    for case in metaclasses['cases']:
                        if case['stage'] not in metaclasses['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('metaclass-reads-fallbacks-audited-mutations-and-native-methods-compose-offline')
                    checks.append('metaclass-binding-errors-and-deferred-namespaces-remain-explicit-offline')
                    run(NESTED_DESCRIPTOR_SOURCE, 'field score 7 name:score\npreserved 7\nnative None 7 9\nremoved 0 4 delete:score\n')
                    for case in nested_descriptors['cases']:
                        if case['stage'] not in nested_descriptors['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('bound-field-mutation-name-notification-and-validation-compose-offline')
                    checks.append('nested-hook-binding-errors-and-live-namespace-boundaries-remain-explicit-offline')
                    run(NATIVE_DESCRIPTOR_SOURCE, 'field 7 None 9\npreserved 9\nclass True\nremoved None 0\nfactory True score:11\nowner True 13\nmethod method-wrapper True property.__get__\n')
                    for case in native_descriptors['cases']:
                        if case['stage'] not in native_descriptors['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('native-property-methods-and-explicit-wrapper-owners-compose-after-offline-reload')
                    checks.append('native-descriptor-arguments-receivers-and-live-namespace-refusals-remain-explicit-offline')
                    run(DESCRIPTOR_BINDING_SOURCE, 'copy False True 7\nupdated 11\nbound True True True 11\nclosure 17\nready\nentered\nitem 13\nnative property.getter method-wrapper\n')
                    for case in descriptor_binding['cases']:
                        if case['stage'] not in descriptor_binding['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            if case['id'].startswith('future-copy-'):
                                assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                    checks.append('accessor-copies-and-explicit-function-binding-compose-after-offline-reload')
                    checks.append('documentation-sensitive-getter-copies-refuse-before-hook-effects-offline')
                    checks.append('descriptor-copy-binding-validation-and-future-refusals-remain-explicit-offline')
                    run(NATIVE_REBINDING_SOURCE, 'field 7 False True\nupdated 11\nnative check True True\nhandles builtin_function_or_method method-wrapper True\nclosure 17\nready\nentered\nitem 13\n')
                    for case in native_rebinding['cases']:
                        if case['stage'] not in native_rebinding['implemented_stages']:
                            refused(case['source'], 'UnsupportedOperationError:')
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('native-descriptor-rebinding-composes-with-offline-copies-type-checks-and-generators')
                    checks.append('native-rebinding-validation-original-callback-frames-and-future-boundaries-offline')
                    hierarchy_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', TYPE_REFLECTION_SOURCE], text=True, encoding='utf-8')
                    run(TYPE_REFLECTION_SOURCE, hierarchy_expected)
                    for case in type_reflection['cases']:
                        if case['stage'] not in type_reflection['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('native-owner-and-type-hierarchy-reflection-compose-after-offline-reload')
                    checks.append('type-reflection-errors-and-deferred-mro-effects-remain-explicit-offline')
                    run(PROPERTY_NAMES_SOURCE, 'names field snapshot 7\nidentity True\nfallback read\nnative builtin_function_or_method True\nindependent field detached\nfield field\nfield detached\nlookup\nfield lazy\n')
                    for case in property_names['cases']:
                        if case['stage'] not in property_names['implemented_stages']:
                            refused(case['source'], 'UnsupportedOperationError:')
                            if case['id'].startswith('diagnostic-'):
                                assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('property-names-copies-and-native-notification-compose-after-offline-reload')
                    checks.append('property-name-errors-and-diagnostic-callback-refusals-remain-explicit-offline')
                    abstract_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', ABSTRACT_FLAGS_SOURCE], text=True, encoding='utf-8')
                    run(ABSTRACT_FLAGS_SOURCE, abstract_expected)
                    for case in abstract_flags['cases']:
                        if case['stage'] not in abstract_flags['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('abstract-flags-compose-with-copies-function-markers-and-lazy-generators-offline')
                    checks.append('abstract-lookup-truth-errors-readonly-flags-and-future-boundaries-offline')
                    documentation_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', DOCUMENTATION_SOURCE], text=True, encoding='utf-8')
                    run(DOCUMENTATION_SOURCE, documentation_expected)
                    for case in documentation['cases']:
                        if case['stage'] not in documentation['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('documentation-callbacks-origin-sensitive-copies-and-lazy-generators-compose-offline')
                    checks.append('documentation-errors-source-frames-and-native-metadata-refusals-remain-explicit-offline')
                    metadata_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', FUNCTION_METADATA_SOURCE], text=True, encoding='utf-8')
                    run(FUNCTION_METADATA_SOURCE, metadata_expected)
                    for case in function_metadata['cases']:
                        if case['stage'] not in function_metadata['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('function-metadata-composes-with-properties-retained-methods-and-lazy-generators-offline')
                    checks.append('function-metadata-validation-source-frames-and-method-fallback-boundaries-offline')
                    dictionaries_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', FUNCTION_DICTIONARIES_SOURCE], text=True, encoding='utf-8')
                    run(FUNCTION_DICTIONARIES_SOURCE, dictionaries_expected)
                    for case in function_dictionaries['cases']:
                        if case['stage'] not in function_dictionaries['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('function-dictionaries-compose-with-decorators-retained-methods-and-lazy-generators-offline')
                    checks.append('function-dictionary-replacement-native-bypass-and-callback-errors-remain-explicit-offline')
                    instances_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', INSTANCE_DICTIONARIES_SOURCE], text=True, encoding='utf-8')
                    run(INSTANCE_DICTIONARIES_SOURCE, instances_expected)
                    for case in instance_dictionaries['cases']:
                        if case['stage'] not in instance_dictionaries['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                            for frame in case.get('error_frames', []):
                                if frame['function'] != '<module>':
                                    assert f"{frame['function']} at sources/app.py:{frame['line']}" in page.locator('#diagnostic').inner_text()
                    checks.append('instance-dictionaries-compose-with-retained-methods-properties-and-lazy-generators-offline')
                    checks.append('instance-dictionary-replacement-deletion-callback-errors-and-reflection-boundaries-offline')
                    namespaces_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', CLASS_NAMESPACES_SOURCE], text=True, encoding='utf-8')
                    run(CLASS_NAMESPACES_SOURCE, namespaces_expected)
                    for case in class_namespaces['cases']:
                        if case['stage'] not in class_namespaces['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                    checks.append('keyed-class-namespaces-compose-with-stored-descriptors-retained-methods-and-lazy-generators-offline')
                    checks.append('keyed-class-namespace-readonly-errors-and-enumeration-boundaries-offline')
                    directories_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', FUNCTION_DIRECTORIES_SOURCE], text=True, encoding='utf-8')
                    run(FUNCTION_DIRECTORIES_SOURCE, directories_expected)
                    for case in function_directories['cases']:
                        if case['stage'] not in function_directories['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                    checks.append('default-function-directories-compose-with-live-dictionaries-retained-methods-and-lazy-generators-offline')
                    checks.append('function-directory-native-merge-callbacks-errors-and-other-layout-boundaries-offline')
                    methods_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', METHOD_DIRECTORIES_SOURCE], text=True, encoding='utf-8')
                    run(METHOD_DIRECTORIES_SOURCE, methods_expected)
                    for case in method_directories['cases']:
                        if case['stage'] not in method_directories['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                    checks.append('bound-method-directories-compose-with-callable-dictionaries-native-binding-and-lazy-generators-offline')
                    checks.append('method-directory-lookup-merge-and-sort-errors-retain-finite-layout-boundaries-offline')
                    views_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', NAMESPACE_VIEW_DIRECTORIES_SOURCE], text=True, encoding='utf-8')
                    run(NAMESPACE_VIEW_DIRECTORIES_SOURCE, views_expected)
                    for case in namespace_view_directories['cases']:
                        if case['stage'] not in namespace_view_directories['implemented_stages']:
                            refused(case['source'], ['UnsupportedOperationError:', 'UnsupportedSyntaxError:'])
                            assert page.locator('#result').inner_text() == ''
                        elif 'error_type' in case:
                            refused(case['source'], case['error_type'] + ':')
                            assert page.locator('#result').inner_text() == case['stdout']
                    checks.append('namespace-view-directories-compose-with-keyed-views-retained-methods-and-lazy-generators-offline')
                    checks.append('view-native-directory-binding-preserves-mapping-enumeration-and-other-layout-boundaries-offline')
                    busy = [
                        'class C: tag=[7]\np=C.__dict__\nC.saved=p\nd=p.__dir__\ndel p\ndel C\nprint("entered")\nwhile True: d()\n',
                        'class Callable: pass\nm=classmethod(Callable()).__get__(None,object)\ndef read(self,name):\n if name=="__dict__":\n  print("entered")\n  while True: pass\n return object.__getattribute__(self,name)\nCallable.__getattribute__=read\ndir(m)\n',
                        'class Key:\n def __hash__(self): return hash("__new__")\n def __eq__(self,other):\n  print("entered")\n  while True: pass\nclass C:\n def f(self): pass\nm=C().f\nm.__func__.__dict__={Key():7}\ndir(m)\n',
                        'class Key:\n def __gt__(self,other):\n  print("entered")\n  while True: pass\nclass C:\n def f(self): pass\nm=C().f\nm.__func__.__dict__={Key():7}\ndir(m)\n',
                        'class Key:\n def __hash__(self): return hash("__new__")\n def __eq__(self,other):\n  print("entered")\n  while True: pass\ndef f(): pass\nf.__dict__={Key():7}\ndir(f)\n',
                        'class Key:\n def __gt__(self,other):\n  print("entered")\n  while True: pass\ndef f(): pass\nf.__dict__={Key():7}\ndir(f)\n',
                        'class Truth:\n def __bool__(self):\n  print("entered")\n  while True: pass\nclass Key:\n def __hash__(self): return hash("__new__")\n def __eq__(self,other): return Truth()\ndef f(): pass\nf.__dict__={Key():7}\ndir(f)\n',
                        'class C: tag=[7]\np=C.__dict__\nC.saved=p\ndel C\nprint("entered")\nwhile True: p["tag"]\n',
                        'class M(type):\n @property\n def __dict__(cls):\n  print("entered")\n  while True: pass\nclass C(metaclass=M): pass\nvars(C)\n',
                        *['class C: pass\nc=C()\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  print("entered")\n  while True: pass\nc.__dict__={Key():7}\n' + operation + '\n'
                          for operation in ['c.tag', 'c.tag=9', 'del c.tag']],
                        'def f(): pass\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  print("entered")\n  while True: pass\nf.__dict__={Key():7}\nf.tag\n',
                        'class Callable: pass\nm=classmethod(Callable()).__get__(None,object)\ndef lookup(self,name):\n print("entered")\n while True: pass\nCallable.__getattribute__=lookup\nm.tag\n',
                        *['class Callable: pass\nm=classmethod(Callable()).__get__(None,object)\ndef lookup(self,name):\n print("entered")\n while True: pass\nCallable.__getattribute__=lookup\nm.' + name + '\n' for name in ['__name__', '__qualname__', '__module__']],
                        'class Getter:\n @property\n def __doc__(self):\n  print("entered")\n  while True: pass\nproperty(Getter())\n',
                        'ready=False\nclass Getter:\n @property\n def __doc__(self):\n  if ready:\n   print("entered")\n   while True: pass\n  return None\np=property(Getter())\nready=True\np.setter(None)\n',
                        'class C: pass\nclass Flag:\n def __getattribute__(self,name):\n  if name=="__isabstractmethod__":\n   print("entered")\n   while True: pass\n  return object.__getattribute__(self,name)\nm=classmethod(Flag()).__get__(None,C)\nm.__isabstractmethod__\n',
                        'class Flag:\n @property\n def __isabstractmethod__(self):\n  print("entered")\n  while True: pass\nproperty(Flag()).__isabstractmethod__\n',
                        'class Truth:\n def __bool__(self):\n  print("entered")\n  while True: pass\nclass Flag: __isabstractmethod__=Truth()\nstaticmethod(Flag()).__isabstractmethod__\n',
                        'class Flag:\n @property\n def __isabstractmethod__(self):\n  print("entered")\n  while True: pass\nclassmethod(Flag()).__isabstractmethod__\n',
                        'class Getter:\n @property\n def __name__(self):\n  print("entered")\n  while True: pass\np=property(Getter())\np.__name__\n',
                        'p=property()\nclass D:\n def __set_name__(self,owner,name):\n  print("entered")\n  while True: pass\nclass C:\n first=p\n callback=D()\n last=p\n',
                        'class M(type):\n def __getattribute__(cls,name):\n  print("entered")\n  while True: pass\nclass C(metaclass=M): pass\nC.mro()\n',
                        'class M(type):\n def __getattribute__(cls,name):\n  print("entered")\n  while True: pass\nclass C(metaclass=M): pass\nC.__base__\n',
                        'def callback(obj):\n print("entered")\n while True: pass\np=property(callback)\nproperty.__get__.__get__(p)([7])\n',
                        'def callback(obj):\n print("entered")\n while True: pass\nbind=type(callback).__get__.__get__(callback)\nbind([7])()\n',
                        'def callback(obj):\n print("entered")\n while True: pass\n yield obj[0]\nbind=type(callback).__get__.__get__(callback)\nnext(bind([7])())\n',
                        'def callback(obj):\n print("entered")\n while True: pass\np=property(callback)\np.__get__([7])\n',
                        'def callback(obj,value):\n print("entered")\n while True: pass\np=property(None,callback)\np.__set__([7],[8])\n',
                        'def callback(obj):\n print("entered")\n while True: pass\np=property(None,None,callback)\np.__delete__([7])\n',
                        'class D:\n @property\n def __set_name__(self):\n  print("entered")\n  while True: pass\nclass A: x=D()\n',
                        'def notify(owner,name):\n print("entered")\n while True: pass\nclass D: __set_name__=property(lambda self: notify)\nclass A: x=D()\n',
                        'class D:\n @property\n def __set__(self):\n  print("entered")\n  while True: pass\nclass A: x=D()\nA().x=[7]\n',
                        'def write(obj,value):\n print("entered")\n while True: pass\nclass D: __set__=property(lambda self: write)\nclass A: x=D()\nA().x=[7]\n',
                        'class D:\n @property\n def __delete__(self):\n  print("entered")\n  while True: pass\nclass A: x=D()\ndel A().x\n',
                        'def remove(obj):\n print("entered")\n while True: pass\nclass D: __delete__=property(lambda self: remove)\nclass A: x=D()\ndel A().x\n',
                        'class A:\n def __init_subclass__(cls,*,x):\n  print("entered")\n  while True: pass\nclass B(A,x=[7]): pass\n',
                        'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  while True: pass\nclass A: __init_subclass__=D()\nclass B(A,x=[7]): pass\n',
                        'class Spin:\n def __call__(self):\n  while True: pass\nSpin()()\n',
                        'class Spin:\n @property\n def __call__(self):\n  while True: pass\nSpin()()\n',
                        'class Spin:\n def __len__(self):\n  while True: pass\nlen(Spin())\n',
                        'class Spin:\n def __bool__(self):\n  while True: pass\nwhile Spin(): pass\n',
                        'class Spin:\n @property\n def __bool__(self):\n  while True: pass\nwhile Spin(): pass\n',
                        'class Spin:\n def __repr__(self):\n  print("entered")\n  while True: pass\nrepr(Spin())\n',
                        'class Spin:\n @property\n def __repr__(self):\n  print("entered")\n  while True: pass\nrepr(Spin())\n',
                        'class Spin:\n def __str__(self):\n  print("entered")\n  while True: pass\nprint("prefix",Spin())\n',
                        'class Spin:\n @property\n def __str__(self):\n  print("entered")\n  while True: pass\nprint("prefix",Spin())\n']
                    busy.extend(['class M(type):\n def __getattribute__(cls,name):\n  print("entered")\n  while True: pass\nclass A(metaclass=M): pass\nA.x\n', 'class M(type):\n def __getattr__(cls,name):\n  print("entered")\n  while True: pass\nclass A(metaclass=M): pass\ngetattr(A,"x",[7])\n', 'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  while True: pass\nclass M(type): __getattribute__=D()\nclass A(metaclass=M): pass\nA.x\n', 'class M(type):\n def __setattr__(cls,name,value):\n  print("entered")\n  while True: pass\nclass A(metaclass=M): pass\nA.x=[7]\n', 'class M(type):\n def __delattr__(cls,name):\n  print("entered")\n  while True: pass\nclass A(metaclass=M): x=[7]\ndel A.x\n', 'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  while True: pass\nclass M(type): __setattr__=D()\nclass A(metaclass=M): pass\nA.x=[7]\n'])
                    busy.extend([
                        'def marker():\n print("entered")\n while True: pass\ndef f(p):\n return [(locals(),marker()) for x in [p]]\nf([7])\n',
                        'def marker():\n print("entered")\n while True: pass\nclass A:\n snapshots=[(vars(),marker()) for x in [[7]]]\n',
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
                    busy.extend(['def read(obj):\n print("entered")\n while True: pass\np=property.getter(property(),read)\np.__get__([7])\n', 'def write(obj,value):\n print("entered")\n while True: pass\np=property.setter(property(),write)\np.__set__([7],[9])\n', 'def remove(obj):\n print("entered")\n while True: pass\np=property.deleter(property(),remove)\np.__delete__([7])\n', 'def read(obj):\n print("entered")\n while True: pass\nm=read.__get__([7])\ndel read\nm()\n', 'def read(obj):\n print("entered")\n while True: pass\n yield obj\nm=read.__get__([7])\ng=m()\ndel m\nnext(g)\n'])
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
                    for sequence in ['[[7]]', '([7],)', '"😀"']:
                        for binding in [False, True]:
                            busy.append('class Spin:\n '+('@property\n ' if binding else '')+
                                        'def __index__(self):\n  print("entered")\n  while True: pass\n'+sequence+'*Spin()\n')
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
                    busy.extend([
                        'class K:\n def __hash__(self):\n  while True: pass\nset([K()])\n',
                        'class K:\n def __hash__(self): return 7\n def __eq__(self,other):\n  while True: pass\n{K(),K()}\n',
                        'class I:\n def __iter__(self): return self\n def __next__(self):\n  while True: pass\nset(I())\n',
                        'class B:\n @property\n def __bytes__(self):\n  while True: pass\nbytes(B())\n',
                        'class I:\n def __index__(self):\n  while True: pass\nbytes([I()])\n',
                        'class I:\n def __index__(self):\n  while True: pass\nv=memoryview(bytearray(b"a")); v[I()]=0\n'
                    ])
                    busy.extend([
                        'def g():\n while True: yield 1\nall(g())\n',
                        'def g():\n try: yield 1\n finally:\n  while True: pass\na=g()\nnext(a)\na.close()\n',
                        'def busy(x):\n while True: pass\na=[busy(x) for x in range(2)]\n',
                        'class Spin:\n def __add__(self,other):\n  while True: pass\nSpin()+[7]\n',
                        'class Spin:\n @property\n def __radd__(self):\n  while True: pass\n[7]+Spin()\n',
                        'class Spin:\n @property\n def x(self):\n  while True: pass\ngetattr(Spin(),"x",[7])\n'
                    ])
                    busy.extend([
                        'class Spin:\n def __new__(cls):\n  while True: pass\nSpin()\n',
                        'class D:\n def __get__(self,obj,owner):\n  while True: pass\nclass Spin: __new__=D()\nSpin()\n',
                        'class Spin:\n def __new__(cls): return object.__new__(cls)\n def __init__(self):\n  while True: pass\nSpin()\n',
                        'class Base:\n @property\n def value(self):\n  while True: pass\nclass Spin(Base):\n def read(self): return super().value\nSpin().read()\n',
                        'class M(type):\n def __new__(meta,name,bases,ns):\n  while True: pass\nclass Spin(metaclass=M): pass\n',
                        'class M(type):\n def __init__(cls,*args):\n  while True: pass\nclass Spin(metaclass=M): pass\n',
                        'class M(type):\n def __call__(cls):\n  while True: pass\nclass Spin(metaclass=M): pass\nSpin()\n',
                        'class D:\n def __set_name__(self,owner,name):\n  while True: pass\nclass M(type): pass\nclass Spin(metaclass=M): value=D()\n'
                    ])
                    busy.extend([
                        'class Spin:\n def __getattribute__(self,name):\n  while True: pass\nSpin().x\n',
                        'class Spin:\n def __getattr__(self,name):\n  while True: pass\ngetattr(Spin(),"x",[7])\n',
                        'class D:\n def __get__(self,obj,owner):\n  while True: pass\nclass Spin: __getattribute__=D()\nSpin().x\n',
                        'class Spin:\n def __setattr__(self,name,value):\n  while True: pass\nSpin().x=[7]\n',
                        'class Spin:\n def __delattr__(self,name):\n  while True: pass\ndel Spin().x\n',
                        'class B: pass\nclass Spin:\n @property\n def __class__(self):\n  while True: pass\nprint(isinstance(Spin(),((B,),)))\n',
                        'class B: pass\nclass Spin:\n @property\n def __class__(self):\n  while True: pass\nsuper(B,Spin())\n'
                    ])
                    for slot, builtin, argument in [('__instancecheck__', 'isinstance', '7'), ('__subclasscheck__', 'issubclass', 'int')]:
                        busy.extend([
                            'class M(type):\n def '+slot+'(cls,obj):\n  while True: pass\nclass A(metaclass=M): pass\n'+builtin+'('+argument+',A)\n',
                            'class D:\n def __get__(self,obj,owner):\n  while True: pass\nclass M(type): '+slot+'=D()\nclass A(metaclass=M): pass\n'+builtin+'('+argument+',A)\n',
                            'class Truth:\n def __bool__(self):\n  while True: pass\nclass M(type):\n def '+slot+'(cls,obj): return Truth()\nclass A(metaclass=M): pass\n'+builtin+'('+argument+',A)\n'
                        ])
                    busy.extend([
                        'class Spin:\n @property\n def __lt__(self):\n  while True: pass\nSpin()< [7]\n',
                        'class Spin:\n def __ge__(self,other):\n  while True: pass\nSpin()>= [7]\n',
                        'class Spin:\n def __eq__(self,other):\n  while True: pass\n[Spin()]<[Spin()]\n',
                        'class Truth:\n def __bool__(self):\n  while True: pass\nclass Spin:\n def __eq__(self,other): return Truth()\n[Spin()]<=[Spin()]\n',
                        'class Spin:\n def __eq__(self,other): return False\n @property\n def __le__(self):\n  while True: pass\nslice(Spin())<=slice(Spin())\n',
                        'class Spin:\n @property\n def __eq__(self):\n  while True: pass\nslice(Spin())==slice(Spin())\n',
                    ])
                    busy.extend([
                        'class Spin:\n @property\n def __dict__(self):\n  while True: pass\nvars(Spin())\n',
                        'class Spin:\n def __dir__(self):\n  while True: pass\ndir(Spin())\n',
                        'class D:\n def __get__(self,obj,owner):\n  while True: pass\nclass Spin: __dir__=D()\ndir(Spin())\n',
                        'class Spin:\n def __dir__(self):\n  yield "x"\n  while True: pass\ndir(Spin())\n',
                        'def spin():\n saved=[]\n while True: saved.append(locals())\nspin()\n',
                    ])
                    busy.extend([
                        'def spin():\n g=(locals() for x in range(1000000000))\n while True: next(g)\nspin()\n',
                        'class Items:\n def __iter__(self): return iter(())\n def __len__(self):\n  print("entered")\n  while True: pass\nclass A:\n def __dir__(self): return Items()\ndir(A())\n',
                        'class Items:\n def __iter__(self): return iter(())\n def __length_hint__(self):\n  print("entered")\n  while True: pass\nclass A:\n def __dir__(self): return Items()\ndir(A())\n',
                        'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  while True: pass\nclass Items:\n def __iter__(self): return iter(())\n __length_hint__=D()\nclass A:\n def __dir__(self): return Items()\ndir(A())\n',
                        'class Index:\n def __index__(self):\n  print("entered")\n  while True: pass\nclass Items:\n def __iter__(self): return iter(())\n def __len__(self): return Index()\nclass A:\n def __dir__(self): return Items()\ndir(A())\n',
                        'class Entry:\n def __lt__(self,other):\n  print("entered")\n  while True: pass\nclass A:\n def __dir__(self): return [Entry(),Entry()]\ndir(A())\n',
                        'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  while True: pass\nclass Entry: __lt__=D()\nclass A:\n def __dir__(self): return [Entry(),Entry()]\ndir(A())\n',
                        'class Truth:\n def __bool__(self):\n  print("entered")\n  while True: pass\nclass Entry:\n def __lt__(self,other): return Truth()\nclass A:\n def __dir__(self): return [Entry(),Entry()]\ndir(A())\n',
                    ])
                    for cycle in range(len(busy)):
                        page.fill('#input', busy[cycle % len(busy)])
                        page.click('#run')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Running…'")
                        if 'print("entered")' in busy[cycle]:
                            page.wait_for_function("()=>document.querySelector('#result').textContent.includes('entered\\n')")
                        page.wait_for_timeout(25)
                        before = time.perf_counter()
                        page.click('#stop')
                        page.wait_for_function("()=>document.querySelector('#status').textContent==='Stopped'")
                        output_at_stop = page.locator('#result').text_content()
                        assert len(output_at_stop) <= 16384
                        page.wait_for_timeout(25)
                        assert page.locator('#result').text_content() == output_at_stop
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
                    run(CORE_VALUES_SOURCE, 'sets 2 True True\ntext Café afé False\nview CBA 3 -1\n')
                    checks.append('sets-binary-codecs-and-buffer-values-retained-after-core-profile-update')
                    core_generator_expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', GENERATOR_CORE_SOURCE], text=True, encoding='utf-8')
                    run(GENERATOR_CORE_SOURCE, core_generator_expected)
                    checks.append('generators-and-comprehensions-retained-after-offline-core-profile-update')
                    for case in ordering['cases']:
                        if 'core-source/1' in case.get('profiles', []):
                            run(case['source'], case['stdout'])
                    refused('print("never")\nclass A:\n def __lt__(self,other): return True\nA()<7\n', 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('primitive-ordering-retained-and-user-ordering-refused-after-core-profile-update')
                    refused(METACLASS_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('class-to-core-update-refuses-metaclass-source-before-effects')
                    refused(NESTED_DESCRIPTOR_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('class-to-core-update-refuses-nested-field-hooks-before-effects')
                    refused(NATIVE_DESCRIPTOR_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('class-to-core-update-refuses-native-descriptor-example-before-effects')
                    refused(DESCRIPTOR_BINDING_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('print("before")\ndef read(obj): return obj\nread.__get__([7])\n', 'UnsupportedOperationError:')
                    assert page.locator('#result').inner_text() == 'before\n'
                    checks.append('class-to-core-update-retains-explicit-function-binding-refusal')
                    refused(NATIVE_REBINDING_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('print("before")\nproperty.getter.__get__(None,property)\n', 'NameError:')
                    assert page.locator('#result').inner_text() == 'before\n'
                    checks.append('class-to-core-update-retains-native-rebinding-boundaries')
                    refused(TYPE_REFLECTION_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    for source in ['int.mro()\n', 'print(int.__base__)\n']:
                        refused('print("before")\n'+source, 'UnsupportedOperationError:')
                        assert page.locator('#result').inner_text() == 'before\n'
                    checks.append('class-to-core-update-retains-type-reflection-boundaries')
                    refused(PROPERTY_NAMES_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('print("before")\nproperty().__set_name__(None,"field")\n', 'NameError:')
                    assert page.locator('#result').inner_text() == 'before\n'
                    checks.append('class-to-core-update-retains-property-name-boundaries')
                    refused(ABSTRACT_FLAGS_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    refused('def f(): pass\nf.__isabstractmethod__=True\n', 'UnsupportedSyntaxError:')
                    checks.append('class-to-core-update-retains-abstract-flag-boundaries')
                    refused('slice(7)\n', 'NameError:')
                    refused('next(iter([]),7)\n', 'UnsupportedOperationError:')
                    refused('iter(str,7)\n', 'UnsupportedOperationError:')
                    refused('hash(7)\n', 'NameError:')
                    refused('NotImplemented\n', 'NameError:')
                    for name in ['id', 'locals', 'vars', 'dir', 'globals']:
                        refused(name + '\n', 'NameError:')
                    refused('def f(): pass\nf.__dict__\n', 'UnsupportedOperationError:')
                    checks.append('class-to-core-update-retains-function-dictionary-boundary')
                    checks.append('class-to-core-update-removes-reflection-builtin-authority')
                    run('a=[7]\nb=a*2\na[0]=9\nprint(len(b),b[0],len("😀"*3),len(2*(1,)))\n', '2 7 3 2\n')
                    checks.append('primitive-repetition-retained-after-core-profile-update')
                    refused(SUBCLASS_SOURCE, 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    checks.append('class-to-core-update-refuses-subclass-keywords-before-effects')
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
