import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic method directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/method-directories.json', import.meta.url)));
for (const item of corpus.cases) test('method directory: ' + item.id, async () => {
  const result = await run(item.source);
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

test('method dictionary lookup owns the method and outer destination', () => {
  const receiver = {}, outer = {}, after = completion('relay', {receiver: outer});
  const record = completion('method-dir-dictionary', {receiver, depth: 3, after});
  assert.deepEqual(completionRoots(record), [receiver, outer]); assert.ok(Object.isFrozen(record));
  for (const depth of [-1, 257, undefined])
    assert.throws(() => completion('method-dir-dictionary', {receiver, depth}), TypeError);
});

async function lifecycle(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
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

test('dictionary lookup retains a detached method through parking and cancellation', async () => {
  await lifecycle('saved={"tag":[7]}\nclass Callable:\n @property\n def __dict__(self):\n  global m,c,Callable\n  del m\n  del c\n  del Callable\n  print("entered")\n  return saved\nc=Callable()\nm=classmethod(c).__get__(None,object)\nr=dir(m)\nprint("tag" in r,len(r))\n', 'entered\nTrue 29\n');
});

for (const phase of ['merge', 'truth', 'sort']) test(phase + ' owns selected keys after method detachment', async () => {
  const mark = 'global m,f,C,Key\n  if not self.done:\n   self.done=True\n   f.__dict__={}\n   del m\n   del f\n   del C\n   del Key\n   print("entered")\n  return True\n';
  const source = (phase === 'truth' ? 'class Truth:\n def __bool__(self): return key.mark()\n' : '') +
    'class Key:\n done=False\n def mark(self):\n  ' + mark +
    ' def __hash__(self): return hash("__new__")\n def __eq__(self,other): return ' + (phase === 'truth' ? 'Truth()' : phase === 'merge' ? 'self.mark()' : 'False') +
    '\n def __lt__(self,other): return ' + (phase === 'sort' ? 'self.mark()' : 'True') +
    '\n def __gt__(self,other): return ' + (phase === 'sort' ? 'not self.mark()' : 'False') +
    '\nclass C:\n def f(self): pass\nm=C().f\nf=m.__func__\nkey=Key()\nf.__dict__={key:[7],"tag":[9]}\nr=dir(m)\nprint(r[0] is key,"tag" in [n for n in r if isinstance(n,str)])\n';
  await lifecycle(source, 'entered\nTrue True\n');
});

test('lookup, merge and sorting errors preserve callback source frames', async () => {
  for (const [id, name] of [['dictionary-valueerror', 'read'], ['merge-valueerror', '__eq__'], ['sort-error', '__gt__']]) {
    const result = await run(corpus.cases.find(item => item.id === id).source);
    assert.equal(result.error?.type, 'ValueError');
    assert.ok(result.error.traceback.some(frame => frame.function === name), JSON.stringify(result.error)); closed(result.closed);
  }
});

for (const phase of ['lookup', 'merge', 'sort']) test(phase + ' shares real resource limits', async () => {
  for (const [body, options, limits, expected] of [
    ['return dir(m)', {maxDepth: 12, maxWork: 20000000}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 300}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 100000, maxWork: 400000}, undefined, 'BUDGET'],
    ['saved=[]\n  while True: saved.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 42000}, 'OOM'],
  ]) {
    const source = phase === 'lookup' ? 'class Callable: pass\nm=classmethod(Callable()).__get__(None,object)\ndef read(self,name):\n if name=="__dict__":\n  print("entered")\n  ' + body + '\n return object.__getattribute__(self,name)\nCallable.__getattribute__=read\ndir(m)\n' :
      'class Key:\n' + (phase === 'merge' ? ' def __hash__(self): return hash("__new__")\n def __eq__(self,other):\n' : ' def __gt__(self,other):\n') +
      '  print("entered")\n  ' + body + '\nclass C:\n def f(self): pass\nm=C().f\nm.__func__.__dict__={Key():7}\ndir(m)\n';
    const result = await run(source, options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
    assert.ok(result.stdout.startsWith('entered\n')); closed(result.closed);
  }
});
