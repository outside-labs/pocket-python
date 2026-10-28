import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic descriptor binding fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/descriptor-binding.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('descriptor binding: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
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

for (const method of ['getter', 'setter', 'deleter']) {
  test('native property '+method+' retains the copied property and accessor cells through parked collection and interruption', async () => {
    const source = 'def factory():\n captured=[9]\n def read(obj):\n  print("entered")\n  print(captured[0],obj[0])\n  return captured[0]\n p=property(read,read,read)\n return p.'+method+'\ncopy=factory()\nq=copy(None)\ndel copy\nprint("copied")\nprint(q.__get__([7]))\n';
    await lifecycle(source, 'copied\nentered\n9 7\n9\n', ['copied\n', 'copied\nentered\n']);
  });
}

test('native property copies release partial allocation growth on real arena failure', async () => {
  const source = 'p=property(lambda obj:obj)\ncopies=[]\nprint("copying")\nfor i in range(1000):\n copies.append(property.getter(p,None))\n';
  const result = await run(source, {maxWork: 20000000}, {maxBytes: 24000});
  assert.equal(result.stdout, 'copying\n'); assert.equal(result.error?.code, 'OOM', JSON.stringify(result.error)); closed(result.closed);
});

for (const item of corpus.cases.filter(item => item.id.startsWith('future-copy-'))) {
  test('documentation boundary: '+item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.error?.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); closed(result.closed);
  });
}

test('detached function binding retains function cells, defaults and the bound receiver through parked collection and interruption', async () => {
  const source = 'def factory():\n captured=[9]\n def read(obj,value=[3]):\n  print("entered")\n  return captured[0]+obj[0]+value[0]\n return read.__get__\nbind=factory()\nm=bind([7],False)\ndel bind\nprint("bound")\nprint(m())\n';
  await lifecycle(source, 'bound\nentered\n19\n', ['bound\n', 'bound\nentered\n']);
});

test('explicitly bound generator retains its receiver and captured cells through parked collection and interruption', async () => {
  const source = 'def factory():\n captured=[9]\n def read(obj):\n  print("entered")\n  yield obj[0]+captured[0]\n return read.__get__\nbind=factory()\nm=bind([7])\ndel bind\ng=m()\ndel m\nprint("ready")\nprint(next(g))\n';
  await lifecycle(source, 'ready\nentered\n16\n', ['ready\n', 'ready\nentered\n']);
});

test('explicit function calls share recursion, instruction, work and actual allocation limits', async () => {
  const wrap = body => 'def read(obj):\n print("entered")\n '+body+'\nm=read.__get__([7])\nm()\n';
  for (const [body, options, limits, code] of [
    ['return read.__get__(obj)()', {}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 150}, undefined, 'BUDGET'],
    ['while True: pass', {maxWork: 10000}, undefined, 'BUDGET'],
    ['return [0]*1024', {}, {maxBytes: 16000}, 'OOM'],
  ]) {
    const result = await run(wrap(body), options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.includes('entered\n')); closed(result.closed);
  }
});

test('explicit binding retains the core function runtime refusal and class admission boundary', async () => {
  const result = await runSourceRequest({modules: [unit('print("before")\ndef read(obj): return obj\nread.__get__([7])\n')]});
  assert.equal(result.error?.code, 'UNSUPPORTED'); assert.equal(result.error?.phase, 'execute');
  assert.equal(result.stdout, 'before\n'); closed(result.closed);
  const admission = await runSourceRequest({modules: [unit('print("never")\nclass A: pass\nproperty.getter(None,None)\n')]});
  assert.equal(admission.error?.code, 'UNSUPPORTED'); assert.equal(admission.stdout, ''); assert.equal(admission.stats, null);
});
