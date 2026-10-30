import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSource} from './source-compiler.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {FunctionValue, PropertyValue} from './function-objects.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime} from './values.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic documentation fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/documentation.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('documentation: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

test('documentation metadata survives registry verification and rejects invalid constant/layout admission', () => {
  const program = compileSource('def f():\n "value"\n return 7\n', profile).program;
  assert.equal(verifyFunctions(program).code.functions[1].doc, program.functions[1].doc);
  for (const change of [
    p => { p.functions[1].doc = -1; },
    p => { p.functions[1].doc = p.constants.length; },
    p => { p.functions[1].doc = 1; },
    p => { p.functions[0].doc = 0; },
    p => { p.version = 4; for (const fn of p.functions) delete fn.kind; },
    p => { p.version = 3; for (const fn of p.functions) delete fn.kind; },
  ]) {
    const invalid = structuredClone(program); change(invalid);
    assert.throws(() => verifyFunctions(invalid), {code: 'BYTECODE'});
  }
});

test('function documentation growth restores the previous value on ownership and memory failure', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], foreignLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const fn = classes.make(FunctionValue, null, 0, null, new Map()); roots.push(fn);
    classes.write(fn, '__doc__', fn);
    const foreignDoc = other.values.list([]); foreignRoots.push(foreignDoc);
    assert.throws(() => classes.write(fn, '__doc__', foreignDoc), {code: 'STALE_HANDLE'});
    assert.equal(fn.documentation, fn);
    const huge = new ValueRuntime().string(new Array(4000).fill(65));
    assert.throws(() => classes.write(fn, '__doc__', huge), {code: 'OOM'});
    assert.equal(fn.documentation, fn);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(fn, '__doc__'), fn);
    classes.write(fn, '__doc__', null, true); assert.equal(classes.get(fn, '__doc__'), null);
  } finally { leave(); memory.close(); foreignLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

async function lifecycle(source, expected, phases) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const phase of phases) for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (output === phase) {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached, phase);
      if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('function documentation and captured cycles survive parked collection, cancellation and close', async () => {
  await lifecycle('def make():\n saved=[7]\n def read():\n  "source"\n  return saved[0]\n read.__doc__=[read,saved]\n return read\nf=make()\nprint("held")\nprint(f.__doc__[0] is f,f.__doc__[1][0],f())\n',
    'held\nTrue 7 7\n', ['held\n']);
});

test('pending property documentation snapshots every selected operand and the original property', () => {
  const original = {}, getter = {}, setter = {}, deleter = {}, outer = {};
  const accessors = [getter, setter, deleter];
  const after = completion('relay', {receiver: outer});
  const record = completion('property-documentation', {receiver: original, accessors, after});
  accessors.pop();
  assert.deepEqual(completionRoots(record), [original, getter, setter, deleter, outer]);
  assert.throws(() => { record.accessors.push(null); }, TypeError);
  for (const invalid of [[], [getter], [getter, setter, deleter, outer]])
    assert.throws(() => completion('property-documentation', {accessors: invalid, receiver: original}), TypeError);
});

test('property documentation retains cycles and rolls back failed growth without changing origin', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], foreignLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const p = classes.make(PropertyValue, null, null, null, undefined, null, true); roots.push(p);
    classes.write(p, '__doc__', p);
    const foreignDoc = other.values.list([]); foreignRoots.push(foreignDoc);
    assert.throws(() => classes.write(p, '__doc__', foreignDoc), {code: 'STALE_HANDLE'});
    assert.equal(p.documentation, p); assert.equal(p.getterDoc, true);
    const huge = new ValueRuntime().string(new Array(4000).fill(65));
    assert.throws(() => classes.write(p, '__doc__', huge), {code: 'OOM'});
    assert.equal(p.documentation, p); assert.equal(p.getterDoc, true);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(p, '__doc__'), p);
    classes.write(p, '__doc__', null, true); assert.equal(classes.get(p, '__doc__'), null);
  } finally { leave(); memory.close(); foreignLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

test('construction and detached copies keep document results, selected setters and old names through parked collection', async () => {
  await lifecycle('class Getter:\n @property\n def __doc__(self):\n  print("lookup")\n  return [[7]]\np=property(Getter())\nprint(p.__doc__[0][0])\n', 'lookup\n7\n', ['lookup\n']);
  await lifecycle('def make():\n saved=[7]\n class Getter:\n  @property\n  def __doc__(self):\n   print("lookup")\n   old.__name__=saved\n   return [saved]\n return Getter()\nold=property(make(),doc="explicit")\ndel old.__doc__\ncopy=old.setter\nprint("copied")\nnew=copy(None)\ndel copy\nprint(new.__doc__[0][0],new.__name__[0])\n',
    'copied\nlookup\n7 7\n', ['copied\n', 'copied\nlookup\n']);
});

test('document callbacks obey shared instruction, recursion, work and arena budgets', async () => {
  for (const [body, options, memoryLimits, code] of [
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['held=[]\n  while True: held.append([1,2,3])', {maxSteps: 50000, maxWork: 20000000}, {maxBytes: 16000}, 'OOM'],
    ['return property(self).__doc__', {maxDepth: 8}, undefined, 'PYTHON'],
    ['held=[]\n  for i in range(1000): held.append([1,2,3])\n  return held', {maxWork: 20000}, undefined, 'BUDGET'],
  ]) {
    const source = 'class Getter:\n @property\n def __doc__(self):\n  print("lookup")\n  '+body+'\nproperty(Getter())\n';
    const result = await run(source, options, memoryLimits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('lookup\n'), JSON.stringify(result));
    closed(result.closed);
  }
});

test('native documentation copies execute owned getter callbacks', async () => {
  const result = await run(corpus.cases.find(item => item.id === 'unqualified-copy-before-callback').source);
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(result.stdout, 'lookup\ndoc\n'); closed(result.closed);
  const core = await runSourceRequest({modules: [unit('def f(): pass\nprint(f.__doc__)\n')]});
  assert.equal(core.error?.code, 'UNSUPPORTED'); assert.equal(core.stdout, '');
});
