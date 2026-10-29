import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic ordinary container directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/container-directories.json', import.meta.url)));
for (const item of corpus.cases) test('ordinary container directory: ' + item.id, async () => {
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
      assert.equal(output, before, 'teardown must not run contained callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('native callers retain detached Unicode strings', async () => {
  await lifecycle('value="a😀中"\nd=value.__dir__\ndel value\nprint("entered")\nprint(len(d()),d.__self__[1])\n', 'entered\n81 😀\n');
});

test('native callers retain self-referential lists', async () => {
  await lifecycle('value=[]\nvalue.append(value)\nd=value.__dir__\ndel value\nprint("entered")\nprint(len(d()),d.__self__[0] is d.__self__)\n', 'entered\n48 True\n');
});

test('nested native callers retain tuple/list cycles', async () => {
  await lifecycle('items=[]\nvalue=(items,)\nitems.append(value)\nd=value.__dir__.__dir__\ndel value\ndel items\nprint("entered")\nprint(len(d()),d.__self__.__self__[0][0] is d.__self__.__self__)\n', 'entered\n30 True\n');
});

test('native callers retain self-referential dictionaries', async () => {
  await lifecycle('value={}\nvalue["self"]=value\nd=value.__dir__\ndel value\nprint("entered")\nprint(len(d()),d.__self__["self"] is d.__self__)\n', 'entered\n46 True\n');
});

test('directory collection retains cyclic dictionary keys without rehashing', async () => {
  await lifecycle('class Key:\n def __hash__(self): return 7\nkey=Key()\nvalue={key:9}\nkey.saved=value\nd=value.__dir__\ndel value\ndel key\ndel Key\nprint("entered")\nprint(len(d()),next(iter(d.__self__)).saved is d.__self__)\n', 'entered\n46 True\n');
});

test('directory callers retain function globals and container cycles', async () => {
  await lifecycle('def f(): return 7\nvalue={"f":f}\nf.saved=value\nd=value.__dir__\ndel value\ndel f\nprint("entered")\nprint(len(d()),d.__self__["f"](),d.__self__["f"].saved is d.__self__)\n', 'entered\n46 7 True\n');
});

for (const expression of ['"a😀中"', '[7,9]', '(7,9)', '{"a":7}']) {
  test(expression+' directories obey real instruction, work and allocation limits', async () => {
    for (const [options, limits, expected] of [
      [{maxSteps: 300}, undefined, 'BUDGET'],
      [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
      [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 15000}, 'OOM'],
    ]) {
      const result = await run('value='+expression+'\nprint("entered")\nwhile True: names=dir(value)\n', options, limits);
      assert.equal(result.error?.code, expected, JSON.stringify(result.error));
      assert.equal(result.stdout, 'entered\n'); closed(result.closed);
    }
  });
  test(expression+' directories retain explicit core admission', async () => {
    for (const operation of ['dir(value)', 'value.__dir__()']) {
      const result = await runSourceRequest({modules: [unit('value='+expression+'\n'+operation+'\n')], compileOptions: {languageProfile: 'core-source/1'}});
      assert.equal(operation === 'dir(value)' ? result.error?.type : result.error?.code,
        operation === 'dir(value)' ? 'NameError' : 'UNSUPPORTED', JSON.stringify(result.error));
      if (result.closed) closed(result.closed);
    }
  });
}
