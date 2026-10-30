import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';

const integer = value => ({type: 'int', value: String(value)});
const list = (...items) => ({type: 'list', items});
const unit = (source, name = 'app', imports = []) => ({name, source, imports, package: false, notice: 'Synthetic callback fixture'});
const setup = async (source, options = {}, units = []) => {
  const {registry} = await compileSourceModules([unit(source, 'app', units.map(unit => unit.name)), ...units], {languageProfile: 'classes-source/1'});
  const session = new ModuleSession(registry, options);
  const close = () => {
    session.close(); session.close(); registry.close();
    for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(session.stats()[key], 0, key);
  };
  return {session, close};
};
const pump = (session, quantum = 1) => {
  let count = 0;
  while (session.pending) {
    assert.ok(++count < 20000); session.pump(quantum);
    session.memory.collect([], {cleanup: true});
  }
};

test('cooperative module entry retains one activation and its total budgets', async () => {
  const {session, close} = await setup('n=0\nwhile n<4: n+=1\ndef update(x): return n+x\n');
  try {
    const entry = session.start(); assert.equal(entry.state, 'ready');
    entry.advance(1); assert.equal(entry.state, 'parked');
    assert.throws(() => session.start(), TypeError); assert.throws(() => session.register('update'), TypeError);
    assert.throws(() => entry.advance(0), TypeError); assert.equal(entry.state, 'parked');
    while (entry.state === 'parked') entry.advance(3);
    assert.equal(entry.result.status, 'ready'); entry.close();
    const handle = session.register('update'), event = session.enqueue(handle, [integer(3)]);
    pump(session); assert.deepEqual(await event.result, integer(7));
  } finally { close(); }
});

test('serialized callbacks preserve globals, mutable defaults, closures and cache identity', async () => {
  const {session, close} = await setup('import helper\nn=0\ndef make():\n saved=[]\n def update(x, seen=[]):\n  global n\n  n+=x\n  seen.append(n)\n  saved.append(n)\n  helper.values.append(n)\n  return [n,len(seen),len(saved),len(helper.values)]\n return update\nupdate=make()\n', {},
    [unit('values=[]\n', 'helper')]);
  try {
    session.run(); const handle = session.register('update');
    const events = [1, 2, 3].map(n => session.enqueue(handle, [integer(n)]));
    pump(session);
    assert.deepEqual(await Promise.all(events.map(event => event.result)), [list(integer(1), integer(1), integer(1), integer(1)),
      list(integer(3), integer(2), integer(2), integer(2)), list(integer(6), integer(3), integer(3), integer(3))]);
    assert.deepEqual(session.read('n'), integer(6)); assert.equal(session.context.module('helper').status, 'ready');
  } finally { close(); }
});

test('registered function identity survives export replacement and queued arguments/results are copied', async () => {
  const {session, close} = await setup('def update(x):\n x.append(7)\n return x\ndef replace():\n global update\n update=lambda x: [99]\n');
  try {
    session.run(); const handle = session.register('update'), replacement = session.register('replace');
    const input = list(integer(1)), first = session.enqueue(handle, [input]); input.items[0].value = '99';
    pump(session); const result = await first.result; assert.deepEqual(result, list(integer(1), integer(7))); assert.ok(Object.isFrozen(result));
    const replace = session.enqueue(replacement); pump(session); await replace.result;
    const second = session.enqueue(handle, [list(integer(2))]); pump(session);
    assert.deepEqual(await second.result, list(integer(2), integer(7))); assert.deepEqual(result, list(integer(1), integer(7)));
    session.unregister(handle); assert.throws(() => session.enqueue(handle), {code: 'STALE_HANDLE'});
  } finally { close(); }
});

test('registered callbacks retain executable identity after metadata mutation', async () => {
  const {session, close} = await setup('def update(x): return x+1\ndef rename():\n update.__name__="renamed"\n update.__qualname__="path.renamed"\n update.__module__=[update]\n return update.__name__\n');
  try {
    session.run();
    const update = session.register('update'), rename = session.register('rename');
    const changed = session.enqueue(rename), queued = session.enqueue(update, [integer(7)]);
    pump(session);
    assert.deepEqual(await changed.result, {type: 'str', codepoints: Array.from('renamed', char => char.codePointAt(0))});
    assert.deepEqual(await queued.result, integer(8));
    const later = session.enqueue(update, [integer(9)]); pump(session);
    assert.deepEqual(await later.result, integer(10));
  } finally { close(); }
});

test('a callback can enqueue from output without Python reentry or premature settlement', async () => {
  const {session, close} = await setup('n=0\ndef update():\n global n\n print(n)\n n+=1\n return n\n');
  try {
    session.run(); const handle = session.register('update'); let second, output = '';
    const first = session.enqueue(handle, [], {}, text => {
      output += text; assert.throws(() => session.pump(), TypeError);
      assert.throws(() => session.close(), TypeError); assert.throws(() => session.unregister(handle), TypeError);
      assert.throws(() => first.cancel(), TypeError);
      second = session.enqueue(handle);
    });
    pump(session); assert.equal(output, '0\n'); assert.deepEqual(await first.result, integer(1));
    assert.deepEqual(await second.result, integer(2)); assert.equal(first.cancel(), false);
  } finally { close(); }
});

test('queued and parked cancellation suppress Python finally and settle exactly once', async () => {
  const {session, close} = await setup('n=0\ndef update():\n global n\n n+=1\n try:\n  print("entered")\n  while True: pass\n finally: print("wrong")\n');
  try {
    session.run(); const handle = session.register('update'); let output = '', settlements = 0;
    const first = session.enqueue(handle, [], {}, text => { output += text; }), queued = session.enqueue(handle);
    first.result.catch(() => { settlements++; }); queued.result.catch(() => { settlements++; });
    assert.equal(queued.cancel(), true); assert.equal(queued.cancel(), false);
    while (!output) session.pump(1);
    assert.equal(first.cancel(), true); assert.equal(first.cancel(), false);
    await assert.rejects(first.result, {code: 'CANCELLED'}); await assert.rejects(queued.result, {code: 'CANCELLED'});
    assert.equal(settlements, 2); assert.equal(output, 'entered\n'); assert.equal(session.pending, 0);
    assert.deepEqual(session.read('n'), integer(1)); assert.equal(session.stats().frames, 0);
  } finally { close(); }
});

test('unregister and session close cancel all owned queued/parked events', async () => {
  for (const mode of ['unregister', 'close']) {
    const {session, close} = await setup('def update():\n while True: pass\n');
    try {
      session.run(); const handle = session.register('update');
      const first = session.enqueue(handle), second = session.enqueue(handle); session.pump(3);
      if (mode === 'close') session.close(); else session.unregister(handle);
      await assert.rejects(first.result, {code: 'CANCELLED'}); await assert.rejects(second.result, {code: 'CANCELLED'});
      assert.equal(session.pending, 0); assert.equal(session.callbacks, 0);
      assert.equal(first.cancel(), false); assert.throws(() => session.enqueue(handle));
    } finally { close(); }
  }
});

test('callback failure preserves module state and does not prevent the next event', async () => {
  const {session, close} = await setup('n=0\ndef update(x):\n global n\n n+=1\n return 7//x\n');
  try {
    session.run(); const handle = session.register('update');
    const bad = session.enqueue(handle, [integer(0)]), good = session.enqueue(handle, [integer(1)]);
    pump(session);
    await assert.rejects(bad.result, error => error.name === 'ZeroDivisionError' && error.traceback[0].function === 'update');
    assert.deepEqual(await good.result, integer(7)); assert.deepEqual(session.read('n'), integer(2));
    assert.equal(session.context.module('app').status, 'ready');
  } finally { close(); }
});

test('callback argument binding and result transport errors release all transient ownership', async () => {
  const {session, close} = await setup('def update(x): return x\ndef invalid(): return invalid\n');
  try {
    session.run(); const handle = session.register('update'), invalid = session.register('invalid');
    const missing = session.enqueue(handle), unencoded = session.enqueue(invalid); pump(session);
    await assert.rejects(missing.result, {name: 'TypeError'}); await assert.rejects(unencoded.result, {name: 'TypeError'});
    assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 3);
  } finally { close(); }
});

test('callback events share instruction/work/recursion/allocation limits across pumps', async () => {
  for (const [body, options, memoryLimits, expected] of [
    ['while True: pass', {maxSteps: 60}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 12000}, undefined, 'BUDGET'],
    ['return update()', {maxDepth: 8}, undefined, 'PYTHON'],
    ['held=[]\n while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const {session, close} = await setup('def update():\n '+body+'\n', {memoryLimits});
    try {
      session.run(); const handle = session.register('update'), event = session.enqueue(handle, [], options);
      pump(session, 3); await assert.rejects(event.result, {code: expected}); assert.equal(session.stats().frames, 0);
    } finally { close(); }
  }
});

test('input conversion and result encoding participate in activation work/cancellation budgets', async () => {
  const {session, close} = await setup('def update(x): return x\n');
  try {
    session.run(); const handle = session.register('update');
    const large = {type: 'str', codepoints: Array(500).fill(65)};
    const event = session.enqueue(handle, [large], {maxWork: 10}); pump(session);
    await assert.rejects(event.result, {code: 'BUDGET'}); assert.equal(session.stats().frames, 0);
    const cancelled = session.enqueue(handle, [integer(7)], {shouldCancel: () => true}); pump(session);
    await assert.rejects(cancelled.result, {code: 'CANCELLED'});
  } finally { close(); }
});

test('callback and event caps include active events and failed admission leaves no leases', async () => {
  const {session, close} = await setup('def update(): return 7\n', {maxCallbacks: 1, maxEvents: 1});
  try {
    session.run(); const handle = session.register('update'); assert.throws(() => session.register('update'), {code: 'QUOTA'});
    const first = session.enqueue(handle); session.pump(1);
    assert.throws(() => session.enqueue(handle), {code: 'QUOTA'}); pump(session); await first.result;
    const before = session.stats();
    for (const args of [[{type: 'bad'}], [{type: 'int', value: '00'}], [{type: 'list', items: [undefined]}]])
      assert.throws(() => session.enqueue(handle, args));
    assert.deepEqual(session.stats(), before); assert.equal(session.pending, 0);
  } finally { close(); }
});

test('events reject cycles, accessors, sparse arrays and oversized values before enqueue', async () => {
  const {session, close} = await setup('def update(x): return x\n');
  try {
    session.run(); const handle = session.register('update'), before = session.stats(); let getters = 0;
    const cyclic = []; cyclic.push(cyclic);
    const accessor = {type: 'int', get value() { getters++; return '7'; }};
    for (const value of [cyclic, [accessor], Array(1), [{type: 'str', codepoints: Array(20000).fill(65)}]])
      assert.throws(() => session.enqueue(handle, value));
    assert.equal(getters, 0); assert.equal(session.pending, 0); assert.deepEqual(session.stats(), before);
  } finally { close(); }
});

test('only ordinary ready exported functions register and callback generations cannot cross sessions', async () => {
  const first = await setup('class A: pass\ndef gen(): yield 7\ndef update(): return 7\nvalue=7\n');
  const second = await setup('def update(): return 8\n');
  try {
    assert.throws(() => first.session.register('update'), TypeError);
    first.session.run(); second.session.run();
    for (const name of ['A', 'gen', 'value', 'missing']) assert.throws(() => first.session.register(name), TypeError);
    const handle = first.session.register('update');
    assert.throws(() => second.session.enqueue(handle), {code: 'STALE_HANDLE'});
    assert.throws(() => first.session.enqueue({...handle, extra: true}), {code: 'STALE_HANDLE'});
    first.session.unregister(handle); assert.throws(() => first.session.unregister(handle), {code: 'STALE_HANDLE'});
  } finally { first.close(); second.close(); }
});

test('callback registration OOM/root exhaustion preserves the cache and previous registrations', async () => {
  const {session, close} = await setup('def update(): return 7\n', {memoryLimits: {maxRoots: 2}});
  try {
    session.run(); const handle = session.register('update'); assert.throws(() => session.register('update'), {code: 'OOM'});
    assert.equal(session.callbacks, 1); session.unregister(handle); assert.equal(session.stats().roots, 1);
  } finally { close(); }
});

test('callback failure in a new import removes only the failed initializer', async () => {
  const {session, close} = await setup('n=0\ndef update():\n global n\n n+=1\n import helper\n', {},
    [unit('raise ValueError("bad")\n', 'helper')]);
  try {
    session.run(); const handle = session.register('update');
    for (let i = 1; i <= 2; i++) {
      const event = session.enqueue(handle); pump(session);
      await assert.rejects(event.result, error => error.name === 'ValueError' && error.traceback.map(f => f.function).join(',') === 'update,<module>');
      assert.equal(session.context.module('helper'), null); assert.deepEqual(session.read('n'), integer(i));
      assert.deepEqual(session.context.chain, []);
    }
  } finally { close(); }
});

test('closing cooperative initialization removes unfinished modules without Python finally', async () => {
  const {session, close} = await setup('try:\n print("entered")\n while True: pass\nfinally: print("wrong")\n');
  try {
    let output = ''; const entry = session.start({}, text => { output += text; });
    while (!output) entry.advance(1);
    session.close(); assert.equal(entry.state, 'closed'); assert.equal(output, 'entered\n');
  } finally { close(); }
});

test('invalid event execution options settle only that event and preserve the next event', async () => {
  const {session, close} = await setup('def update(): return 7\n');
  try {
    session.run(); const handle = session.register('update');
    const bad = session.enqueue(handle, [], {maxSteps: 0}), options = {maxSteps: 200}, good = session.enqueue(handle, [], options);
    options.maxSteps = 0; pump(session);
    await assert.rejects(bad.result, TypeError); assert.deepEqual(await good.result, integer(7));
  } finally { close(); }
});

test('execution-option accessors never run and failed snapshots allocate no event metadata', async () => {
  const {session, close} = await setup('def update(): return 7\n');
  try {
    session.run(); const handle = session.register('update'), before = session.stats(); let getters = 0;
    const options = {get maxSteps() { getters++; throw new Error('getter ran'); }};
    assert.throws(() => session.enqueue(handle, [], options), TypeError);
    assert.equal(getters, 0); assert.equal(session.pending, 0); assert.deepEqual(session.stats(), before);
  } finally { close(); }
});

test('falsy values thrown by host hooks reject exactly once and preserve the next event', async () => {
  const {session, close} = await setup('def update(): return 7\n');
  try {
    session.run(); const handle = session.register('update');
    for (const thrown of [null, undefined, false, 0]) {
      const bad = session.enqueue(handle, [], {shouldCancel: () => { throw thrown; }}), good = session.enqueue(handle);
      pump(session);
      await bad.result.then(() => assert.fail('Host failure resolved'), error => assert.equal(error, thrown));
      assert.deepEqual(await good.result, integer(7)); assert.equal(bad.cancel(), false);
    }
  } finally { close(); }
});


test('paused callback owners remain collectable at tight allocation boundaries', async () => {
  for (const maxBytes of [23964, 23972, 23980, 24000]) {
    const {session, close} = await setup('def update():\n held=[]\n while True: held.append([7])\n', {memoryLimits: {maxBytes}});
    try {
      session.run(); const handle = session.register('update');
      const event = session.enqueue(handle, [], {maxSteps:100000, maxWork:100000000});
      pump(session, 3);
      await assert.rejects(event.result, {code:'OOM'});
      assert.equal(session.stats().frames, 0);
    } finally { close(); }
  }
});
