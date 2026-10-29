import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic set/buffer directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/buffer-directories.json', import.meta.url)));
for (const item of corpus.cases) test('set/buffer directory: ' + item.id, async () => {
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
      assert.equal(output, before, 'teardown must not run buffer or contained callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

for (const [expression, count] of [['{7}',57], ['frozenset((7,))',44]]) {
  test(expression+' native callers retain cyclic set/key graphs without rehashing', async () => {
    await lifecycle('class Key:\n def __hash__(self): return 7\nkey=Key()\nvalue='+expression.replace('7','key')+'\nkey.saved=value\ndef forbidden(self): raise RuntimeError("hash")\nKey.__hash__=forbidden\nd=value.__dir__\ndel value\ndel key\ndel Key\nprint("entered")\nprint(len(d()),next(iter(d.__self__)).saved is d.__self__)\n', 'entered\n'+count+' True\n');
  });
}

test('native callers retain detached byte storage', async () => {
  await lifecycle('value=b"abc"\nd=value.__dir__\ndel value\nprint("entered")\nprint(len(d()),d.__self__[1])\n', 'entered\n78 98\n');
});

test('native callers retain mutable bytearray aliases', async () => {
  await lifecycle('storage=bytearray(b"abc")\nview=memoryview(storage)\nd=storage.__dir__\ndel storage\nprint("entered")\nview[0]=90\nprint(len(d()),d.__self__[0],view[0])\n', 'entered\n91 90 90\n');
});

test('nested native callers retain reversed child views after parent release', async () => {
  await lifecycle('storage=bytearray(b"abcd")\nparent=memoryview(storage)\nvalue=parent[::-2]\nd=value.__dir__.__dir__\nparent.release()\ndel parent\ndel value\ndel storage\nprint("entered")\nprint(len(d()),d.__self__.__self__.tobytes()==b"db")\nd.__self__.__self__[0]=90\nprint(d.__self__.__self__.obj[3])\n', 'entered\n30 True\n90\n');
});

test('native callers retain readonly views without changing data authority', async () => {
  await lifecycle('storage=bytearray(b"abc")\nvalue=memoryview(storage).toreadonly()\nd=value.__dir__\ndel value\ndel storage\nprint("entered")\nprint(len(d()),d.__self__.readonly,d.__self__[0])\n', 'entered\n55 True 97\n');
});

test('released views retain directories without retaining storage or reviving access', async () => {
  await lifecycle('storage=bytearray(b"abc")\nvalue=memoryview(storage)\nd=value.__dir__\nvalue.release()\ndel value\ndel storage\nprint("entered")\nprint(len(d()),len(dir(d.__self__)))\ntry: d.__self__[0]\nexcept ValueError: print("released")\n', 'entered\n55 55\nreleased\n');
});

for (const expression of ['set()', 'frozenset()', 'b"abc"', 'bytearray(b"abc")', 'memoryview(b"abc")']) {
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
