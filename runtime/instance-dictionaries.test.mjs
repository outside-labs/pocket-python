import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic instance dictionary fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/instance-dictionaries.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('instance dictionary: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

function instance(classes, roots) {
  const root = classes.root(); roots.push(root);
  const type = classes.create('C', 'C', 'app', [], new Map(), root); roots.push(type);
  const receiver = classes.instance(type); roots.push(receiver); return receiver;
}

test('unexposed instance layouts stay compact; materialization owns every value', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory}), receiver = instance(classes, roots);
    assert.deepEqual(valueLayout(receiver), {bytes: 80, children: [receiver.type]});
    const value = classes.values.list([]); roots.push(value);
    classes.write(receiver, 'tag', value);
    assert.ok(receiver.attributes instanceof Map);
    const dictionary = classes.get(receiver, '__dict__');
    assert.deepEqual(valueLayout(receiver), {bytes: 88, children: [receiver.type, dictionary]});
    roots.pop(); memory.collect([], {cleanup: true});
    assert.equal(classes.get(receiver, 'tag'), value);
    assert.equal(classes.values.text(dictionary.entries[0].key), 'tag');
    classes.write(receiver, '__dict__', null, true);
    assert.ok(receiver.attributes instanceof Map);
    assert.equal(classes.get(receiver, '__dict__').entries.length, 0);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('instance dictionary transfers roll back foreign graphs and real arena exhaustion', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], otherLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), receiver = instance(classes, roots);
    const dictionary = classes.get(receiver, '__dict__');
    classes.write(receiver, 'tag', receiver);
    const other = new ValueRuntime({memory: foreign}).dict([]); foreignRoots.push(other);
    assert.throws(() => classes.write(receiver, '__dict__', other), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(receiver, '__dict__'), dictionary);
    assert.throws(() => classes.write(receiver, 'tag', other), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(receiver, 'tag'), receiver);
    const values = new ValueRuntime();
    const huge = values.dict([[values.string([65]), values.string(new Array(4000).fill(65))]]);
    assert.throws(() => classes.write(receiver, '__dict__', huge), {code: 'OOM'});
    assert.equal(classes.get(receiver, '__dict__'), dictionary);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(receiver, 'tag'), receiver);
  } finally { leave(); memory.close(); otherLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

test('failed materialization preserves compact attributes and their original owners', () => {
  const memory = new MemoryArena({maxBytes: 1800}), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory}), receiver = instance(classes, roots);
    for (let index = 0; index < 7; index++) classes.write(receiver, 'tag' + index, 7n);
    const before = receiver.attributes;
    assert.throws(() => classes.get(receiver, '__dict__'), {code: 'OOM'});
    assert.equal(receiver.attributes, before);
    memory.collect([], {cleanup: true});
    for (let index = 0; index < 7; index++) assert.equal(classes.get(receiver, 'tag' + index), 7n);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('root object native dictionary mutation preserves its missing-layout error', async () => {
  const result = await run('o=object()\ntry: object.__setattr__(o,"__dict__",{})\nexcept AttributeError: print("set")\ntry: object.__delattr__(o,"__dict__")\nexcept AttributeError: print("delete")\n');
  assert.equal(result.stdout, 'set\ndelete\n'); assert.equal(result.ok, true); closed(result.closed);
});

test('instance dictionaries retain core and broader namespace refusal boundaries', async () => {
  const core = await runSourceRequest({modules: [unit('class C: pass\nC().__dict__\n')]});
  assert.equal(core.error?.code, 'UNSUPPORTED'); if (core.closed) closed(core.closed);
  for (const item of corpus.cases.filter(item => item.stage === 'Future')) {
    const result = await run(item.source);
    assert.equal(result.error?.code, 'UNSUPPORTED', item.id); if (result.closed) closed(result.closed);
  }
});

test('instance dictionary continuations own selected class fallbacks and supplied names', () => {
  const receiver = {}, key = {}, fallback = {}, outer = {};
  const after = completion('relay', {receiver: outer});
  assert.deepEqual(completionRoots(completion('instance-entry', {receiver, key, operation: 'get', found: true, fallback, depth: 0, after})),
    [receiver, key, fallback, outer]);
  assert.deepEqual(completionRoots(completion('instance-entry', {receiver, key, operation: 'delete', found: false, fallback, depth: 0, after})),
    [receiver, key, outer]);
  assert.throws(() => completion('instance-entry', {receiver, key, operation: 'get', fallback}), TypeError);
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

test('detached receiver, original dictionary and stored result survive parked callbacks', async () => {
  await lifecycle('class C: pass\nc=C()\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  global c,C,Key\n  del c\n  del C\n  del Key\n  print("entered")\n  return True\nc.__dict__={Key():[7]}\nprint(c.tag[0])\n', 'entered\n7\n', 'entered\n');
});

test('deleted original nondata descriptor survives parked lookup and binding', async () => {
  await lifecycle('class D:\n def __get__(self,obj,owner):\n  print("bound")\n  return [7]\nclass C: tag=D()\nc=C()\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  global c,C,Key,D\n  del C.tag\n  del c\n  del C\n  del Key\n  del D\n  print("entered")\n  return False\nc.__dict__={Key():11}\nprint(c.tag[0])\n', 'entered\nbound\n7\n', 'entered\n');
});

test('original dictionaries remain live across parked replacement writes and deletions', async () => {
  const source = 'class C: pass\nc=C()\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  c.__dict__={"fresh":11}\n  print("entered")\n  return True\nkey=Key()\nold={key:7}\nc.__dict__=old\n';
  await lifecycle(source + 'c.tag=9\nprint(old[key],c.fresh)\n', 'entered\n9 11\n', 'entered\n');
  await lifecycle(source + 'del c.tag\nprint(len(old),c.fresh)\n', 'entered\n0 11\n', 'entered\n');
});

test('instance dictionary collisions obey real callback budgets and release every owner', async () => {
  for (const [body, options, limits, code] of [
    ['return c.tag', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 40000}, undefined, 'BUDGET'],
    ['items=[]\n  while True: items.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 30000}, 'OOM'],
  ]) {
    const source = 'class C: pass\nc=C()\nclass Key:\n def __hash__(self): return hash("tag")\n def __eq__(self,other):\n  print("entered")\n  ' + body + '\nc.__dict__={Key():7}\nc.tag\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});
