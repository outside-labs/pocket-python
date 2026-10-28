import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic subclass initialization fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/subclass-initialization.json', import.meta.url)));

for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('subclass initialization: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout ?? '');
    if (item.error_type) assert.equal(result.error?.type, item.error_type);
    else assert.equal(result.error, undefined, JSON.stringify(result.error));
    closed(result.closed);
  });
}

test('subclass results retain the temporary class and original destination', () => {
  const type = {}, outer = {}, after = completion('relay', {receiver: outer});
  assert.deepEqual(completionRoots(completion('subclass-result', {receiver: type, after})), [type, outer]);
});

test('temporary bases, descriptor closures and class cells survive collection and interruption', async () => {
  const sources = [
    'def base():\n class D:\n  def __get__(self,obj,owner):\n   print("binding")\n   held=[7]\n   def hook():\n    print("hook")\n    owner.saved=held\n   return hook\n class A: __init_subclass__=D()\n return A\nclass B(base()):\n def identity(self): return __class__\nprint(B.saved[0],B().identity() is B)\n',
    'def base():\n class A:\n  def __init_subclass__(cls):\n   print("hook")\n   cls.saved=[7]\n return A\nclass B(base()):\n def identity(self): return __class__\nprint(B.saved[0],B().identity() is B)\n',
    'def base():\n class A:\n  def __init_subclass__(cls):\n   print("hook")\n   cls.saved=[7]\n return A\nB=type("B",(base(),),{})\nprint(B.saved[0])\n',
  ];
  for (const source of sources) {
    const {registry} = await compileSourceModules([unit(source)], profile);
    try {
      for (const phase of source.includes('"binding"') ? ['binding\n', 'binding\nhook\n'] : ['hook\n']) {
        for (const mode of ['finish', 'cancel', 'close']) {
          const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
          session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
          const execution = Execution.modules(session.context);
          try {
            while (execution.state !== 'completed') {
              execution.advance(); session.memory.collect([], {cleanup: true});
              if (output === phase) {
                reached = true;
                if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
                if (mode === 'close') break;
              }
            }
            assert.ok(reached, phase);
            if (mode === 'finish') assert.equal(output, (source.includes('"binding"') ? 'binding\n' : '') + 'hook\n7' + (source.includes('identity') ? ' True' : '') + '\n');
          } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
          closed(session.stats());
        }
      }
    } finally { registry.close(); }
  }
});

test('subclass binding and body failures retain Python source frames', async () => {
  for (const [source, expected] of [
    ['class D:\n def __get__(self,obj,owner):\n  raise AttributeError("original")\nclass A: __init_subclass__=D()\nclass B(A): pass\n', [['<module>', 5], ['__get__', 3]]],
    ['class A:\n def __init_subclass__(cls):\n  raise ValueError("original")\nclass B(A): pass\n', [['<module>', 4], ['__init_subclass__', 3]]],
  ]) {
    const result = await run(source);
    assert.equal(result.error.code, 'PYTHON');
    assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.span[0]]), expected);
    closed(result.closed);
  }
});

test('subclass hooks share recursion, instruction, work and real arena limits', async () => {
  for (const [body, options, limits, expected] of [
    ['type("Again",(A,),{})', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 10000}, undefined, 'BUDGET'],
    ['a=[]\n  while True: a.append([7])', {maxSteps: 100000}, {maxBytes: 22000}, 'OOM'],
  ]) {
    const result = await run('class A:\n def __init_subclass__(cls):\n  print("hook")\n  '+body+'\nclass B(A): pass\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.includes('hook\n')); closed(result.closed);
  }
});
