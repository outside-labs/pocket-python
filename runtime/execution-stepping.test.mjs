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

test('a single instruction driver visits nested initializer frames with shared counters and cache identity', async () => {
  const {compileSourceModules} = await import('./source-modules.mjs');
  const {ModuleSession} = await import('./module-session.mjs');
  const units = [
    {name: 'app', package: false, imports: ['pkg.child'], source: 'import pkg.child as first\nimport pkg.child as second\nprint(first is second,first.value)\n'},
    {name: 'pkg', package: true, imports: [], source: 'print("pkg")\n'},
    {name: 'pkg.child', package: false, imports: ['helper'], source: 'import helper\nvalue=helper.value+1\nprint("child")\n'},
    {name: 'helper', package: false, imports: [], source: 'values=[]\ni=0\nwhile i<3:\n values.append([i])\n i+=1\nvalue=values[2][0]+4\n'}
  ].map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'}));
  const {registry} = await compileSourceModules(units), session = new ModuleSession(registry);
  let output = ''; const visited = new Set();
  session.context.begin({maxWork: 20000000}, text => { output += text; });
  const execution = Execution.modules(session.context);
  try {
    let previous = 0;
    do {
      const snapshot = execution.advance(); assert.equal(snapshot.steps, previous + 1); previous = snapshot.steps;
      for (const frame of snapshot.frames) if (frame.module) visited.add(frame.module);
      if (snapshot.frames.some(frame => frame.module === 'helper')) {
        assert.deepEqual(session.context.chain, ['app', 'pkg.child', 'helper']);
        assert.equal(session.context.module('pkg').status, 'ready');
        assert.equal(session.context.module('pkg.child').status, 'initializing');
        assert.equal(snapshot.imports.length, 3);
        session.memory.collect([], {cleanup: true});
      }
    } while (execution.state === 'paused');
    assert.equal(output, 'pkg\nchild\nTrue 7\n');
    assert.deepEqual([...visited].sort(), ['app', 'helper', 'pkg', 'pkg.child']);
    const child = session.context.module('pkg.child');
    assert.equal(session.context.module('pkg').environment.cells.get('child').value, child);
    assert.equal(session.context.module('app').environment.cells.get('first').value, child);
    assert.equal(session.context.module('app').environment.cells.get('second').value, child);
    assert.deepEqual(session.context.chain, []);
  } finally { execution.close(); session.context.finish(); session.close(); registry.close(); }
  assert.equal(session.stats().bytes, 0); assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 0);
});

test('closing or cancelling inside an imported initializer unwinds owned plans and preserves prior effects', async () => {
  const {compileSourceModules} = await import('./source-modules.mjs');
  const {ModuleSession} = await import('./module-session.mjs');
  const units = [
    {name: 'app', package: false, imports: ['state', 'helper'], source: 'import state\ntry: import helper\nfinally: print("wrong")\n'},
    {name: 'state', package: false, imports: [], source: 'calls=[]\n'},
    {name: 'helper', package: false, imports: ['state'], source: 'import state\nstate.calls.append([7])\nprint("entered")\nwhile True: pass\n'}
  ].map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'}));
  const {registry} = await compileSourceModules(units);
  try {
    for (const mode of ['close', 'cancel']) {
      const session = new ModuleSession(registry); let cancel = false, output = '';
      session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (output !== 'entered\n') execution.advance();
        assert.equal(execution.state, 'paused'); assert.deepEqual(session.context.chain, ['app', 'helper']);
        session.memory.collect([], {cleanup: true});
        if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
        execution.close(); execution.close();
        assert.equal(output, 'entered\n'); assert.equal(session.context.module('app'), null);
        assert.equal(session.context.module('helper'), null); assert.deepEqual(session.context.chain, []);
        assert.equal(session.context.module('state').status, 'ready');
        assert.equal(session.context.module('state').environment.cells.get('calls').value.items.length, 1);
        assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 1);
      } finally { execution.close(); session.context.finish(); session.close(); }
      for (const key of ['bytes', 'objects', 'frames', 'roots', 'external']) assert.equal(session.stats()[key], 0);
    }
  } finally { registry.close(); }
});

test('forced import stepping preserves relative packages, cycle refusal and quotas', async () => {
  const scenarios = [
    [
      {name: 'app', package: false, imports: ['pkg.worker'], source: 'from pkg import worker\nprint(worker.value)\n'},
      {name: 'pkg', package: true, imports: [], source: 'print("parent")\n'},
      {name: 'pkg.worker', package: false, imports: ['pkg.helper'], source: 'from .helper import value\n'},
      {name: 'pkg.helper', package: false, imports: [], source: 'value=7\n'}
    ],
    [
      {name: 'app', package: false, imports: ['helper'], source: 'import helper\n'},
      {name: 'helper', package: false, imports: ['app'], source: 'import app\n'}
    ]
  ];
  for (const units of scenarios) for (const options of [{maxWork: 20000000}, {maxSteps: 8}, {maxWork: 3000}]) {
    const request = {modules: units.map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'})), options};
    const direct = await runSourceRequest(request);
    const {boundaries, steps, work, transitions, ...stepped} = await runExecutionRequest(request);
    assert.deepEqual(stepped, direct); assert.equal(stepped.stats.frames, 0);
    for (const key of ['bytes', 'frames', 'roots']) assert.equal(stepped.closed[key], 0);
  }
});

test('failure or cancellation during imported-error ownership preflight leaves no stranded initializer', async () => {
  const {compileSourceModules} = await import('./source-modules.mjs');
  const {ModuleSession} = await import('./module-session.mjs');
  const {ExceptionValue} = await import('./function-objects.mjs');
  const {ResourceError} = await import('./memory.mjs');
  const units = [
    {name: 'app', package: false, imports: ['helper'], source: 'try: import helper\nfinally: print("wrong")\n'},
    {name: 'helper', package: false, imports: [], source: 'print("entered")\nraise ValueError("bad")\n'}
  ].map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'}));
  const {registry} = await compileSourceModules(units);
  try {
    for (const mode of ['oom', 'cancel']) {
      const session = new ModuleSession(registry), pin = session.memory.pin.bind(session.memory);
      let transferring = false, output = '';
      session.memory.pin = values => {
        if (values[0] instanceof ExceptionValue) {
          transferring = true;
          if (mode === 'oom') throw new ResourceError('OOM', 'MemoryError', 'Injected transfer preflight exhaustion.');
        }
        return pin(values);
      };
      session.context.begin({maxWork: 20000000, shouldCancel: () => mode === 'cancel' && transferring}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        assert.throws(() => { while (execution.state !== 'completed') execution.advance(); }, {code: mode === 'oom' ? 'OOM' : 'CANCELLED'});
        assert.equal(transferring, true); assert.equal(output, 'entered\n'); assert.equal(execution.state, 'failed');
        assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 1);
        assert.deepEqual(session.context.chain, []); assert.equal(session.context.module('app'), null); assert.equal(session.context.module('helper'), null);
      } finally { execution.close(); session.context.finish(); session.close(); }
      for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(session.stats()[key], 0);
    }
  } finally { registry.close(); }
});

test('initializing package parents can grant a child and cached entry runs allocate no new frames', async () => {
  const {compileSourceModules} = await import('./source-modules.mjs');
  const {ModuleSession} = await import('./module-session.mjs');
  const units = [
    {name: 'app', package: false, imports: ['pkg'], source: 'import pkg\nprint(pkg.value)\n'},
    {name: 'pkg', package: true, imports: ['pkg.child'], source: 'from .child import value\n'},
    {name: 'pkg.child', package: false, imports: [], source: 'value=7\n'}
  ].map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'}));
  const {registry} = await compileSourceModules(units), session = new ModuleSession(registry);
  try {
    let stdout = '';
    const first = session.run({}, text => { stdout += text; }), stats = session.stats();
    assert.equal(stdout, '7\n');
    assert.equal(session.run(), first); assert.equal(session.context.steps, 0); assert.equal(session.context.work, 0);
    assert.equal(session.stats().allocations, stats.allocations); assert.equal(session.stats().frames, 0);
  } finally { session.close(); registry.close(); }
});
