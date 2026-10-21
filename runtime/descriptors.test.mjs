import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';

const run = (source, options = {}) => runSourceRequest({modules: [{name: 'app', package: false, imports: [],
  notice: 'Synthetic descriptor fixture notice', source}], compileOptions: {languageProfile: 'classes-source/1'}, options});
const closed = result => {
  assert.equal(result.closed.bytes, 0); assert.equal(result.closed.roots, 0); assert.equal(result.closed.frames, 0);
};

test('descriptor recursion, work and cancellation use ordinary VM frames and release all roots', async () => {
  const source = 'class D:\n def __get__(self,obj,owner): return obj.x\nclass A:\n x=D()\nA().x\n';
  const recursive = await run(source, {maxDepth: 8});
  assert.equal(recursive.error.type, 'RecursionError'); closed(recursive);
  const bounded = await run(source, {maxWork: 10000, maxDepth: 256});
  assert.equal(bounded.error.code, 'BUDGET'); closed(bounded);
  let polls = 0;
  const cancelled = await run(source, {shouldCancel: () => ++polls > 5000});
  assert.equal(cancelled.error.code, 'CANCELLED'); closed(cancelled);
});

test('constructor-valued descriptor hooks preserve discard and notification continuations', async () => {
  const source = 'events=[]\nclass Hook:\n def __init__(self,obj,value): events.append(value)\nclass D:\n __set__=Hook\n __set_name__=Hook\nclass A:\n x=D()\na=A()\na.x=7\nprint(events[0],events[1])\n';
  const result = await run(source);
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'x 7\n'); closed(result);
});

test('failed notification preserves the old binding and traces the original hook exception', async () => {
  const result = await run('class D:\n def __set_name__(self,owner,name):\n  raise ValueError("notification")\nclass A:\n x=D()\n');
  assert.equal(result.error.type, 'ValueError');
  assert.deepEqual(result.error.traceback.map(frame => frame.function), ['<module>', '__set_name__']);
  assert.deepEqual(result.error.traceback.map(frame => frame.location.span[0]), [4, 3]); closed(result);
  const caught = await run('class D:\n def __set_name__(self,owner,name): raise ValueError("notification")\nA=7\ntry:\n class A:\n  x=D()\nexcept ValueError: pass\nprint(A)\n');
  assert.equal(caught.error, undefined); assert.equal(caught.stdout, '7\n'); closed(caught);
});

test('notification snapshots retain removed later descriptors until their callback completes', async () => {
  const source = 'class D:\n def __set_name__(self,owner,name):\n  if name=="first": del owner.second\n  print(name)\nclass A:\n first=D()\n second=D()\nprint(A.__name__)\n';
  const result = await run(source);
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'first\nsecond\nA\n'); closed(result);
});

test('retained property accessor copies and native method wrappers keep their defining closures', async () => {
  const result = await run('def make(value):\n def read(self): return value\n p=property(read)\n return p.getter\ncopy=make(7)\ndef replacement(self): return 9\np=copy(replacement)\nclass A:\n x=p\nprint(A().x,p.fget is replacement)\ndef build(value):\n def method(): return value\n return staticmethod(method)\nwrapped=build(8)\nprint(wrapped())\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '9 True\n8\n'); closed(result);
});

test('native property callbacks preserve exceptions, ignored setter returns and initialized getter values', async () => {
  const result = await run('class Result:\n def __init__(self,obj): self.saved=7\nclass A:\n def write(self,value): return 99\n x=property(Result,write)\na=A()\na.x=1\nprint(a.x.saved)\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7\n'); closed(result);
  const failed = await run('class A:\n def read(self): return 1//0\n x=property(read)\nA().x\n');
  assert.equal(failed.error.type, 'ZeroDivisionError');
  assert.deepEqual(failed.error.traceback.map(frame => frame.function), ['<module>', 'read']); closed(failed);
});

test('native wrapper argument errors are Python errors and default core builtins stay bounded', async () => {
  for (const expression of ['property(1,fget=2)', 'property(unknown=1)', 'staticmethod()', 'classmethod(1,2)', 'property().setter()']) {
    const result = await run(expression + '\n'); assert.equal(result.error.type, 'TypeError', expression); closed(result);
  }
  const result = await runSourceRequest({modules: [{name: 'app', package: false, imports: [],
    notice: 'Synthetic core fixture notice', source: 'property()\n'}]});
  assert.equal(result.error.type, 'NameError'); closed(result);
});

test('decorators obey the count budget before effects and preserve default core refusal', async () => {
  const prefix = 'def identity(value): return value\n';
  const accepted = await run(prefix + '@identity\n'.repeat(16) + 'def f(): return 7\nprint(f())\n');
  assert.equal(accepted.error, undefined, JSON.stringify(accepted.error)); assert.equal(accepted.stdout, '7\n'); closed(accepted);
  const bounded = await run('print("never")\n' + prefix + '@identity\n'.repeat(17) + 'def f(): pass\n');
  assert.equal(bounded.error.code, 'COMPILE_BUDGET'); assert.equal(bounded.stdout, ''); assert.equal(bounded.stats, null);
  const core = await runSourceRequest({modules: [{name: 'app', source: '@missing\ndef f(): pass\n',
    package: false, imports: [], notice: 'Synthetic decorator fixture notice'}]});
  assert.equal(core.error.code, 'UNSUPPORTED'); assert.equal(core.stats, null);
});

test('decorator errors retain their expression locations and old bindings', async () => {
  const failed = await run('@7\ndef f(): pass\n');
  assert.equal(failed.error.type, 'TypeError'); assert.equal(failed.error.location.span[0], 1); closed(failed);
  const missing = await run('@missing\nclass A: pass\n');
  assert.equal(missing.error.type, 'NameError'); assert.equal(missing.error.location.span[0], 1); closed(missing);
  const result = await run('def reject(value): raise ValueError("reject")\nf=7\ntry:\n @reject\n def f(): pass\nexcept ValueError: pass\nprint(f)\n');
  assert.equal(result.error, undefined); assert.equal(result.stdout, '7\n'); closed(result);
});

test('decorator closures resolve in the enclosing scope and private expressions use its class context', async () => {
  const result = await run('def build(value):\n def decorate(fn):\n  def wrapped(): return value\n  return wrapped\n @decorate\n def f(): return 0\n return f\nprint(build(7)())\nclass Outer:\n def __decorate(value): return value\n @__decorate\n class Inner:\n  @property\n  def __value(self): return 9\n  def read(self): return self.__value\nprint(Outer.Inner().read())\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7\n9\n'); closed(result);
});
