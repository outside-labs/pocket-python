import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from './source-compiler.mjs';
import {runSourceRequest} from './source-request.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = (name, source, imports = []) => ({name, source, imports, package: false, notice: 'Synthetic private-name fixture'});
const run = source => runSourceRequest({modules: [unit('app', source)], compileOptions: profile});

test('private bindings and parameters use verified storage names while function metadata stays original', async () => {
  const source = 'class A:\n def __read(self,__x=7,*,__y=9): return __x+__y\na=A()\nprint(a._A__read(_A__x=3,_A__y=4),A._A__read.__name__,A._A__read.__qualname__)\n';
  const compiled = compileSource(source, profile);
  assert.equal(compiled.program.version, 5);
  const fn = compiled.program.functions.find(fn => fn.name === '__read');
  assert.equal(fn.qualname, 'A.__read');
  assert.deepEqual(fn.params.positional, ['self', '_A__x']);
  assert.deepEqual(fn.params.kwonly, ['_A__y']);
  const actual = await run(source);
  assert.equal(actual.error, undefined, JSON.stringify(actual.error));
  assert.equal(actual.stdout, '7 __read A.__read\n');
  assert.equal(actual.closed.bytes, 0);
  const trailing = await run('class A:\n __x_=7\n def read(self): return self.__x_\nprint(A._A__x_,A().read())\n');
  assert.equal(trailing.error, undefined, JSON.stringify(trailing.error));
  assert.equal(trailing.stdout, '7 7\n');
});

test('mangled parameter collisions are syntax errors before application effects', async () => {
  for (const parameters of ['self,__x,_A__x', 'self,__x,*,_A__x', 'self,__x,/,_A__x']) {
    const actual = await run("print('never')\nclass A:\n def f(" + parameters + '): pass\n');
    assert.equal(actual.error.type, 'SyntaxError');
    assert.equal(actual.error.code, 'SYNTAX');
    assert.equal(actual.stdout, '');
    assert.equal(actual.stats, null);
    assert.equal(actual.error.location.span[0], 3);
  }
});

test('generated private names retain the identifier budget without truncation or partial effects', async () => {
  const accepted = 'A'.repeat(60), refused = 'A'.repeat(61);
  const compiled = compileSource('class ' + accepted + ':\n __x=7\n', profile);
  assert.ok(compiled.program.functions[1].locals.includes('_' + accepted + '__x'));
  const actual = await run("print('never')\nclass " + refused + ':\n __x=7\n');
  assert.equal(actual.error.code, 'COMPILE_BUDGET');
  assert.equal(actual.error.location.span[0], 3);
  assert.equal(actual.stdout, '');
  const cancelled = await runSourceRequest({modules: [unit('app', 'class A:\n __x=7\n')],
    compileOptions: {...profile, shouldCancel: () => true}});
  assert.equal(cancelled.error.code, 'CANCELLED');
});

test('private import transformation never supplies a missing module grant', async () => {
  const source = 'class A:\n import __secret\nprint(A._A__secret.value)\n';
  const modules = [unit('app', source, ['__secret']), unit('__secret', 'value=9\n'), unit('_A__secret', 'value=7\n')];
  const denied = await runSourceRequest({modules, compileOptions: profile});
  assert.equal(denied.error.type, 'ImportError');
  assert.equal(denied.stdout, '');
  assert.equal(denied.closed.bytes, 0);
  modules[0].imports = ['_A__secret'];
  const allowed = await runSourceRequest({modules, compileOptions: profile});
  assert.equal(allowed.error, undefined, JSON.stringify(allowed.error));
  assert.equal(allowed.stdout, '7\n');
  assert.equal(allowed.closed.roots, 0);
});

test('private from-imports require the transformed member rather than the literal spelling', async () => {
  const modules = [unit('app', 'class A:\n from helper import __value\n', ['helper']), unit('helper', '__value=7\n')];
  const actual = await runSourceRequest({modules, compileOptions: profile});
  assert.equal(actual.error.type, 'ImportError');
  assert.equal(actual.closed.bytes, 0);
});

test('default core syntax and later class features keep their existing refusal boundary', async () => {
  assert.equal(compileSource('__x=7\nprint(__x)\n').program.version, 4);
  assert.throws(() => compileSource('class A:\n __x=7\n'), {code: 'UNSUPPORTED'});
  for (const source of ['class A:\n def __add__(self,other): return 7\n',
    'async def f(): pass\n', 'class A:\n def read(self): return __class__\n']) {
    const actual = await run("print('never')\n" + source);
    assert.equal(actual.error.code, 'UNSUPPORTED');
    assert.equal(actual.stdout, '');
  }
});
