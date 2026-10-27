import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime} from './values.mjs';
import {Execution} from './functions.mjs';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';

const program = source => ({...structuredClone(compileSource(source).program), version: 3});
const closed = memory => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(memory.stats()[key], 0, key); };

test('parked owners keep dynamic root visitors and original scope charges', () => {
  const memory = new MemoryArena(), values = new ValueRuntime({memory}), roots = [];
  const leave = memory.enter(() => roots), first = values.list([7n]); roots.push(first);
  memory.collect([], {cleanup: true}); const before = memory.stats();
  const owner = memory.parkScopes(0);
  assert.equal(memory.scopeDepth, 0); assert.equal(memory.stats().frames, 1);
  assert.deepEqual(memory.stats(), before);
  roots.push(values.list([8n])); memory.collect([], {cleanup: true});
  assert.equal(memory.stats().objects, 2);
  assert.throws(() => new MemoryArena().restoreScopes(owner), TypeError);
  memory.restoreScopes(owner); assert.equal(memory.scopeDepth, 1);
  assert.throws(() => memory.restoreScopes(owner), TypeError);
  assert.throws(() => memory.parkScopes(1), TypeError);
  leave(); closed(memory); memory.close();
});

test('two parked activations interleave on one arena without losing mutable values or counters', () => {
  const memory = new MemoryArena(); let a = '', b = '';
  const source = 'items=[]\ni=0\nwhile i<4:\n items=items+[[i]]\n i=i+1\nprint(items[3][0])\n';
  const executions = [new Execution(program(source), {arena: memory, onOutput: text => { a += text; }}),
    new Execution(program(source), {arena: memory, onOutput: text => { b += text; }})];
  const steps = [0, 0];
  try {
    while (executions.some(execution => execution.state !== 'completed')) {
      executions.forEach((execution, index) => {
        if (execution.state === 'completed') return;
        const snapshot = execution.advance(3);
        assert.ok(snapshot.steps > steps[index]); steps[index] = snapshot.steps;
        if (execution.state === 'paused') execution.park();
        memory.collect([], {cleanup: true}); assert.equal(memory.scopeDepth, 0);
      });
    }
    assert.equal(a, '3\n'); assert.equal(b, '3\n'); assert.equal(steps[0], steps[1]);
  } finally { executions.forEach(execution => execution.close()); closed(memory); memory.close(); }
});

test('parked close can release an older activation while another is paused', () => {
  const memory = new MemoryArena(), first = new Execution(program('while True: pass\n'), {arena: memory}),
    second = new Execution(program('print(7)\n'), {arena: memory});
  first.advance(); first.park(); second.advance();
  const steps = second.snapshot().steps;
  first.close(); first.close(); assert.equal(second.state, 'paused');
  assert.equal(second.snapshot().steps, steps); second.drain(); second.close();
  closed(memory); memory.close();
});

test('running reentry, invalid quanta and invalid park leave scope owners intact', () => {
  const memory = new MemoryArena(); let execution, parked;
  parked = new Execution(program('while True: pass\n'), {arena: memory}); parked.advance(); parked.park();
  execution = new Execution(program('print(7)\n'), {arena: memory, onOutput: () => {
    assert.throws(() => execution.park(), TypeError);
    assert.throws(() => execution.advance(), TypeError);
    assert.throws(() => parked.advance(), TypeError);
    assert.throws(() => parked.close(), TypeError);
  }});
  assert.throws(() => execution.park(), TypeError);
  assert.throws(() => parked.advance(0), TypeError); assert.equal(parked.state, 'parked');
  execution.drain(); execution.close(); parked.close(); closed(memory); memory.close();
});

test('parked frames count toward the shared arena frame limit', () => {
  const memory = new MemoryArena({maxFrames: 3});
  const first = new Execution(program('while True: pass\n'), {arena: memory}); first.advance(); first.park();
  const second = new Execution(program('print(7)\n'), {arena: memory});
  assert.throws(() => second.advance(), error => error.name === 'RecursionError' || error.code === 'BUDGET');
  second.close(); first.close(); closed(memory); memory.close();
});

test('allocation failure in a second activation preserves the parked owner', () => {
  const memory = new MemoryArena({maxBytes: 4500}); let output = '';
  const first = new Execution(program('print(7)\n'), {arena: memory, onOutput: text => { output += text; }});
  first.advance(); first.park();
  const second = new Execution(program('values=['+Array(100).fill('7').join(',')+']\n'), {arena: memory});
  assert.throws(() => second.advance(), {code: 'OOM'}); second.close();
  memory.collect([], {cleanup: true}); first.drain(); first.close();
  assert.equal(output, '7\n'); closed(memory); memory.close();
});

test('parking never replenishes work/instruction budgets or suppresses cancellation', () => {
  for (const mode of ['steps', 'work', 'cancel']) {
    const memory = new MemoryArena(); let cancel = false;
    const execution = new Execution(program('try:\n while True: pass\nfinally: print("wrong")\n'), {
      arena: memory, maxSteps: mode === 'steps' ? 35 : 100000, maxWork: mode === 'work' ? 6000 : 1000000,
      shouldCancel: () => cancel, onOutput: () => assert.fail('hard failure executed Python finally')});
    try {
      let previous = 0;
      assert.throws(() => { for (let i = 0; i < 10000; i++) {
        execution.advance(3); assert.ok(execution.snapshot().steps > previous); previous = execution.snapshot().steps;
        execution.park(); if (mode === 'cancel' && i === 3) cancel = true;
      } }, {code: mode === 'cancel' ? 'CANCELLED' : 'BUDGET'});
      assert.equal(execution.state, 'failed');
    } finally { execution.close(); closed(memory); memory.close(); }
  }
});

const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/execution.json', import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/execution-resources.json', import.meta.url)));
for (const fixture of corpus.cases) test('parking preserves composed execution/resource observations: ' + fixture.id, async () => {
  const units = [{name: 'app', source: fixture.source, imports: fixture.imports || [], package: false}, ...(fixture.modules || [])]
    .map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'}));
  const {registry} = await compileSourceModules(units, {languageProfile: 'classes-source/1'}), session = new ModuleSession(registry);
  let output = '', error = null;
  session.context.begin({maxSteps: 50000, maxWork: 20000000}, text => { output += text; });
  const execution = Execution.modules(session.context);
  try {
    try { do { execution.advance(1); if (execution.state === 'paused') execution.park(); } while (execution.state === 'parked'); }
    catch (caught) { error = caught; }
    assert.equal(output, fixture.stdout); assert.equal(error?.name, fixture.error_type);
    execution.close(); session.context.finish();
    assert.deepEqual({steps: session.context.steps, work: session.context.work, ...session.stats()}, baseline.cases[fixture.id]);
  } finally { execution.close(); session.context.finish(); session.close(); closed(session.memory); registry.close(); }
});

test('parked module/import/generator/protocol graphs survive forced collection and arbitrary close', async () => {
  const source = 'class A:\n @property\n def __hash__(self):\n  import helper\n  print("entered")\n  return lambda: helper.value\ndef gen():\n yield slice((A(),))\ng=gen()\nprint(hash(next(g))==hash(slice((A(),))))\n';
  const {registry} = await compileSourceModules([
    {name: 'app', source, package: false, imports: ['helper'], notice: 'Synthetic parked fixture'},
    {name: 'helper', source: 'value=7\n', package: false, imports: [], notice: 'Synthetic parked fixture'},
  ], {languageProfile: 'classes-source/1'});
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let cancel = false, output = '';
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state !== 'paused') break;
        execution.park(); session.memory.collect([], {cleanup: true});
        if (output === 'entered\n') {
          if (mode === 'close') break;
          if (mode === 'cancel') cancel = true;
        }
      }
      if (mode === 'finish') assert.equal(output, 'entered\nentered\nTrue\n');
      else assert.equal(mode, 'close');
    } catch (error) { assert.equal(mode, 'cancel'); assert.equal(error.code, 'CANCELLED'); }
    finally { execution.close(); session.context.finish(); session.close(); closed(session.memory); }
  } } finally { registry.close(); }
});
