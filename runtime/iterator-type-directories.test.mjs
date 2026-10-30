import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic iterator type directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/iterator-type-directories.json', import.meta.url)));
for (const item of corpus.cases) test('iterator type directory: ' + item.id, async () => {
  const result = await run(item.source);
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
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
      const before = output;
      execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before, 'teardown must not run directory or contained callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

for (const [setup, count] of [
  ["def g():\n print(\"body\")\n yield 7\nitem=g()\n", 38],
  ["item=iter([7,9])\n", 28],
  ["item=iter((7,9))\n", 28],
  ["item=iter(\"abc\")\n", 28],
  ["item=iter(\"a😀\")\n", 28],
  ["item=iter({\"a\":7})\n", 27],
  ["item=iter(range(3))\n", 28],
  ["item=iter(range(10**40,10**40+3))\n", 28],
  ["item=iter({7})\n", 27],
  ["item=iter(b\"abc\")\n", 28],
  ["item=iter(bytearray(b\"abc\"))\n", 28],
  ["storage=bytearray(b\"abc\")\nview=memoryview(storage)\nitem=iter(view)\n", 26],
  ["class A:\n def __getitem__(self,key): return key+7\nitem=iter(A())\n", 28],
  ["def f():\n print(\"call\")\n return 7\nitem=iter(f,9)\n", 26],
]) {
  test('native caller retains canonical iterator type: ' + setup, async () => {
    await lifecycle(setup+'value=type(item)\nd=type.__dir__.__get__(value)\ndel item\ndel value\nprint("entered")\nprint(len(d()),len(dir(d.__self__)))\n', 'entered\n'+count+' '+count+'\n');
  });
}
test('nested native iterator caller retains the directory descriptor receiver', async () => {
  await lifecycle('d=type.__dir__.__get__(type(iter([]))).__dir__\nprint("entered")\nprint(len(d()),len(d.__self__()),d.__self__.__self__ is type(iter([])))\n', 'entered\n30 28 True\n');
});
test('advertised iterator namespace merging retains a cyclic instance graph', async () => {
  await lifecycle('class A:\n @property\n def __class__(self): return type(iter([]))\na=A()\na.saved=a\nd=a.__dir__\ndel a\ndel A\nprint("entered")\nprint("__iter__" in d(),d.__self__.saved is d.__self__)\n', 'entered\nTrue True\n');
});
test('advertised native key collision callbacks retain the merge and receiver graph', async () => {
  await lifecycle('class Key:\n def __hash__(self): return hash("__iter__")\n def __eq__(self,other):\n  if not self.seen:\n   self.seen=True\n   print("entered")\n  return other=="__iter__"\nkey=Key()\nkey.seen=False\nclass A:\n @property\n def __class__(self): return type(iter([]))\na=A()\na.__dict__[key]=7\nkey.saved=a\nd=a.__dir__\ndel a\ndel key\ndel A\ndel Key\nnames=d()\nprint(names[0].saved is d.__self__)\n', 'entered\nTrue\n');
});
test('advertised generator type retains the suspended cyclic source graph', async () => {
  await lifecycle('def g():\n print("body")\n yield 7\nclass A:\n @property\n def __class__(self): return type(self.saved)\na=A()\na.saved=g()\ng.saved=a\nd=a.__dir__\ndel a\ndel A\ndel g\nprint("entered")\nprint("send" in d())\nprint(next(d.__self__.saved))\n', 'entered\nTrue\nbody\n7\n');
});
test('advertised callable iterator type retains a cyclic callable and sentinel', async () => {
  await lifecycle('class A:\n @property\n def __class__(self): return type(self.saved)\nclass Call:\n def __call__(self): return self.saved\na=A()\ncall=Call()\ncall.saved=a\na.saved=iter(call,a)\nd=a.__dir__\ndel a\ndel call\ndel A\ndel Call\nprint("entered")\nprint("__next__" in d())\nprint(next(d.__self__.saved,"done"))\n', 'entered\nTrue\ndone\n');
});
for (const operation of ['dir(type(iter([])))', 'type.__dir__(type(iter(())))', 'd()']) test(operation+' uses shared real budgets', async () => {
  for (const [options, limits, expected] of [
    [{maxSteps: 300}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
    [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 12000}, 'OOM'],
  ]) {
    const result = await run('d=type.__dir__.__get__(type(iter([])))\nprint("entered")\nwhile True: names='+operation+'\n', options, limits);
    assert.equal(result.error?.code, expected, JSON.stringify(result.error));
    assert.equal(result.stdout, 'entered\n'); closed(result.closed);
  }
});
test('iterator type directory forms keep core source admission', async () => {
  for (const source of ['dir(type(iter([])))\n', 'type.__dir__(type(iter([])))\n']) {
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: {languageProfile: 'core-source/1'}});
    assert.equal(result.error?.type, 'NameError', JSON.stringify(result.error));
    if (result.closed) closed(result.closed);
  }
});
