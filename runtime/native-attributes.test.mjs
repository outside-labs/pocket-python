import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = (source, imports = []) => ({name: 'app', package: false, imports, source, notice: 'Synthetic native attribute fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-attributes.json', import.meta.url)));
for (const item of corpus.cases) test('native attribute: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [...(item.modules ?? []).map(module => ({...module, notice: 'Synthetic native attribute fixture'})), unit(item.source, item.imports)], compileOptions: profile});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

test('explicit super attribute callback survives collection and interruption', async () => {
  const item = corpus.cases.find(item => item.id === 'super-property-callback');
  const {registry} = await compileSourceModules([unit(item.source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (!reached && output === 'entered\n' && execution.state === 'parked') {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.equal(reached, true);
      assert.equal(output, mode === 'finish' ? item.stdout : 'entered\n');
    } finally { execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('explicit super callbacks retain recursion and execution limits', async () => {
  for (const [body, options, memoryLimits, expected] of [
    ['return super.__getattribute__(super(B,self),"x")', {maxDepth: 8}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 1000}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 100000}, undefined, 'BUDGET'],
    ['a=[]\n  while True: a.append([0]*1024)', {}, {maxBytes: 32768}, 'OOM'],
  ]) {
    const source = 'class A:\n @property\n def x(self):\n  print("entered")\n  '+body+'\nclass B(A): pass\nsuper.__getattribute__(super(B,B()),"x")\n';
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout.startsWith('entered\n'), true, JSON.stringify({options, memoryLimits, error: result.error})); if (result.closed) closed(result.closed);
  }
});
