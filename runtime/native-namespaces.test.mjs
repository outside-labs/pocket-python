import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {NATIVE_NAMESPACES} from './native-namespaces.mjs';
import {BuiltinValue} from './function-objects.mjs';
import {valueLayout} from './values.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic live class body fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-namespaces.json', import.meta.url)));
for (const item of corpus.cases) test('native namespace: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports || []}, ...(item.modules || []).map(value => ({...value, notice: "Synthetic native namespace fixture"}))], compileOptions: profile,
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

test('every adopted native type has its complete own ordered dictionary and stored identities', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory});
    for (const [name, entries] of Object.entries(NATIVE_NAMESPACES)) {
      const type = name === 'object' ? classes.root() : classes.make(BuiltinValue, name); roots.push(type);
      const dictionary = classes.namespaceDictionary(type);
      assert.deepEqual(dictionary.entries.map(entry => classes.values.text(entry.key)), entries.map(entry => entry[0]), name);
      assert.equal(classes.namespaceDictionary(type), dictionary);
      for (const entry of dictionary.entries) {
        if (entry.value?.nativeOwner) assert.equal(entry.value.nativeOwner, type);
        assert.equal(classes.values.classNamespaceEntry(classes.get(type, '__dict__'), entry.key).value, entry.value);
      }
      memory.collect([], {cleanup: true});
    }
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});
test('failed native namespace materialization leaves no partially published dictionary', () => {
  const memory = new MemoryArena({maxObjects: 7}), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory}), type = classes.make(BuiltinValue, 'int'); roots.push(type);
    const before = valueLayout(type);
    assert.throws(() => classes.namespaceDictionary(type), {code: 'OOM'});
    assert.equal(type.namespaceDictionary, undefined); assert.deepEqual(valueLayout(type), before);
    memory.collect([], {cleanup: true}); assert.equal(memory.stats().objects, 1);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});
test('stored descriptors and type owners survive parked calls and detached aliases', async () => {
  await lifecycle('class C:pass\nd=C.__dict__["__dict__"]\na=C()\na.value=[7]\ndel C\nprint("entered")\nprint(d.__get__(a)["value"][0],d.__objclass__ is type(a))\n', 'entered\n7 True\n');
});
test('owned class-name key comparison survives parking, cancellation and close', async () => {
  await lifecycle('active=False\nclass Key:\n def __hash__(self):return hash("tag")\n def __eq__(self,other):\n  if active: print("entered")\n  return other=="tag"\nC=type("C",(),{Key():[7]})\nactive=True\nprint(C.tag[0])\n', 'entered\n7\n');
});
for (const [options, limits, expected] of [
  [{maxSteps: 3}, undefined, 'BUDGET'],
  [{maxWork: 600}, undefined, 'BUDGET'],
  [{maxWork: 20000000}, {maxBytes: 16000}, 'OOM'],
]) test('native namespace materialization observes ' + expected + ' limits ' + JSON.stringify(options), async () => {
  const result = await runSourceRequest({modules: [unit('p=int.__dict__\nprint(p["__add__"].__objclass__ is int)\n')], compileOptions: profile, options, memoryLimits: limits});
  assert.equal(result.error?.code, expected, JSON.stringify(result.error)); closed(result.closed);
});

test('protocol discovery retains its private type copy while key callbacks are interrupted', async () => {
  await lifecycle('active=True\nclass Key:\n def __hash__(self):return hash("__call__")\n def __eq__(self,other):\n  global active\n  if active:\n   active=False\n   print("entered")\n  return other=="__call__"\nC=type("C",(),{Key():lambda self:7})\nprint(C()())\n', 'entered\n7\n');
});
test('custom-new initialization retains the new instance across owned key lookup', async () => {
  await lifecycle('active=False\nclass Key:\n def __hash__(self):return hash("__init__")\n def __eq__(self,other):\n  global active\n  if active:\n   active=False\n   print("entered")\n  return other=="__init__"\ndef make(cls,value):return object.__new__(cls)\ndef initialize(self,value):self.value=value\nC=type("C",(),{"__new__":make,Key():initialize})\nactive=True\nprint(C(7).value)\n', 'entered\n7\n');
});
test('opaque protocol presence is charged before publishing a type', () => {
  const plain = new ClassRuntime(), base = plain.root();
  const create = (classes, root, protocolNames) => classes.create('C', 'C', 'app', [], new Map(), root, {dynamic: true, protocolNames});
  const normal = valueLayout(create(plain, base, null)), indexed = valueLayout(create(plain, base, ['__call__']));
  assert.equal(indexed.bytes - normal.bytes, 16 + 2 * '__call__'.length);
  const memory = new MemoryArena({maxBytes: 136 + valueLayout(base).bytes + indexed.bytes - 1}), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory}), root = classes.root(); roots.push(root);
    assert.throws(() => create(classes, root, ['__call__']), {code: 'OOM'});
    memory.collect([], {cleanup: true}); assert.equal(memory.stats().objects, 1);
    const type = create(classes, root, null); roots.push(type);
    assert.equal(type.protocolNames, null);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});
