import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime} from './values.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic function directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/function-directories.json', import.meta.url)));
for (const item of corpus.cases) test('function directory: ' + item.id, async () => {
  const result = await run(item.source);
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

test('directory merge continuation retains receiver, private dictionary and outer destinations', () => {
  const receiver = {}, result = {}, outer = {};
  const after = completion('relay', {receiver: outer});
  const record = completion('native-dir-merge', {receiver, result, position: 42, depth: 3, after});
  assert.deepEqual(completionRoots(record), [receiver, result, outer]);
  for (const position of [-1, 43, 0.5, undefined])
    assert.throws(() => completion('native-dir-merge', {receiver, result, position, depth: 0}), TypeError);
  assert.throws(() => completion('native-dir-merge', {receiver, result, position: 0, depth: 257}), TypeError);
  assert.ok(Object.isFrozen(record));
});

test('private dictionary copies preserve hashes and entries while owning separate storage', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  try {
    const values = new ValueRuntime({memory}), key = values.string([116, 97, 103]); roots.push(key);
    const item = values.list([7n]); roots.push(item);
    const original = values.dict([[key, item]]); roots.push(original);
    const copy = values.copyDictionary(original); roots.push(copy);
    assert.equal(copy.entries[0].key, key); assert.equal(copy.entries[0].value, item);
    assert.equal(copy.entries[0].hash, original.entries[0].hash);
    assert.notEqual(copy.entries[0], original.entries[0]);
    values.set(original, key, 9n); memory.collect([], {cleanup: true});
    assert.equal(values.index(copy, key).items[0], 7n); assert.equal(values.index(original, key), 9n);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('copy allocation and foreign ownership failures preserve the original dictionary', () => {
  const memory = new MemoryArena({maxObjects: 1}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), others = [], otherLeave = foreign.enter(() => others);
  try {
    const values = new ValueRuntime({memory}), original = values.dict([]); roots.push(original);
    assert.throws(() => values.copyDictionary(original), {code: 'OOM'});
    assert.equal(original.entries.length, 0);
    const other = new ValueRuntime({memory: foreign}).dict([]); others.push(other);
    assert.throws(() => values.copyDictionary(other), {code: 'STALE_HANDLE'});
    memory.collect([], {cleanup: true}); assert.equal(memory.stats().objects, 1);
  } finally { leave(); memory.close(); otherLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

async function lifecycle(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (!reached && output === 'entered\n' && execution.state === 'parked') {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached); if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('native merge retains detached receivers and selected keys during parked collision callbacks', async () => {
  await lifecycle('class Key:\n done=False\n def __hash__(self): return hash("__new__")\n def __eq__(self,other):\n  global f,Key\n  if not self.done:\n   self.done=True\n   f.__dict__={}\n   del f\n   del Key\n   print("entered")\n  return True\n def __lt__(self,other): return True\n def __gt__(self,other): return False\ndef f(): pass\nf.__dict__={Key():[7],"tag":[9]}\nr=dir(f)\nprint(r[0].done,len(r),"tag" in [n for n in r if isinstance(n,str)])\n', 'entered\nTrue 40 True\n');
});

test('sorting retains selected keys and the native caller through parked mutation', async () => {
  await lifecycle('class Key:\n done=False\n def mark(self,result):\n  global f,Key\n  if not self.done:\n   self.done=True\n   f.__dict__={}\n   del f\n   del Key\n   print("entered")\n  return result\n def __lt__(self,other): return self.mark(True)\n def __gt__(self,other): return self.mark(False)\ndef f(): pass\nf.__dict__={Key():[7],"tag":[9]}\nr=dir(f)\nprint(r[0].done,len(r),"tag" in [n for n in r if isinstance(n,str)])\n', 'entered\nTrue 41 True\n');
});

test('merge and sort callback errors preserve their original Python source frames', async () => {
  for (const [id, name] of [['merge-error', '__eq__'], ['sort-error', '__gt__']]) {
    const result = await run(corpus.cases.find(item => item.id === id).source);
    assert.equal(result.error?.type, 'ValueError');
    assert.ok(result.error.traceback.some(frame => frame.function === name), JSON.stringify(result.error));
    closed(result.closed);
  }
});

for (const phase of ['merge', 'sort']) test(phase + ' callbacks obey real shared resource bounds', async () => {
  for (const [body, options, limits, expected] of [
    ['return dir(f)', {maxDepth: 12, maxWork: 20000000}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 300}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 400000}, undefined, 'BUDGET'],
    ['saved=[]\n  while True: saved.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 38000}, 'OOM'],
  ]) {
    const source = 'class Key:\n' + (phase === 'merge' ? ' def __hash__(self): return hash("__new__")\n def __eq__(self,other):\n' : ' def __gt__(self,other):\n') +
      '  print("entered")\n  ' + body + '\ndef f(): pass\nf.__dict__={Key():7}\ndir(f)\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});

test('default function directories retain the explicit core source boundary', async () => {
  for (const source of ['def f(): pass\ndir(f)\n', 'def f(): pass\nf.__dir__()\n']) {
    const result = await runSourceRequest({modules: [unit(source)]});
    assert.equal(result.error?.code, source.includes('dir(f)') ? 'PYTHON' : 'UNSUPPORTED', JSON.stringify(result.error));
    if (source.includes('dir(f)')) assert.equal(result.error?.type, 'NameError');
    if (result.closed) closed(result.closed);
  }
});
