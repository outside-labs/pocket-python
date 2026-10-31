import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/object-integration.json', import.meta.url)));
const profile = {languageProfile: 'classes-source/1'};
const unit = item => ({name: 'app', package: false, imports: item.imports ?? [], source: item.source, notice: 'Synthetic object integration fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
for (const item of corpus.cases) test('object composition: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item), ...(item.modules ?? []).map(module => ({...module, notice: 'Synthetic object integration fixture'}))],
    compileOptions: profile, options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

// The continuation owns dynamic code, imported namespaces, slots and descriptor
// callbacks together. Collection at every parked boundary must preserve them.
const model = body => ({name: 'model', package: false, imports: [], notice: 'Synthetic composed lifecycle fixture', source:
  'class Model:\n __slots__=("value",)\n def __init__(self): self.value=[7]\n @property\n def field(self):\n  print("entered")\n  '+body+'\ninstance=Model()\n'});
const main = {source: 'module=__import__("model")\nnamespace=module.__dict__\nexec(compile("print(instance.field)","composed-callback.py","exec"),namespace)\n', imports: ['model']};

test('composed module and dynamic descriptor execution survives parked collection, cancellation and close', async () => {
  const {registry} = await compileSourceModules([unit(main), model('return self.value[0]+2')], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({maxSteps: 50000, maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
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
      assert.equal(reached, true); assert.equal(output, mode === 'finish' ? 'entered\n9\n' : 'entered\n');
    } finally { const before = output; execution.close(); session.context.finish(); session.close(); assert.equal(output, before); }
    closed(session.stats());
  } } finally { registry.close(); }
});

for (const [name, body, options, memoryLimits, code, type] of [
  ['instructions', 'while True: pass', {maxSteps: 2000, maxWork: 20000000}, undefined, 'BUDGET'],
  ['work', 'while True: pass', {maxSteps: 100000, maxWork: 500000}, undefined, 'BUDGET'],
  ['memory', 'while True: self.value.append([0]*1024)', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 524288}, 'OOM'],
  ['recursion', 'return self.field', {maxDepth: 20, maxWork: 20000000}, undefined, 'PYTHON', 'RecursionError'],
  ['failure', 'self.value[0]=9\n  raise ValueError("body")', {maxWork: 20000000}, undefined, 'PYTHON', 'ValueError'],
]) test('composed dynamic imports and descriptors share ' + name, async () => {
  const result = await runSourceRequest({modules: [unit(main), model(body)], compileOptions: profile, options, memoryLimits});
  assert.equal(result.error?.code, code, JSON.stringify(result.error));
  if (type) assert.equal(result.error.type, type);
  assert.ok(result.stdout.startsWith('entered\n'), JSON.stringify(result));
  closed(result.closed);
});

test('composed dynamic definitions retain original diagnostics', async () => {
  const item = corpus.cases.find(item => item.id === 'dynamic-original-source-failure');
  const result = await runSourceRequest({modules: [unit(item)], compileOptions: profile});
  assert.ok(result.error.traceback.some(frame => frame.function === 'fail' && frame.location?.filename === 'composed-original.py' && frame.location.span[0] === 4));
  closed(result.closed);
});
