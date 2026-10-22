import test from 'node:test';
import assert from 'node:assert/strict';
import {completion, completionRoots, callTask, unaryTask, valueTask, operationRoots, controlRoots, retainTransfer} from './operations.mjs';
import {MemoryArena} from './memory.mjs';
import {Cell} from './function-objects.mjs';

test('closed completions preserve ordered duplicate ancestor roots and init frame costs', () => {
  const receiver = {}, instance = {}, arg = {}, keyword = {}, type = {}, descriptor = {};
  const relay = completion('relay', {receiver});
  const formatted = completion('format-result', {receiver, slot: '__str__', after: relay});
  const printed = completion('print-argument', {args: [arg, keyword], index: 1, depth: 2, after: formatted});
  assert.deepEqual(completionRoots(printed), [arg, keyword, receiver, receiver]);
  assert.throws(() => completion('print-argument', {args: [arg], index: 1, depth: 0}), TypeError);
  assert.throws(() => completion('print-argument', {args: [arg], index: 0, depth: 257}), TypeError);
  const init = completion('init', {instance, after: relay});
  const protocol = completion('protocol-result', {receiver, slot: '__bool__', operation: 'truth', after: init});
  const optional = completion('optional-truth', {receiver, operation: 'truth', depth: 2, after: protocol});
  const invoke = completion('invoke', {args: [arg], keywords: ['key'], keywordValues: [keyword], depth: 2, after: optional});
  assert.deepEqual(completionRoots(invoke), [arg, keyword, receiver, receiver, instance, receiver]);
  assert.deepEqual(completionRoots(init, true), [instance, instance, receiver]);
  assert.deepEqual(completionRoots(completion('class', {bases: [type], module: 'app'}), true), [type]);
  const entries = [['first', descriptor], ['second', descriptor]];
  const notification = completion('notify', {type, entries, index: 0}); entries.pop();
  assert.deepEqual(completionRoots(notification), [type, descriptor, descriptor]);
  for (const after of [completion('condition', {control: 'while'}), completion('discard'), null]) assert.deepEqual(completionRoots(after), []);
  assert.deepEqual(operationRoots(callTask(receiver, [arg], ['key'], [keyword], null, init)), [receiver, arg, keyword, instance, receiver]);
  for (const task of [unaryTask('truth', arg, null, init), valueTask(arg, null, init)]) assert.deepEqual(operationRoots(task), [arg, instance, receiver]);
  const target = []; retainTransfer(target, [arg], init); assert.deepEqual(target, [arg, instance, receiver]);
  assert.throws(() => completion('future'), TypeError);
  assert.throws(() => completionRoots({kind: 'relay', receiver}), TypeError);
  assert.throws(() => operationRoots({kind: 'future'}), TypeError);
  assert.throws(() => controlRoots({type: 'future'}), TypeError);
  assert.throws(() => { invoke.args.push(null); }, TypeError);
});

test('control roots keep null placeholders, pending returns and active error edges', () => {
  const value = {}, caught = {}, previous = {}, iterator = {};
  assert.deepEqual(controlRoots({type: 'block', stack: [value, value]}), [value, value]);
  assert.deepEqual(controlRoots({type: 'while'}), [null, null, null, null]);
  assert.deepEqual(controlRoots({type: 'for', iterator}), [iterator, null, null, null]);
  assert.deepEqual(controlRoots({type: 'try', pending: {kind: 'return', value}, caught, previous}), [null, value, caught, previous]);
});

test('failed transfer preflight leaves the original operation owner valid', () => {
  const memory = new MemoryArena({maxBytes: 512});
  const cell = memory.allocate(48, [], () => new Cell());
  const task = unaryTask('truth', cell, null);
  const leave = memory.enter(() => operationRoots(task));
  try {
    memory.collect();
    const before = memory.stats();
    assert.throws(() => memory.pin([...operationRoots(task), ...Array(64).fill(7n)]), {code: 'OOM'});
    assert.equal(memory.stats().roots, 0);
    memory.collect(); assert.equal(memory.stats().bytes, before.bytes);
    // A successful transfer installs the lease while the old scope is still live.
    const lease = memory.pin(operationRoots(task));
    leave(); assert.equal(lease.get()[0], cell); assert.equal(memory.stats().objects, 1);
    lease.release(); assert.equal(memory.stats().bytes, 0);
  } finally { memory.close(); }
  assert.equal(memory.stats().frames, 0); assert.equal(memory.stats().roots, 0);
});
