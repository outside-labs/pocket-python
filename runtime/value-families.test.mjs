import test from 'node:test';
import assert from 'node:assert/strict';
import {ValueRuntime, valueLayout} from './values.mjs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', source, imports: [], package: false, notice: 'Synthetic value-family notice'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = result => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(result.closed[key], 0, key);
};

test('set algebra and frozen hashes preserve membership across primitive subsets', () => {
  const values = new ValueRuntime({numeric: true});
  const make = (mask, frozen) => {
    const value = values.newSet(frozen);
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) values.commitDictionary(value.storage, BigInt(i), null, values.pythonHash(BigInt(i)), -1);
    return value;
  };
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
    const left = make(a, true), right = make(b, false);
    for (const [name, mask] of [['bit-or', a | b], ['bit-and', a & b], ['bit-xor', a ^ b], ['subtract', a & ~b]]) {
      const result = values.binary(name, left, right);
      assert.equal(values.equal(result, make(mask, true)), true);
      assert.equal(values.pythonHash(result), values.pythonHash(make(mask, true)));
      assert.equal(result.frozen, true);
    }
    assert.equal(values.binary('less-equal', left, right), (a & b) === a);
    assert.equal(valueLayout(left).children[0], left.storage);
  }
});

test('set operations preserve aliases and avoid rebinding existing equal elements', async () => {
  const result = await run('a={1,2}; b=a; a|={2,3}; a&={2,3}; a^={3,4}; a-={4}\nprint(a is b,len(b),2 in b)\n' +
    'class K:\n def __hash__(self): return 1\n def __eq__(self,o): return True\nx=K(); y=K(); s={x}; s.add(y); print(next(iter(s)) is x,len(s.copy()))\n');
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.stdout, 'True 1 True\nTrue 1\n'); closed(result);
});

test('set acquisition and key callback exhaustion propagate instead of finishing construction', async () => {
  for (const source of [
    'class K:\n def __hash__(self): raise StopIteration("hash")\nset([K()])\n',
    'class K:\n def __hash__(self): return 1\n def __eq__(self,o): raise StopIteration("equal")\nset([K(),K()])\n',
    'class I:\n def __iter__(self): raise StopIteration("iter")\nset(I())\n'
  ]) {
    const result = await run(source); assert.equal(result.error.type, 'StopIteration'); closed(result);
  }
});

test('set copy constructors reuse cached key hashes without invoking user code', async () => {
  const result = await run('class K:\n def __hash__(self): print("hash"); return 1\ns={K()}; a=set(s); b=frozenset(s); c=set(b); d=s.copy()\nprint(len(a),len(b),len(c),len(d))\n');
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(result.stdout, 'hash\n1 1 1 1\n'); closed(result);
});

test('set callbacks retain partial results through stepping, collection, cancellation and close', async () => {
  const sources = [
    'class K:\n def __hash__(self):\n  print("entered")\n  return 1\ns=set([K(),K()]); print(len(s))\n',
    'class K:\n def __hash__(self): return 1\n def __eq__(self,o):\n  print("entered")\n  return True\ns={K(),K()}; print(len(s))\n',
    'class I:\n def __iter__(self):\n  print("entered")\n  return iter([1,2])\ns={0,*I()}; print(len(s))\n'
  ];
  for (const source of sources) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try {
      for (const mode of ['finish', 'cancel', 'close']) {
        const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
        session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
        const execution = Execution.modules(session.context);
        try {
          while (execution.state !== 'completed') {
            execution.advance(); session.memory.collect([], {cleanup: true});
            if (output.includes('entered\n') && !reached) {
              reached = true;
              if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
              if (mode === 'close') break;
            }
          }
          assert.equal(reached, true); if (mode === 'finish') assert.match(output, /[123]\n$/);
        } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
        closed({closed: session.stats()});
      }
    } finally { registry.close(); }
  }
});

test('set growth, work and allocation failures release every logical owner', async () => {
  for (const [source, options, limits, code] of [
    ['set(range(1025))\n', {maxSteps: 50000, maxWork: 20000000}, undefined, 'BUDGET'],
    ['set(range(100))\n', {maxWork: 500}, undefined, 'BUDGET'],
    ['set(range(100))\n', {maxWork: 20000000}, {maxBytes: 10000}, 'OOM']
  ]) {
    const result = await run(source, options, limits); assert.equal(result.error.code, code); closed(result);
  }
});

test('deferred set algebra and structural key mutation fail without leaking callbacks', async () => {
  const algebra = await run('class K:\n def __hash__(self): print("hash"); return 1\na=K(); s={a}; print("ready"); s|set()\n');
  assert.equal(algebra.error.code, 'UNSUPPORTED'); assert.equal(algebra.stdout, 'hash\nready\n'); closed(algebra);
  const mutation = await run('class K:\n def __hash__(self): return 1\n def __eq__(self,o):\n  s.clear()\n  return True\ns={K()}; K() in s\n');
  assert.equal(mutation.error.code, 'UNSUPPORTED'); closed(mutation);
});

test('binary constants snapshot bytes, preserve scalar transport and reject malformed or mutable constants', () => {
  const values = new ValueRuntime({numeric: true}), bytes = [0, 97, 255];
  const immutable = values.decode({type: 'bytes', bytes}, {immutable: true}); bytes[0] = 9;
  assert.equal(values.index(immutable, 0n), 0n);
  assert.deepEqual(values.encode(immutable), {type: 'bytes', bytes: [0, 97, 255]});
  const mutable = values.decode({type: 'bytearray', bytes: [1, 2]});
  values.set(mutable, 1n, 255n); assert.equal(values.index(mutable, 1n), 255n);
  assert.equal(valueLayout(mutable).bytes, 66); assert.deepEqual(valueLayout(mutable).children, []);
  for (const record of [{type: 'bytes', bytes: [256]}, {type: 'bytes', bytes: [-1]}, {type: 'bytes', bytes: [1.5]},
    {type: 'bytes', bytes: [null]}, {type: 'bytes', bytes: [], extra: 0}, {type: 'bytearray', bytes: []}])
    assert.throws(() => values.decode(record, {immutable: true}), {name: 'TypeError'});
  assert.throws(() => new ValueRuntime().decode({type: 'bytes', bytes: []}), {name: 'TypeError'});
});

test('strict UTF-8 matches scalar encoding and rejects malformed input without replacement', () => {
  const values = new ValueRuntime({numeric: true});
  const points = [0, 127, 128, 2047, 2048, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff, 0xfeff];
  for (let point = 0; point <= 0x10ffff; point += 251) if (point < 0xd800 || point > 0xdfff) points.push(point);
  const string = values.string(points), bytes = values.encodeText(string);
  assert.deepEqual(bytes.items, [...new TextEncoder().encode(String.fromCodePoint(...points))]);
  assert.equal(values.equal(values.decodeBinary(bytes), string), true);
  for (const invalid of [[128], [192, 175], [224, 128, 128], [237, 160, 128], [244, 144, 128, 128],
    [245, 128, 128, 128], [240, 159], [226, 40, 161], [255]])
    assert.throws(() => values.decodeBinary(values.binaryValue(invalid)), {name: 'UnicodeDecodeError'});
  for (const surrogate of [0xd800, 0xdbff, 0xdc00, 0xdfff])
    assert.throws(() => values.encodeText(values.string([surrogate])), {name: 'UnicodeEncodeError'});
});

test('binary growth limits are checked before repetition and count allocation', async () => {
  const values = new ValueRuntime({numeric: true});
  assert.throws(() => values.binaryCount(65537n), {code: 'BUDGET'});
  assert.throws(() => values.binary('multiply', values.binaryValue([1]), 65537n), {code: 'BUDGET'});
  assert.throws(() => values.binary('multiply', values.binaryValue([]), 10n ** 100n), {name: 'OverflowError'});
  assert.throws(() => values.binaryCount(-(10n ** 100n)), {name: 'OverflowError'});
  for (const [source, options, limits, code] of [
    ['bytes(range(256))\n', {maxWork: 500}, undefined, 'BUDGET'],
    ['bytes(65536)\n', {}, {maxBytes: 12000}, 'OOM']
  ]) {
    const result = await run(source, options, limits); assert.equal(result.error.code, code); closed(result);
  }
});

test('binary type conversions retain operands across pause, collection, cancellation and close', async () => {
  for (const source of [
    'class I:\n def __index__(self): print("entered"); return 2\na=bytes([I()]); b=bytearray(b"abc"); b[I()]=I(); print(a[0],b[2])\n',
    'class B:\n @property\n def __bytes__(self):\n  print("entered")\n  return lambda: b"ok"\nprint(bytes(B())==b"ok")\n'
  ]) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output.includes('entered\n') && !reached) {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.equal(reached, true); if (mode === 'finish') assert.match(output, /(2 2|True)\n$/);
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed({closed: session.stats()});
    } } finally { registry.close(); }
  }
});

test('bytes user length hints refuse before hooks while bytearray ignores them', async () => {
  const source = 'class I:\n def __iter__(self): print("iter"); return iter([1])\n def __len__(self): print("hint"); return 1\n';
  const bytes = await run(source + 'bytes(I())\n');
  assert.equal(bytes.error.code, 'UNSUPPORTED'); assert.equal(bytes.stdout, ''); closed(bytes);
  const bytearray = await run(source + 'print(len(bytearray(I())))\n');
  assert.equal(bytearray.ok, true, JSON.stringify(bytearray.error)); assert.equal(bytearray.stdout, 'iter\n1\n'); closed(bytearray);
});

test('deferred bytearray slice mutation reaches its explicit boundary', async () => {
  const result = await run('a=bytearray(b"abc"); a[1:]=b"d"\n');
  assert.equal(result.error.code, 'UNSUPPORTED'); closed(result);
});

test('logical views keep one buffer edge and slices match signed sequence selection', () => {
  const values = new ValueRuntime({numeric: true}), owner = values.binaryValue([0, 1, 2, 3, 4, 5, 6, 7], true), view = values.view(owner);
  assert.equal(valueLayout(view).bytes, 112); assert.deepEqual(valueLayout(view).children, [owner]);
  for (const start of [null, -100n, -3n, -1n, 0n, 3n, 100n])
    for (const stop of [null, -100n, -3n, -1n, 0n, 3n, 100n]) for (const step of [-4n, -1n, 1n, 3n]) {
      const sliced = values.slice(view, start, stop, step), expected = values.slice(owner, start, stop, step);
      assert.deepEqual(values.viewItems(sliced), expected.items);
      assert.equal(valueLayout(sliced).bytes, 112); assert.deepEqual(valueLayout(sliced).children, [owner]);
    }
  const child = values.slice(view, 1n, null, 2n); values.releaseView(view); values.set(child, 0n, 99n);
  assert.equal(values.index(owner, 1n), 99n); assert.deepEqual(valueLayout(view).children, []);
  assert.throws(() => values.unary('len', view), {name: 'ValueError'});
});

test('view owners, child aliases and cached hashes survive instruction-boundary collection', async () => {
  const source = 'b=bytearray(b"abcd"); a=memoryview(b); c=a[::-1]; del b\na.release(); c[0]=90; print(c.tobytes()==b"Zcba")\n' +
    'r=memoryview(b"hash"); h=hash(r); r.release(); print(hash(r)==h,r==r,r==b"hash")\n';
  const {registry} = await compileSourceModules([unit(source)], profile), session = new ModuleSession(registry); let output = '';
  session.context.begin({}, text => { output += text; }); const execution = Execution.modules(session.context);
  try {
    while (execution.state !== 'completed') { execution.advance(); session.memory.collect([], {cleanup: true}); }
    assert.equal(output, 'True\nTrue True False\n');
  } finally { execution.close(); session.context.finish(); session.close(); registry.close(); }
  closed({closed: session.stats()});
});

test('view writes preserve conversion operands through callback pause, cancellation and close', async () => {
  const source = 'b=bytearray(b"abc"); v=memoryview(b)[::-1]\nclass I:\n def __index__(self): print("entered"); return 0\nv[I()]=I(); print(b[2])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); session.memory.collect([], {cleanup: true});
        if (output.includes('entered\n') && !reached) {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.equal(reached, true); if (mode === 'finish') assert.equal(output, 'entered\nentered\n0\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed({closed: session.stats()});
  } } finally { registry.close(); }
});

test('readonly view writes refuse before binding index callbacks and released views retain no data authority', async () => {
  const result = await run('class I:\n def __index__(self): print("bad"); return 0\nmemoryview(b"a")[I()]=I()\n');
  assert.equal(result.error.type, 'TypeError'); assert.equal(result.stdout, ''); closed(result);
  const released = await run('v=memoryview(b"a"); v.release()\nclass I:\n def __index__(self): print("bad"); return 0\nv[I()]\n');
  assert.equal(released.error.type, 'ValueError'); assert.equal(released.stdout, ''); closed(released);
});

test('view conversions enforce list, allocation and work bounds without retaining buffers', async () => {
  for (const [source, options, limits, code] of [
    ['memoryview(bytes(1025)).tolist()\n', {maxWork: 20000000}, undefined, 'BUDGET'],
    ['v=memoryview(bytes(5000)); v.tobytes()\n', {maxWork: 20000000}, {maxBytes: 11000}, 'OOM'],
    ['v=memoryview(bytes(1000)); v.tobytes()\n', {maxWork: 2000}, undefined, 'BUDGET']
  ]) {
    const result = await run(source, options, limits); assert.equal(result.error.code, code); closed(result);
  }
});

test('starred set displays evaluate the initial group before hashing its elements', async () => {
  const source = 'class K:\n def __init__(self,n): self.n=n\n def __hash__(self): print("hash",self.n); return self.n\n' +
    'def value(n): print("value",n); return K(n)\ns={value(1),value(2),*[value(3)],value(4),value(5)}\nprint(len(s))\n';
  const result = await run(source);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.stdout, 'value 1\nvalue 2\nhash 1\nhash 2\nvalue 3\nhash 3\nvalue 4\nhash 4\nvalue 5\nhash 5\n5\n'); closed(result);
  const walrus = await run('s={n:=1,2,*[3]}; print(n,len(s))\n');
  assert.equal(walrus.ok, true, JSON.stringify(walrus.error)); assert.equal(walrus.stdout, '1 3\n'); closed(walrus);
});
