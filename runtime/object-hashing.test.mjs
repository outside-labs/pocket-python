import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic hash fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/object-hashing.json', import.meta.url)));

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('object hash source: ' + fixture.id, async () => {
    const result = await runSourceRequest({modules: [unit(fixture.source)], compileOptions: profile});
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    closed(result.closed);
  });

test('method dictionary keys retain temporary receivers through collection and unwind', async () => {
  const source = 'class A:\n def use(self): return self.value[0]\na=A()\na.value=[7]\nf=a.use\nd={f:[8]}\ndel a\nprint("entered")\nprint(f(),d[f][0])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (output !== 'entered\n') execution.advance();
      session.memory.collect([], {cleanup: true});
      if (mode === 'finish') { execution.drain(); assert.equal(output, 'entered\n7 8\n'); }
      if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
    } finally { execution.close(); session.context.finish(); session.close(); closed(session.stats()); }
  } } finally { registry.close(); }
});

test('sequence hash destinations own the raw receiver, accumulator and outer destination', () => {
  const receiver = {}, outer = {}, after = completion('relay', {receiver: outer});
  assert.deepEqual(completionRoots(completion('sequence-hash', {receiver, position: 0, hash: 7n, depth: 1, after})), [receiver, 7n, outer]);
  for (const fields of [{position: -1, hash: 7n}, {position: 0, hash: 7}, {position: 0, hash: 7n, depth: -1}])
    assert.throws(() => completion('sequence-hash', {receiver, position: 0, hash: 7n, depth: 1, ...fields}), TypeError);
});

test('slice hash binding and body retain nested fields across collection, cancellation and close', async () => {
  for (const binding of [false, true]) {
    const source = 'class A:\n '+(binding ? '@property\n ' : '')+'def __hash__(self):\n  print("entered")\n  '+(binding ? 'return lambda: 7' : 'return 7')+'\ns=slice((A(),),7)\nprint(hash(s)==hash(s))\n';
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (output !== 'entered\n') execution.advance();
        session.memory.collect([], {cleanup: true});
        if (mode === 'finish') { execution.drain(); assert.equal(output, 'entered\nentered\nTrue\n'); }
        if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
      } finally { execution.close(); session.context.finish(); session.close(); closed(session.stats()); }
    } } finally { registry.close(); }
  }
});

test('slice hashing shares instruction, work, recursion and allocation limits', async () => {
  for (const [body, options, memoryLimits, code] of [
    ['while True: pass', {maxSteps: 400}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 18000}, undefined, 'BUDGET'],
    ['return hash(slice(self))', {maxDepth: 12}, undefined, 'PYTHON'],
    ['held=[]\n  while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const source = 'class A:\n def __hash__(self):\n  '+body+'\nhash(slice(A()))\n';
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
    assert.equal(result.error.code, code, JSON.stringify(result.error));
    if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    closed(result.closed);
  }
});
