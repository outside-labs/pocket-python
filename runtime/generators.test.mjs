import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {runSourceRequest} from './source-request.mjs';
import {GeneratorValue} from './function-objects.mjs';
import {valueLayout} from './values.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic generator fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };

test('yield syntax is bound to its own function and verified before effects', () => {
  for (const source of ['yield 1\n', 'class A:\n yield 1\n']) assert.throws(() => compileSource(source, profile), {code: 'SYNTAX'});
  const code = structuredClone(compileSource('def g(): yield 1\n').program);
  code.functions[0].blocks[0].instructions[0] = ['yield'];
  assert.throws(() => new Execution(code), /Yield requires a function/);
});

test('generator iterables compose with consumers, displays, unpacking and calls', async () => {
  const result = await run('def g():\n yield 1\n yield 2\ndef f(a,b): return a+b\na=[*g()]\nb,c=g()\nprint(a[0],b,c,f(*g()),all(g()),any(g()),len(set(g())),bytes(g())[1],2 in g())\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.equal(result.stdout, '1 1 2 3 True True 2 2 True\n'); closed(result.closed);
});

test('suspended aliases and cycles retain cells and controls across every collection boundary', async () => {
  const source = 'def inner(n):\n try:\n  x=[n]\n  yield x\n  yield x\n finally: print("final")\ndef outer():\n r=yield from inner(7)\n return r\na=outer()\nb=next(a)\nb.append(a)\nprint(next(a)[0])\nprint(a.close())\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, parked = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        const snapshot = execution.advance(); session.memory.collect([], {cleanup: true});
        const generator = session.context.module('app')?.environment.cells.get('a')?.value;
        if (generator instanceof GeneratorValue && generator.status === 'suspended') {
          parked = true; assert.ok(valueLayout(generator).children.length > 1);
          assert.ok(snapshot.memory.frames < 5);
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(parked); assert.equal(output, mode === 'finish' ? '7\nfinal\nNone\n' : '');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('generator resumes share total work/instruction quotas and suspended allocation bounds', async () => {
  const prefix = 'def g():\n while True: yield [7]\n';
  for (const [source, options, limits, code] of [
    [prefix+'all(g())\n', {maxSteps: 300}, undefined, 'BUDGET'],
    [prefix+'a=[]\nfor x in range(300):\n b=g()\n next(b)\n a.append(b)\n', {maxSteps: 50000}, {maxBytes: 18000}, 'OOM'],
  ]) {
    const result = await run(source, options, limits); assert.equal(result.error.code, code); closed(result.closed);
  }
});

test('delegation to user iterators forwards send, throw, close and return values', async () => {
  const result = await run('class D:\n def __iter__(self): return self\n def __next__(self): return 1\n def send(self,x): return x+2\n def throw(self,e): raise StopIteration(8)\n def close(self): print("close")\ndef g():\n try:\n  r=yield from D()\n  yield r\n finally: print("final")\na=g()\nprint(next(a),a.send(3),a.throw(ValueError))\nprint(a.close())\nb=g()\nprint(next(b),b.close())\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.equal(result.stdout, '1 5 8\nfinal\nNone\nclose\nfinal\n1 None\n'); closed(result.closed);
});
