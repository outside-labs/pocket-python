import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';

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
