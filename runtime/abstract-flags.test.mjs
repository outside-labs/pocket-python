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
import {ValueRuntime} from './values.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic abstract flag fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/abstract-flags.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('abstract flags: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

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

test('lookup and truth retain their descriptor, temporary result and function cycles while parked', async () => {
  await lifecycle('class Truth:\n def __init__(self): self.saved=[7]\n def __bool__(self):\n  print("truth")\n  return bool(self.saved)\nclass Flag:\n @property\n def __isabstractmethod__(self):\n  print("lookup")\n  return Truth()\nprint(property(Flag()).__isabstractmethod__)\n',
    'lookup\ntruth\nTrue\n', ['lookup\n', 'lookup\ntruth\n']);
  await lifecycle('def make():\n saved=[7]\n def read(obj): return saved[0]\n read.__isabstractmethod__=[read,saved]\n return property(read)\np=make()\nprint("held")\nprint(p.__isabstractmethod__,p.fget.__isabstractmethod__[1][0])\n',
    'held\nTrue 7\n', ['held\n']);
});

test('function marker growth rolls back failed arena and foreign-owner transfers', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], foreignLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const fn = classes.make(FunctionValue, null, 0, null, new Map()); roots.push(fn);
    classes.write(fn, '__isabstractmethod__', fn);
    const foreignFlag = other.values.list([]); foreignRoots.push(foreignFlag);
    assert.throws(() => classes.write(fn, '__isabstractmethod__', foreignFlag), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(fn, '__isabstractmethod__'), fn);
    const huge = new ValueRuntime().string(new Array(4000).fill(65));
    assert.throws(() => classes.write(fn, '__isabstractmethod__', huge), {code: 'OOM'});
    assert.equal(classes.get(fn, '__isabstractmethod__'), fn);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(fn, '__isabstractmethod__'), fn);
    classes.write(fn, '__isabstractmethod__', null, true); assert.equal(classes.get(fn, '__dict__').entries.length, 0);
    assert.throws(() => classes.write(fn, '__isabstractmethod__', null, true), {code: 'PYTHON', name: 'AttributeError'});
  } finally { leave(); memory.close(); foreignLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

test('detached and nested wrappers retain callable closures through lookup, truth and cancellation', async () => {
  for (const wrapper of ['staticmethod', 'classmethod']) {
    await lifecycle('class Truth:\n def __init__(self,value): self.value=value\n def __bool__(self):\n  print("truth")\n  return bool(self.value)\nclass Flag:\n @property\n def __isabstractmethod__(self):\n  print("lookup")\n  return Truth([7])\nw='+wrapper+'(Flag())\nprint("held")\nprint(w.__isabstractmethod__)\n',
      'held\nlookup\ntruth\nTrue\n', ['held\n', 'held\nlookup\n', 'held\nlookup\ntruth\n']);
    await lifecycle('def make():\n saved=[7]\n def read(obj): return saved[0]\n read.__isabstractmethod__=[read,saved]\n return '+wrapper+'(staticmethod(property(read)))\nw=make()\nprint("held")\nprint(w.__isabstractmethod__)\n', 'held\nTrue\n', ['held\n']);
  }
});

test('nested wrapper flag dispatch has bounded recursion and cleans parked owners', async () => {
  const result = await run('w=property()\nfor i in range(30): w=staticmethod(classmethod(w))\nprint("entered")\nw.__isabstractmethod__\n', {maxDepth: 16});
  assert.equal(result.stdout, 'entered\n'); assert.equal(result.error?.type, 'RecursionError'); closed(result.closed);
  for (const wrapper of ['staticmethod', 'classmethod']) {
    const busy = await run('class Truth:\n def __bool__(self):\n  print("entered")\n  while True: pass\nclass Flag: __isabstractmethod__=Truth()\n'+wrapper+'(Flag()).__isabstractmethod__\n', {maxSteps: 300});
    assert.equal(busy.stdout, 'entered\n'); assert.equal(busy.error?.code, 'BUDGET'); closed(busy.closed);
  }
});

test('bound marker forwarding retains custom callables and exact temporary marker results', async () => {
  await lifecycle('class C: pass\nclass Flag:\n def __getattribute__(self,name):\n  if name=="__isabstractmethod__":\n   print("lookup")\n   return [7]\n  return object.__getattribute__(self,name)\nm=classmethod(Flag()).__get__(None,C)\nprint("held")\nprint(m.__isabstractmethod__[0])\n', 'held\nlookup\n7\n', ['held\n', 'held\nlookup\n']);
  const result = await run('class C: pass\ndef f(): pass\nm=f\nfor i in range(30): m=classmethod(m).__get__(None,C)\nprint("entered")\nm.__isabstractmethod__\n', {maxDepth: 16});
  assert.equal(result.stdout, 'entered\n'); assert.equal(result.error?.type, 'RecursionError'); closed(result.closed);
});

test('abstract lookup and truth records preserve outer roots and reject invalid phases', () => {
  const receiver = {}, outer = {};
  const after = completion('relay', {receiver: outer});
  for (const kind of ['abstract-lookup', 'abstract-truth']) {
    assert.deepEqual(completionRoots(completion(kind, {receiver, position: 2, depth: 4, after})), [receiver, outer]);
    for (const position of [-1, 3, 0.5]) assert.throws(() => completion(kind, {receiver, position, depth: 0}), TypeError);
    assert.throws(() => completion(kind, {receiver, position: 0, depth: 257}), TypeError);
  }
});

test('marker lookup and truth obey recursion, instruction, work and allocation limits', async () => {
  for (const [body, options, limits, code] of [
    ['return p.__isabstractmethod__', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    ['items=[]\n  while True: items.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 20000}, 'OOM'],
  ]) {
    const result = await run('class Flag:\n @property\n def __isabstractmethod__(self):\n  print("entered")\n  '+body+'\np=property(Flag())\np.__isabstractmethod__\n', options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});

test('abstract flags preserve core admission and unrelated function metadata boundaries', async () => {
  const result = await runSourceRequest({modules: [unit('def f(): pass\nf.__isabstractmethod__=True\n')]});
  assert.equal(result.error?.code, 'UNSUPPORTED');
  if (result.closed) closed(result.closed);
  const other = await run('def f(): pass\nf.__code__\n');
  assert.equal(other.error?.code, 'UNSUPPORTED'); closed(other.closed);
});
