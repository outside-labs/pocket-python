import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {attributeTask, instanceTask, completion, completionRoots, operationRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic attribute fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/attribute-hooks.json', import.meta.url)));

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('attribute source: ' + fixture.id, async () => {
    const result = await run(fixture.source);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    closed(result.closed);
  });

test('attribute operations retain original names, fallback snapshots and destinations', () => {
  const receiver = {}, key = {}, hook = {}, outer = {}, after = completion('relay', {receiver: outer});
  const target = completion('attribute-fallback', {receiver, key, name: 'x', hook, depth: 0, after});
  assert.deepEqual(completionRoots(target), [receiver, key, hook, outer]);
  assert.deepEqual(operationRoots(attributeTask(receiver, 'x', null, target, 0, 'get', key)), [receiver, key, null, receiver, key, hook, outer]);
  assert.deepEqual(operationRoots(attributeTask(receiver, 'x', null, after, 0, 'set', key, null, hook)), [receiver, key, null, hook, outer]);
  assert.throws(() => attributeTask(receiver, 7, null), TypeError);
  assert.throws(() => attributeTask(receiver, 'x', null, null, 0, 'unknown'), TypeError);
  for (const kind of ['instance-tuple', 'advertised-instance', 'advertised-super']) {
    const target = completion(kind, {receiver, type: hook, position: 1, nesting: 0, depth: 0, after});
    assert.deepEqual(completionRoots(target), [receiver, hook, outer]);
    assert.deepEqual(operationRoots(instanceTask(receiver, hook, null, target)), [receiver, hook, receiver, hook, outer]);
  }
});

test('read and binding callbacks survive every-instruction collection, cancellation and close', async () => {
  const sources = [
    'class A:\n def __getattribute__(self,name):\n  print("entered")\n  return [7]\nprint([1][0]+getattr(A(),"x",[9])[0])\n',
    'class A:\n def __getattr__(self,name):\n  print("entered")\n  return [7]\nprint([1][0]+A().x[0])\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  def read(name): return [7]\n  return read\nclass A: __getattribute__=D()\nprint([1][0]+A().x[0])\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  raise AttributeError("binding")\nclass A:\n __getattribute__=D()\n def __getattr__(self,name): return [7]\nprint([1][0]+A().x[0])\n',
    'class A:\n def __getattribute__(self,name):\n  del A.__getattr__\n  print("entered")\n  raise AttributeError("missing")\n def __getattr__(self,name): return [7]\nprint([1][0]+A().x[0])\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  def write(name,value): object.__setattr__(obj,name,value)\n  return write\nclass A: __setattr__=D()\na=A()\na.x=[7]\nprint([1][0]+a.x[0])\n',
    'class A:\n def __delattr__(self,name):\n  print("entered")\n  object.__delattr__(self,name)\na=A()\na.x=[7]\nsaved=a.x\ndel a.x\nprint([1][0]+saved[0])\n',
    'class B: pass\nclass A:\n @property\n def __class__(self):\n  print("entered")\n  return B\nprint([1][0]+isinstance(A(),((B,),7))*7)\n',
    'class B: pass\nclass A:\n @property\n def __class__(self):\n  print("entered")\n  return type("C",(B,),{})\ns=super(B,A())\nprint([1][0]+(s.__self_class__.__name__=="C")*7)\n',
  ];
  for (const source of sources) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n') {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.ok(reached); if (mode === 'finish') assert.equal(output, 'entered\n8\n');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed(session.stats());
    } } finally { registry.close(); }
  }
});

test('read hooks preserve source frames and share recursion, work and real allocation limits', async () => {
  for (const slot of ['__getattribute__', '__getattr__']) {
    const failure = await run('class A:\n def '+slot+'(self,name):\n  raise ValueError("original")\nA().x\n');
    assert.equal(failure.error.type, 'ValueError');
    assert.deepEqual(failure.error.traceback.map(f => [f.function, f.location.span[0]]), [['<module>', 4], [slot, 3]]);
    closed(failure.closed);
    for (const [body, options, limits, code] of [
      ['return self.x', {maxDepth: 12}, undefined, 'PYTHON'],
      ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
      ['items=[]\n  while True: items.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
    ]) {
      const result = await run('class A:\n def '+slot+'(self,name):\n  '+body+'\nA().x\n', options, limits);
      assert.equal(result.error.code, code); if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      closed(result.closed);
    }
  }
});

test('deferred special reflection refuses before instance hook effects', async () => {
  const result = await run('class A:\n def __getattribute__(self,name): print("never")\ngetattr(A(),"__slots__")\n');
  assert.equal(result.error.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); closed(result.closed);
});

test('unadopted metaclass protocols refuse definitions before class-body effects', async () => {
  for (const slot of ['__enter__', '__format__']) {
    const result = await run('class M(type):\n print("never")\n '+slot+'=None\n');
    assert.equal(result.error.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); if (result.closed) closed(result.closed);
    const dynamic = await run('type("M",(type,),{"'+slot+'":None})\n');
    assert.equal(dynamic.error.code, 'UNSUPPORTED'); assert.equal(dynamic.stdout, ''); closed(dynamic.closed);
  }
});

test('mutation hooks preserve error frames and share recursion, work and allocation limits', async () => {
  for (const slot of ['__setattr__', '__delattr__']) {
    const expression = slot === '__setattr__' ? 'A().x=7' : 'del A().x';
    const signature = slot === '__setattr__' ? 'self,name,value' : 'self,name';
    const failure = await run('class A:\n def '+slot+'('+signature+'):\n  raise ValueError("original")\n'+expression+'\n');
    assert.equal(failure.error.type, 'ValueError');
    assert.deepEqual(failure.error.traceback.map(f => [f.function, f.location.span[0]]), [['<module>', 4], [slot, 3]]);
    closed(failure.closed);
    for (const [body, options, limits, code] of [
      [slot === '__setattr__' ? 'self.x=value' : 'del self.x', {maxDepth: 12}, undefined, 'PYTHON'],
      ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
      ['items=[]\n  while True: items.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
    ]) {
      const result = await run('class A:\n def '+slot+'('+signature+'):\n  '+body+'\n'+expression+'\n', options, limits);
      assert.equal(result.error.code, code); if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      closed(result.closed);
    }
  }
});

test('advertised class callbacks preserve frames and share all activation limits', async () => {
  for (const expression of ['isinstance(A(),B)', 'super(B,A())']) {
    const failure = await run('class B: pass\nclass A:\n @property\n def __class__(self):\n  raise ValueError("original")\n'+expression+'\n');
    assert.equal(failure.error.type, 'ValueError');
    assert.deepEqual(failure.error.traceback.map(f => [f.function, f.location.span[0]]), [['<module>', 6], ['__class__', 5]]);
    closed(failure.closed);
    for (const [body, options, limits, code] of [
      ['return '+expression.replace('A()', 'self'), {maxDepth: 12}, undefined, 'PYTHON'],
      ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
      ['items=[]\n  while True: items.append([7])', {maxSteps: 100000}, {maxBytes: 26000}, 'OOM'],
    ]) {
      const result = await run('class B: pass\nclass A:\n @property\n def __class__(self):\n  '+body+'\n'+expression+'\n', options, limits);
      assert.equal(result.error.code, code); if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      closed(result.closed);
    }
  }
});

test('class-info nesting is bounded only along candidates actually visited', async () => {
  const prefix = 'class A:\n def __getattribute__(self,name): raise ValueError("never")\na=A()\ntypes=A\ni=0\nwhile i<33:\n types=(types,)\n i+=1\n';
  const result = await run(prefix+'print(isinstance(a,(A,types)))\n');
  assert.equal(result.error, undefined); assert.equal(result.stdout, 'True\n'); closed(result.closed);
  const bounded = await run(prefix+'isinstance(a,types)\n');
  assert.equal(bounded.error.code, 'BUDGET'); closed(bounded.closed);
});
