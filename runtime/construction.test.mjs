import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';
import {compileSource} from './source-compiler.mjs';
import {verifyFunctions} from './function-bytecode.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic construction fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };

test('allocation continuations retain the class, original operands and outer destinations', () => {
  const type = {}, argument = {}, keyword = {}, outer = {}, after = completion('relay', {receiver: outer});
  const target = completion('new-result', {type, args: [argument], keywords: ['x'], keywordValues: [keyword], depth: 1, after});
  assert.deepEqual(completionRoots(target), [type, argument, keyword, outer]);
});

test('constructor callbacks and bound initializer descriptors survive collection, cancellation and close', async () => {
  const sources = [
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  def create(cls,x,*,y): return object.__new__(cls)\n  return create\nclass A:\n __new__=D()\n def __init__(self,x,*,y): self.x=x[0]+y[0]\nprint([1][0]+A([3],y=[4]).x)\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  def initialize(x,*,y): obj.x=x[0]+y[0]\n  return initialize\nclass A:\n def __new__(cls,*args,**kwargs): return object.__new__(cls)\n __init__=D()\nprint([1][0]+A([3],y=[4]).x)\n',
  ];
  for (const source of sources) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
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

test('construction shares Python recursion, work and real allocation limits', async () => {
  for (const slot of ['__new__', '__init__']) for (const [body, options, limits, expected] of [
    [slot === '__new__' ? 'return cls()' : 'self.__init__()', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['a=[]\n  while True: a.append([7])', {maxSteps: 100000}, {maxBytes: 22000}, 'OOM'],
  ]) {
    const result = await run('class A:\n def '+slot+'('+(slot === '__new__' ? 'cls' : 'self')+'):\n  '+body+'\nA()\n', options, limits);
    assert.equal(result.error.code, expected); if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});

test('constructor binding and body errors retain their original source frames', async () => {
  for (const slot of ['__new__', '__init__']) {
    const result = await run('class A:\n def '+slot+'(value):\n  raise AttributeError("original")\nA()\n');
    assert.equal(result.error.type, 'AttributeError');
    assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.span[0]]), [['<module>', 4], [slot, 3]]);
    closed(result.closed);
  }
});

test('reading native constructors does not turn default class calls into custom slots', async () => {
  const result = await run('new=object.__new__\ninit=object.__init__\nclass A: pass\ntry: A(1)\nexcept TypeError: print("arguments")\nprint(isinstance(A(),A))\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'arguments\nTrue\n'); closed(result.closed);
});

test('initializer callability is checked at invocation after allocation effects', async () => {
  const result = await run('class A:\n def __new__(cls):\n  print("allocated")\n  return object.__new__(cls)\n __init__=None\nA()\n');
  assert.equal(result.error.type, 'TypeError'); assert.equal(result.stdout, 'allocated\n'); closed(result.closed);
});

test('initialization after custom allocation ignores instance shadow attributes', async () => {
  const result = await run('class A:\n def __new__(cls):\n  value=object.__new__(cls)\n  value.__init__=None\n  return value\n def __init__(self): self.x=7\nprint(A().x)\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7\n'); closed(result.closed);
});

test('lexical class cells are private, shared and retained even after method deletion', async () => {
  const result = await run('class A:\n def deleted(self): return __class__\n del deleted\nclass B:\n def f(self):\n  return lambda: __class__\nf=B().f()\nprint(f() is B)\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'True\n'); closed(result.closed);
  const compiled = compileSource('class A:\n def f(self): return __class__\n', profile);
  const raw = JSON.parse(JSON.stringify(compiled.program));
  raw.functions[1].locals = raw.functions[1].locals.filter(name => name !== '@source:class');
  assert.throws(() => verifyFunctions(raw), {code: 'BYTECODE'});
});

test('super descriptors and suspended generators retain the dynamic owner across collection', async () => {
  const source = 'class A:\n @property\n def f(self):\n  print("entered")\n  return [self.x]\nclass B(A):\n def g(self):\n  yield 1\n  yield super().f[0]\nb=B()\nb.x=7\ng=b.g()\nprint(next(g))\ndel b\nprint(next(g))\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); session.memory.collect([], {cleanup: true});
        if (output === '1\nentered\n') {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached); if (mode === 'finish') assert.equal(output, '1\nentered\n7\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('super reads the current base namespace, bypasses shadows and exposes immutable proxy metadata', async () => {
  const result = await run('class A:\n def f(self): return 1\nclass B(A): pass\nb=B()\np=super(B,b)\ndef changed(self): return 7\nA.f=changed\nb.f=None\nprint(p.f(),bool(p),p.__class__ is super,hash(p)==hash(p))\ntry: setattr(p,"__self__",None)\nexcept AttributeError: print("readonly")\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7 True True True\nreadonly\n'); closed(result.closed);
});

test('super descriptor failures retain source frames and shared resource limits', async () => {
  for (const [body, options, limits, expected] of [
    ['return self.f', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['a=[]\n  while True: a.append([7])', {maxSteps: 100000}, {maxBytes: 26000}, 'OOM'],
  ]) {
    const result = await run('class A:\n @property\n def f(self):\n  '+body+'\nclass B(A):\n def g(self): return super().f\nB().g()\n', options, limits);
    assert.equal(result.error.code, expected); if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});
