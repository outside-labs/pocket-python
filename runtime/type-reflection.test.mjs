import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic type reflection fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/type-reflection.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('type reflection: ' + item.id, async () => {
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

test('owner reads retain detached native receivers and captured accessor cells through parked collection', async () => {
  const source = 'def make():\n saved=[9]\n def read(obj):\n  print("entered")\n  return saved[0]+obj[0]\n return property(read).__get__\nm=make()\nprint("held")\nprint(m.__objclass__ is property,m([7]))\n';
  await lifecycle(source, 'held\nentered\nTrue 16\n', ['held\n', 'held\nentered\n']);
});

test('owner metadata traversals share actual work and arena budgets', async () => {
  for (const [source, options, limits, code] of [
    ['while True: property.__get__.__objclass__\n', {maxSteps: 100000, maxWork: 3000}, undefined, 'BUDGET'],
    ['held=[]\nprint("entered")\nwhile True: held.append(property().__get__)\n', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, code, JSON.stringify(result.error)); closed(result.closed);
  }
});
