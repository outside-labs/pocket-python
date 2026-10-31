import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic dynamic exec fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/dynamic-exec.json', import.meta.url)));
for (const item of corpus.cases) test('owned exec: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile, options: {maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error)); closed(result.closed);
});
test('nested statement execution shares every caller limit', async () => {
  const sources = ['exec("while True: pass")\n', 'def f(): exec("f()")\nf()\n'];
  for (const [source, options] of [[sources[0], {maxSteps: 150}], [sources[1], {maxDepth: 8}], [sources[1], {maxWork: 15000}]]) {
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options});
    assert.ok(['BUDGET', 'PYTHON'].includes(result.error.code));
    if (result.error.code === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});
test('dynamic statements retain original diagnostics and effects across failure', async () => {
  const result = await runSourceRequest({modules: [unit('g={}\nexec(compile("x=7\\nprint(x)\\nraise ValueError(\'failed\')","original-statements.py","exec"),g)\n')], compileOptions: profile});
  assert.equal(result.stdout, '7\n'); assert.equal(result.error.type, 'ValueError');
  assert.ok(result.error.traceback.some(frame => frame.location?.filename === 'original-statements.py' && frame.location.span[0] === 3)); closed(result.closed);
});
test('parked nested exec keeps closure cells and definitions alive, then cancels/closes cleanly', async () => {
  const source = 'def outer():\n x=[7]\n def body():\n  nonlocal x\n  x=[9]\n  print("inside")\n  x[0]+=2\n return body\nf=outer()\nexec(f.__code__,closure=f.__closure__)\nprint(f.__closure__[0].cell_contents[0])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park(); session.memory.collect([], {cleanup: true});
        if (output === 'inside\n') {
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      if (mode === 'finish') assert.equal(output, 'inside\n11\n');
    } finally { const before = output; execution.close(); session.context.finish(); session.close(); assert.equal(output, before); } closed(session.stats());
  } } finally { registry.close(); }
});
