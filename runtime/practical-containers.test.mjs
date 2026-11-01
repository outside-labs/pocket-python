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

for (const marker of ['equal', 'truth']) test('sequence scan owns ' + marker + ' callback state through park/cancel/close', async () => {
  const source = 'class T:\n def __bool__(self):\n  ' + (marker === 'truth' ? 'print("entered")\n  ' : '') + 'return True\n' +
    'class A:\n def __eq__(self,other):\n  ' + (marker === 'equal' ? 'print("entered")\n  ' : '') + 'a.clear()\n  return T()\na=[A()]\nprint(a.count(7),len(a))\n';
  await callbackLifetime(source, 'entered\n1 0\n');
});

test('sequence index owns the search value and bounds during conversion callbacks', async () => {
  await callbackLifetime('key=[]\na=[key]\nclass I:\n def __index__(self):\n  print("entered")\n  return 0\nprint(a.index(key,I()))\n', 'entered\n0\n');
});

test('extension retains its iterator and partial results during park/cancel/close', async () => {
  await callbackLifetime('class A:\n def __iter__(self): return self\n def __next__(self):\n  self.n+=1\n  if self.n>1: raise StopIteration\n  print("entered")\n  return [7]\ni=A()\ni.n=0\na=[]\na.extend(i)\nprint(a[0][0])\n', 'entered\n7\n');
});

test('extension refuses user hints before binding or consuming callbacks', async () => {
  for (const slot of ['__len__', '__length_hint__']) {
    const source = 'class A:\n @property\n def __iter__(self):\n  print("bad iter")\n  return str\n def ' + slot + '(self):\n  print("bad hint")\n  return 1\n[].extend(A())\n';
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: {languageProfile: corpus.profile}});
    assert.equal(result.error?.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); closed(result.closed);
  }
});

test('extension enforces the shared item quota and tears down partial results', async () => {
  const result = await runSourceRequest({modules: [unit('a=[7]*1023\nprint("ready")\na.extend([8,9])\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.code, 'BUDGET'); closed(result.closed);
});

for (const name of ['get', 'setdefault', 'pop']) test('dictionary ' + name + ' owns keys/defaults during parked hash callbacks', async () => {
  const source = 'class K:\n def __hash__(self):\n  print("entered")\n  return 7\nk=K()\nf=[]\nd=' + (name === 'pop' ? '{1:7}' : '{}') + '\nr=d.' + name + '(k,f)\nprint(r is f)\n';
  await callbackLifetime(source, 'entered\nTrue\n');
});

test('dictionary removal owns the detached result during parked equality/truth callbacks', async () => {
  await callbackLifetime('class T:\n def __bool__(self):\n  print("entered")\n  return True\nclass K:\n def __hash__(self): return 7\n def __eq__(self,other): return T()\na=K()\nb=K()\nd={a:[]}\nv=d.pop(b)\ndel d\nv.append(7)\nprint(v[0])\n', 'entered\n7\n');
});

test('live values membership owns its view and equality result through park/cancel/close', async () => {
  await callbackLifetime('class T:\n def __bool__(self):\n  print("entered")\n  return True\nclass A:\n def __eq__(self,other): return T()\nd={1:A()}\nv=d.values()\ndel d\nprint(7 in v)\n', 'entered\nTrue\n');
});

test('dictionary subtype views retain the complete original owner graph', async () => {
  const source = 'class D(dict): pass\nd=D()\nd.saved=[7]\nv=d.keys()\ndel d\n';
  const {registry} = await compileSourceModules([unit(source)], {languageProfile: corpus.profile});
  const session = new ModuleSession(registry);
  try {
    session.run(); session.memory.collect([], {cleanup: true});
    const view = session.context.module(registry.entry).environment.cells.get('v').value;
    assert.equal(view.owner.type.name, 'D');
    assert.ok(session.memory.identityHash(view.owner) > 0);
  } finally { session.close(); registry.close(); }
  closed(session.stats());
});
