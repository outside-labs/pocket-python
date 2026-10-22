import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Execution, execute} from './functions.mjs';
import {MemoryArena} from './memory.mjs';
import {compileSource} from './source-compiler.mjs';
import {runSourceRequest} from './source-request.mjs';
import {runExecutionRequest} from './execution_checks.mjs';
const program = source => { const result = structuredClone(compileSource(source).program); result.version = 3; return result; };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/execution.json', import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/execution-resources.json', import.meta.url)));
const fixtureRequest = fixture => ({modules: [{name: 'app', source: fixture.source, imports: fixture.imports || [], package: false},
  ...(fixture.modules || [])].map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'})),
  compileOptions: {languageProfile: 'classes-source/1'}, options: {maxSteps: 50000, maxWork: 20000000}});

for (const fixture of corpus.cases) test('every instruction boundary matches draining: ' + fixture.id, async () => {
  const request = fixtureRequest(fixture), direct = await runSourceRequest(request);
  const draining = await runExecutionRequest({...request, quantum: 1000000});
  for (const quantum of [1, 3, 17]) {
    const {boundaries, steps, work, transitions, ...stepped} = await runExecutionRequest({...request, quantum});
    assert.deepEqual(stepped, direct); assert.ok(boundaries > 0 || fixture.error_type);
    assert.deepEqual(transitions, draining.transitions);
    assert.ok(transitions["dispatch:call"] > 0);
    assert.equal(steps, baseline.cases[fixture.id].steps); assert.equal(work, baseline.cases[fixture.id].work);
  }
});

test('ready, paused, completed and failed executions close idempotently and preserve result leases', () => {
  const code = program('def f(value): return value+1\nprint(f(6))\n');
  for (const mode of ['ready', 'paused', 'completed', 'failed']) {
    const arena = new MemoryArena(); let stdout = '';
    const execution = new Execution(code, {arena, retainResult: true, maxSteps: mode === 'failed' ? 1 : 10000,
      onOutput: text => { stdout += text; }});
    assert.equal(execution.state, 'ready');
    if (mode === 'paused') { execution.advance(); assert.equal(execution.state, 'paused'); }
    if (mode === 'completed') { execution.drain(); assert.equal(execution.state, 'completed'); assert.equal(stdout, '7\n'); }
    if (mode === 'failed') { assert.throws(() => execution.drain(), {code: 'BUDGET'}); assert.equal(execution.state, 'failed'); }
    const result = mode === 'completed' ? execution.result : null;
    if (result) assert.deepEqual(result.get(), [null]);
    execution.close(); execution.close(); assert.equal(execution.state, 'closed');
    assert.throws(() => execution.advance(), TypeError); assert.throws(() => execution.result, TypeError);
    assert.equal(arena.stats().frames, 0); assert.equal(arena.stats().roots, result ? 1 : 0);
    result?.release(); assert.equal(arena.stats().bytes, 0); assert.equal(arena.stats().objects, 0); arena.close();
  }
});

test('paused mutable frames survive collection without allowing another activation to interleave', () => {
  const arena = new MemoryArena(), execution = new Execution(program('values=[]\ni=0\nwhile i<4:\n values=values+[[i]]\n i=i+1\nprint(values[3][0])\n'), {arena});
  let count = 0;
  while (execution.state !== 'completed') {
    execution.advance(); count++;
    if (execution.state === 'paused') {
      arena.collect([], {cleanup: true});
      const other = new Execution(program('print(99)\n'), {arena});
      assert.throws(() => other.advance(), TypeError); assert.equal(other.state, 'ready'); other.close();
      assert.throws(() => execute(program('print(99)\n'), {arena}), TypeError);
      assert.equal(execution.state, 'paused');
    }
  }
  assert.ok(count > 20); execution.close(); assert.equal(arena.stats().bytes, 0); arena.close();
});

test('reentry and invalid quanta leave the owner intact; counters never reset at pauses', () => {
  let execution, output = '';
  const arena = new MemoryArena(), code = program('print(7)\nwhile True: pass\n');
  execution = new Execution(code, {arena, maxSteps: 40, onOutput: text => {
    for (const action of [() => execution.advance(), () => execution.drain(), () => execution.close()]) assert.throws(action, TypeError);
    output += text;
  }});
  for (const units of [0, -1, 1.5, Infinity, 1000001]) assert.throws(() => execution.advance(units), TypeError);
  assert.equal(execution.state, 'ready');
  let previous = 0;
  assert.throws(() => { while (true) {
    const snapshot = execution.advance(); assert.ok(snapshot.steps >= previous); previous = snapshot.steps;
    assert.throws(() => { snapshot.frames.push({}); }, TypeError);
    if (snapshot.source?.location) assert.throws(() => { snapshot.source.location.span[0] = 999; }, TypeError);
  } }, {code: 'BUDGET'});
  assert.equal(execution.snapshot().steps, 41); assert.equal(output, '7\n'); assert.equal(execution.state, 'failed');
  assert.throws(() => execution.advance(), TypeError); execution.close(); assert.equal(arena.stats().bytes, 0); arena.close();
});

test('cancellation after a pause releases the full graph and bypasses Python finally', () => {
  let cancelled = false, stdout = '';
  const arena = new MemoryArena(), execution = new Execution(program('try:\n while True: pass\nfinally: print("wrong")\n'),
    {arena, shouldCancel: () => cancelled, onOutput: text => { stdout += text; }});
  execution.advance(4); cancelled = true;
  assert.throws(() => execution.advance(), {code: 'CANCELLED'}); assert.equal(stdout, '');
  assert.equal(execution.state, 'failed'); execution.close(); assert.equal(arena.stats().bytes, 0); arena.close();
});
