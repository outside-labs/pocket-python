import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic container type directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/container-type-directories.json', import.meta.url)));
for (const item of corpus.cases) test('container type directory: ' + item.id, async () => {
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

for (const [expression, count] of [['str', 81], ['list', 48], ['tuple', 35], ['dict', 46], ['range', 35], ['slice', 28], ['set', 57], ['frozenset', 44], ['bytes', 78], ['bytearray', 91], ['memoryview', 55]]) {
  test('native caller retains canonical ' + expression + ' while parked', async () => {
    await lifecycle('value='+expression+'\nd=type.__dir__.__get__(value)\ndel value\nprint("entered")\nprint(len(d()),d.__self__ is '+expression+')\n', 'entered\n'+count+' True\n');
  });
}
test('nested native container caller retains the directory descriptor receiver', async () => {
  await lifecycle('d=type.__dir__.__get__(dict).__dir__\nprint("entered")\nprint(len(d()),len(d.__self__()),d.__self__.__self__ is dict)\n', 'entered\n30 46 True\n');
});
test('advertised container namespace merging retains a cyclic instance graph', async () => {
  await lifecycle('class A:\n @property\n def __class__(self): return dict\na=A()\na.saved=a\nd=a.__dir__\ndel a\ndel A\nprint("entered")\nprint("keys" in d(),d.__self__.saved is d.__self__)\n', 'entered\nTrue True\n');
});
test('advertised native key collision callbacks retain the merge and receiver graph', async () => {
  await lifecycle('class Key:\n def __hash__(self): return hash("keys")\n def __eq__(self,other):\n  print("entered")\n  return other=="keys"\nkey=Key()\nclass A:\n @property\n def __class__(self): return dict\na=A()\na.__dict__[key]=7\nkey.saved=a\nd=a.__dir__\ndel a\ndel key\ndel A\ndel Key\nnames=d()\nprint(names[0].saved is d.__self__)\n', 'entered\nTrue\n');
});
for (const operation of ['dir(memoryview)', 'type.__dir__(str)', 'd()']) test(operation+' uses shared real budgets', async () => {
  for (const [options, limits, expected] of [
    [{maxSteps: 300}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 16000}, 'OOM'],
  ]) {
    const result = await run('d=type.__dir__.__get__(dict)\nprint("entered")\nwhile True: names='+operation+'\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout, 'entered\n'); closed(result.closed);
  }
});
test('container type directory forms keep core source admission', async () => {
  for (const source of ['dir(memoryview)\n', 'type.__dir__(dict)\n']) {
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: {languageProfile: 'core-source/1'}});
    assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
    if (result.closed) closed(result.closed);
  }
});
