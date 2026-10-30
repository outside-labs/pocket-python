import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {ClassNamespaceValue} from './function-objects.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic live class body fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/class-mapping-proxies.json', import.meta.url)));
for (const item of corpus.cases) test('class mapping proxy: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports || []}, ...(item.modules || []).map(value => ({...value, notice: "Synthetic live proxy fixture"}))], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout); assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
async function lifecycle(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
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
    } finally {
      const before = output; execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before);
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('views, mappings, iterators and copied descriptors retain escaped dictionary graphs', async () => {
  await lifecycle('class C:tag=[7]\np=C.__dict__\nv=p.values()\ni=iter(v)\nm=p.keys().mapping\nc=p.copy()\ndel p\ndel C\nprint("entered")\nprint(m["tag"][0],any(x==[7] for x in i),m["tag"] is c["tag"])\n', 'entered\n7 True True\n');
});
test('namespace equality owns pending key/value operands across interruption', async () => {
  await lifecycle('class C:tag=[7]\nclass V:\n def __eq__(self,other):print("entered");return True\np=C.__dict__\nq=p.copy()\nq["tag"]=V()\ndel C\nprint(p==q)\n', 'entered\nTrue\n');
});
test('namespace union retains its private partial result across owned comparison callbacks', async () => {
  await lifecycle('active=False\nclass K:\n def __hash__(self):return hash("tag")\n def __eq__(self,other):\n  global active\n  if active:active=False;print("entered")\n  return other=="tag"\nC=type("C",(),{K():[7]})\np=C.__dict__\nactive=True\nr=p|{"tag":[9]}\nprint(r["tag"][0])\n', 'entered\n9\n');
});
test('proxy get and item membership retain keys and stored values through callback parking', async () => {
  await lifecycle('class C:tag=[7]\nclass K:\n def __hash__(self):print("entered");return hash("tag")\n def __eq__(self,other):return other=="tag"\np=C.__dict__\nprint((K(),[7]) in p.items())\n', 'entered\nTrue\n');
});
test('dictionary views and proxy edges are charged and source copies fail atomically', () => {
  const memory = new MemoryArena({maxObjects: 4}), roots = [], leave = memory.enter(() => roots);
  try {
    const values = new ValueRuntime({memory}), key = values.string([116,97,103]); roots.push(key);
    const value = values.list([7n]); roots.push(value);
    const dictionary = values.dict([[key, value]]); roots.push(dictionary);
    const proxy = memory.allocate(48, [dictionary], () => new ClassNamespaceValue(dictionary)); roots.push(proxy);
    assert.deepEqual(valueLayout(proxy), {bytes: 48, children: [dictionary]});
    assert.throws(() => values.copyDictionary(dictionary), {code: 'OOM'});
    assert.throws(() => values.dictionaryView(dictionary, 0), {code: 'OOM'});
    assert.equal(values.classNamespaceEntry(proxy, key).value, value);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});
test('foreign view transfer leaves the original live class dictionary unchanged', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), otherRoots = [], otherLeave = foreign.enter(() => otherRoots);
  try {
    const classes = new ClassRuntime({memory}), root = classes.root(); roots.push(root);
    const type = classes.create('C','C','app',[],new Map([['tag',7n]]),root); roots.push(type);
    const proxy = classes.get(type,'__dict__'); roots.push(proxy);
    const values = new ValueRuntime({memory:foreign}), dictionary = values.dict([]); otherRoots.push(dictionary);
    const view = values.dictionaryView(dictionary, 0); otherRoots.push(view);
    assert.throws(() => classes.write(type,'tag',view), {code:'STALE_HANDLE'});
    assert.equal(classes.get(type,'tag'),7n);
  } finally { leave();memory.close();otherLeave();foreign.close(); }
  closed(memory.stats());closed(foreign.stats());
});
for (const [options, limits, expected] of [
  [{maxSteps: 30}, undefined, 'BUDGET'],
  [{maxWork: 1000}, undefined, 'BUDGET'],
  [{maxWork: 20000000}, {maxBytes: 22000}, 'OOM'],
]) test('proxy and view construction obey ' + expected + ' limits ' + JSON.stringify(options), async () => {
  const result = await runSourceRequest({modules: [unit('class C:tag=[7]\np=C.__dict__\nviews=[]\nwhile True:views.append(p.items())\n')], compileOptions: profile, options, memoryLimits: limits});
  assert.equal(result.error?.code, expected, JSON.stringify(result.error));closed(result.closed);
});

test('exhausted view iterators release their dictionary and keep their actual type', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  try {
    const values = new ValueRuntime({memory}), key = values.string([116]); roots.push(key);
    const item = values.list([7n]); roots.push(item);
    const dictionary = values.dict([[key,item]]); roots.push(dictionary);
    const iterator = values.dictionaryIterator(dictionary, 1); roots.splice(0,roots.length,iterator);
    assert.equal(values.next(iterator),item);
    assert.throws(() => values.next(iterator), {name:'StopIteration'});
    memory.collect([], {cleanup:true});
    assert.equal(memory.stats().objects,1);
    assert.equal(values.typeName(iterator),'dict_valueiterator');
  } finally { leave();memory.close(); }
  closed(memory.stats());
});
