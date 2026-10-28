import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {PropertyValue} from './function-objects.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime} from './values.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic property name fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/property-names.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('property names: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}
for (const item of corpus.cases.filter(item => item.id.startsWith('diagnostic-'))) {
  test('property diagnostic refusal: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
    assert.equal(result.stdout, ''); closed(result.closed);
  });
}

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

test('assigned names, copied cycles and getter cells survive parked collection and cancellation', async () => {
  await lifecycle('def make():\n saved=[9]\n def read(obj): return saved[0]\n p=property(read)\n p.__name__=[p,saved]\n return p.setter(None)\nq=make()\nprint("held")\nprint(q.__name__[1][0],q.fget(None))\n', 'held\n9 9\n', ['held\n']);
  await lifecycle('class Getter:\n @property\n def __name__(self):\n  print("entered")\n  return [9]\np=property(Getter())\nprint("held")\nprint(p.__name__[0])\n', 'held\nentered\n9\n', ['held\n', 'held\nentered\n']);
});

test('name growth preflights arena ownership and restores the exact previous value', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], foreignLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const p = classes.make(PropertyValue); roots.push(p);
    classes.write(p, '__name__', p);
    const foreignName = other.values.list([]); foreignRoots.push(foreignName);
    assert.throws(() => classes.write(p, '__name__', foreignName), {code: 'STALE_HANDLE'});
    assert.equal(p.propertyName, p);
    assert.throws(() => classes.notification(p, null, foreignName), {code: 'STALE_HANDLE'});
    assert.equal(p.propertyName, p);
    const huge = new ValueRuntime().string(new Array(4000).fill(65));
    assert.throws(() => classes.write(p, '__name__', huge), {code: 'OOM'});
    assert.equal(p.propertyName, p);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(p, '__name__'), p);
    classes.write(p, '__name__', null, true); assert.equal(p.propertyName, undefined);
  } finally { leave(); memory.close(); foreignLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

test('detached native notifications and namespace snapshots survive collection at callback boundaries', async () => {
  await lifecycle('def make():\n p=property()\n return p.__set_name__\nm=make()\nprint("held")\nprint(m(None,[9]),m.__self__.__name__[0])\n', 'held\nNone 9\n', ['held\n']);
  await lifecycle('p=property()\nclass D:\n def __set_name__(self,owner,name):\n  print("entered")\n  print(p.__name__)\n  p.__set_name__(owner,[9])\nclass C:\n first=p\n callback=D()\n last=p\nprint(p.__name__)\n', 'entered\nfirst\nlast\n', ['entered\n', 'entered\nfirst\n']);
});

test('property names retain source profile and unrelated mutation boundaries', async () => {
  for (const source of ['p=property()\np.__name__="x"\n', 'property().__set_name__(None,"x")\n']) {
    const result = await runSourceRequest({modules: [unit(source)]});
    assert.ok(['UNSUPPORTED', 'PYTHON'].includes(result.error?.code));
    if (result.error?.code === 'PYTHON') assert.equal(result.error.type, 'NameError');
    if (result.closed) closed(result.closed);
  }
  for (const source of ['def f(): pass\nf.__name__="x"\n', 'class C: pass\nC.__name__="x"\n']) {
    const result = await run(source); assert.equal(result.error?.code, 'UNSUPPORTED'); closed(result.closed);
  }
});

test('lazy names and assigned edges obey actual recursion, work, instruction and arena limits', async () => {
  for (const [body, options, limits, code] of [
    ['return p.__name__', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 220}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
  ]) {
    const result = await run('class Getter:\n @property\n def __name__(self):\n  print("entered")\n  '+body+'\np=property(Getter())\np.__name__\n', options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
  const result = await run('p=property()\np.__name__=[]\nprint("entered")\nwhile True: p.__name__.append([9])\n',
    {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 18000});
  assert.equal(result.stdout, 'entered\n'); assert.equal(result.error?.code, 'OOM', JSON.stringify(result.error)); closed(result.closed);
});
