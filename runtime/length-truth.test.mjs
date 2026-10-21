import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';

const unit = source => ({name: 'app', source, package: false, imports: [], notice: 'Synthetic length/truth notice'});
const run = (source, options = {}, memoryLimits = undefined) => runSourceRequest({modules: [unit(source)],
  compileOptions: {languageProfile: 'classes-source/1'}, options, memoryLimits});
const closed = result => {
  assert.equal(result.closed.bytes, 0); assert.equal(result.closed.roots, 0); assert.equal(result.closed.frames, 0);
};

test('length validates integers and uses a fixed signed-64-bit positive maximum', async () => {
  for (const [source,expected] of [['True','1'],['9223372036854775807','9223372036854775807']]) {
    const result = await run('class A:\n def __len__(self): return '+source+'\nprint(len(A()))\n');
    assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, expected+'\n'); closed(result);
  }
  for (const [value,error] of [['-9223372036854775809','ValueError'],['9223372036854775808','OverflowError'],['None','TypeError']]) {
    const result = await run('class A:\n def __len__(self): return '+value+'\nlen(A())\n');
    assert.equal(result.error.type, error); closed(result);
  }
});

test('implicit truth uses type slots while direct reads observe instance shadows', async () => {
  const result = await run('class A:\n def __bool__(self): return False\n def __len__(self): return 7\na=A()\ndef yes(): return True\na.__bool__=yes\nprint(a.__bool__(),bool(a),len(a),not a)\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'True False 7 True\n'); closed(result);
});

test('optional bool binding fallback is distinct from body failures and normal length validation', async () => {
  const source = 'class A:\n @property\n def __bool__(self): raise AttributeError("binding")\n def __len__(self): return -1\nprint(bool(A()))\n';
  const fallback = await run(source); assert.equal(fallback.error, undefined, JSON.stringify(fallback.error));
  assert.equal(fallback.stdout, 'True\n'); closed(fallback);
  const missingGetter = await run('class A:\n __bool__=property()\n __len__=property()\nprint(bool(A()),not A())\n');
  assert.equal(missingGetter.error, undefined, JSON.stringify(missingGetter.error));
  assert.equal(missingGetter.stdout, 'True False\n'); closed(missingGetter);
  for (const expression of ['bool(A())','not A()','1 if A() else 2']) {
    const result = await run('class A:\n def __bool__(self): raise AttributeError("body")\n def __len__(self): return 7\n'+expression+'\n');
    assert.equal(result.error.type, 'AttributeError'); assert.equal(result.error.message, 'body'); closed(result);
  }
});

test('temporary receiver and partially evaluated expression operands survive suspended binding and truth', async () => {
  const result = await run('class Flag:\n def __init__(self,n): self.__n=n\n @property\n def __bool__(self):\n  values=[1,2,3]\n  def yes(): return self.__n>0\n  return yes\nprint(([7] if Flag(1) else [9])[0])\nprint([8][0]+(3 if Flag(0) else 4))\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '7\n12\n'); closed(result);
});

test('short circuiting retains operand identity and while resumes through continue and finally', async () => {
  const result = await run('class A:\n def __init__(self,n): self.n=n\n def __bool__(self):\n  self.n-=1\n  return self.n>=0\na=A(0)\nb=A(2)\nprint((a and b) is a,(b or a) is b)\nwhile b:\n try:\n  continue\n finally: print(b.n)\nelse: print("done")\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'True True\n0\ndone\n'); closed(result);
});

test('callback failures and invalid results retain the original branch and loop source locations', async () => {
  for (const statement of ['if A(): pass','while A(): pass','print(1 if A() else 2)','print(not A())','bool(A())']) {
    const result = await run('class A:\n def __bool__(self):\n  return 1//0\n'+statement+'\n');
    assert.equal(result.error.type, 'ZeroDivisionError');
    assert.deepEqual(result.error.traceback.map(f => [f.function,f.location.span[0]]), [['<module>',4],['__bool__',3]]); closed(result);
  }
  const invalid = await run('class A:\n def __bool__(self): return 7\nwhile A(): pass\n');
  assert.equal(invalid.error.type, 'TypeError');
  assert.deepEqual(invalid.error.traceback.map(f => [f.function,f.location.span[0]]), [['<module>',3]]); closed(invalid);
});

test('optional binding recovery preserves the surrounding active exception and finally behavior', async () => {
  const result = await run('class A:\n @property\n def __bool__(self): raise AttributeError("missing")\n def __len__(self): raise\ntry:\n raise ValueError("original")\nexcept ValueError:\n try:\n  while A(): pass\n except ValueError as error: print(str(error))\n finally: print("finally")\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'original\nfinally\n'); closed(result);
});

test('recursive Python truth and frame-free builtin binding cycles have bounded Python errors', async () => {
  for (const source of [
    'class A:\n def __bool__(self): return bool(self)\nbool(A())\n',
    'class A:\n def __len__(self): return len(self)\nlen(A())\n',
    'class A:\n __bool__=property(bool)\nbool(A())\n',
    'class A:\n __len__=property(len)\nlen(A())\n',
    'class A:\n @property\n def __bool__(self): raise AttributeError("missing")\n def __len__(self): return self\nbool(A())\n'
  ]) {
    const result = await run(source, {maxDepth: 8, maxSteps: 100000, maxWork: 10000000});
    assert.equal(result.error.type, 'RecursionError', JSON.stringify(result.error)); closed(result);
  }
});

test('native wrapper unwrapping does not consume protocol depth', async () => {
  const result = await run('def yes(): return True\nwrapped=yes\ni=0\nwhile i<80:\n wrapped=staticmethod(wrapped)\n i+=1\nclass A:\n __bool__=wrapped\nprint(bool(A()))\n', {maxDepth: 8, maxWork: 10000000});
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'True\n'); closed(result);
});

test('busy length/truth callbacks and bindings obey work and cancellation limits', async () => {
  for (const source of [
    'class A:\n def __len__(self):\n  print("entered")\n  while True: pass\nlen(A())\n',
    'class A:\n @property\n def __bool__(self):\n  print("entered")\n  while True: pass\nwhile A(): pass\n'
  ]) {
    const bounded = await run(source, {maxSteps: 500});
    assert.equal(bounded.stdout, 'entered\n'); assert.equal(bounded.error.code, 'BUDGET'); closed(bounded);
    const work = await run(source, {maxSteps: 1000000, maxWork: 50000});
    assert.equal(work.stdout, 'entered\n'); assert.equal(work.error.code, 'BUDGET'); assert.match(work.error.message, /work/i); closed(work);
    let polls = 0;
    const cancelled = await run(source, {shouldCancel: () => ++polls > 10000});
    assert.equal(cancelled.stdout, 'entered\n'); assert.equal(cancelled.error.code, 'CANCELLED'); closed(cancelled);
  }
});

test('memory exhaustion inside a truth binding unwinds pending operands and receiver roots', async () => {
  const result = await run('class A:\n @property\n def __bool__(self):\n  print("entered")\n  values=[]\n  while True: values.append([1,2,3])\nprint([7][0]+(1 if A() else 2))\n',
    {maxSteps: 100000, maxWork: 100000000}, {maxBytes: 32000});
  assert.equal(result.stdout, 'entered\n'); assert.equal(result.error.code, 'OOM', JSON.stringify(result.error)); closed(result);
});

test('primitive core behavior and future protocol refusal remain explicit', async () => {
  const core = await runSourceRequest({modules: [unit('print(len("A😀"),bool([]),not 0)\ni=2\nwhile i: i-=1\nelse: print(i)\n')]});
  assert.equal(core.error, undefined); assert.equal(core.stdout, '2 False True\n0\n'); closed(core);
  const future = await run('print("never")\nclass Index:\n def __index__(self): return 7\n');
  assert.equal(future.error.code, 'UNSUPPORTED'); assert.equal(future.stdout, ''); assert.equal(future.stats, null);
});
