import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';

const unit = source => ({name: 'app', source, package: false, imports: [], notice: 'Synthetic special call notice'});
const run = (source, options = {}, memoryLimits = undefined) => runSourceRequest({modules: [unit(source)], compileOptions: {languageProfile: 'classes-source/1'}, options, memoryLimits});
const closed = result => {
  assert.equal(result.closed.bytes, 0); assert.equal(result.closed.roots, 0); assert.equal(result.closed.frames, 0);
};

test('implicit calls bypass instance attributes while ordinary direct calls retain their lookup', async () => {
  const result = await run('def other(): return 9\nclass A:\n def __call__(self): return 7\na=A()\na.__call__=other\nprint(a.__call__(),a())\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '9 7\n'); closed(result);
});

test('pending descriptor bindings retain original temporary positional and keyword values', async () => {
  const result = await run('def run(x,*,y): return x[0]+y[0]\nclass A:\n @property\n def __call__(self):\n  values=[1,2,3]\n  return run\nprint(A()([3],y=[4]))\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7\n'); closed(result);
});

test('call and binding failures keep the original caller and callback source locations', async () => {
  const called = await run('class A:\n def __call__(self):\n  return 1//0\nA()()\n');
  assert.equal(called.error.type, 'ZeroDivisionError');
  assert.deepEqual(called.error.traceback.map(f => [f.function, f.location.span[0]]), [['<module>', 4], ['__call__', 3]]); closed(called);
  const bound = await run('class D:\n def __get__(self,obj,owner):\n  raise ValueError("binding")\nclass A:\n __call__=D()\nA()()\n');
  assert.equal(bound.error.type, 'ValueError');
  assert.deepEqual(bound.error.traceback.map(f => [f.function, f.location.span[0]]), [['<module>', 6], ['__get__', 3]]); closed(bound);
});

test('Python recursion and frame-free callable redirect cycles have bounded ordinary errors', async () => {
  for (const source of [
    'class A:\n def __call__(self): return self()\nA()()\n',
    'class A: pass\na=A()\nA.__call__=a\na()\n',
    'class A:\n @property\n def __call__(self): return self\nA()()\n',
    // A native getter returns a wrapper around the same receiver; no Python getter frame is required.
    'class A:\n __call__=property(staticmethod)\nA()()\n'
  ]) {
    const result = await run(source, {maxDepth: 8, maxSteps: 100000, maxWork: 10000000});
    assert.equal(result.error.type, 'RecursionError', JSON.stringify(result.error)); closed(result);
  }
});

test('callable callbacks preserve constructor, ignored setter and notification completions', async () => {
  const result = await run('class Hook:\n def __call__(self,obj,value):\n  print(value)\n  return 99\nclass D:\n __set_name__=Hook()\n __set__=Hook()\nclass A:\n x=D()\na=A()\na.x=7\nclass Box:\n def __init__(self,n): self.n=n\nclass Factory:\n __call__=Box\nprint(Factory()(9).n)\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'x\n7\n9\n'); closed(result);
});

test('busy callable work and cancellation unwind the same owned graphs', async () => {
  const source = 'class A:\n def __call__(self):\n  while True: pass\nA()()\n';
  const bounded = await run(source, {maxSteps: 500}); assert.equal(bounded.error.code, 'BUDGET'); closed(bounded);
  let polls = 0;
  const cancelled = await run(source, {shouldCancel: () => ++polls > 10000});
  assert.equal(cancelled.error.code, 'CANCELLED'); closed(cancelled);
  const oom = await run('class A:\n def __call__(self):\n  print("entered")\n  values=[]\n  while True: values.append([1,2,3])\nA()()\n',
    {maxSteps: 100000, maxWork: 100000000}, {maxBytes: 32000});
  assert.equal(oom.stdout, 'entered\n'); assert.equal(oom.error.code, 'OOM', JSON.stringify(oom.error)); closed(oom);
});

test('later protocols still refuse before effects and default core selection stays unchanged', async () => {
  const later = await run('print("never")\nclass A:\n def __index__(self): return 7\n');
  assert.equal(later.error.code, 'UNSUPPORTED'); assert.equal(later.stdout, ''); assert.equal(later.stats, null);
  const core = await runSourceRequest({modules: [unit('class A:\n def __call__(self): return 7\n')]});
  assert.equal(core.error.code, 'UNSUPPORTED'); assert.equal(core.stats, null);
});


test('callable queries never execute property or descriptor binding and ignore instance shadows', async () => {
  const result = await run('class D:\n def __get__(self,obj,owner):\n  while True: pass\nclass A:\n __call__=D()\nclass B: pass\nb=B()\nb.__call__=print\nprint(callable(A()),callable(b))\n', {maxSteps: 1000});
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'True False\n'); closed(result);
});

test('query presence follows inherited type mutation without validating or invoking the slot value', async () => {
  const result = await run('class A: pass\nclass B(A): pass\nb=B()\nprint(callable(b))\nA.__call__=None\nprint(callable(b))\ndel A.__call__\nprint(callable(b))\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'False\nTrue\nFalse\n'); closed(result);
});

test('callable argument errors, global shadows and core builtin selection remain explicit', async () => {
  for (const source of ['callable()', 'callable(1,2)', 'callable(object=7)']) {
    const result = await run(source); assert.equal(result.error.type, 'TypeError'); closed(result);
  }
  const shadowed = await run('def callable(value): return value+1\nprint(callable(6))\n');
  assert.equal(shadowed.error, undefined); assert.equal(shadowed.stdout, '7\n'); closed(shadowed);
  const core = await runSourceRequest({modules: [unit('callable(print)\n')]});
  assert.equal(core.error.type, 'NameError'); closed(core);
});


test('existing native wrapper chains stay work-bounded without consuming Python or implicit call depth', async () => {
  const result = await run('def plain(): return 7\nwrapped=plain\ni=0\nwhile i<80:\n wrapped=staticmethod(wrapped)\n i+=1\nprint(wrapped())\nclass A:\n __call__=wrapped\nprint(A()())\n', {maxDepth: 8, maxWork: 10000000});
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7\n7\n'); closed(result);
});
