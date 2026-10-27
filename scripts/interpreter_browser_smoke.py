"""Verify the independent source console, offline updates and browser lifetime."""

import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from threading import Thread
import uuid

from playwright.sync_api import sync_playwright

from pocket_python.interpreter import build_interpreter, read_interpreter


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('console_example', ROOT / 'examples/interpreter_console.py')
EXAMPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXAMPLE)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        self.server.paths.append(self.path)
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def smoke(channel=None):
    checks, requests, page_errors, cases = [], [], [], []
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        source = EXAMPLE.write_source(root / 'client')
        (source.root / 'server-only.py').write_text('PRIVATE_SERVER_CANARY', encoding='utf-8')
        engine = read_interpreter(ROOT / 'runtime')
        application = root / 'nested/app'
        receipt = build_interpreter(source, engine, application)
        neighbor = build_interpreter(source, engine, root / 'neighbor', title='Neighbor')
        broken = build_interpreter(source, engine, root / 'broken', title='Broken install')
        (root / 'broken' / broken['licenses'][0]).write_bytes(b'changed notice with HTTP 200')
        updated_source = EXAMPLE.write_source(root / 'updated-client', source="print('updated console')\n")
        updated_root = root / 'updated'
        updated = build_interpreter(updated_source, engine, updated_root, title='Updated console')
        for record in receipt['files']:
            assert b'PRIVATE_SERVER_CANARY' not in (application / record['path']).read_bytes()
        assert receipt['source_execution'] and receipt['engine']['implementation'] == 'pocket-python-source'
        assert not any(record['path'].endswith('.wasm') for record in receipt['files'])
        server = Server(('127.0.0.1', 0), partial(Handler, directory=str(root)))
        server.paths = []
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=channel)
                try:
                    context = browser.new_context()
                    context.on('request', lambda request: requests.append({'method': request.method, 'url': request.url}))
                    context.on('page', lambda page: page.on('pageerror', lambda error: page_errors.append(str(error))))
                    page = context.new_page()
                    page.set_default_timeout(20000)

                    def ready(tab, *, offline=True):
                        try:
                            tab.wait_for_function("()=>document.querySelector('#status').textContent==='Ready'")
                            if offline:
                                tab.wait_for_function("()=>document.querySelector('#offline').textContent==='Offline ready on this device'")
                                tab.wait_for_function('()=>navigator.serviceWorker.controller!==null')
                        except Exception as error:
                            raise AssertionError({'url': tab.url, 'status': tab.locator('#status').inner_text(),
                                'offline': tab.locator('#offline').inner_text(), 'page_errors': page_errors,
                                'paths': server.paths[-30:]}) from error

                    def run(tab, source, expected):
                        tab.fill('#input', source)
                        tab.click('#run')
                        tab.wait_for_function("()=>document.querySelector('#status').textContent==='Completed'")
                        assert tab.locator('#result').inner_text() == expected

                    def error(tab, source, expected):
                        tab.fill('#input', source)
                        tab.click('#run')
                        tab.wait_for_function("prefix=>document.querySelector('#status').textContent.startsWith(prefix)", arg=expected)
                        assert tab.locator('#run').is_enabled()

                    def reload(tab):
                        with tab.expect_navigation(wait_until='load'):
                            tab.evaluate('()=>location.reload()')

                    page.goto(origin + '/nested/app/')
                    ready(page)
                    assert page.locator('#input').input_value() == EXAMPLE.SOURCE
                    corpus = ['', 'A😀 é\nline two', 'a\u00a0b', '\t\r\n\v\f', 'one', 'one\n', 'a b c']
                    for text in corpus:
                        source_text = EXAMPLE.COMPUTATION + '\nresult=metrics(' + repr(text) + ')\nprint(result[0],result[1],result[2])\n'
                        expected = subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', source_text], text=True, encoding='utf-8', timeout=5)
                        run(page, source_text, expected)
                        cases.append({'source_sha256': hashlib.sha256(source_text.encode()).hexdigest(), 'stdout': expected, 'status': 'pass'})
                    checks.append('shared-cpython-source-differential')
                    run(page, "print(9007199254740993,'A😀 é','<script>window.bad=1</script>')", '9007199254740993 A😀 é <script>window.bad=1</script>\n')
                    assert page.evaluate('()=>window.bad===undefined&&document.querySelectorAll("#result script").length===0')
                    run(page, 'previous=3\nprint(previous)', '3\n')
                    error(page, 'print(previous)', 'NameError:')
                    error(page, 'if True print(1)', 'SyntaxError:')
                    assert 'sources/app.py:1:' in page.locator('#status').inner_text()
                    error(page, "print('never')\nclass Deferred: pass", 'UnsupportedSyntaxError:')
                    assert page.locator('#result').inner_text() == ''
                    error(page, "def fail():\n    return 1//0\nprint('before')\nfail()", 'ZeroDivisionError:')
                    assert page.locator('#result').inner_text() == 'before\n'
                    assert 'sources/app.py:2:' in page.locator('#status').inner_text()
                    assert 'fail at sources/app.py:2' in page.locator('#diagnostic').inner_text()
                    error(page, 'import browser\n', 'ImportError:')
                    checks.append('source-errors-unsupported-imports-fresh-state-and-text-output')

                    context.set_offline(True)
                    reload(page)
                    ready(page)
                    novel = 'new source ' + uuid.uuid4().hex
                    run(page, 'print(' + repr(novel) + ')', novel + '\n')
                    assert novel.encode() not in b''.join(data for _, data in source.files)
                    checks.append('newly-entered-source-after-offline-reload-in-subdirectory')
                    page.fill('#input', 'while True:\n    pass\n')
                    page.click('#run')
                    page.wait_for_function("()=>document.querySelector('#status').textContent==='Running…'")
                    page.click('#stop')
                    assert page.locator('#status').inner_text() == 'Stopped'
                    assert page.locator('#run').is_disabled()
                    for index in range(8):
                        page.click('#restart')
                        ready(page)
                        if index == 0:
                            assert page.locator('#input').input_value().startswith('while True')
                        run(page, f"print('restart {index}')", f'restart {index}\n')
                    checks.append('busy-worker-interrupt-and-eight-offline-restarts')
                    config = json.loads((application / receipt['configuration']).read_bytes())
                    api = page.evaluate('''async ({host,config})=>{
                      const {mountInterpreter}=await import('./'+host);
                      const live=new Set();let observed;
                      class TrackedWorker extends Worker{
                        constructor(...args){super(...args);observed=this;live.add(this);this.count=0;}
                        addEventListener(...args){this.count++;return super.addEventListener(...args);}
                        removeEventListener(...args){this.count--;return super.removeEventListener(...args);}
                        terminate(){live.delete(this);super.terminate();}
                      }
                      const outputs=[],errors=[];
                      const mount=options=>mountInterpreter({application:config.application,onOutput:text=>outputs.push(text),onError:error=>errors.push(error),...options},TrackedWorker);
                      const app=mount({});await app.ready;
                      observed.dispatchEvent(new MessageEvent('message',{data:{session:'f'.repeat(32),bad:true}}));
                      await app.run("print('after stale')");
                      if(outputs.join('')!=='after stale\\n')throw new Error('Stale session changed execution.');
                      const session=app.stats().session;
                      observed.dispatchEvent(new MessageEvent('message',{data:{protocol:'pocket-python-host',version:1,session,seq:1,kind:'ready'}}));
                      if(app.stats().state!=='closed'||observed.count!==0||live.size!==0||errors.at(-1).code!=='PROTOCOL')throw new Error('Malformed-session teardown failed.');
                      const checks=[];
                      for(const [limits,source,code] of [
                        [{source_bytes:32},'😀'.repeat(9),'BAD_VALUE'],
                        [{output_codepoints:4},"print('abcdef')",'QUOTA'],
                        [{response_bytes:1},"print('long')",'QUOTA'],
                        [{compile_work:1},'pass','COMPILE_BUDGET'],
                        [{execution_steps:10},'while True:\\n    pass','BUDGET'],
                        [{memory_bytes:512},'print(1)','OOM']]){
                        const active=mount({limits});await active.ready;
                        try{await active.run(source);throw new Error('Expected '+code);}
                        catch(error){if(error.code!==code)throw error;checks.push(code);}
                        finally{active.stop();}
                        if(live.size!==0||observed.count!==0||active.stats().pending!==0)throw new Error('Budget cleanup failed.');
                      }
                      const count=live.size;
                      try{mount({capabilities:[{id:'fetch/1'}]});throw new Error('Capability accepted.');}
                      catch(error){if(error.code!=='DENIED'||live.size!==count)throw error;}
                      class UnresponsiveWorker extends TrackedWorker{
                        postMessage(message){if(message.kind!=='request')super.postMessage(message);}
                      }
                      const busy=mountInterpreter({application:config.application,limits:{deadline_ms:1000}},UnresponsiveWorker);
                      await busy.ready;
                      try{await busy.run('pass');throw new Error('Deadline did not expire.');}
                      catch(error){if(error.code!=='TIMEOUT')throw error;}
                      if(busy.stats().state!=='closed'||live.size!==0||observed.count!==0)throw new Error('Deadline cleanup failed.');
                      const sessions=new Set();
                      for(let index=0;index<8;index++){
                        const active=mount({});await active.ready;sessions.add(active.stats().session);
                        const pending=active.run('pass');active.stop('restart');
                        try{await pending;throw new Error('Stopped run resolved.');}catch(error){if(error.code!=='CANCELLED')throw error;}
                        if(live.size!==0||observed.count!==0)throw new Error('Stop leaked listeners/workers.');
                      }
                      if(sessions.size!==8)throw new Error('Restart reused a session.');
                      let liveOutput='',cancelled=false;
                      const cooperative=mount({onOutput:text=>{
                        liveOutput+=text;
                        if(!cancelled){cancelled=true;if(!cooperative.cancel()||cooperative.cancel())throw new Error('Cancellation was not idempotent.');}
                      }});
                      await cooperative.ready;
                      try{await cooperative.run('try:\\n print("entered")\\n while True: pass\\nfinally: print("wrong")\\n');throw new Error('Executing run was not cancelled.');}
                      catch(error){if(error.code!=='CANCELLED')throw error;}
                      if(liveOutput!=='entered\\n'||cooperative.stats().state!=='ready'||cooperative.cancel())throw new Error('Cooperative cancellation changed state or executed finally.');
                      await cooperative.run('print("after cancel")');
                      if(liveOutput!=='entered\\nafter cancel\\n')throw new Error('Worker did not recover after cancellation.');
                      cooperative.stop();
                      if(live.size!==0||observed.count!==0)throw new Error('Cooperative worker leaked listeners.');
                      return {bounds:checks,sessions:sessions.size,live_workers:live.size,denied_capability:'fetch/1',deadline:'TIMEOUT'};
                    }''', {'host': receipt['engine']['entrypoint'].rsplit('/', 1)[0] + '/interpreter-host.mjs', 'config': config})
                    checks.append('real-worker-limits-grants-stale-malformed-deadline-and-listener-cleanup')
                    checks.append('offline-live-output-cancels-executing-python-and-recovers-same-worker')

                    events = page.evaluate('''async ({host,source})=>{
                      const base=new URL(host,location.href);
                      const {compileSourceModules}=await import(new URL('./source-modules.mjs',base));
                      const {ModuleSession,MODULE_EVENT_PROFILE}=await import(new URL('./module-session.mjs',base));
                      const {registry}=await compileSourceModules([{name:'app',package:false,imports:[],source:source+'\\ndef spin():\\n while True: pass\\n',notice:'Synthetic offline module event fixture'}]);
                      const session=new ModuleSession(registry),closed=[];
                      const drive=async()=>{while(session.pending){session.pump(3);session.memory.collect([],{cleanup:true});await new Promise(resolve=>setTimeout(resolve,0));}};
                      const record=value=>Object.fromEntries(value.entries.map(([key,item])=>[String.fromCodePoint(...key.codepoints),Number(item.value)]));
                      try{
                        const entry=session.start();do{entry.advance(3);}while(entry.state==='parked');
                        const callback=session.register('adjust');
                        const events=[1,2,3].map(value=>session.enqueue(callback,[{type:'int',value:String(value)}]));
                        await drive();const records=(await Promise.all(events.map(event=>event.result))).map(record);
                        if(JSON.stringify(records.map(item=>[item.schema,item.revision,item.total]))!==JSON.stringify([[1,1,1],[1,2,3],[1,3,6]]))throw new Error('Persistent event state differs.');
                        const spin=session.register('spin'),active=session.enqueue(spin),queued=session.enqueue(callback,[{type:'int',value:'99'}]);
                        session.pump(3);if(!active.cancel()||active.cancel())throw new Error('Parked event cancellation differs.');
                        await active.result.then(()=>{throw new Error('Cancelled event resolved.');},error=>{if(error.code!=='CANCELLED')throw error;});
                        queued.cancel();await queued.result.catch(error=>{if(error.code!=='CANCELLED')throw error;});
                        session.close();closed.push(session.stats());
                        const fresh=new ModuleSession(registry);
                        try{fresh.run();if(fresh.read('total').value!=='0')throw new Error('Fresh event session inherited state.');
                          try{fresh.enqueue(callback);throw new Error('Foreign callback accepted.');}catch(error){if(error.code!=='STALE_HANDLE')throw error;}
                        }finally{fresh.close();closed.push(fresh.stats());}
                        if(closed.some(stats=>['bytes','objects','roots','frames','external'].some(key=>stats[key]!==0)))throw new Error('Event owners did not close.');
                        return {profile:MODULE_EVENT_PROFILE,records,closed};
                      }finally{session.close();registry.close();}
                    }''', {'host': receipt['engine']['entrypoint'].rsplit('/', 1)[0] + '/interpreter-host.mjs',
                           'source': (ROOT / 'examples/interpreter_events.py').read_text()})
                    checks.append('persistent-callback-fifo-values-cancel-close-and-fresh-session-offline')
                    context.set_offline(False)

                    sibling = context.new_page()
                    sibling.goto(origin + '/neighbor/')
                    ready(sibling)
                    page.evaluate("()=>caches.open('unrelated-application-cache')")
                    damaged = context.new_page()
                    damaged.goto(origin + '/broken/')
                    ready(damaged, offline=False)
                    damaged.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Offline unavailable:')")
                    assert damaged.evaluate('async()=>!(await navigator.serviceWorker.getRegistration())?.active')
                    damaged.close()
                    checks.append('http-200-hash-mismatch-refuses-initial-offline-install')

                    old = context.new_page()
                    old.goto(origin + '/nested/app/')
                    ready(old)
                    old_cache = 'pocket-python:' + origin + '/nested/app/:' + receipt['cache_version']
                    new_cache = 'pocket-python:' + origin + '/nested/app/:' + updated['cache_version']
                    shutil.rmtree(application)
                    shutil.copytree(updated_root, application)
                    missing = application / next(name for name in updated['licenses'] if name.startswith('application/'))
                    notice_bytes = missing.read_bytes()
                    missing.unlink()
                    failed_update = page.evaluate('''async()=>{
                      let timer;
                      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Failed-update transition timed out.')),15000);});
                      const transition=async()=>{
                      const registration=await navigator.serviceWorker.getRegistration();
                      const found=new Promise(resolve=>registration.addEventListener('updatefound',()=>resolve(registration.installing),{once:true}));
                      await registration.update();const worker=registration.installing||await found;
                      await new Promise(resolve=>{const done=()=>{if(worker.state==='redundant')resolve();};worker.addEventListener('statechange',done);done();});
                      return {active:registration.active.state,waiting:registration.waiting};
                      };
                      try{return await Promise.race([transition(),deadline]);}finally{clearTimeout(timer);}
                    }''')
                    assert failed_update == {'active': 'activated', 'waiting': None}
                    context.set_offline(True)
                    reload(page)
                    ready(page)
                    assert page.title() == receipt['title']
                    run(page, "print('old complete cache')", 'old complete cache\n')
                    context.set_offline(False)
                    checks.append('missing-asset-update-retains-complete-old-offline-graph')
                    missing.write_bytes(notice_bytes)
                    page.evaluate('async()=>{await(await navigator.serviceWorker.getRegistration()).update()}')
                    page.wait_for_function("()=>document.querySelector('#offline').textContent.startsWith('Update ready.')")
                    assert page.title() == receipt['title'] and old.title() == receipt['title']
                    context.set_offline(True)
                    reload(page)
                    page.wait_for_function("()=>document.querySelector('#status').textContent==='Ready'")
                    assert page.title() == receipt['title']
                    run(page, "print('waiting version stays intact')", 'waiting version stays intact\n')
                    context.set_offline(False)
                    page.close()
                    assert old.evaluate('async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting)')
                    old.close()
                    sibling.wait_for_function('''async({scope,oldCache,newCache})=>{
                      const registration=(await navigator.serviceWorker.getRegistrations()).find(item=>item.scope===scope);
                      const keys=await caches.keys();
                      return registration?.active?.state==='activated'&&!registration.waiting&&keys.includes(newCache)&&!keys.includes(oldCache);
                    }''', arg={'scope': origin + '/nested/app/', 'oldCache': old_cache, 'newCache': new_cache})
                    context.set_offline(True)
                    page = context.new_page()
                    page.goto(origin + '/nested/app/')
                    ready(page)
                    assert page.title() == 'Updated console'
                    run(page, page.locator('#input').input_value(), 'updated console\n')
                    run(sibling, "print('neighbor survives')", 'neighbor survives\n')
                    keys = page.evaluate('()=>caches.keys()')
                    assert old_cache not in keys and new_cache in keys
                    assert 'unrelated-application-cache' in keys
                    assert any(key.endswith(':' + neighbor['cache_version']) and '/neighbor/:' in key for key in keys)
                    checks.append('waiting-update-activates-after-all-old-tabs-close-and-isolates-caches')
                    assert page.evaluate("async()=>{const response=await fetch('./unknown-private.py');return response.status}") == 404
                    assert not page_errors, page_errors
                    assert all(request['method'] == 'GET' and request['url'].startswith(origin + '/') for request in requests)
                    checks.append('local-get-only-complete-closure-and-unknown-path-refusal')
                    version = browser.version
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
              for name in ['scripts/interpreter_browser_smoke.py', 'src/pocket_python/interpreter.py',
                           'src/pocket_python/interpreter_templates.py', 'examples/shared_text_metrics/computation.py',
                           'examples/interpreter_events.py']}
    return {'schema_version': 1, 'suite': 'interpreter-console/1', 'target': 'browser', 'browser': version,
            'reference': platform.python_version(), 'profile': 'in-house-interpreter/1', 'engine': receipt['engine'],
            'source_execution': True, 'input_mode': 'source', 'artifact_bytes': receipt['size']['artifact_bytes'],
            'artifact_file_count': len(receipt['files']) + 1, 'tool_sha256': hashes, 'cases': cases, 'lifecycle': api,
            'module_events': events,
            'checks': [{'id': check, 'status': 'pass'} for check in checks], 'network_requests': len(requests),
            'summary': {'pass': len(checks) + len(cases), 'fail': 0}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', default=None)
    parser.add_argument('--report', type=Path, default=Path('build/interpreter-console-browser-report.json'))
    args = parser.parse_args()
    report = smoke(args.channel)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('Independent source console:', report['summary'], report['browser'])
