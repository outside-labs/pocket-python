import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic advertised directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/advertised-directories.json', import.meta.url)));
for (const item of corpus.cases) test('advertised directory: ' + item.id, async () => {
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

for (const [name, source, expected] of [
 ['dictionary', 'class Meta(type):\n @property\n def __dict__(cls):\n  print("entered")\n  return {"virtual":7}\nclass A(metaclass=Meta): pass\nprint("virtual" in dir(A))\n', 'entered\nTrue\n'],
 ['base sequence', 'class Bases:\n def __len__(self):\n  print("entered")\n  return 1\n def __getitem__(self,index): return object\nclass Meta(type):\n @property\n def __bases__(cls): return Bases()\nclass A(metaclass=Meta): pass\nprint("__class__" in dir(A))\n', 'entered\nTrue\n'],
 ['type checking', 'class Fake:\n @property\n def __bases__(self):\n  print("entered")\n  return ()\nprint(isinstance(object(),Fake()))\n', 'entered\nFalse\n'],
]) test(name+' callback roots survive parking collection cancellation and close', async () => { await lifecycle(source, expected); });
for (const [options, limits, expected] of [
 [{maxSteps: 300}, undefined, 'BUDGET'],
 [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
 [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 30000}, 'OOM'],
]) test('advertised traversal shares '+expected+' limits '+JSON.stringify(options), async () => {
 const result = await run('class Meta(type): pass\nclass A(metaclass=Meta): pass\nprint("entered")\nwhile True: names=dir(A)\n', options, limits);
 assert.equal(result.error?.code, expected, JSON.stringify(result.error)); assert.equal(result.stdout, 'entered\n'); closed(result.closed);
});
