import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots, instanceTask, operationRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic type-check fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/type-checks.json', import.meta.url)));

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('type-check source: ' + fixture.id, async () => {
    const result = await run(fixture.source);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    closed(result.closed);
  });

test('type-check binding and truth continuations retain checked values and outer destinations', () => {
  const receiver = {}, type = {}, outer = {}, after = completion('relay', {receiver: outer});
  for (const kind of ['check-result', 'check-truth']) {
    const target = completion(kind, {receiver, type, depth: 1, after});
    assert.deepEqual(completionRoots(target), [receiver, type, outer]);
    assert.deepEqual(operationRoots(instanceTask(receiver, type, null, target)), [receiver, type, receiver, type, outer]);
    assert.throws(() => completion(kind, {receiver, type, depth: -1, after}), TypeError);
  }
  assert.throws(() => instanceTask(receiver, type, null, after, 0, 0, 'native'), TypeError);
});

const pausedSources = [
  'class M(type):\n def __instancecheck__(cls,obj):\n  print("entered")\n  return [7]\nclass A(metaclass=M): pass\nprint([1][0]+isinstance([7],((A,),7))*7)\n',
  'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  return lambda value: True\nclass M(type): __instancecheck__=D()\nprint([1][0]+isinstance([7],M("A",(),{}))*7)\n',
  'class Truth:\n def __bool__(self):\n  print("entered")\n  return True\nclass M(type):\n def __instancecheck__(cls,obj): return Truth()\nprint([1][0]+isinstance([7],type("N",(M,),{})("A",(),{}))*7)\n',
  'class A: pass\nclass B:\n @property\n def __class__(self):\n  print("entered")\n  return A\nprint([1][0]+type.__instancecheck__(A,B())*7)\n',
];

test('instance checking survives collection, cancellation and close during binding, checking and truth', async () => {
  for (const source of pausedSources) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n' && !reached) {
            reached = true;
            if (mode === 'close') { execution.close(); break; }
            if (mode === 'cancel') cancel = true;
          }
        }
        if (mode === 'finish') assert.equal(output, 'entered\n8\n');
        else assert.equal(mode, 'close');
      } catch (error) {
        if (mode === 'finish') throw error;
        assert.equal(mode, 'cancel'); assert.equal(error.code, 'CANCELLED');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); closed(session.stats()); }
      assert.ok(reached);
      if (mode !== 'finish') assert.equal(output, 'entered\n');
    } } finally { registry.close(); }
  }
});

test('instance callback and truth failures retain source frames and release all owners', async () => {
  for (const [source, frames] of [
    ['class M(type):\n def __instancecheck__(cls,obj):\n  raise ValueError("original")\nclass A(metaclass=M): pass\nisinstance(7,A)\n', [['<module>',5],['__instancecheck__',3]]],
    ['class Truth:\n def __bool__(self):\n  raise ValueError("original")\nclass M(type):\n def __instancecheck__(cls,obj): return Truth()\nclass A(metaclass=M): pass\nisinstance(7,A)\n', [['<module>',7],['__bool__',3]]],
  ]) {
    const result = await run(source);
    assert.equal(result.error.type, 'ValueError');
    assert.deepEqual(result.error.traceback.map(f => [f.function,f.location.span[0]]), frames);
    closed(result.closed);
  }
});

test('instance checking shares recursion, instruction, work and arena limits', async () => {
  for (const [body, options, limits, code] of [
    ['return isinstance(obj,cls)', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 5000}, undefined, 'BUDGET'],
    ['items=[]\n  while True: items.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const result = await run('class M(type):\n def __instancecheck__(cls,obj):\n  '+body+'\nclass A(metaclass=M): pass\nisinstance(7,A)\n', options, limits);
    assert.equal(result.error.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    closed(result.closed);
  }
});

test('descriptor binding and result truth share activation limits and preserve error frames', async () => {
  for (const phase of ['binding', 'truth']) for (const [body, options, limits, code] of [
    [phase === 'binding' ? 'return isinstance(7,obj)' : 'return bool(self)', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['items=[]\n  while True: items.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const source = phase === 'binding' ?
      'class D:\n def __get__(self,obj,owner):\n  '+body+'\nclass M(type): __instancecheck__=D()\nclass A(metaclass=M): pass\nisinstance(7,A)\n' :
      'class Truth:\n def __bool__(self):\n  '+body+'\nclass M(type):\n def __instancecheck__(cls,obj): return Truth()\nclass A(metaclass=M): pass\nisinstance(7,A)\n';
    const result = await run(source, options, limits);
    assert.equal(result.error.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    closed(result.closed);
  }
});

test('ordinary checking ignores class shadows and instance attribute hooks', async () => {
  const result = await run('class A:\n def __instancecheck__(self,obj): return True\nclass Checker:\n def __getattribute__(self,name): raise ValueError("never")\n def __instancecheck__(self,obj): return True\nprint(isinstance(7,A),isinstance(7,Checker()))\n');
  assert.equal(result.stdout, 'False True\n'); assert.equal(result.ok, true); closed(result.closed);
});
