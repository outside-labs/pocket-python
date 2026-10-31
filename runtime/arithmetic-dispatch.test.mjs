import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic arithmetic fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/arithmetic-dispatch.json', import.meta.url)));
for (const item of corpus.cases) test('arithmetic dispatch: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile});
  assert.equal(result.stdout, item.stdout);
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

for (const power of [false, true]) for (const priority of [false, true]) test('arithmetic callbacks survive parked collection, cancellation and close: ' + [power, priority], async () => {
  const source = priority ? corpus.cases.find(item => item.id === (power ? 'pow' : 'matmul') + '-owned-overload-lookup').source.replace('print("lookup",type.__getattribute__(cls,"__name__"))', 'print("entered")') :
    'class A:\n @property\n def __' + (power ? 'pow' : 'matmul') + '__(self):\n  print("entered")\n  return lambda *args: args[-1]\nprint((' + (power ? 'pow(A(),[3],[7])' : 'A()@[7]') + ')[0])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
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
      assert.ok(reached); if (mode === 'finish') assert.equal(output, priority ? 'entered\nentered\n9\n' : 'entered\n7\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('matrix and ternary power callbacks share recursion, work, instruction and allocation limits', async () => {
  for (const power of [false, true]) for (const [body, options, memoryLimits, type] of [
    [power ? 'return pow(self,other,mod)' : 'return self@other', {maxDepth: 12}, undefined, 'RecursionError'],
    ['while True: pass', {maxSteps: 250}, undefined, 'ExecutionLimitError'],
    ['while True: pass', {maxSteps: 100000, maxWork: 50000}, undefined, 'ExecutionLimitError'],
    ['held=[]\n  while True: held.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 20000}, 'MemoryError'],
  ]) {
    const source = 'class A:\n def __' + (power ? 'pow__(self,other,mod)' : 'matmul__(self,other)') + ':\n  ' + body + '\n' + (power ? 'pow(A(),[3],[7])' : 'A()@[7]') + '\n';
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
    assert.equal(result.error?.type, type, JSON.stringify(result.error)); closed(result.closed);
  }
});
