import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';

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
