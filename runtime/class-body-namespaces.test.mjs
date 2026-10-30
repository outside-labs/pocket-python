import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic live class body fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/class-body-namespaces.json', import.meta.url)));
for (const item of corpus.cases) test('live class body: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout); assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
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
      const before = output; execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before);
    }
    closed(session.stats());
  } } finally { registry.close(); }
}
test('class namespace and free cells survive parked key comparison and collection', async () => {
  await lifecycle('class Key:\n def __hash__(self): return hash("value")\n def __eq__(self,name):\n  print("entered")\n  return name=="value"\nclass C:\n ns=locals()\n ns[Key()]=[7]\n print(value[0])\n', 'entered\n7\n');
});
test('class-cell propagation retains the original live mapping through parked metaclass callbacks', async () => {
  await lifecycle('class M(type):\n def __new__(meta,name,bases,ns):\n  print("entered")\n  return type.__new__(meta,name,bases,ns)\nclass C(metaclass=M):\n ns=locals()\n def f(self): return __class__\nprint(C().f() is C,"__classcell__" in C.ns)\n', 'entered\nTrue True\n');
});
test('comprehension walrus cells survive suspended generator ownership', async () => {
  await lifecycle('def outer():\n value=19\n g=((value:=item) for item in [7,9])\n print("entered")\n print(next(g),value,next(g),value)\nouter()\n', 'entered\n7 7 9 9\n');
});
for (const [options, limits, expected] of [
  [{maxSteps: 250}, undefined, 'BUDGET'],
  [{maxSteps: 100000, maxWork: 6000}, undefined, 'BUDGET'],
  [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 18000}, 'OOM'],
]) test('class namespace growth uses real ' + expected + ' limits ' + JSON.stringify(options), async () => {
  const result = await runSourceRequest({modules: [unit('class C:\n ns=locals()\n value=0\n while True:\n  ns[value]=[value]\n  value=value+1\n')],
    compileOptions: profile, options, memoryLimits: limits});
  assert.equal(result.error?.code, expected, JSON.stringify(result.error)); closed(result.closed);
});
