import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic metaclass attribute fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/metaclass-attributes.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('metaclass attribute: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
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
        execution.advance(); session.memory.collect([], {cleanup: true});
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

test('temporary classes, descriptor closures and fallback snapshots survive collection and interruption', async () => {
  for (const source of [
    'def make():\n class M(type):\n  def __getattribute__(cls,name):\n   print("read")\n   return [7]\n return M("A",(),{})\nprint([1][0]+make().x[0])\n',
    'def make():\n class D:\n  def __get__(self,obj,owner):\n   print("bind")\n   saved=[7]\n   def read(name):\n    print("read")\n    return saved\n   return read\n class M(type): __getattribute__=D()\n return M("A",(),{})\nprint([1][0]+make().x[0])\n',
    'def make():\n class M(type):\n  def __getattribute__(cls,name):\n   del M.__getattr__\n   print("read")\n   raise AttributeError("missing")\n  def __getattr__(cls,name):\n   print("fallback")\n   return [7]\n return M("A",(),{})\nprint([1][0]+make().x[0])\n',
    'def make():\n class D:\n  def __get__(self,obj,owner):\n   print("bind")\n   raise AttributeError("binding")\n class M(type):\n  __getattribute__=D()\n  def __getattr__(cls,name):\n   print("fallback")\n   return [7]\n return M("A",(),{})\nprint([1][0]+make().x[0])\n',
    'def make():\n class M(type):\n  @property\n  def x(cls):\n   print("read")\n   return [7]\n return M("A",(),{})\nprint([1][0]+type.__getattribute__(make(),"x")[0])\n',
  ]) {
    const markers = source.includes('"fallback"') ? (source.includes('"bind"') ? ['bind', 'fallback'] : ['read', 'fallback']) :
      source.includes('"bind"') ? ['bind', 'read'] : ['read'];
    await lifecycle(source, markers.join('\n')+'\n8\n', markers.map((_, i) => markers.slice(0, i+1).join('\n')+'\n'));
  }
});

test('native bound type readers retain temporary class receivers during collection', async () => {
  const source = 'class M(type):\n def reader(cls): return super().__getattribute__\ndef make():\n class A(metaclass=M): x=[7]\n return A.reader()\nf=make()\nprint("held")\nprint(f("x")[0],type(f).__name__,f.__self__.__name__)\n';
  await lifecycle(source, 'held\n7 method-wrapper A\n', ['held\n']);
});

test('metaclass reads preserve binding, hook and fallback source frames', async () => {
  for (const [source, frames] of [
    ['class M(type):\n def __getattribute__(cls,name):\n  raise ValueError("original")\nclass A(metaclass=M): pass\nA.x\n', [['<module>',5],['__getattribute__',3]]],
    ['class M(type):\n def __getattr__(cls,name):\n  raise ValueError("original")\nclass A(metaclass=M): pass\nA.x\n', [['<module>',5],['__getattr__',3]]],
    ['class D:\n def __get__(self,obj,owner):\n  raise ValueError("original")\nclass M(type): __getattribute__=D()\nclass A(metaclass=M): pass\nA.x\n', [['<module>',6],['__get__',3]]],
  ]) {
    const result = await run(source);
    assert.equal(result.error?.code, 'PYTHON'); assert.equal(result.error?.type, 'ValueError');
    assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.span[0]]), frames);
    closed(result.closed);
  }
});

test('metaclass read and binding phases share recursion, work, instruction and real arena limits', async () => {
  for (const phase of ['read', 'fallback', 'bind']) for (const [body, options, limits, code] of [
    ['return obj.x', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    ['held=[]\n  while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const source = phase === 'bind' ? 'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  '+body+'\nclass M(type): __getattribute__=D()\nclass A(metaclass=M): pass\nA.x\n' :
      'class M(type):\n def '+(phase === 'read' ? '__getattribute__' : '__getattr__')+'(obj,name):\n  print("entered")\n  '+body+'\nclass A(metaclass=M): pass\nA.x\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.includes('entered\n'), phase+' '+JSON.stringify(options)+' '+JSON.stringify(result.error)); closed(result.closed);
  }
});

test('metaclass mutation binding, bodies and data descriptors retain values across collection and interruption', async () => {
  for (const [source, markers] of [
    ['def make():\n class D:\n  def __get__(self,obj,owner):\n   print("bind")\n   def write(name,value):\n    print("write")\n    type.__setattr__(obj,name,value)\n   return write\n class M(type): __setattr__=D()\n return M("A",(),{})\na=make()\na.x=[7]\nprint(a.x[0])\n', ['bind','write']],
    ['def make():\n class D:\n  def __get__(self,obj,owner):\n   print("bind")\n   def remove(name):\n    print("delete")\n    type.__delattr__(obj,name)\n   return remove\n class M(type): __delattr__=D()\n return M("A",(),{"x":[7]})\na=make()\nsaved=a.x\ndel a.x\nprint(saved[0])\n', ['bind','delete']],
    ['class M(type):\n @property\n def x(cls): return 9\n @x.setter\n def x(cls,value):\n  print("write")\n  cls.saved=value\nclass A(metaclass=M): pass\nA.x=[7]\nprint(A.saved[0])\n', ['write']],
    ['class M(type):\n @property\n def x(cls): return 9\n @x.deleter\n def x(cls):\n  print("delete")\n  cls.saved=[7]\nclass A(metaclass=M): pass\ndel A.x\nprint(A.saved[0])\n', ['delete']],
    ['class M(type):\n def writer(cls): return super().__setattr__\ndef make():\n class A(metaclass=M): pass\n return A.writer()\nf=make()\nprint("held")\nf("x",[7])\nprint(f.__self__.x[0])\n', ['held']],
  ]) await lifecycle(source, markers.join('\n')+'\n7\n', markers.map((_, i) => markers.slice(0, i+1).join('\n')+'\n'));
});

test('metaclass mutation hooks and bindings preserve frames and actual activation limits', async () => {
  for (const slot of ['__setattr__','__delattr__']) {
    const setting = slot === '__setattr__', signature = setting ? 'cls,name,value' : 'cls,name';
    const expression = setting ? 'A.x=[7]' : 'del A.x';
    for (const phase of ['hook','bind']) {
      const prefix = body => phase === 'bind' ? 'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  '+body+'\nclass M(type): '+slot+'=D()\nclass A(metaclass=M): pass\n'+expression+'\n' :
        'class M(type):\n def '+slot+'('+signature+'):\n  print("entered")\n  '+body+'\nclass A(metaclass=M): pass\n'+expression+'\n';
      const failure = await run(prefix('raise ValueError("original")'));
      assert.equal(failure.error?.type, 'ValueError');
      assert.deepEqual(failure.error.traceback.map(frame => [frame.function, frame.location.span[0]]),
        phase === 'bind' ? [['<module>',7],['__get__',4]] : [['<module>',6],[slot,4]]);
      closed(failure.closed);
      for (const [body, options, limits, code] of [
        [setting ? (phase === 'bind' ? 'obj.x=[7]' : 'cls.x=value') : (phase === 'bind' ? 'del obj.x' : 'del cls.x'), {maxDepth: 12}, undefined, 'PYTHON'],
        ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
        ['while True: pass', {maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
        ['held=[]\n  while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 26000}, 'OOM'],
      ]) {
        const result = await run(prefix(body), options, limits);
        assert.equal(result.error?.code, code, phase+' '+JSON.stringify(result));
        if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
        assert.ok(result.stdout.includes('entered\n')); closed(result.closed);
      }
    }
  }
});
