import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic iterator directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/iterator-directories.json', import.meta.url)));
for (const item of corpus.cases) test('iterator directory: ' + item.id, async () => {
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
      assert.equal(output, before, 'teardown must not run application callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('native callers retain detached cyclic list iterators and their positions', async () => {
  await lifecycle('items=[None,7]\nit=iter(items)\nitems[0]=it\nd=it.__dir__\ndel it\ndel items\nprint("entered")\nprint(len(d()),next(d.__self__) is d.__self__,next(d.__self__))\n', 'entered\n28 True 7\n');
});

test('native callers retain dictionary iterators without inspecting cyclic values', async () => {
  await lifecycle('items={"key":None}\nit=iter(items)\nitems["key"]=it\nd=it.__dir__\ndel it\ndel items\nprint("entered")\nprint(len(d()),next(d.__self__))\n', 'entered\n27 key\n');
});

test('native callers retain indexed source objects and cycles', async () => {
  await lifecycle('class Indexed:\n def __getitem__(self,i): return i+7\nvalue=Indexed()\nit=iter(value)\nvalue.saved=it\nd=it.__dir__\ndel it\ndel value\ndel Indexed\nprint("entered")\nprint(len(d()),next(d.__self__))\n', 'entered\n28 7\n');
});

test('native callers retain callable sources, exact sentinels and cycles', async () => {
  await lifecycle('class Produce:\n def __call__(self): return 7\nvalue=Produce()\nit=iter(value,value)\nvalue.saved=it\nd=it.__dir__\ndel it\ndel value\ndel Produce\nprint("entered")\nprint(len(d()),next(d.__self__))\n', 'entered\n26 7\n');
});

test('native callers retain memory iterators and detached backing storage', async () => {
  await lifecycle('storage=bytearray(b"ab")\nview=memoryview(storage)\nit=iter(view)\nd=it.__dir__\ndel it\ndel view\ndel storage\nprint("entered")\nprint(len(d()),next(d.__self__))\n', 'entered\n26 97\n');
});

test('nested native directory callers retain the iterator behind their binding chain', async () => {
  await lifecycle('it=iter((7,9))\nd=it.__dir__.__dir__\ndel it\nprint("entered")\nprint(len(d()),next(d.__self__.__self__))\n', 'entered\n30 7\n');
});

for (const expression of ['iter([7,9])', 'iter(memoryview(b"ab"))', 'iter(lambda: 7,0)'])
  test(expression+' directory collection obeys instruction, work and allocation limits', async () => {
    for (const [options, limits, expected] of [
      [{maxSteps: 300}, undefined, 'BUDGET'],
      [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
      [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 15000}, 'OOM'],
    ]) {
      const result = await run('it='+expression+'\nprint("entered")\nwhile True: names=dir(it)\n', options, limits);
      assert.equal(result.error?.code, expected, JSON.stringify(result.error));
      assert.equal(result.stdout, 'entered\n'); closed(result.closed);
    }
  });

test('iterator directories retain explicit core admission', async () => {
  for (const expression of ['dir(it)', 'it.__dir__()']) {
    const result = await runSourceRequest({modules: [unit('it=iter([7,9])\n'+expression+'\n')], compileOptions: {languageProfile: 'core-source/1'}});
    if (expression === 'dir(it)') assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
    else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
    if (result.closed) closed(result.closed);
  }
});
