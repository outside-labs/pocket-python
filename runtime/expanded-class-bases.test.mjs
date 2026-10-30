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
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/expanded-class-bases.json', import.meta.url)));
for (const item of corpus.cases) test('expanded class bases: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports || []}, ...(item.modules || []).map(module => ({package: false, imports: [], notice: 'Synthetic expanded base module', ...module}))], compileOptions: profile,
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
test('base resolution retains original operands through collection and interruption', async () => {
  await lifecycle('class A: pass\nclass Proxy:\n def __mro_entries__(self,bases):\n  print("entered")\n  return (A,)\np=Proxy()\nclass C(p): pass\nprint(C.__orig_bases__[0] is p,C.__bases__==(A,))\n', 'entered\nTrue True\n');
});

test('expanded class bytecode verifies the body and owned argument operand', async () => {
  const {compileSource} = await import('./source-compiler.mjs');
  const {verifyFunctions} = await import('./function-bytecode.mjs');
  const raw = JSON.parse(JSON.stringify(compileSource('class A(*()): pass\n', profile).program));
  const instruction = raw.functions[0].blocks[0].instructions.find(([op]) => op === 'class-expanded');
  instruction[1] = 0;
  assert.throws(() => verifyFunctions(raw), {code: 'BYTECODE'});
  assert.throws(() => compileSource('class A(*()): pass\n'), {code: 'UNSUPPORTED'});
});

test('base-resolution callbacks share work and recursion limits', async () => {
  for (const [body, options, type] of [
    ['while True: pass', {maxSteps: 200}, 'ExecutionLimitError'],
    ['return self.__mro_entries__(bases)', {maxDepth: 12}, 'RecursionError'],
  ]) {
    const result = await runSourceRequest({modules: [unit('class Proxy:\n def __mro_entries__(self,bases):\n  '+body+'\nclass A(Proxy()): pass\n')], compileOptions: profile, options});
    assert.equal(result.error?.type, type); closed(result.closed);
  }
});
