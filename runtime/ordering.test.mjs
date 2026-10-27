import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots, compareTask, operationRoots} from './operations.mjs';
import {ORDERING_SLOTS} from './class-policy.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic ordering fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/ordering.json', import.meta.url)));

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('ordering source: ' + fixture.id, async () => {
    const result = await run(fixture.source);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    if (fixture.error_frames) assert.deepEqual(result.error.traceback.map(f => ({function: f.function, line: f.location.span[0]})), fixture.error_frames);
    closed(result.closed);
  });

test('ordering completions retain both operands and outer destinations', () => {
  const left = {}, right = {}, outer = {}, after = completion('relay', {receiver: outer});
  assert.ok(Object.isFrozen(ORDERING_SLOTS));
  for (const operation of Object.keys(ORDERING_SLOTS)) {
    assert.ok(Object.isFrozen(ORDERING_SLOTS[operation]));
    const target = completion('compare-result', {left, right, operation, position: 1, depth: 3, after});
    assert.deepEqual(completionRoots(target), [left, right, outer]);
    assert.deepEqual(operationRoots(compareTask(operation, left, right, null, target)), [left, right, left, right, outer]);
  }
  assert.throws(() => compareTask('less', left, right, null, null, 0, 3), TypeError);
});

const pausedSources = [
  'class A:\n @property\n def __lt__(self):\n  print("entered")\n  return lambda other: other[0]\nprint([1][0]+(A()< [7]))\n',
  'class A:\n def __lt__(self,other):\n  print("entered")\n  return other[0]\nprint([1][0]+(A()< [7]))\n',
  'class R:\n def __bool__(self):\n  print("entered")\n  return self.saved[0]==7\nclass A:\n def __lt__(self,other):\n  r=R()\n  r.saved=other\n  return r\nprint([7][0]+bool(A()< [7]))\n',
  'class A:\n @property\n def __eq__(self):\n  print("entered")\n  return lambda other: False\n def __lt__(self,other): return other[0]\nprint([1][0]+([A()]<[[7]]))\n',
  'class R:\n def __bool__(self):\n  print("entered")\n  return self.saved[0]==8\nclass A:\n def __eq__(self,other):\n  r=R()\n  r.saved=other\n  return r\n def __lt__(self,other): return other[0]\nprint([1][0]+([A()]<[[7]]))\n',
  'class A:\n def __eq__(self,other): return False\n @property\n def __lt__(self):\n  print("entered")\n  return lambda other: other[0]\nprint([1][0]+([A()]<[[7]]))\n',
  'class A:\n def __init__(self): self.saved=[7]\n def __eq__(self,other): return False\n def __lt__(self,other):\n  print("entered")\n  del x[0]\n  del y[0]\n  return other.saved[0]\nx=[A()]\ny=[A()]\nprint([1][0]+(x<y))\n',
  'class A:\n @property\n def __eq__(self):\n  print("entered")\n  return lambda other: False\n def __lt__(self,other): return other[0]\nprint([1][0]+(slice(A())<slice([7])))\n',
  'class R:\n def __bool__(self):\n  print("entered")\n  return self.saved[0]==8\nclass A:\n def __eq__(self,other):\n  r=R()\n  r.saved=other\n  return r\n def __lt__(self,other): return other[0]\nprint([1][0]+(slice(A())<slice([7])))\n',
  'class A:\n def __eq__(self,other): return False\n @property\n def __lt__(self):\n  print("entered")\n  return lambda other: other[0]\nprint([1][0]+(slice(A())<slice([7])))\n',
];

test('paused ordering binding, body and consuming truth survive collection, cancellation and close', async () => {
  for (const source of pausedSources) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n' && !reached) {
            reached = true;
            if (mode === 'close') { execution.close(); break; }
            if (mode === 'cancel') cancel = true;
          }
        }
        if (mode === 'finish') assert.equal(output, 'entered\n8\n');
        else assert.equal(mode, 'close');
      } catch (error) {
        if (mode === 'finish') throw error;
        assert.equal(mode, 'cancel'); assert.equal(error.code, 'CANCELLED');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); closed(session.stats()); }
      assert.ok(reached);
      if (mode !== 'finish') assert.equal(output, 'entered\n');
    } } finally { registry.close(); }
  }
});

test('ordering binding and body share instruction, work, recursion and arena budgets', async () => {
  for (const binding of [false, true]) for (const [body, options, limits, code] of [
    ['while True: pass', {maxSteps: 500}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 12000}, undefined, 'BUDGET'],
    [binding ? 'return self<7' : 'return self<other', {maxDepth: 12}, undefined, 'PYTHON'],
    ['held=[]\n  while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    for (const expression of ['A()< [7]', 'slice(A())<slice([7])']) {
      const source = 'class A:\n '+(binding ? '@property\n ' : '')+'def __lt__(self'+(binding ? '' : ',other')+'):\n  '+body+'\n'+expression+'\n';
      const result = await run(source, options, limits);
      assert.equal(result.error.code, code, JSON.stringify(result.error));
      if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      closed(result.closed);
    }
  }
});

test('frame-free ordering callable cycles are bounded by implicit dispatch depth', async () => {
  const result = await run('class A: pass\na=A()\nA.__call__=a\nA.__lt__=a\na<7\n', {maxDepth: 12});
  assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
});

test('reflected NotImplemented reloads the forward slot after callback mutation', async () => {
  const result = await run('class A:\n def __lt__(self,other): return 3\nclass B(A):\n def __gt__(self,other):\n  A.__lt__=lambda self,other: 7\n  return NotImplemented\nprint(A()<B())\n');
  assert.equal(result.stdout, '7\n'); assert.equal(result.ok, true); closed(result.closed);
});

test('recursive element equality during ordering shares the comparison depth limit', async () => {
  const result = await run('class A:\n def __eq__(self,other): return [self]<[other]\n[A()]<[A()]\n', {maxDepth: 12});
  assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
});

test('nested slices and recursive slice equality have bounded comparison depth', async () => {
  for (const source of [
    'x=1\ny=2\nfor i in range(24):\n x=slice(x)\n y=slice(y)\nx<y\n',
    'class A:\n def __eq__(self,other): return slice(self)==slice(other)\nslice(A())==slice(A())\n',
  ]) {
    const result = await run(source, {maxDepth: 12});
    assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});

test('ordering dictionaries and user-key sets retain their own boundaries', async () => {
  const dictionary = await run('class A: pass\nprint({"a":A()}<{"a":A()})\n');
  assert.equal(dictionary.error.type, 'TypeError'); closed(dictionary.closed);
  const set = await run('class A:\n def __hash__(self): return 7\n def __eq__(self,other): raise ValueError("never")\nx={A()}\nprint(x<=x)\n');
  assert.equal(set.error.code, 'UNSUPPORTED'); assert.equal(set.stdout, ''); closed(set.closed);
});

test('core admission and metaclass ordering refuse before user effects', async () => {
  const result = await runSourceRequest({modules: [unit('print("never")\nclass A:\n def __lt__(self,other): return True\nA()<7\n')]});
  assert.equal(result.error.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); assert.equal(result.stats, null);
  for (const source of [
    'class M(type):\n print("never")\n def __lt__(cls,other): return True\n',
    'class M(type): pass\nM.__lt__=lambda self,other: True\n',
  ]) {
    const result = await run(source);
    assert.equal(result.error.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); closed(result.closed);
  }
});
