import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic nested descriptor fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/nested-descriptors.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('nested descriptor: ' + item.id, async () => {
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

for (const slot of ['__set__', '__delete__']) for (const form of ['property', 'descriptor']) {
  const setting = slot === '__set__', signature = setting ? 'obj,value' : 'obj';
  const body = setting ? 'obj.saved=value' : 'obj.saved=[7]';
  const hook = form === 'property' ? ' @property\n def '+slot+'(self):\n  print("bind")\n  def callback('+signature+'):\n   print("body")\n   '+body+'\n   return [99]\n  return callback\n' :
    ' '+slot+'=Hook()\n';
  const source = 'saved=[]\nclass Hook:\n def __get__(self,descriptor,owner):\n  print("bind")\n  def callback('+signature+'):\n   print("body")\n   '+body+'\n   return [99]\n  return callback\nclass D:\n'+hook+
    'class A: x=D()\ndef target():\n obj=A()\n saved.append(obj)\n return obj\n'+(setting ? 'target().x=[7]' : 'del target().x')+'\nprint(saved[0].saved[0])\n';
  test(slot+' '+form+' retains temporary arguments and callback closures through parked collection and interruption', async () => {
    await lifecycle(source, 'bind\nbody\n7\n', ['bind\n', 'bind\nbody\n']);
  });
}

for (const slot of ['__set__', '__delete__']) for (const phase of ['bind', 'body']) {
  const setting = slot === '__set__', signature = setting ? 'obj,value' : 'obj';
  const prefix = body => phase === 'bind' ? 'class D:\n @property\n def '+slot+'(self):\n  print("entered")\n  '+body+'\n' :
    'def callback('+signature+'):\n print("entered")\n '+body.replaceAll('\n  ', '\n ')+'\nclass D:\n '+slot+'=property(lambda self: callback)\n';
  const suffix = 'class A: x=D()\na=A()\n'+(setting ? 'a.x=[7]' : 'del a.x')+'\n';
  test(slot+' '+phase+' shares instruction, work, recursion and actual allocation limits', async () => {
    const recursive = phase === 'bind' ? 'return self.'+slot : setting ? 'obj.x=value' : 'del obj.x';
    for (const [body, options, limits, code] of [
      [recursive, {maxDepth: 12}, undefined, 'PYTHON'],
      ['while True: pass', {maxSteps: 350}, undefined, 'BUDGET'],
      ['while True: pass', {maxSteps: 100000, maxWork: 35000}, undefined, 'BUDGET'],
      ['held=[]\n  while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 28000}, 'OOM'],
    ]) {
      const result = await run(prefix(body)+suffix, options, limits);
      assert.equal(result.error?.code, code, JSON.stringify(result));
      if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      assert.ok(result.stdout.includes('entered\n'), JSON.stringify(result.error)); closed(result.closed);
    }
  });
}

test('nested mutation keeps the original callback exception and pending outer expression', async () => {
  const source = 'def write(obj,value):\n raise ValueError("body")\nclass D: __set__=property(lambda self: write)\nclass A: x=D()\nsetattr(A(),"x",[7])\n';
  const result = await run(source);
  assert.equal(result.error?.type, 'ValueError');
  assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.span[0]]), [['<module>',5],['write',2]]);
  closed(result.closed);
});

for (const form of ['property', 'descriptor']) {
  const binding = '  print("bind")\n  saved=[descriptor]\n  def notify(owner,name):\n   print("body",name)\n   if name=="first": del owner.second\n   owner.saved=saved[0]\n   return [99]\n  return notify\n';
  const source = form === 'property' ? 'class D:\n @property\n def __set_name__(descriptor):\n'+binding :
    'class Hook:\n def __get__(self,descriptor,owner):\n'+binding+'class D: __set_name__=Hook()\n';
  test('name '+form+' retains original names, removed entries and binding closures through parked collection and interruption', async () => {
    await lifecycle(source+'class A:\n first=D()\n second=D()\nprint(type(A.saved).__name__,A.__name__)\n',
      'bind\nbody first\nbind\nbody second\nD A\n', ['bind\n', 'bind\nbody first\n', 'bind\nbody first\nbind\n', 'bind\nbody first\nbind\nbody second\n']);
  });
}

for (const phase of ['bind', 'body']) {
  const source = body => (phase === 'bind' ? 'class D:\n @property\n def __set_name__(self):\n  print("entered")\n  '+body+'\n' :
    'def notify(owner,name):\n print("entered")\n '+body.replaceAll('\n  ', '\n ')+'\nclass D: __set_name__=property(lambda self: notify)\n')+'class A: x=D()\n';
  test('name '+phase+' shares recursion, instruction, work and actual allocation limits', async () => {
    for (const [body, options, limits, code] of [
      [phase === 'bind' ? 'return self.__set_name__' : 'type("Nested",(),{"x":D()})', {maxDepth: 12}, undefined, 'PYTHON'],
      ['while True: pass', {maxSteps: 350}, undefined, 'BUDGET'],
      ['while True: pass', {maxSteps: 100000, maxWork: 35000}, undefined, 'BUDGET'],
      ['held=[]\n  while True: held.append([7])', {maxSteps: 100000}, {maxBytes: 28000}, 'OOM'],
    ]) {
      const result = await run(source(body), options, limits);
      assert.equal(result.error?.code, code, JSON.stringify(result));
      if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      assert.ok(result.stdout.includes('entered\n'), JSON.stringify(result.error)); closed(result.closed);
    }
  });
}

test('bound constructor callbacks preserve notification and discard completions', async () => {
  const source = 'class Callback:\n def __init__(self,obj,value):\n  print(value)\nclass D:\n __set_name__=property(lambda self: Callback)\n __set__=property(lambda self: Callback)\nclass A: x=D()\nA().x=7\nprint(A.__name__)\n';
  await lifecycle(source, 'x\n7\nA\n', ['x\n', 'x\n7\n']);
});

test('generator results from mutation and name callbacks are discarded without iteration', async () => {
  const source = 'def callback(obj,value):\n print("never")\n yield value\nclass D:\n __set_name__=property(lambda self: callback)\n __set__=property(lambda self: callback)\nclass A: x=D()\nA().x=7\nprint(A.__name__)\n';
  const result = await run(source);
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'A\n'); closed(result.closed);
});

test('nested descriptor source retains the explicit core admission boundary', async () => {
  const result = await runSourceRequest({modules: [unit('print("never")\nclass D: __set__=property(lambda self: None)\n')]});
  assert.equal(result.error?.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); assert.equal(result.stats, null);
});
