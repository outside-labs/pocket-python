import test from 'node:test';
import assert from 'node:assert/strict';
import {CLASS_SPECIAL_POLICY, DESCRIPTOR_HOOKS, allowsClassSpecial} from './class-policy.mjs';
import {compileSource} from './source-compiler.mjs';
import {ClassRuntime} from './class-values.mjs';

const profile = {languageProfile: 'classes-source/1'};
test('shared policy is immutable and keeps metadata distinct from ordinary slot admission', () => {
  assert.ok(Object.isFrozen(CLASS_SPECIAL_POLICY)); assert.ok(Object.isFrozen(DESCRIPTOR_HOOKS));
  assert.throws(() => { CLASS_SPECIAL_POLICY.__init__.mutate = false; }, TypeError);
  assert.throws(() => { CLASS_SPECIAL_POLICY.__matmul__ = {}; }, TypeError);
  for (const name of ['__init__', '__call__', '__len__', '__bool__', '__repr__', '__str__', '__index__', '__getitem__', '__setitem__', '__delitem__', ...DESCRIPTOR_HOOKS])
    for (const context of ['define', 'attribute', 'mutate']) assert.equal(allowsClassSpecial(name, context), true);
  for (const name of ['__call__', '__len__', '__bool__', '__repr__', '__str__', '__index__', '__getitem__', '__setitem__', '__delitem__']) assert.equal(allowsClassSpecial(name, 'implicit'), true);
  assert.equal(allowsClassSpecial('__init__', 'implicit'), false);
  for (const name of ['__instancecheck__', '__subclasscheck__'])
    for (const context of ['define', 'attribute', 'mutate', 'implicit']) assert.equal(allowsClassSpecial(name, context), true);
  assert.equal(allowsClassSpecial('__module__', 'define'), true);
  assert.equal(allowsClassSpecial('__module__', 'attribute'), false);
  assert.equal(allowsClassSpecial('__module__', 'mutate'), false);
  assert.equal(allowsClassSpecial('ordinary', 'attribute'), true);
  assert.throws(() => allowsClassSpecial('__init__', 'unknown'), TypeError);
});

test('source and direct class records reject unadopted protocols through the same policy', () => {
  const runtime = new ClassRuntime(), root = runtime.root();
  for (const name of ['__matmul__', '__format__', '__prepare__', '__dir__']) {
    assert.equal(allowsClassSpecial(name, 'define'), false);
    assert.throws(() => compileSource('print("never")\nclass A:\n '+name+'=None\n', profile), {code: 'UNSUPPORTED'});
    assert.throws(() => runtime.create('A', 'A', 'app', [], new Map([[name, null]]), root), {code: 'UNSUPPORTED'});
    const cls = runtime.create('A', 'A', 'app', [], new Map(), root);
    assert.throws(() => runtime.mutate(cls, name, null), {code: 'UNSUPPORTED'});
    assert.throws(() => runtime.read(runtime.instance(cls), name), {code: 'UNSUPPORTED'});
  }
});
