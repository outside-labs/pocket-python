import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {FunctionValue, CodePool, Environment} from './function-objects.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic function metadata fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/function-metadata.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('function metadata: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

test('module metadata snapshots the real module name before later global changes', async () => {
  const result = await run('def f(): pass\nprint(f.__module__)\n__name__="other"\nprint(f.__module__)\n');
  assert.equal(result.stdout, 'app\napp\n'); assert.equal(result.ok, true); closed(result.closed);
});

test('metadata edges reject foreign values and roll back actual allocation failure', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), otherRoots = [], otherLeave = foreign.enter(() => otherRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const pool = classes.make(CodePool, {version: 5, constants: [], functions: [{kind: 'module'}, {kind: 'function', name: 'f', qualname: 'f'}]}, 64);
    roots.push(pool);
    const env = classes.make(Environment); roots.push(env);
    const fn = classes.make(FunctionValue, pool, 1, env, new Map()); roots.push(fn);
    const foreignText = other.values.string([65]); otherRoots.push(foreignText);
    for (const name of ['__name__', '__qualname__', '__module__']) {
      const saved = classes.values.string([66]); roots.push(saved);
      classes.write(fn, name, saved);
      assert.throws(() => classes.write(fn, name, foreignText), {code: 'STALE_HANDLE'});
      assert.equal(classes.get(fn, name), saved);
      const huge = new ValueRuntime().string(new Array(4000).fill(65));
      assert.throws(() => classes.write(fn, name, huge), {code: 'OOM'});
      assert.equal(classes.get(fn, name), saved);
      memory.collect([], {cleanup: true}); assert.equal(classes.get(fn, name), saved);
    }
    classes.write(fn, '__module__', fn);
    assert.ok(valueLayout(fn).children.includes(fn));
    classes.write(fn, '__module__', null, true); assert.equal(classes.get(fn, '__module__'), null);
  } finally { leave(); memory.close(); otherLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

async function lifecycle(source, expected, phases) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const phase of phases) for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (output === phase) {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached, phase);
      if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('renamed closures and cyclic module snapshots survive parked collection, cancellation and close', async () => {
  await lifecycle('def make():\n saved=[7]\n def read(): return saved[0]\n read.__name__="renamed"\n read.__qualname__="path.renamed"\n read.__module__=[read,saved]\n return read\nf=make()\nprint("held")\nprint(f.__name__,f.__qualname__,f.__module__[0] is f,f.__module__[1][0],f())\n',
    'held\nrenamed path.renamed True 7 7\n', ['held\n']);
});

test('class metadata mutation updates subsequent reads', async () => {
  for (const name of ['__qualname__', '__module__']) {
    const result = await run('class C: pass\nC.' + name + '="other"\nprint(C.' + name + ')\n');
    assert.ok(result.ok, JSON.stringify(result.error)); assert.equal(result.stdout, 'other\n'); closed(result.closed);
  }
});

test('bound metadata retains detached callable closures and results through parked callbacks', async () => {
  for (const name of ['__name__', '__qualname__', '__module__']) {
    await lifecycle('def make():\n saved=[[7]]\n class Callable: pass\n obj=Callable()\n m=classmethod(obj).__get__(None,object)\n def lookup(self,name):\n  print("lookup")\n  return saved\n Callable.__getattribute__=lookup\n return m\nm=make()\nprint("held")\nprint(m.' + name + '[0][0])\n',
      'held\nlookup\n7\n', ['held\n', 'held\nlookup\n']);
  }
});

test('method metadata fallback owns the original receiver after all global aliases are deleted', async () => {
  await lifecycle('class Callable: pass\nobj=Callable()\nm=classmethod(obj).__get__(None,object)\ndef lookup(self,name):\n global m,obj,Callable\n del m\n del obj\n del Callable\n print("lookup")\n return [self]\nCallable.__getattribute__=lookup\nresult=m.__name__\nprint(type(result[0]).__name__)\n',
    'lookup\nCallable\n', ['lookup\n']);
});

test('method metadata callbacks obey real recursion, instruction, work and allocation limits', async () => {
  for (const [body, options, limits, code] of [
    ['return m.__name__', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 40000}, undefined, 'BUDGET'],
    ['items=[]\n while True: items.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 30000}, 'OOM'],
  ]) {
    const source = 'class Callable: pass\nm=classmethod(Callable()).__get__(None,object)\ndef lookup(self,name):\n print("entered")\n ' + body + '\nCallable.__getattribute__=lookup\nm.__name__\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});
