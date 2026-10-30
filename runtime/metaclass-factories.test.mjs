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
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/metaclass-factories.json', import.meta.url)));
for (const item of corpus.cases) test('metaclass factory: ' + item.id, async () => {
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
test('factory preparation and construction retain operands through interruption', async () => {
  for (const source of [
    'def factory(name,bases,ns):\n print("entered")\n return type(name,bases,ns)\nclass C(metaclass=factory):\n def f(self): return __class__\nprint(C().f() is C)\n',
    'class Factory:\n def __prepare__(self,name,bases):\n  print("entered")\n  return {}\n def __call__(self,name,bases,ns): return type(name,bases,ns)\nclass C(metaclass=Factory()):\n def f(self): return __class__\nprint(C().f() is C)\n',
  ]) await lifecycle(source, 'entered\nTrue\n');
});

test('factory callbacks share recursion and work limits and source diagnostics', async () => {
  for (const [body, options, type] of [
    ['return factory(name,bases,ns)', {maxDepth: 12}, 'RecursionError'],
    ['while True: pass', {maxSteps: 200}, 'ExecutionLimitError'],
    ['raise ValueError("original")', {}, 'ValueError'],
  ]) {
    const result = await runSourceRequest({modules: [unit('def factory(name,bases,ns):\n '+body+'\nclass C(metaclass=factory): pass\n')], compileOptions: profile, options});
    assert.equal(result.error?.type, type); closed(result.closed);
    if (type === 'ValueError') assert.equal(result.error.traceback.at(-1).function, 'factory');
  }
});
