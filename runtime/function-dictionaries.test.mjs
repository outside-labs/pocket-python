import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {FunctionValue} from './function-objects.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic function dictionary fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/function-dictionaries.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('function dictionary: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

test('replacement and insertion roll back foreign values and real arena exhaustion', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], otherLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const fn = classes.make(FunctionValue, null, 0, null, new Map()); roots.push(fn);
    const dict = classes.get(fn, '__dict__');
    classes.write(fn, 'tag', fn);
    assert.ok(valueLayout(fn).children.includes(dict));
    const otherDict = other.values.dict([]); foreignRoots.push(otherDict);
    assert.throws(() => classes.write(fn, '__dict__', otherDict), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(fn, '__dict__'), dict);
    assert.throws(() => classes.write(fn, 'tag', otherDict), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(fn, 'tag'), fn);
    const huge = new ValueRuntime().dict([]);
    new ValueRuntime().set(huge, new ValueRuntime().string([65]), new ValueRuntime().string(new Array(4000).fill(65)));
    assert.throws(() => classes.write(fn, '__dict__', huge), {code: 'OOM'});
    assert.equal(classes.get(fn, '__dict__'), dict);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(fn, 'tag'), fn);
  } finally { leave(); memory.close(); otherLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

test('dictionary continuations own the original callable and key', () => {
  const receiver = {}, key = {}, outer = {};
  const after = completion('relay', {receiver: outer});
  assert.deepEqual(completionRoots(completion('function-entry', {receiver, key, operation: 'delete', after})), [receiver, key, outer]);
  assert.throws(() => completion('function-entry', {receiver, key, operation: 'missing'}), TypeError);
});

async function lifecycle(source, expected, phase) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (!reached && output === phase && execution.state === 'parked') {
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

const collision = 'def f(): pass\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  global f,Key\n  del f\n  del Key\n  print("entered")\n  return True\nf.__dict__={Key():[7]}\n';
test('detached original function and dictionary survive parked collision callbacks', async () => {
  await lifecycle(collision + 'print(f.tag[0])\n', 'entered\n7\n', 'entered\n');
});

test('dictionary collision callbacks obey recursion, instruction, work and arena limits', async () => {
  for (const [body, options, limits, code] of [
    ['return f.tag', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 40000}, undefined, 'BUDGET'],
    ['items=[]\n  while True: items.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 30000}, 'OOM'],
  ]) {
    const source = 'def f(): pass\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  print("entered")\n  ' + body + '\nf.__dict__={Key():7}\nf.tag\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});

test('function dictionaries retain core admission and class namespace boundaries', async () => {
  const core = await runSourceRequest({modules: [unit('def f(): pass\nf.__dict__\n')]});
  assert.equal(core.error?.code, 'UNSUPPORTED'); if (core.closed) closed(core.closed);
  for (const source of ['class C: pass\nC.__dict__={}\n', 'class C: pass\nC().__dict__\n']) {
    const result = await run(source); assert.equal(result.error?.code, 'UNSUPPORTED'); if (result.closed) closed(result.closed);
  }
});

test('method attribute fallback owns detached callable state and returned values', async () => {
  await lifecycle('class Callable: pass\nobj=Callable()\nm=classmethod(obj).__get__(None,object)\ndef read(self):\n global m,obj,Callable\n del m\n del obj\n del Callable\n print("entered")\n return [self]\nCallable.tag=property(read)\nresult=m.tag\nprint(type(result[0]).__name__)\n',
    'entered\nCallable\n', 'entered\n');
});

test('nested bound methods retain the original function dictionary', async () => {
  const result = await run('class C:\n def read(self): return 7\nm=C().read\nnested=classmethod(m).__get__(None,C)\nC.read.tag=[]\nprint(nested.tag is C.read.tag,nested.__dict__ is C.read.__dict__)\n');
  assert.equal(result.stdout, 'True True\n'); assert.equal(result.ok, true); closed(result.closed);
});

test('method fallback obeys real callback limits and closes every owner', async () => {
  for (const [body, options, limits, code] of [
    ['return m.tag', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 40000}, undefined, 'BUDGET'],
    ['items=[]\n while True: items.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 30000}, 'OOM'],
  ]) {
    const result = await run('class Callable: pass\nm=classmethod(Callable()).__get__(None,object)\ndef lookup(self,name):\n print("entered")\n ' + body + '\nCallable.__getattribute__=lookup\nm.tag\n', options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});

test('native method marker access bypasses callable fallback while documentation keeps its descriptor', async () => {
  const result = await run('class C:\n def read(self):\n  "doc"\n  pass\nC.read.__isabstractmethod__=True\nm=C().read\ntry: object.__getattribute__(m,"__isabstractmethod__")\nexcept AttributeError: print("bypass")\nprint(m.__isabstractmethod__,object.__getattribute__(m,"__doc__"))\n');
  assert.equal(result.stdout, 'bypass\nTrue doc\n'); assert.equal(result.ok, true); closed(result.closed);
});
