import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
import {Cell, IntegerIdentityRecord} from './function-objects.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic integer identity fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/integer-identity.json', import.meta.url)));
for (const item of corpus.cases) test('integer identity: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports ?? []},
    ...(item.modules ?? []).map(module => ({...module, notice: 'Synthetic integer fixture'}))],
    compileOptions: profile, options: {maxWork: 20000000, maxSteps: 50000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

test('integer identities follow reachable scalar edges and release unreachable registry entries', () => {
  const memory = new MemoryArena(), roots = [];
  const leave = memory.enter(() => roots);
  try {
    const values = new ValueRuntime({memory}), value = 12345678901234567890123456789n;
    const cell = memory.allocate(40, [value], () => new Cell());
    cell.value = value; cell.bound = true; roots.push(cell);
    const identity = values.objectId(value); memory.collect([], {cleanup: true});
    assert.equal(memory.stats().objects, 2);
    const before = memory.stats(); memory.collect([], {cleanup: true, validateOnly: true});
    assert.deepEqual(memory.stats(), before);
    const parked = memory.parkScopes(0);
    for (let count = 0; count < 4; count++) {
      memory.collect([], {cleanup: true}); assert.equal(values.objectId(cell.value), identity);
    }
    memory.restoreScopes(parked);
    const held = values.list([value]); roots.push(held); cell.value = null;
    memory.collect([], {cleanup: true}); assert.equal(values.objectId(held.items[0]), identity);
    roots.length = 0; memory.collect([], {cleanup: true});
    assert.equal(memory.stats().objects, 0);
    assert.notEqual(values.objectId(value), identity);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('canonical interning shares equal scalar identities without changing numeric values', () => {
  const memory = new MemoryArena(), roots = [1000000000000000000000007n];
  const leave = memory.enter(() => roots);
  try {
    const first = new ValueRuntime({memory, numeric: true}), second = new ValueRuntime({memory, numeric: true});
    const equal = BigInt('1000000000000000000000007');
    assert.equal(first.binary('is', roots[0], equal), true);
    assert.equal(first.objectId(roots[0]), second.objectId(equal));
    assert.equal(memory.stats().objects, 1);
    const object = first.list([]); roots.push(object);
    const ids = [first.objectId(roots[0]), first.objectId(object), first.objectId(null), first.objectId(true), first.objectId(false)];
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(first.binary('is', roots[0], true), false);
    assert.equal(first.binary('is', roots[0], first.float(Number(roots[0]))), false);
  } finally { leave(); memory.close(); }
  closed(memory.stats());
});

test('failed scalar identity allocation publishes neither a record nor an identity counter', () => {
  const memory = new MemoryArena({maxBytes: 1024}), roots = [123456789n];
  const leave = memory.enter(() => roots);
  try {
    const values = new ValueRuntime({memory}); memory.collect([], {cleanup: true});
    const release = memory.external(memory.limits.maxBytes - memory.stats().bytes - 8);
    const before = memory.stats();
    assert.throws(() => values.objectId(roots[0]), {code: 'OOM'});
    assert.deepEqual(memory.stats(), before);
    release();
    assert.equal(values.objectId(roots[0]), 4n);
    assert.equal(memory.stats().objects, 1);
    assert.equal(valueLayout(new IntegerIdentityRecord(roots[0], 1n)).bytes, 84);
  } finally { leave(); memory.close(); }
  assert.throws(() => memory.integerIdentity(7n), {code: 'STALE_HANDLE'});
  closed(memory.stats());
});

test('integer aliases survive every-instruction parked collection and interruption', async () => {
  const source = 'value=int("1234567890123456789012345")\nidentity=id(value)\ndef make(saved):\n def read(): return saved\n return read\nf=make(value)\nheld=[value]\nprint("entered")\nprint(id(f())==identity,id(held[0])==identity,f() is held[0])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (output === 'entered\n' && mode !== 'finish') {
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
          break;
        }
      }
      if (mode === 'finish') assert.equal(output, 'entered\nTrue True True\n');
    } finally { execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('persistent callbacks keep integer identities across collection and failed activations', async () => {
  const source = 'value=int("1234567890123456789012345")\nidentity=id(value)\ndef inspect(): return id(value)==identity\ndef stalled():\n print("entered",id(value)==identity)\n while True: pass\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['cancel', 'budget']) {
    const session = new ModuleSession(registry); let output = '';
    try {
      session.run(); const inspect = session.register('inspect'), stalled = session.register('stalled');
      const event = session.enqueue(stalled, [], {maxSteps: 150, maxWork: 20000000}, text => { output += text; });
      event.result.catch(() => {});
      while (session.pending) { session.pump(1); session.memory.collect([], {cleanup: true});
        if (mode === 'cancel' && output === 'entered True\n') { event.cancel(); break; } }
      await assert.rejects(event.result, {code: mode === 'cancel' ? 'CANCELLED' : 'BUDGET'});
      assert.equal(output, 'entered True\n');
      for (let count = 0; count < 2; count++) {
        const next = session.enqueue(inspect, []);
        while (session.pending) { session.pump(1); session.memory.collect([], {cleanup: true}); }
        assert.deepEqual(await next.result, {type: 'bool', value: true});
      }
    } finally { session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('integer identity and comparison obey shared work and allocation limits', async () => {
  for (const [source, options, memoryLimits, expected] of [
    ['value=int("9"*200)\nwhile True: id(value)\n', {maxSteps: 100000, maxWork: 15000}, undefined, 'BUDGET'],
    ['value=int("9"*200)\nwhile True: value is value\n', {maxSteps: 100000, maxWork: 15000}, undefined, 'BUDGET'],
    ['held=[]\nfor value in range(1000):\n held.append(value)\n id(value)\n', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 30000}, 'OOM'],
  ]) {
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
    assert.equal(result.error?.code, expected, JSON.stringify(result.error)); closed(result.closed);
  }
});

test('core integer identity comparisons preserve aliases and distinguish types', async () => {
  const result = await runSourceRequest({modules: [unit('a=int("1234567890123456789")\nb=a\nc=a+1\nprint(a is b,a is not c,a is not True)\n')]});
  assert.equal(result.stdout, 'True True True\n'); assert.equal(result.ok, true); closed(result.closed);
});

test('frozen legacy value profiles retain their integer identity refusal', () => {
  const legacy = new ValueRuntime();
  for (const pair of [[7n, 7n], [7n, true], [false, 0n]])
    assert.throws(() => legacy.binary('is', ...pair), {code: 'UNSUPPORTED'});
  assert.equal(legacy.binary('is', 7n, null), false);
});
