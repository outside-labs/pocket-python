import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {VALUE_LIMITS} from './values.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic property diagnostic fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/property-diagnostics.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) test('property diagnostic: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{name: 'app', package: false, imports: [], source: item.source, notice: 'Synthetic property diagnostic fixture'}], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

for (const id of ['getter-repr-bound', 'setter-getter-name-success', 'string-subclass-qualification', 'qualification-owned-after-name-mutation', 'copy-doc-name-mutation', 'copy-raw-factory-getter']) {
  test('property diagnostic/copy lifetime: ' + id, async () => {
    const item = corpus.cases.find(item => item.id === id), {registry} = await compileSourceModules([unit(item.source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); if (execution.state === 'paused') execution.park();
          session.memory.collect([], {cleanup: true});
          if (!reached && output === 'entered\n' && execution.state === 'parked') {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.ok(reached); if (mode === 'finish') assert.equal(output, item.stdout);
      } finally { const before = output; execution.close(); execution.close(); session.context.finish(); session.close(); assert.equal(output, before); }
      closed(session.stats());
    } } finally { registry.close(); }
  });
}

test('property diagnostics share callback, output-size, work and allocation limits', async () => {
  for (const [body, options, memoryLimits, type] of [
    ['return p.__get__(self)', {maxDepth: 12}, undefined, 'RecursionError'],
    ['while True: pass', {maxSteps: 250}, undefined, 'ExecutionLimitError'],
    ['while True: pass', {maxSteps: 100000, maxWork: 100000}, undefined, 'ExecutionLimitError'],
    ['held=[]\n  while True: held.append("x"*1024)', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 50000}, 'MemoryError'],
    ['return "x"*' + VALUE_LIMITS.text, {maxWork: 20000000}, undefined, 'ExecutionLimitError'],
  ]) {
    const source = 'class Name:\n def __repr__(self):\n  print("entered")\n  ' + body + '\np=property()\np.__name__=Name()\np.__get__(object())\n';
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
    assert.ok(result.stdout.startsWith('entered\n'), JSON.stringify(result.error));
    assert.equal(result.error?.type, type, JSON.stringify(result.error)); closed(result.closed);
  }
});
