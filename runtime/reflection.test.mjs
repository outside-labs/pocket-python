import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';
import {compileSource} from './source-compiler.mjs';
import {verifyFunctions} from './function-bytecode.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic reflection fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/reflection.json', import.meta.url)));

test('captured namespace metadata preserves distinct cell and iteration-slot order', () => {
  const source = 'def f(p):\n x=9\n def keep():return x\n r=[locals() for x in [1]]\n return r\n';
  const result = compileSource(source, profile);
  assert.deepEqual(result.program.functions[1].namespaceCells, ['x']);
  const code = verifyFunctions(result.program).code;
  assert.ok(Object.isFrozen(code.functions[1].namespaceCells));
  for (const invalid of [['p'], ['missing'], ['x', 'x'], null]) {
    const program = structuredClone(result.program); program.functions[1].namespaceCells = invalid;
    assert.throws(() => verifyFunctions(program), /namespace|Names/);
  }
  const missing = structuredClone(result.program); delete missing.functions[1].namespace;
  assert.throws(() => verifyFunctions(missing), /namespace/);
  assert.throws(() => compileSource(source, {...profile, maxWork: result.stats.work - 1}), {code: 'COMPILE_BUDGET'});
  const wide = 'def f(p):\n return ['+Array.from({length:64}, (_,i) => '[locals() for x'+i+',y'+i+' in [(1,2)]]').join(',')+']\n';
  assert.throws(() => compileSource(wide, profile), {code: 'COMPILE_BUDGET'});
});

test('isolated comprehension snapshots retain owners during class and module execution', async () => {
  for (const body of [
    'saved=[(vars(),[vars() for y in [marker()]]) for x in [[7]]]\nr=saved[0]\n',
    'class A:\n saved=[(vars(),[vars() for y in [marker()]]) for x in [[7]]]\nr=A.saved[0]\n',
  ]) {
    const source = 'def marker():\n print("entered")\n return 8\n'+body+'print(list(r[0])==["x"],r[0]["x"][0],r[1][0]["y"])\n';
    const {registry} = await compileSourceModules([unit(source)], profile);
    try {
      for (const mode of ['finish', 'cancel', 'close']) {
        const session = new ModuleSession(registry); let output = '', cancel = false;
        session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
        const execution = Execution.modules(session.context);
        try {
          while (execution.state !== 'completed') {
            execution.advance(); session.memory.collect([], {cleanup: true});
            if (output.includes('entered') && mode !== 'finish') {
              if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
              break;
            }
          }
          if (mode === 'finish') assert.equal(output, 'entered\nTrue 7 8\n');
        } finally { execution.close(); session.context.finish(); session.close(); }
        closed(session.stats());
      }
    } finally { registry.close(); }
  }
});

test('isolated comprehension snapshots share instruction, work and real allocation limits', async () => {
  for (const [source, options, memoryLimits, expected] of [
    ['while True: [locals() for x in [1]]\n', {maxSteps: 300}, undefined, 'BUDGET'],
    ['while True: [vars() for x in [1]]\n', {maxSteps: 100000, maxWork: 1800}, undefined, 'BUDGET'],
    ['saved=[]\nwhile True: saved.append([locals() for x in [1]])\n', {maxSteps: 100000}, {maxBytes: 28000}, 'OOM'],
  ]) {
    const result = await run(source, options, memoryLimits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error)); closed(result.closed);
  }
});
test('comprehension namespace metadata is bounded, exact, immutable and retained by registries', async () => {
  const source = 'def f(p):\n a=7\n return [locals() for x in [1]]\nr=f(9)[0]\nprint(*list(r))\n';
  const compiled = compileSource(source, profile).program;
  const checked = verifyFunctions(compiled).code;
  assert.deepEqual(checked.functions[1].namespace, ['p', 'a', 'x']);
  assert.ok(Object.isFrozen(checked.functions[1].namespace));
  const {registry} = await compileSourceModules([unit(source)], profile);
  const session = new ModuleSession(registry); let output = '';
  try {
    session.run({}, text => { output += text; });
    assert.equal(output, 'p a x\n');
  } finally { session.close(); registry.close(); }
  closed(session.stats());
  for (const invalid of [['p', 'a'], ['p', 'a', 'x', 'other'], ['p', 'a', 'x', 'x'],
    ['p', 'a', '@source:999'], Array.from({length: 129}, (_, i) => 'n'+i), null]) {
    const code = structuredClone(compiled); code.functions[1].namespace = invalid;
    assert.throws(() => verifyFunctions(code), /namespace|Names/);
  }
  const module = structuredClone(compiled); module.functions[0].namespace = [];
  assert.throws(() => verifyFunctions(module), /function/);
  const core = structuredClone(compileSource('def f(): return 7\n').program);
  core.functions[1].namespace = [];
  assert.throws(() => verifyFunctions(core), /fields/);
});

test('comprehension snapshots keep escaped values through every-instruction collection and interruption', async () => {
  const source = 'def marker():\n print("entered")\n return 8\ndef f(p):\n a=[7]\n saved=[(locals(),[locals() for y in [marker()]]) for x in [a]]\n return saved\nr=f(9)[0]\nprint(r[0]["a"] is r[0]["x"],r[0]["p"],r[1][0]["y"],r[0]["a"][0])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try {
    for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
      const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output.includes('entered') && mode !== 'finish') {
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
            break;
          }
        }
        if (mode === 'finish') assert.equal(output, 'entered\nTrue 9 8 7\n');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed(session.stats());
    }
  } finally { registry.close(); }
});

test('comprehension reflection shares real instruction, work and allocation limits', async () => {
  for (const [body, options, memoryLimits, expected] of [
    ['while True: [locals() for x in [1]]', {maxSteps: 300}, undefined, 'BUDGET'],
    ['while True: [locals() for x in [1]]', {maxSteps: 100000, maxWork: 1800}, undefined, 'BUDGET'],
    ['saved=[]\n while True: saved.append([locals() for x in [1]])', {maxSteps: 100000}, {maxBytes: 28000}, 'OOM'],
  ]) {
    const result = await run('def f(p):\n '+body+'\nf([7])\n', options, memoryLimits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    closed(result.closed);
  }
});

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('reflection source: ' + fixture.id, async () => {
    const result = await run(fixture.source);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    if (result.closed) closed(result.closed); else assert.equal(result.error?.code, 'SYNTAX');
  });

test('identities survive collection at every instruction and generator suspension', async () => {
  const source = 'class A:\n def f(self): return 7\ndef values():\n x=A()\n saved=id(x)\n yield x,saved\n print(saved==id(x))\ng=values()\nx,saved=next(g)\nprint(saved==id(x))\ntry: next(g)\nexcept StopIteration: pass\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  const session = new ModuleSession(registry); let output = '';
  session.context.begin({}, text => { output += text; }); const execution = Execution.modules(session.context);
  try {
    while (execution.state !== 'completed') { execution.advance(); session.memory.collect([], {cleanup: true}); }
    assert.equal(output, 'True\nTrue\n');
  } finally { execution.close(); execution.close(); session.context.finish(); session.close(); registry.close(); }
  closed(session.stats());
});

test('identities remain stable across separate persistent callback activations', async () => {
  const {registry} = await compileSourceModules([unit('saved=[]\ndef identity(): return id(saved)\ndef replace():\n global saved\n saved=[]\n return id(saved)\n')], profile);
  const session = new ModuleSession(registry);
  try {
    session.run(); const handle = session.register('identity'), replacement = session.register('replace');
    const invoke = async callback => {
      const event = session.enqueue(callback, []);
      let quanta = 0;
      while (session.pending) { assert.ok(++quanta < 1000); session.pump(1); session.memory.collect([], {cleanup: true}); }
      return event.result;
    };
    const first = await invoke(handle), second = await invoke(handle), third = await invoke(replacement);
    assert.deepEqual(first, second); assert.notDeepEqual(first, third); assert.deepEqual(third, await invoke(handle));
  } finally { session.close(); registry.close(); }
  closed(session.stats());
});

test('integer identity refuses explicitly and core admission remains unchanged', async () => {
  const result = await run('id(7)\n'); assert.equal(result.error.code, 'UNSUPPORTED'); closed(result.closed);
  const core = await runSourceRequest({modules: [unit('id([])\n')]});
  assert.equal(core.error.type, 'NameError'); closed(core.closed);
});

test('identity traversal obeys the shared work limit', async () => {
  const result = await run('saved=[]\nwhile True: id(saved)\n', {maxSteps: 100000, maxWork: 1000});
  assert.equal(result.error.code, 'BUDGET'); closed(result.closed);
});

test('snapshot values and free cells survive collection, cancellation and close', async () => {
  const source = 'def outer():\n saved=[7]\n def f(x):\n  before=locals()\n  print("entered")\n  del x\n  return before["x"][0]+saved[0]\n return f\nprint(outer()([1]))\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); session.memory.collect([], {cleanup: true});
        if (output === 'entered\n') {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached); if (mode === 'finish') assert.equal(output, 'entered\n8\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('recursive snapshot graphs share real memory and work budgets', async () => {
  for (const [body, options, limits, expected] of [
    ['while True: locals()', {maxSteps: 100000, maxWork: 1000}, undefined, 'BUDGET'],
    ['saved=[]\n while True: saved.append(locals())', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const result = await run('def f():\n '+body+'\nf()\n', options, limits);
    assert.equal(result.error.code, expected); closed(result.closed);
  }
});

test('class body locals share the live dictionary', async () => {
  const result = await run('class A:\n print(locals() is vars())\n');
  assert.equal(result.stdout, 'True\n'); assert.equal(result.error, undefined); closed(result.closed);
});

test('generator-expression snapshots retain iterator and target owners through close and collection', async () => {
  const source = 'saved=[[7],[8]]\ng=(locals() for x in saved)\na=next(g)\nb=next(g)\ng.close()\nprint(a[".0"] is b[".0"],a["x"][0],b["x"][0],list(a)==[".0","x"])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, advances = 0;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); session.memory.collect([], {cleanup: true});
        if (++advances === 70 && mode !== 'finish') {
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
          break;
        }
      }
      if (mode === 'finish') assert.equal(output, 'True 7 8 True\n');
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});

test('escaped generator-expression iterator remains usable after the generator closes', async () => {
  const result = await run('g=(vars() for x in (7,8))\na=next(g)\ng.close()\nprint(next(a[".0"]),a["x"])\n');
  assert.equal(result.stdout, '8 7\n'); assert.ok(result.ok); closed(result.closed);
});

test('reflection continuations retain receivers, iterable owners and outer destinations', () => {
  const receiver = {}, iterator = {}, outer = {}, after = completion('relay', {receiver: outer});
  for (const kind of ['vars-result', 'dir-result', 'dir-sort'])
    assert.deepEqual(completionRoots(completion(kind, {receiver, after, depth: 1})), [receiver, outer]);
  assert.throws(() => completion('dir-result', {receiver, depth: -1}), TypeError);
  assert.deepEqual(completionRoots(completion('dir-iter', {receiver, after, depth: 1})), [receiver, outer]);
  for (const kind of ['dir-length', 'dir-hint-bound', 'dir-hint-call', 'dir-hint-value'])
    assert.deepEqual(completionRoots(completion(kind, {receiver, iterator, after, depth: 1})), [receiver, iterator, outer]);
  for (const kind of ['dir-compare', 'dir-truth']) {
    assert.deepEqual(completionRoots(completion(kind, {receiver, index: 2, lower: 0, upper: 2, after, depth: 1})), [receiver, outer]);
    assert.throws(() => completion(kind, {receiver, index: 2, lower: 3, upper: 2, after, depth: 1}), TypeError);
  }
});

test('directory comparison, reflected, descriptor and truth phases retain their private copy', async () => {
  const definitions = [
    'class Entry:\n def __init__(self,key): self.key=key\n def __lt__(self,other):\n  print("entered")\n  return self.key<other.key\n',
    'class Entry:\n def __init__(self,key): self.key=key\n def __lt__(self,other): return NotImplemented\n def __gt__(self,other):\n  print("entered")\n  return self.key>other.key\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  return lambda other: obj.key<other.key\nclass Entry:\n def __init__(self,key): self.key=key\n __lt__=D()\n',
    'class Truth:\n def __init__(self,value): self.value=value\n def __bool__(self):\n  print("entered")\n  return self.value\nclass Entry:\n def __init__(self,key): self.key=key\n def __lt__(self,other): return Truth(self.key<other.key)\n',
    'class Truth:\n def __init__(self,value): self.value=value\n def __len__(self):\n  print("entered")\n  return int(self.value)\nclass Entry:\n def __init__(self,key): self.key=key\n def __lt__(self,other): return Truth(self.key<other.key)\n',
  ];
  for (const definition of definitions) {
    const source = definition + 'saved=[Entry(2),Entry(1)]\nclass A:\n def __dir__(self): return saved\nresult=dir(A())\nprint(result[0] is saved[1],result[1] is saved[0])\n';
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n') {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.ok(reached); if (mode === 'finish') assert.equal(output, 'entered\nTrue True\n');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed(session.stats());
    } } finally { registry.close(); }
  }
});

test('directory sorting retains stability and every entry across repeated collection', async () => {
  const source = 'class Entry:\n def __init__(self,key,label): self.key=key; self.label=label\n def __lt__(self,other): return self.key<other.key\nsaved=[Entry(i%3,i) for i in range(20)]\nclass A:\n def __dir__(self): return saved\nresult=dir(A())\nprint([x.label for x in result]==[0,3,6,9,12,15,18,1,4,7,10,13,16,19,2,5,8,11,14,17],saved[1].label)\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  const session = new ModuleSession(registry); let output = '';
  session.context.begin({maxWork: 5000000}, text => { output += text; }); const execution = Execution.modules(session.context);
  try {
    while (execution.state !== 'completed') { execution.advance(); session.memory.collect([], {cleanup: true}); }
    assert.equal(output, 'True 1\n');
  } finally { execution.close(); session.context.finish(); session.close(); registry.close(); }
  closed(session.stats());
});

test('directory comparison and truth callbacks share recursion, work and allocation limits', async () => {
  for (const slot of ['__lt__', '__bool__']) for (const [body, options, limits, expected] of [
    ['return dir(A())', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['print("entered")\n  while True: pass', {maxSteps: 100000, maxWork: 150000}, undefined, 'BUDGET'],
    ['saved=[]\n  while True: saved.append([7])', {maxSteps: 100000}, {maxBytes: 28000}, 'OOM'],
  ]) {
    const source = slot === '__lt__' ? 'class Entry:\n def __lt__(self,other):\n  '+body+'\n' :
      'class Truth:\n def __bool__(self):\n  '+body+'\nclass Entry:\n def __lt__(self,other): return Truth()\n';
    const result = await run(source+'class A:\n def __dir__(self): return [Entry(),Entry()]\ndir(A())\n', options, limits);
    assert.equal(result.error.code, expected); if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
    if (options.maxWork) assert.equal(result.stdout, 'entered\n');
  }
});

test('directory length, hint, binding and index phases survive collection and interruption', async () => {
  const sources = [
    'class Items:\n def __iter__(self): return iter(("z","a"))\n def __len__(self):\n  print("entered")\n  return 0\n',
    'class Items:\n def __iter__(self): return iter(("z","a"))\n def __length_hint__(self):\n  print("entered")\n  return 0\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  return lambda: 0\nclass Items:\n def __iter__(self): return iter(("z","a"))\n __length_hint__=D()\n',
    'class Index:\n def __index__(self):\n  print("entered")\n  return 0\nclass Items:\n def __iter__(self): return iter(("z","a"))\n def __len__(self): return Index()\n',
    'class Items:\n def __len__(self): return 0\n def __iter__(self):\n  yield "z"\n  print("entered")\n  yield "a"\n',
  ];
  for (const definitions of sources) {
    const source = definitions + 'class A:\n def __dir__(self): return Items()\nprint(dir(A())[0])\n';
    const {registry} = await compileSourceModules([unit(source)], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n') {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.ok(reached); if (mode === 'finish') assert.equal(output, 'entered\na\n');
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed(session.stats());
    } } finally { registry.close(); }
  }
});

test('directory hints share work, instruction and actual allocation limits without reserving host arrays', async () => {
  for (const slot of ['__len__', '__length_hint__']) for (const [body, options, limits, expected] of [
    ['return 1025', {}, undefined, 'BUDGET'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['print("entered")\n  while True: pass', {maxSteps: 100000, maxWork: 150000}, undefined, 'BUDGET'],
    ['saved=[]\n  while True: saved.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const result = await run('class Items:\n def __iter__(self): return iter(())\n def '+slot+'(self):\n  '+body+'\nclass A:\n def __dir__(self): return Items()\ndir(A())\n', options, limits);
    assert.equal(result.error.code, expected); closed(result.closed);
    if (options.maxWork) assert.equal(result.stdout, 'entered\n');
  }
});

test('reflection binding, bodies and partial iterable copies survive collection and interruption', async () => {
  const sources = [
    'class A:\n @property\n def __dict__(self):\n  print("entered")\n  return [7]\nprint([1][0]+vars(A())[0])\n',
    'class A:\n def __getattribute__(self,name):\n  print("entered")\n  return [7]\nprint([1][0]+vars(A())[0])\n',
    'class D:\n def __get__(self,obj,owner):\n  print("entered")\n  return lambda: ("z","a")\nclass A: __dir__=D()\nprint(dir(A())[0])\n',
    'class A:\n def __dir__(self):\n  yield "z"\n  print("entered")\n  yield "a"\nprint(dir(A())[0])\n',
    'class M(type):\n @property\n def __dir__(cls):\n  print("entered")\n  return lambda: (cls.__name__,)\nclass A(metaclass=M): pass\nprint(dir(A)[0])\n',
  ];
  for (let index = 0; index < sources.length; index++) {
    const {registry} = await compileSourceModules([unit(sources[index])], profile);
    try { for (const mode of ['finish', 'cancel', 'close']) {
      const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
      session.context.begin({shouldCancel: () => cancel}, text => { output += text; }); const execution = Execution.modules(session.context);
      try {
        while (execution.state !== 'completed') {
          execution.advance(); session.memory.collect([], {cleanup: true});
          if (output === 'entered\n') {
            reached = true;
            if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
            if (mode === 'close') break;
          }
        }
        assert.ok(reached); if (mode === 'finish') assert.equal(output, 'entered\n'+['8\n','8\n','a\n','a\n','A\n'][index]);
      } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
      closed(session.stats());
    } } finally { registry.close(); }
  }
});

test('reflection hooks share recursion, instruction and real allocation limits', async () => {
  for (const builtin of ['vars', 'dir']) for (const [body, options, limits, expected] of [
    ['return '+builtin+'(self)', {maxDepth: 12}, undefined, 'PYTHON'],
    ['while True: pass', {maxSteps: 200}, undefined, 'BUDGET'],
    ['a=[]\n  while True: a.append([7])', {maxSteps: 100000}, {maxBytes: 24000}, 'OOM'],
  ]) {
    const slot = builtin === 'vars' ? '__dict__' : '__dir__', decorator = builtin === 'vars' ? ' @property\n' : '';
    const result = await run('class A:\n'+decorator+' def '+slot+'(self):\n  '+body+'\n'+builtin+'(A())\n', options, limits);
    assert.equal(result.error.code, expected); if (expected === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});

test('reflection method and descriptor failures preserve original Python source frames', async () => {
  for (const [source, expected] of [
    ['class A:\n @property\n def __dict__(self):\n  raise ValueError("original")\nvars(A())\n', [['<module>', 5], ['__dict__', 4]]],
    ['class A:\n def __dir__(self):\n  raise AttributeError("original")\ndir(A())\n', [['<module>', 4], ['__dir__', 3]]],
    ['class D:\n def __get__(self,obj,owner):\n  raise AttributeError("original")\nclass A: __dir__=D()\ndir(A())\n', [['<module>', 5], ['__get__', 3]]],
  ]) {
    const result = await run(source); assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.span[0]]), expected); closed(result.closed);
  }
});
