"""Serve the shared computation through a local stdlib HTTP reference fixture."""

import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import platform
import tempfile
from urllib.parse import parse_qs, urlsplit

from .computation import metrics


COMPUTATION = Path(__file__).with_name('computation.py')
SERVER_ONLY_CANARY = 'synthetic-server-only-input-341bc98'
CASES = {'empty':'', 'simple':'hello world', 'whitespace':' \t\n\v\f',
         'unicode':'A😀 é\nline two', 'non-ascii-space':'a\u00a0b',
         'server-only':SERVER_ONLY_CANARY, 'type-error':None}
LOCAL_APP = '''from JavaScript.browser import on_click
from text_metrics import metrics
async def display(text):
    print(metrics(text))
async def main():
    await on_click("run", display)
'''


def computation_bytes():
    return COMPUTATION.read_bytes().replace(b'\r\n',b'\n')


def reference_case(name):
    result = {'kind':'shared-text-metrics-result','schema_version':1,'case':name,'value':None,'error':None}
    try:
        result['value'] = list(metrics(CASES[name]))
    except TypeError as error:
        result['error'] = {'name':type(error).__name__,'message':str(error)}
    return result


def reference_report():
    return {'kind':'shared-text-metrics-reference','schema_version':1,'python':platform.python_version(),
            'computation_sha256':hashlib.sha256(computation_bytes()).hexdigest(),'source_hash_policy':'utf-8-canonical-lf',
            'cases':[reference_case(name) for name in CASES]}


def endpoint(origin, name):
    return origin + '/api/metrics?case=' + name


def remote_source(origin):
    lines = ['from JavaScript.browser import on_click, fetch_text', 'async def display(case):']
    for index, name in enumerate(CASES):
        lines += [('    if ' if index == 0 else '    elif ') + 'case == ' + json.dumps(name) + ':',
                  '        response = await fetch_text(' + json.dumps(endpoint(origin,name)) + ')']
    lines += ['    else:', '        raise TypeError("Choose a named reference case.")',
              '    print(response[2])', 'async def main():', '    await on_click("run", display)']
    return '\n'.join(lines) + '\n'


def client_sources(root, app, *, fetch_urls=()):
    # Select only the client adapter, exact shared computation and its notice.
    from examples.compiled_text_metrics import write_client
    from pocket_python.assets import json_bytes
    from pocket_python.compiled import read_client
    client = write_client(root, app=app, computation=computation_bytes().decode('utf-8'))
    path = client.root / 'CLIENT-SOURCES.json'
    descriptor = json.loads(client.manifest_bytes)
    descriptor['fetch_urls'] = list(fetch_urls)
    path.write_bytes(json_bytes(descriptor))
    return read_client(path)


def build_fixture(output, origin):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Output already exists; choose a new directory.')
    from pocket_python.assets import json_bytes
    from pocket_python.compiled import build_compiled
    from pocket_python.web import _publish
    payload, applications = {}, {}
    variants = [('local',LOCAL_APP,(),'Local text metrics'),
                ('remote',remote_source(origin),tuple(endpoint(origin,name) for name in CASES),'Server reference cases'),
                ('error',LOCAL_APP.replace('metrics(text)','metrics(None)'),(),'Invalid-input demonstration')]
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        for name, app, urls, title in variants:
            client = client_sources(root / (name+'-source'),app,fetch_urls=urls)
            destination = root / name
            receipt = build_compiled(client,destination,title=title)
            for record in receipt['files']:
                payload[name+'/'+record['path']] = (destination/record['path']).read_bytes()
            payload[name+'/POCKET-PYTHON.json'] = (destination/'POCKET-PYTHON.json').read_bytes()
            applications[name] = {'receipt':name+'/POCKET-PYTHON.json','artifact_bytes':receipt['size']['artifact_bytes'],
                                  'compiler_source_fingerprint':receipt['producer']['source_fingerprint']}
    receipt = {'kind':'shared-text-metrics-fixture','schema_version':1,
               'computation':{'module':'text_metrics','sha256':hashlib.sha256(computation_bytes()).hexdigest(),
                              'size_bytes':len(computation_bytes()),'hash_policy':'utf-8-canonical-lf'},
               'client_source_allowlist':['app','text_metrics'],'server_adapter':'examples.shared_text_metrics.__main__',
               'http_contract':'shared-text-metrics-result/1','reference_cases':list(CASES),'applications':applications}
    payload['FIXTURE.json'] = json_bytes(receipt)
    payload['index.html'] = b'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Shared text metrics</title><style>body{font:1.1rem system-ui;max-width:44rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6}a{color:#225841}</style>
<main><h1>Shared text metrics</h1><p>The same supported Python computation runs in a browser worker and through the local Python reference server.</p>
<ul><li><a href="local/">Local text metrics</a>: enter ordinary text. Run continues offline after installation.</li>
<li><a href="remote/">Server reference cases</a>: enter empty, simple, whitespace, unicode, non-ascii-space, server-only or type-error. Run requests the selected result from this local server.</li>
<li><a href="error/">Invalid-input demonstration</a>: Run passes a non-string value to the local computation.</li></ul>
<p>The server routes and sample records stay on the server. Network requests fail visibly while disconnected. These are bounded development fixtures.</p></main></html>'''
    _publish(Path(output).absolute(),payload)
    return receipt


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        parsed = urlsplit(self.path)
        self.server.paths.append(parsed.path)
        if parsed.path != '/api/metrics':
            if parsed.path.startswith('/api/'):
                self.send_error(404)
            else:
                super().do_GET()
            return
        try:
            query = parse_qs(parsed.query,strict_parsing=True,keep_blank_values=True)
            if set(query) != {'case'} or len(query['case']) != 1:
                raise ValueError
            name = query['case'][0]
            if name not in CASES:
                raise KeyError
        except (ValueError,KeyError) as error:
            self.send_error(404 if isinstance(error,KeyError) else 400,'Choose one declared reference case.')
            return
        self.server.api_calls.append(name)
        result = reference_case(name)
        data = json.dumps(result,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()
        self.send_response(400 if result['error'] else 200)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def make_server(output, port=0):
    server = Server(('127.0.0.1',port),partial(Handler,directory=str(Path(output).absolute())))
    server.paths = []
    server.api_calls = []
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--json',action='store_true',help='Print the CPython reference without starting a server.')
    args = parser.parse_args()
    if args.json:
        print(json.dumps(reference_report(),sort_keys=True,ensure_ascii=True))
        return
    if args.output is None:
        parser.error('--output NEW_DIRECTORY is required when serving.')
    server = make_server(args.output,args.port)
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        build_fixture(args.output,origin)
        print('Shared computation fixture: '+origin+'/',flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
