import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic ordinary instance directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/instance-directories.json', import.meta.url)));
for (const item of corpus.cases) test('ordinary instance directory: ' + item.id, async () => {
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

test('native instance callers retain cyclic receiver and class graphs', async () => {
  await lifecycle('class A: pass\nv=A()\nv.saved=v\nd=v.__dir__\ndel v\ndel A\nprint("entered")\nprint("saved" in d(),d.__self__.saved is d.__self__)\n', 'entered\nTrue True\n');
});
test('nested directory callers retain their full receiver chain', async () => {
  await lifecycle('class A: pass\nv=A()\nv.saved=v\nd=v.__dir__.__dir__\ndel v\ndel A\nprint("entered")\nprint(len(d()),d.__self__.__self__.saved is d.__self__.__self__)\n', 'entered\n30 True\n');
});
test("owned dictionary phases survive parking collection cancellation and close", async () => {
  await lifecycle("class A:\n @property\n def __dict__(self):\n  print(\"entered\")\n  return {\"virtual\":7}\nprint(\"virtual\" in dir(A()))\n", "entered\nTrue\n");
});
test("owned advertised class phases survive parking collection cancellation and close", async () => {
  await lifecycle("class B: marker=7\nclass A:\n @property\n def __class__(self):\n  print(\"entered\")\n  return B\nprint(\"marker\" in dir(A()))\n", "entered\nTrue\n");
});
test("owned collision truth phases survive parking collection cancellation and close", async () => {
  await lifecycle("class Truth:\n def __bool__(self):\n  print(\"entered\")\n  return True\nclass Key:\n def __hash__(self): return hash(\"__doc__\")\n def __eq__(self,other): return Truth()\nclass A: pass\nv=A()\nkey=Key()\nv.__dict__={key:7}\nprint(object.__dir__(v)[0] is key)\n", "entered\nentered\nTrue\n");
});
for (const expression of ['object()', 'A()']) test(expression+' directory loops obey real budgets', async () => {
  for (const [options, limits, expected] of [
    [{maxSteps: 300}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 18000}, 'OOM'],
  ]) {
    const result = await run('class A: pass\nv='+expression+'\nprint("entered")\nwhile True: names=dir(v)\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout, 'entered\n'); closed(result.closed);
  }
});
for (const operation of ['dir(object())', 'object().__dir__()']) test('instance directory core admission: '+operation, async () => {
  const result = await runSourceRequest({modules: [unit(operation+'\n')], compileOptions: {languageProfile: 'core-source/1'}});
  assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
