import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic live class body fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/custom-mro.json', import.meta.url)));
for (const item of corpus.cases) test('custom mro: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout); assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
async function lifecycle(source, expected) {
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
    } finally {
      const before = output; execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before);
    }
    closed(session.stats());
  } } finally { registry.close(); }
}
test('MRO callbacks and iterators survive parked collection and interruption', async () => {
  for (const body of ['print("entered")\n  return type.mro(cls)', 'yield cls\n  print("entered")\n  yield object'])
    await lifecycle('class M(type):\n def mro(cls):\n  '+body+'\nclass C(metaclass=M):\n def f(self): return __class__\nprint(C().f() is C)\n', 'entered\nTrue\n');
});

test('custom MRO callbacks share recursion, instruction and allocation limits', async () => {
  for (const [body, options, memoryLimits, type] of [
    ['return cls.mro()', {maxDepth: 12}, undefined, 'RecursionError'],
    ['while True: pass', {maxSteps: 200}, undefined, 'ExecutionLimitError'],
    ['held=[]\n  while True: held.append([7])', {maxWork: 10000000, maxSteps: 100000}, {maxBytes: 30000}, 'MemoryError'],
  ]) {
    const result = await runSourceRequest({modules: [unit('class M(type):\n def mro(cls):\n  '+body+'\nclass C(metaclass=M): pass\n')], compileOptions: profile, options, memoryLimits});
    assert.equal(result.error?.type, type, JSON.stringify(result.error)); closed(result.closed);
  }
});
