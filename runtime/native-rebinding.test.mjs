import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic native rebinding fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-rebinding.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('native rebinding: ' + item.id, async () => {
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

test('detached method binding and copied accessor retain cells through parked collection and interruption', async () => {
  const source = 'def factory():\n captured=[9]\n def read(obj):\n  print("entered")\n  return captured[0]+obj[0]\n p=property(read)\n return property.getter.__get__,p\nbind,p=factory()\nm=bind(p,False)\ndel bind,p\nprint("bound")\nq=m(None)\ndel m\nprint(q.__get__([7]))\n';
  await lifecycle(source, 'bound\nentered\n16\n', ['bound\n', 'bound\nentered\n']);
});

test('native type checking handle owns its class and namespace through parked collection and interruption', async () => {
  const source = 'def factory():\n class C: value=[9]\n return type.__instancecheck__.__get__(C),C()\nm,obj=factory()\nprint("bound")\nprint(m(obj),obj.value[0])\n';
  await lifecycle(source, 'bound\nTrue 9\n', ['bound\n']);
});

test('accumulating native method bindings releases partial owners on real allocation failure', async () => {
  const result = await run('p=property()\nitems=[]\nprint("binding")\nfor i in range(1000):\n items.append(property.getter.__get__(p))\n', {maxWork: 20000000}, {maxBytes: 24000});
  assert.equal(result.stdout, 'binding\n'); assert.equal(result.error?.code, 'OOM', JSON.stringify(result.error)); closed(result.closed);
});

test('native method invocation retains source recursion and instruction/work limits', async () => {
  for (const [body, options, code] of [
    ['return p.__get__(obj)', {}, 'PYTHON'],
    ['while True: pass', {maxSteps: 160}, 'BUDGET'],
    ['while True: pass', {maxWork: 11000}, 'BUDGET'],
  ]) {
    const result = await run('def read(obj):\n print("entered")\n '+body+'\np=property(read)\nq=property.getter.__get__(p)(None)\nq.__get__([7])\n', options);
    assert.equal(result.error?.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});

test('native rebinding retains core admission and runtime boundaries', async () => {
  const result = await runSourceRequest({modules: [unit('print("before")\nproperty.getter.__get__(None,property)\n')]});
  assert.equal(result.error?.type, 'NameError'); assert.equal(result.stdout, 'before\n'); closed(result.closed);
  const admission = await runSourceRequest({modules: [unit('print("never")\nclass C: pass\n')]});
  assert.equal(admission.error?.code, 'UNSUPPORTED'); assert.equal(admission.stdout, ''); assert.equal(admission.stats, null);
  for (const source of ['type.__instancecheck__.__get__(int)', 'type.__getattribute__.__get__(int)']) {
    const result = await runSourceRequest({modules: [unit('print("before")\n'+source+'\n')]});
    assert.equal(result.error?.type, 'NameError'); assert.equal(result.stdout, 'before\n'); closed(result.closed);
  }
});

test('rebound function wrappers retain receiver, cells and defaults through parked collection and interruption', async () => {
  const source = 'def factory():\n captured=[9]\n def read(obj,value=[3]):\n  print("entered")\n  return captured[0]+obj[0]+value[0]\n return type(read).__get__.__get__(read,False)\nbind=factory()\nm=bind([7])\ndel bind\nprint("bound")\nprint(m())\n';
  await lifecycle(source, 'bound\nentered\n19\n', ['bound\n', 'bound\nentered\n']);
});

test('rebound native binding wrappers retain the original property through parked collection and interruption', async () => {
  const source = 'def factory():\n captured=[9]\n def read(obj):\n  print("entered")\n  return captured[0]+obj[0]\n p=property(read)\n return type(property.getter).__get__.__get__(property.getter)(p)\nm=factory()\nprint("bound")\nq=m(None)\ndel m\nprint(q.__get__([7]))\n';
  await lifecycle(source, 'bound\nentered\n16\n', ['bound\n', 'bound\nentered\n']);
});

test('rebound lazy generators retain cells and receivers across parked collection and interruption', async () => {
  const source = 'def factory():\n captured=[9]\n def read(obj):\n  print("entered")\n  yield captured[0]+obj[0]\n return type(read).__get__.__get__(read)([7])()\ng=factory()\nprint("ready")\nprint(next(g))\n';
  await lifecycle(source, 'ready\nentered\n16\n', ['ready\n', 'ready\nentered\n']);
});

test('accumulating native wrapper bindings releases partial owners on actual arena exhaustion', async () => {
  const result = await run('def read(obj): return obj\nitems=[]\nprint("binding")\nfor i in range(1000):\n items.append(type(read).__get__.__get__(read))\n', {maxWork: 20000000}, {maxBytes: 24000});
  assert.equal(result.stdout, 'binding\n'); assert.equal(result.error?.code, 'OOM', JSON.stringify(result.error)); closed(result.closed);
});
