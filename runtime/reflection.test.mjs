import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic reflection fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/reflection.json', import.meta.url)));

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('reflection source: ' + fixture.id, async () => {
    const result = await run(fixture.source);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    closed(result.closed);
  });

test('identities survive collection at every instruction and generator suspension', async () => {
  const source = 'class A:\n def f(self): return 7\ndef values():\n x=A()\n saved=id(x)\n yield x,saved\n print(saved==id(x))\ng=values()\nx,saved=next(g)\nprint(saved==id(x))\ntry: next(g)\nexcept StopIteration: pass\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  const session = new ModuleSession(registry); let output = '';
  session.context.begin({}, text => { output += text; }); const execution = Execution.modules(session.context);
  try {
    while (execution.state !== 'completed') { execution.advance(); session.memory.collect([], {cleanup: true}); }
    assert.equal(output, 'True\nTrue\n');
  } finally { execution.close(); execution.close(); session.context.finish(); session.close(); registry.close(); }
  closed(session.stats());
});

test('identities remain stable across separate persistent callback activations', async () => {
  const {registry} = await compileSourceModules([unit('saved=[]\ndef identity(): return id(saved)\ndef replace():\n global saved\n saved=[]\n return id(saved)\n')], profile);
  const session = new ModuleSession(registry);
  try {
    session.run(); const handle = session.register('identity'), replacement = session.register('replace');
    const invoke = async callback => {
      const event = session.enqueue(callback, []);
      let quanta = 0;
      while (session.pending) { assert.ok(++quanta < 1000); session.pump(1); session.memory.collect([], {cleanup: true}); }
      return event.result;
    };
    const first = await invoke(handle), second = await invoke(handle), third = await invoke(replacement);
    assert.deepEqual(first, second); assert.notDeepEqual(first, third); assert.deepEqual(third, await invoke(handle));
  } finally { session.close(); registry.close(); }
  closed(session.stats());
});

test('integer identity refuses explicitly and core admission remains unchanged', async () => {
  const result = await run('id(7)\n'); assert.equal(result.error.code, 'UNSUPPORTED'); closed(result.closed);
  const core = await runSourceRequest({modules: [unit('id([])\n')]});
  assert.equal(core.error.type, 'NameError'); closed(core.closed);
});

test('identity traversal obeys the shared work limit', async () => {
  const result = await run('saved=[]\nwhile True: id(saved)\n', {maxSteps: 100000, maxWork: 1000});
  assert.equal(result.error.code, 'BUDGET'); closed(result.closed);
});
