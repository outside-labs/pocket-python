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

test('starred set displays evaluate the initial group before hashing its elements', async () => {
  const source = 'class K:\n def __init__(self,n): self.n=n\n def __hash__(self): print("hash",self.n); return self.n\n' +
    'def value(n): print("value",n); return K(n)\ns={value(1),value(2),*[value(3)],value(4),value(5)}\nprint(len(s))\n';
  const result = await run(source);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.stdout, 'value 1\nvalue 2\nhash 1\nhash 2\nvalue 3\nhash 3\nvalue 4\nhash 4\nvalue 5\nhash 5\n5\n'); closed(result);
  const walrus = await run('s={n:=1,2,*[3]}; print(n,len(s))\n');
  assert.equal(walrus.ok, true, JSON.stringify(walrus.error)); assert.equal(walrus.stdout, '1 3\n'); closed(walrus);
});
