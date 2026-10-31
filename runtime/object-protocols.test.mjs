import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots, arithmeticTask, operationRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic object protocol fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };

test('attribute reflection retains defaults, receiver and outer destinations', () => {
  const receiver = {}, fallback = {}, outer = {}, after = completion('relay', {receiver: outer});
  assert.deepEqual(completionRoots(completion('attribute-result', {receiver, default: fallback, mode: 'getattr', after})), [receiver, fallback, outer]);
  assert.deepEqual(completionRoots(completion('attribute-write', {receiver, after})), [receiver, outer]);
  assert.throws(() => completion('attribute-result', {receiver, default: null, mode: 'setattr'}), TypeError);
});

test('dynamic attribute names preserve arbitrary text without identifier normalization or mangling', async () => {
  const result = await run('class A: pass\na=A()\nsetattr(a,"",1)\nsetattr(a,"two words",2)\nsetattr(a,"K",3)\nsetattr(a,"K",4)\nprint(getattr(a,""),getattr(a,"two words"),getattr(a,"K"),getattr(a,"K"))\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '1 2 3 4\n'); closed(result.closed);
});

test('reflection suppresses only AttributeError and validates signatures before callbacks', async () => {
  for (const [expression, type] of [['getattr(A(),7)', 'TypeError'], ['hasattr(A(),"x")', 'StopIteration'], ['getattr(A(),"x",9)', 'StopIteration'], ['setattr(A(),"x")', 'TypeError']]) {
    const result = await run('class A:\n @property\n def x(self): raise StopIteration("body")\n'+expression+'\n');
    assert.equal(result.error.type, type); closed(result.closed);
  }
  const result = await run('class A:\n @property\n def x(self): raise AttributeError("body")\na=A()\nprint(getattr(a,"x",[4])[0],hasattr(a,"x"))\n');
  assert.equal(result.stdout, '4 False\n'); assert.equal(result.error, undefined); closed(result.closed);
});

test('descriptor getters and setters keep temporary operands across collection, cancellation and close', async () => {
  const sources = [
    'class A:\n @property\n def x(self):\n  print("entered")\n  raise AttributeError("missing")\nprint(getattr(A(),"x",[7])[0])\n',
    'class A:\n @property\n def x(self): return 0\n @x.setter\n def x(self,value):\n  print("entered")\n  self.saved=value\na=A()\nprint(setattr(a,"x",[7]),a.saved[0])\n',
  ];
  for (let index = 0; index < sources.length; index++) {
    const {registry} = await compileSourceModules([unit(sources[index])], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n') {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.ok(reached); if (mode === 'finish') assert.equal(output, index ? 'entered\nNone 7\n' : 'entered\n7\n');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed(session.stats());
    } } finally { registry.close(); }
  }
});

test('reflection callbacks share recursion, work and memory budgets', async () => {
  const recursive = await run('class A:\n @property\n def x(self): return getattr(self,"x")\ngetattr(A(),"x")\n');
  assert.equal(recursive.error.type, 'RecursionError'); closed(recursive.closed);
  const budget = await run('class A:\n @property\n def x(self):\n  while True: pass\ngetattr(A(),"x",9)\n', {maxSteps: 200});
  assert.equal(budget.error.code, 'BUDGET'); closed(budget.closed);
  const oom = await run('class A:\n @property\n def x(self):\n  a=[]\n  while True: a.append([7])\ngetattr(A(),"x")\n', {maxSteps: 100000}, {maxBytes: 20000});
  assert.equal(oom.error.code, 'OOM'); closed(oom.closed);
});

test('binary, reflected and in-place arithmetic slots share complete operand roots', async () => {
  const left = {}, right = {}, modulus = {}, outer = {}, after = completion('relay', {receiver: outer});
  assert.deepEqual(operationRoots(arithmeticTask('power', [left, right, modulus], null, after)), [left, right, modulus, outer]);
  assert.throws(() => arithmeticTask('matrix', [left, right], null), TypeError);
  for (const [symbol, stem] of [['+', 'add'], ['-', 'sub'], ['*', 'mul'], ['/', 'truediv'], ['//', 'floordiv'], ['%', 'mod'], ['**', 'pow'], ['<<', 'lshift'], ['>>', 'rshift'], ['&', 'and'], ['|', 'or'], ['^', 'xor']]) {
    const source = 'class A:\n def __'+stem+'__(self,x): return [x+1]\n def __i'+stem+'__(self,x): return [x+3]\nclass R:\n def __r'+stem+'__(self,x): return [x+2]\na=A()\na'+symbol+'=4\nprint((A()'+symbol+'4)[0],(4'+symbol+'R())[0],a[0])\n';
    const result = await run(source); assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(result.stdout, '5 6 7\n'); closed(result.closed);
  }
});

test('reflected overrides have subclass priority while inherited slots and instance shadows do not', async () => {
  const result = await run('class A:\n def __add__(self,x):\n  print("left")\n  return NotImplemented\n def __radd__(self,x):\n  print("right")\n  return 8\nclass B(A): pass\na=A()\na.__add__=None\nprint(a+B())\nclass C(A):\n __radd__=None\ntry: A()+C()\nexcept TypeError: print("override")\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'left\nright\n8\noverride\n'); closed(result.closed);
});

test('sequence repetition falls back to index conversion and retains in-place list aliases', async () => {
  const result = await run('class I:\n def __index__(self): return 2\na=[7]\nb=a\na*=I()\nprint(a is b,len(b),len(I()*b"x"),len(b"x"*I()))\nclass R:\n def __rmul__(self,other): return 9\nprint([1]*R())\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'True 2 2 2\n9\n'); closed(result.closed);
});

test('optional power modulus distinguishes None without asserting integer interning', async () => {
  const result = await run('class A:\n def __pow__(self,x,mod=None): return x if mod is None else mod\n def __rpow__(self,x,mod=None): return x+mod\nprint(pow(A(),3),pow(A(),3,7),pow(2,A(),5))\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, '3 7 7\n'); closed(result.closed);
});

test('arithmetic binding AttributeError falls back while body failures retain original frames', async () => {
  for (const binding of [false, true]) {
    const result = await run('class A:\n '+(binding ? '@property\n ' : '')+'def __add__(self'+(binding ? '' : ',other')+'):\n  raise AttributeError("original")\nclass B:\n def __radd__(self,other):\n  print("bad")\n  return 7\nA()+B()\n');
    if (binding) { assert.equal(result.error, undefined); assert.equal(result.stdout, 'bad\n'); }
    else { assert.equal(result.error.type, 'AttributeError'); assert.equal(result.error.traceback.at(-1).function, '__add__'); assert.equal(result.stdout, ''); }
    closed(result.closed);
  }
});

test('arithmetic callbacks survive collection and unwind on cancellation, budget and allocation failure', async () => {
  const source = 'class A:\n @property\n def __add__(self):\n  print("entered")\n  def use(other): return [other[0]+3]\n  return use\nprint((A()+[4])[0])\n';
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
      assert.ok(reached); if (mode === 'finish') assert.equal(output, 'entered\n7\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
  for (const [body, options, limits, code] of [
    ['return self+other', {}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['a=[]\n  while True: a.append([7])', {maxSteps: 100000}, {maxBytes: 20000}, 'OOM'],
  ]) {
    const result = await run('class A:\n def __add__(self,other):\n  '+body+'\nA()+[4]\n', options, limits);
    assert.equal(result.error.code, code); if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});
