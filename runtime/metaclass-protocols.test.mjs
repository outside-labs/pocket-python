import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic live class body fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/metaclass-protocols.json', import.meta.url)));
for (const item of corpus.cases) test('metaclass protocol: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile,
    options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout); assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
async function lifecycle(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], profile);
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
    } finally {
      const before = output; execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before);
    }
    closed(session.stats());
  } } finally { registry.close(); }
}
test('metaclass descriptor binding and callbacks survive parked collection and interruption', async () => {
  for (const slot of ['__len__','__index__','__hash__']) {
    const expression = {__len__:'len(C)',__index__:'[7,8][C]',__hash__:'hash(C)'}[slot];
    const expected = slot==='__index__' ? '8' : '1';
    await lifecycle('class D:\n def __get__(self,obj,owner):\n  print("entered")\n  return lambda:1\nclass M(type): '+slot+'=D()\nclass C(metaclass=M): pass\nprint('+expression+')\n', 'entered\n'+expected+'\n');
  }
});

test('arithmetic, equality, truth and iterator callbacks retain class operands', async () => {
  for (const [slot, signature, body, expression] of [
    ['__add__', ',value', 'return [7]', '(C+9)[0]'],
    ['__eq__', ',value', 'return [7]', '(C==9)[0]'],
    ['__bool__', '', 'return True', 'bool(C)*7'],
    ['__iter__', '', 'yield 7', 'next(iter(C))'],
  ]) await lifecycle('class M(type):\n def '+slot+'(cls'+signature+'):\n  print("entered")\n  '+body+'\nclass C(metaclass=M): pass\nprint('+expression+')\n', 'entered\n7\n');
});

test('metaclass callbacks share recursion, instruction and allocation limits', async () => {
  for (const [body, options, memoryLimits, type] of [
    ['return bool(cls)', {maxDepth: 12}, undefined, 'RecursionError'],
    ['while True: pass', {maxSteps: 200}, undefined, 'ExecutionLimitError'],
    ['held=[]\n  while True: held.append([7])', {maxWork: 10000000, maxSteps: 100000}, {maxBytes: 35000}, 'MemoryError'],
  ]) {
    const result = await runSourceRequest({modules: [unit('class M(type):\n def __bool__(cls):\n  '+body+'\nclass C(metaclass=M): pass\nbool(C)\n')], compileOptions: profile, options, memoryLimits});
    assert.equal(result.error?.type, type, JSON.stringify(result.error)); closed(result.closed);
  }
});

test('metaclass slot inventory is frozen and preserves named protocol boundaries', async () => {
  const {METACLASS_PROTOCOLS} = await import('./class-policy.mjs');
  const {compileSource} = await import('./source-compiler.mjs');
  assert.throws(() => compileSource('value.__class__=None\n'), {code: 'UNSUPPORTED'});
  assert.ok(Object.isFrozen(METACLASS_PROTOCOLS));
  assert.equal(new Set(METACLASS_PROTOCOLS).size, METACLASS_PROTOCOLS.length);
  for (const slot of ['__class_getitem__','__matmul__','__format__','__enter__','__await__']) {
    assert.equal(METACLASS_PROTOCOLS.includes(slot), false);
    assert.throws(() => compileSource('class M(type):\n '+slot+'=None\n', profile), {code: 'UNSUPPORTED'});
  }
});

test('the class descriptor accepts same-class reassignment', async () => {
  const result = await runSourceRequest({modules: [unit('class A: pass\na=A()\nprint("entered")\na.__class__=A\n')], compileOptions: profile});
  assert.equal(result.stdout, 'entered\n'); assert.ok(result.ok, JSON.stringify(result.error)); closed(result.closed);
});
