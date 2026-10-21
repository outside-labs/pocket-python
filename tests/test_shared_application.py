import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from examples.shared_text_metrics import __main__ as shared
from pocket_python.compiled import build_compiled, read_client


ROOT = Path(__file__).resolve().parents[1]


class SharedApplicationTests(unittest.TestCase):
    def test_cpython_cli_and_stdlib_http_share_outputs_and_errors(self):
        report = json.loads(subprocess.check_output([sys.executable,'-m','examples.shared_text_metrics','--json'],cwd=ROOT,text=True,encoding='utf-8'))
        self.assertEqual(report,shared.reference_report())
        with tempfile.TemporaryDirectory() as temporary:
            server = shared.make_server(temporary)
            thread = Thread(target=server.serve_forever,daemon=True);thread.start()
            origin = f'http://127.0.0.1:{server.server_port}'
            try:
                for expected in report['cases']:
                    with self.subTest(case=expected['case']):
                        try:
                            response = urlopen(shared.endpoint(origin,expected['case']),timeout=5)
                        except HTTPError as error:
                            response = error
                        with response:
                            self.assertEqual(response.status,400 if expected['error'] else 200)
                            self.assertEqual(response.headers['Cache-Control'],'no-store')
                            self.assertEqual(json.load(response),expected)
                for path in ['/api/metrics','/api/metrics?case=simple&case=unicode','/api/metrics?other=x','/api/metrics?case=unknown']:
                    with self.subTest(path=path),self.assertRaises(HTTPError) as caught:
                        urlopen(origin+path,timeout=5)
                    caught.exception.close()
                self.assertEqual(server.api_calls,list(shared.CASES))
            finally:
                server.shutdown();server.server_close();thread.join(timeout=5)

    def test_explicit_clients_retain_shared_source_and_exclude_server_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            client = shared.client_sources(root/'source',shared.LOCAL_APP)
            (client.root/'server_only.py').write_bytes(Path(shared.__file__).read_bytes())
            (client.root/'private.json').write_text(shared.SERVER_ONLY_CANARY)
            client = read_client(client.root/'CLIENT-SOURCES.json')
            direct = build_compiled(client,root/'direct')
            fixture = shared.build_fixture(root/'fixture','http://127.0.0.1:8000')
            source_hash = hashlib.sha256(shared.computation_bytes()).hexdigest()
            self.assertEqual(fixture['computation']['sha256'],source_hash)
            for name in ['local','remote','error']:
                app = root/'fixture'/name
                receipt = json.loads((app/'POCKET-PYTHON.json').read_bytes())
                sources = {item['path']:item for item in receipt['sources']}
                self.assertEqual(set(sources),{'app.py'} if name=='remote' else {'app.py','text_metrics.py'})
                if name!='remote':
                    self.assertEqual(sources['text_metrics.py']['sha256'],source_hash)
                grants = [grant for grant in receipt['capabilities'] if grant['id']=='fetch/1']
                self.assertEqual(bool(grants),name=='remote')
                if grants:
                    self.assertEqual(grants[0]['urls'],[shared.endpoint('http://127.0.0.1:8000',case) for case in shared.CASES])
            for directory in [root/'direct',root/'fixture']:
                for path in directory.rglob('*'):
                    if path.is_file():
                        self.assertNotIn(shared.SERVER_ONLY_CANARY.encode(),path.read_bytes())
                        self.assertNotEqual(path.name,'server_only.py')
            self.assertIsNone(direct['engine'])
            with self.assertRaisesRegex(ValueError,'already exists'):
                shared.build_fixture(root/'fixture','http://127.0.0.1:8000')
