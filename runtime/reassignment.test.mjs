import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {environmentCell} from './function-objects.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic live class body fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/reassignment.json', import.meta.url)));
for (const item of corpus.cases) test('reassignment: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports || []}, ...(item.modules || []).map(m => ({...m, notice: "Synthetic module fixture"}))], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout); assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
async function lifecycle(source, expected, options = {}) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false, type, oldBase;
    session.context.begin({maxWork: 20000000, ...options, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (!reached && output === 'entered\n' && execution.state === 'parked') {
          reached = true;
          type = environmentCell(session.context.module('app').environment, 'C').value;
          oldBase = type.mro[1]; assert.notEqual(type.bases[0], oldBase);
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached); if (mode === 'finish') assert.equal(output, expected);
    } finally {
      const before = output; execution.close(); execution.close();
      if (reached) assert.equal(type.bases[0] === oldBase, mode !== 'finish');
      session.context.finish(); session.close();
      assert.equal(output, before);
    }
    closed(session.stats());
  } } finally { registry.close(); }
}
const hierarchySource = generator => `changing=False
class A: x=7
class B: x=9
${generator ? 'def sequence(cls):\n yield cls\n print("entered")\n yield B\n yield object\n' : ''}class M(type):
 def mro(cls):
  if changing:
${generator ? '   return sequence(cls)' : '   print("entered")'}
  return type.mro(cls)
class C(A,metaclass=M): pass
class D(C): pass
changing=True
C.__bases__=(B,)
print(C.x,D.x)
`;
for (const generator of [false, true]) test('hierarchy rollback survives parked collection, cancellation and close: ' + generator, async () => {
  await lifecycle(hierarchySource(generator), 'entered\nentered\n9 9\n');
});

test('subclass enumeration traces retained classes without retaining discarded classes', async () => {
  const source = 'class Base: pass\ndef make():\n class Child(Base): pass\n return Child()\na=make()\nprint(len(Base.__subclasses__()))\ndel a\nprint(len(Base.__subclasses__()))\n';
  const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile});
  assert.ok(result.ok, JSON.stringify(result.error)); assert.equal(result.stdout, '1\n0\n'); closed(result.closed);
});

test('hierarchy mutation restores retained classes after real execution limits', async () => {
  for (const [body, options, memoryLimits, name] of [
    ['return cls.mro()', {maxDepth: 12}, {}, 'RecursionError'],
    ['while True: pass', {maxSteps: 250}, {}, 'ExecutionLimitError'],
    ['while True: pass', {maxSteps: 100000, maxWork: 2000000}, {}, 'ExecutionLimitError'],
    ['held=[]\n   while True: held.append([7])', {maxSteps: 100000, maxWork: 100000000}, {maxBytes: 100000}, 'MemoryError'],
  ]) {
    const source = hierarchySource(false).replace('   print("entered")', '   print("entered")\n   ' + body);
    const {registry} = await compileSourceModules([unit(source)], profile);
    const session = new ModuleSession(registry, {memoryLimits}); let output = '', type, oldBase, lease, failure;
    session.context.begin({maxWork: 20000000, ...options}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      try { while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (!type && output === 'entered\n') {
          type = environmentCell(session.context.module('app').environment, 'C').value;
          oldBase = type.mro[1]; lease = session.memory.pin([type]);
        }
      } } catch (error) { failure = error; }
      assert.ok(type, name + ' must occur inside the mutation'); assert.equal(failure?.name, name);
      assert.equal(type.bases[0], oldBase); assert.equal(type.mro[1], oldBase);
    } finally {
      execution.close(); lease?.release(); session.context.finish(); session.close(); registry.close();
    }
    closed(session.stats());
  }
});
