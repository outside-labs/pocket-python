import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic generator directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/generator-directories.json', import.meta.url)));
for (const item of corpus.cases) test('generator directory: ' + item.id, async () => {
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
      assert.ok(reached); if (mode === 'finish') assert.equal(output, expected);
    } finally {
      const before = output;
      execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before, 'teardown must not run generator callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('native callers retain detached created generators and cyclic functions', async () => {
  await lifecycle('def produce():\n yield 7\ng=produce()\nproduce.saved=g\nd=g.__dir__\ndel g\ndel produce\nprint("entered")\nprint(len(d()),next(d.__self__))\n', 'entered\n38 7\n');
});

test('native callers retain suspended locals and arguments through owned sorting', async () => {
  await lifecycle('def produce(value):\n local=value\n delta=yield 1\n yield local[0]+delta\nvalue=[7]\ng=produce(value)\nnext(g)\nproduce.saved=g\nd=g.__dir__\ndel g\ndel value\ndel produce\nprint("entered")\nprint(len(d()),d.__self__.send(13),iter(d.__self__) is d.__self__)\n', 'entered\n38 20 True\n');
});

test('nested native callers retain the generator behind their binding chain', async () => {
  await lifecycle('g=(x for x in (7,9))\nd=g.__dir__.__dir__\ndel g\nprint("entered")\nprint(len(d()),next(d.__self__.__self__))\n', 'entered\n30 7\n');
});

test('running generators can collect directories without reentering themselves', async () => {
  await lifecycle('def produce():\n print("entered")\n yield len(dir(g))+len(g.__dir__())\ng=produce()\nprint(next(g))\n', 'entered\n76\n');
});

test('generator directory collection obeys instruction, work and allocation limits', async () => {
  for (const [options, limits, expected] of [
    [{maxSteps: 300}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 15000}, 'OOM'],
  ]) {
    const result = await run('g=(x for x in (7,9))\nprint("entered")\nwhile True: names=dir(g)\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout, 'entered\n'); closed(result.closed);
  }
});

test('generator directories retain explicit core admission', async () => {
  for (const expression of ['dir(g)', 'g.__dir__()']) {
    const result = await runSourceRequest({modules: [unit('g=(x for x in (7,9))\n'+expression+'\n')], compileOptions: {languageProfile: 'core-source/1'}});
    if (expression === 'dir(g)') assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
    else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
    if (result.closed) closed(result.closed);
  }
});
