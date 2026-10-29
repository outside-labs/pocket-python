import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic sequence directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/sequence-directories.json', import.meta.url)));
for (const item of corpus.cases) test('sequence directory: ' + item.id, async () => {
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
      assert.equal(output, before, 'teardown must not run sequence callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('native callers retain detached very large ranges', async () => {
  await lifecycle('value=range(10**40,10**40+7)\nd=value.__dir__\ndel value\nprint("entered")\nprint(len(d()),d.__self__.stop-d.__self__.start)\n', 'entered\n35 7\n');
});

test('native callers retain slice container cycles without touching fields', async () => {
  await lifecycle('field=[]\nvalue=slice(field,field,field)\nfield.append(value)\nd=value.__dir__\ndel value\ndel field\nprint("entered")\nprint(len(d()),d.__self__.start[0] is d.__self__,d.__self__.stop is d.__self__.step)\n', 'entered\n28 True True\n');
});

test('native callers retain cyclic ordinary instance fields', async () => {
  await lifecycle('class Field: pass\nfield=Field()\nvalue=slice(field,field,field)\nfield.saved=value\nd=value.__dir__\ndel value\ndel field\ndel Field\nprint("entered")\nprint(len(d()),d.__self__.start.saved is d.__self__)\n', 'entered\n28 True\n');
});

test('nested native callers retain function and slice cycles', async () => {
  await lifecycle('def field(): return 7\nvalue=slice(field,field,field)\nfield.saved=value\nd=value.__dir__.__dir__\ndel value\ndel field\nprint("entered")\nprint(len(d()),d.__self__.__self__.start(),d.__self__.__self__.start.saved is d.__self__.__self__)\n', 'entered\n30 7 True\n');
});

for (const expression of ['range(7)', 'slice(7)']) {
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
      if (operation === 'dir(value)' || expression === 'slice(7)') assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
      else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
      if (result.closed) closed(result.closed);
    }
  });
}
