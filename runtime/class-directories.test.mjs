import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic ordinary class directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/class-directories.json', import.meta.url)));
for (const item of corpus.cases) test('ordinary class directory: ' + item.id, async () => {
  const result = await run(item.source);
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
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
      const before = output;
      execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before, 'teardown must not run directory or contained callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('native class directory callers retain cyclic class and base namespaces', async () => {
  await lifecycle('class Base: marker=7\nclass A(Base): pass\nA.saved=A\nd=type.__dir__.__get__(A)\ndel A\ndel Base\nprint("entered")\nprint("marker" in d(),d.__self__.saved is d.__self__)\n', 'entered\nTrue True\n');
});
test('nested native callers retain the directory method and its class graph', async () => {
  await lifecycle('class A: marker=7\nd=type.__dir__.__get__(A).__dir__\ndel A\nprint("entered")\nprint(len(d()),"marker" in d.__self__())\n', 'entered\n30 True\n');
});
for (const operation of ['dir(A)', 'type.__dir__(A)', 'd()']) test(operation+' uses shared real budgets', async () => {
  for (const [options, limits, expected] of [
    [{maxSteps: 300}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 16000}, 'OOM'],
  ]) {
    const result = await run('class A: marker=7\nd=type.__dir__.__get__(A)\nprint("entered")\nwhile True: names='+operation+'\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout, 'entered\n'); closed(result.closed);
  }
});
test('ordinary class directory forms keep core source admission', async () => {
  const result = await runSourceRequest({modules: [unit('class A: pass\ndir(A)\n')], compileOptions: {languageProfile: 'core-source/1'}});
  assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
