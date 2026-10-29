import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {valueLayout} from './values.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic keyed namespace fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/class-namespaces.json', import.meta.url)));
for (const item of corpus.cases) test('keyed class namespace: ' + item.id, async () => {
  const result = await run(item.source);
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

test('view graph retains its class and live values through cycles and collection', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory}), root = classes.root(); roots.push(root);
    const type = classes.create('C', 'C', 'app', [], new Map(), root); roots.push(type);
    const proxy = classes.get(type, '__dict__'); roots.push(proxy);
    assert.deepEqual(valueLayout(proxy), {bytes: 48, children: [type]});
    const key = classes.values.string([116, 97, 103]); roots.push(key);
    classes.write(type, 'tag', classes.values.list([7n]));
    classes.write(type, 'saved', proxy);
    roots.splice(1, 1); memory.collect([], {cleanup: true});
    assert.equal(classes.namespaceEntry(proxy, key).value.items[0], 7n);
    classes.write(type, 'tag', classes.values.list([9n])); memory.collect([], {cleanup: true});
    assert.equal(classes.namespaceEntry(proxy, key).value.items[0], 9n);
    roots.splice(1); memory.collect([], {cleanup: true});
    assert.equal(memory.stats().objects, 1);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('view allocation failure preserves the class and compact namespace', () => {
  const memory = new MemoryArena({maxObjects: 2}), roots = [], leave = memory.enter(() => roots);
  try {
    const classes = new ClassRuntime({memory}), root = classes.root(); roots.push(root);
    const type = classes.create('C', 'C', 'app', [], new Map([['tag', 7n]]), root); roots.push(type);
    const before = type.namespace;
    assert.throws(() => classes.get(type, '__dict__'), {code: 'OOM'});
    assert.equal(type.namespace, before); assert.equal(classes.get(type, 'tag'), 7n);
    memory.collect([], {cleanup: true}); assert.equal(memory.stats().objects, 2);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('foreign view transfer fails transactionally without replacing a class value', () => {
  const memory = new MemoryArena(), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), others = [], otherLeave = foreign.enter(() => others);
  try {
    const classes = new ClassRuntime({memory}), root = classes.root(); roots.push(root);
    const type = classes.create('C', 'C', 'app', [], new Map([['tag', 7n]]), root); roots.push(type);
    const other = new ClassRuntime({memory: foreign}), base = other.root(); others.push(base);
    const otherType = other.create('D', 'D', 'app', [], new Map(), base); others.push(otherType);
    const proxy = other.get(otherType, '__dict__'); others.push(proxy);
    assert.throws(() => classes.write(type, 'tag', proxy), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(type, 'tag'), 7n);
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

test('detached views and retained get methods survive parking and generator suspension', async () => {
  await lifecycle('class C: tag=[7]\np=C.__dict__\ng=p.get\nC.saved=p\ndel C\ndef values():\n print("entered")\n yield g("tag")[0]\n yield p["saved"] is p\ngen=values()\nprint(next(gen),next(gen))\n', 'entered\n7 True\n');
});

test('metaclass descriptor results retain their original namespace owner while parked', async () => {
  await lifecycle('class M(type):\n @property\n def __dict__(cls):\n  p=type.__getattribute__(cls,"tag")\n  print("entered")\n  return p\nclass C(metaclass=M): tag=[7]\nprint(vars(C)[0])\n', 'entered\n7\n');
});

test('view growth obeys real instruction, work and allocation limits', async () => {
  for (const [body, options, limits, expected] of [
    ['while True: C.__dict__["tag"]', {maxSteps: 250}, undefined, 'BUDGET'],
    ['while True: C.__dict__.get("tag")', {maxSteps: 100000, maxWork: 6000}, undefined, 'BUDGET'],
    ['saved=[]\nwhile True: saved.append(C.__dict__)', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 28000}, 'OOM'],
  ]) {
    const result = await run('class C: tag=7\n' + body + '\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error)); closed(result.closed);
  }
});

test('class namespace admission keeps the explicit core language boundary', async () => {
  const result = await runSourceRequest({modules: [unit('class C: pass\nC.__dict__\n')]});
  assert.equal(result.error?.code, 'UNSUPPORTED'); if (result.closed) closed(result.closed);
});
