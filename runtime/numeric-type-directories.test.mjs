import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic numeric type directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/numeric-type-directories.json', import.meta.url)));
for (const item of corpus.cases) test('numeric type directory: ' + item.id, async () => {
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

for (const [expression, count] of [['bool', 74], ['int', 74], ['float', 60], ['complex', 44], ['type(None)', 25], ['type(NotImplemented)', 25]]) {
  test('native caller retains canonical ' + expression + ' while parked', async () => {
    await lifecycle('value='+expression+'\nd=type.__dir__.__get__(value)\ndel value\nprint("entered")\nprint(len(d()),d.__self__ is '+expression+')\n', 'entered\n'+count+' True\n');
  });
}
test('nested native numeric caller retains the directory descriptor receiver', async () => {
  await lifecycle('d=type.__dir__.__get__(int).__dir__\nprint("entered")\nprint(len(d()),len(d.__self__()),d.__self__.__self__ is int)\n', 'entered\n30 74 True\n');
});
test('advertised numeric namespace merging retains a cyclic instance graph', async () => {
  await lifecycle('class A:\n @property\n def __class__(self): return int\na=A()\na.saved=a\nd=a.__dir__\ndel a\ndel A\nprint("entered")\nprint("bit_length" in d(),d.__self__.saved is d.__self__)\n', 'entered\nTrue True\n');
});
for (const operation of ['dir(int)', 'type.__dir__(bool)', 'd()']) test(operation+' uses shared real budgets', async () => {
  for (const [options, limits, expected] of [
    [{maxSteps: 300}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 16000}, 'OOM'],
  ]) {
    const result = await run('d=type.__dir__.__get__(int)\nprint("entered")\nwhile True: names='+operation+'\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout, 'entered\n'); closed(result.closed);
  }
});
test('numeric type directory forms keep core source admission', async () => {
  for (const source of ['dir(int)\n', 'type.__dir__(int)\n']) {
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: {languageProfile: 'core-source/1'}});
    assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
    if (result.closed) closed(result.closed);
  }
});
