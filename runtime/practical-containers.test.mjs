import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/practical-containers.json', import.meta.url)));
const unit = source => ({name: 'app', source, imports: [], package: false, notice: 'Synthetic practical container fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  for (const languageProfile of item.profiles ?? [corpus.profile]) test(languageProfile + ': ' + item.id, async () => {
    const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: {languageProfile},
      options: {maxSteps: 50000, maxWork: 20000000}});
    assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    assert.ok(result.closed); closed(result.closed);
  });
}

test('detached list mutation methods retain cyclic receivers through parked collection', async () => {
  const source = 'a=[7]\na.append(a)\nr=a.reverse\nc=a.copy\nd=a.clear\ndel a\nprint("ready")\nr()\nb=c()\nprint(b[0][0] is b[0],b[1])\nd()\nprint(len(b[0]),b[1])\n';
  const {registry} = await compileSourceModules([unit(source)], {languageProfile: corpus.profile});
  try {
    const session = new ModuleSession(registry); let output = '';
    session.context.begin({}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
      }
      assert.equal(output, 'ready\nTrue 7\n0 7\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } finally { registry.close(); }
});

test('list copies share ordinary work and allocation limits', async () => {
  for (const [options, memoryLimits, expected] of [
    [{maxWork: 12000}, undefined, 'ExecutionLimitError'],
    [{maxWork: 20000000}, {maxBytes: 24000}, 'MemoryError'],
  ]) {
    const result = await runSourceRequest({modules: [unit('a=[7]*32\nheld=[]\nprint("ready")\nwhile True: held.append(a.copy())\n')],
      compileOptions: {languageProfile: corpus.profile}, options, memoryLimits});
    assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, expected, JSON.stringify(result.error)); closed(result.closed);
  }
});

async function callbackLifetime(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], {languageProfile: corpus.profile});
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
      assert.ok(reached); if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
}

for (const [name, tail, expected] of [
  ['insert', 'a.insert(I(),a)\nprint(a[0] is a)\n', 'entered\nTrue\n'],
  ['pop', 'b=a.pop(I())\ndel a\nb.append(7)\nprint(b[0])\n', 'entered\n7\n'],
]) test('owned list ' + name + ' index callback survives parking, cancellation and close', async () => {
  await callbackLifetime('a=[[]]\nclass I:\n def __index__(self):\n  print("entered")\n  return 0\n' + tail, expected);
});
