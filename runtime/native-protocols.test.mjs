import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic native protocol fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-protocols.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) test('native protocol: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{name: 'app', package: false, imports: [], source: item.source, notice: 'Synthetic native protocol fixture'}], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

for (const [source, expected] of [
  ['def f(value):\n print("entered")\n return [value]\nprint(type(f).__call__(f,7)[0])\n', 'entered\n7\n'],
  [corpus.cases.find(item => item.id === 'native-index-callback').source, 'entered\n7\n'],
  ['class A:\n def f(self): pass\nclass Call:\n def __call__(self,receiver): return 7\n def __hash__(self):\n  print("entered")\n  return 9\nm=type(A().f)(Call(),[])\nprint(m.__hash__()==hash(m))\n', 'entered\nentered\nTrue\n'],
]) test('explicit native callback lifetime: ' + expected, async () => {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
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
      assert.ok(reached); if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('explicit native callbacks share recursion, instruction, work and allocation limits', async () => {
  for (const [body, options, memoryLimits, type] of [
    ['return type(f).__call__(f)', {maxDepth: 12}, undefined, 'RecursionError'],
    ['while True: pass', {maxSteps: 250}, undefined, 'ExecutionLimitError'],
    ['while True: pass', {maxSteps: 100000, maxWork: 100000}, undefined, 'ExecutionLimitError'],
    ['held=[]\n while True: held.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 20000}, 'MemoryError'],
  ]) {
    const source = 'def f():\n print("entered")\n ' + body + '\ntype(f).__call__(f)\n';
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
    assert.ok(result.stdout.startsWith('entered\n'), JSON.stringify(result.error));
    assert.equal(result.error?.type, type, JSON.stringify(result.error)); closed(result.closed);
  }
});
