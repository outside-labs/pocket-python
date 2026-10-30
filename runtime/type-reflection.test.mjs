import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic type reflection fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/type-reflection.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('type reflection: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

async function lifecycle(source, expected, phases) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const phase of phases) for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (output === phase) {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached, phase);
      if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('owner reads retain detached native receivers and captured accessor cells through parked collection', async () => {
  const source = 'def make():\n saved=[9]\n def read(obj):\n  print("entered")\n  return saved[0]+obj[0]\n return property(read).__get__\nm=make()\nprint("held")\nprint(m.__objclass__ is property,m([7]))\n';
  await lifecycle(source, 'held\nentered\nTrue 16\n', ['held\n', 'held\nentered\n']);
});

test('owner metadata traversals share actual work and arena budgets', async () => {
  for (const [source, options, limits, code] of [
    ['while True: property.__get__.__objclass__\n', {maxSteps: 100000, maxWork: 3000}, undefined, 'BUDGET'],
    ['held=[]\nprint("entered")\nwhile True: held.append(property().__get__)\n', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error)); closed(result.closed);
  }
});

test('MRO lists and detached native methods retain temporary hierarchies through parked collection', async () => {
  for (const source of [
    'def make():\n class A: value=[9]\n class B(A): pass\n return B.mro\nm=make()\nprint("held")\na=m()\ndel m\nprint(a[1].value[0],a[0].__base__ is a[1])\n',
    'def make():\n class A: value=[9]\n class B(A): pass\n return B.mro()\na=make()\nprint("held")\nprint(a[1].value[0],a[0].__base__ is a[1])\n',
    'def make():\n class A: value=[9]\n class B(A): pass\n return type.mro.__get__(B)\nm=make()\nprint("held")\na=m()\ndel m\nprint(a[1].value[0],a[0].__base__ is a[1])\n',
  ]) await lifecycle(source, 'held\n9 True\n', ['held\n']);
});

test('MRO lookup and primary-base hooks preserve owned frames across interruption', async () => {
  for (const expression of ['C.mro()[0] is C', 'C.__base__ is object']) {
    const source = 'class M(type):\n def __getattribute__(cls,name):\n  print("entered")\n  return type.__getattribute__(cls,name)\nclass C(metaclass=M): pass\nprint('+expression+')\n';
    await lifecycle(source, 'entered\nTrue\n', ['entered\n']);
  }
});

test('MRO callbacks and retained lists obey actual recursion, work, instruction and arena limits', async () => {
  for (const [body, options, limits, code] of [
    ['return cls.mro', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 220}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
  ]) {
    const source = 'class M(type):\n def __getattribute__(cls,name):\n  print("entered")\n  '+body+'\nclass C(metaclass=M): pass\nC.mro()\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
  const result = await run('class C: pass\nheld=[]\nprint("entered")\nwhile True: held.append(C.mro())\n',
    {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 24000});
  assert.equal(result.stdout, 'entered\n'); assert.equal(result.error?.code, 'OOM', JSON.stringify(result.error)); closed(result.closed);
});

test('deferred custom MRO construction refuses before class bodies and inherited hook effects', async () => {
  for (const source of [
    'class M(type):\n print("never")\n def mro(cls): return type.mro(cls)\n',
    'class A:\n def mro(cls): return type.mro(cls)\nclass M(A,type):\n print("never")\n',
    'class A: pass\nclass M(A,type): pass\nA.mro=lambda cls:type.mro(cls)\nclass C(metaclass=M):\n print("never")\n',
    'class A: pass\nclass M(A,type): pass\nA.mro=lambda cls:type.mro(cls)\nM("C",(),{})\n',
  ]) {
    const result = await run(source); assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
    assert.equal(result.stdout, ''); closed(result.closed);
  }
});

test('type reflection retains core source admission and native-runtime boundaries', async () => {
  for (const source of ['int.mro()\n', 'print(int.__base__)\n', 'property.getter.__objclass__\n']) {
    const result = await runSourceRequest({modules: [unit(source)]});
    assert.ok(['UNSUPPORTED', 'PYTHON'].includes(result.error?.code)); closed(result.closed);
  }
});
