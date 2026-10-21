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
