import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = (source, name = 'app', imports = [], package_ = false) => ({name, package: package_, imports, source, notice: 'Synthetic dynamic import fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/dynamic-imports.json', import.meta.url)));
for (const item of corpus.cases) test('granted dynamic import: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source, 'app', item.imports ?? []), ...(item.modules ?? []).map(item => ({...item, notice: 'Synthetic dynamic import helper'}))], compileOptions: profile, options: {maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error)); closed(result.closed);
});
test('dynamic names and fromlist children cannot escape exact registry grants', async () => {
  for (const source of ['__import__("helper")\n', 'exec("import helper",{"__name__":"helper"})\n', 'eval("__import__(\'helper\')",{"__package__":"helper"})\n']) {
    const result = await runSourceRequest({modules: [unit(source), unit('print("ungranted")\n', 'helper')], compileOptions: profile});
    assert.equal(result.stdout, ''); assert.equal(result.error.type, 'ImportError'); closed(result.closed);
  }
  const result = await runSourceRequest({modules: [unit('__import__("pkg",fromlist=["child"])\n', 'app', ['pkg']), unit('print("pkg")\n', 'pkg', [], true), unit('print("ungranted child")\n', 'pkg.child')], compileOptions: profile});
  assert.equal(result.stdout, 'pkg\n'); assert.equal(result.error.type, 'ImportError'); closed(result.closed);
});
test('borrowed namespaces and a populated cache cannot widen a code pool grant', async () => {
  const source = 'import helper\nprint(helper.read())\ntry: eval(compile("__import__(\'hidden\')","borrowed.py","eval"),helper.__dict__)\nexcept ImportError: print("denied")\n';
  const result = await runSourceRequest({modules: [unit(source, 'app', ['helper']), unit('def read(): return __import__("hidden").x\n', 'helper', ['hidden']), unit('x=7\n', 'hidden')], compileOptions: profile, options: {maxWork: 20000000}});
  assert.equal(result.stdout, '7\ndenied\n'); assert.equal(result.ok, true, JSON.stringify(result.error)); closed(result.closed);
});
test('existing direct initialization cycle boundary remains explicit and tears down', async () => {
  const result = await runSourceRequest({modules: [unit('__import__("other")\n', 'app', ['other']), unit('__import__("app")\n', 'other', ['app'])], compileOptions: profile});
  assert.equal(result.error.type, 'ImportError'); assert.match(result.error.message, /Cyclic/); closed(result.closed);
});
test('fromlist child initialization survives parked collection and shared cancellation/close', async () => {
  const modules = [unit('m=__import__("pkg",fromlist=["child"])\nprint(m.child.x)\n', 'app', ['pkg', 'pkg.child']), unit('pass\n', 'pkg', [], true), unit('print("entered")\nx=7\n', 'pkg.child')];
  const {registry} = await compileSourceModules(modules, profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park(); session.memory.collect([], {cleanup: true});
        if (output === 'entered\n') {
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      if (mode === 'finish') assert.equal(output, 'entered\n7\n');
    } finally { const before = output; execution.close(); session.context.finish(); session.close(); assert.equal(output, before); } closed(session.stats());
  } } finally { registry.close(); }
});
test('dynamic initialization and lazy fromlists share the caller instruction and work limits', async () => {
  for (const [source, modules, options] of [
    ['__import__("helper")\n', [unit('while True: pass\n', 'helper')], {maxSteps: 150}],
    ['def names():\n while True: yield "x"\n__import__("pkg",fromlist=names())\n', [unit('x=7\n', 'pkg', [], true)], {maxSteps: 100000, maxWork: 30000}],
  ]) {
    const result = await runSourceRequest({modules: [unit(source, 'app', modules.map(item => item.name)), ...modules], compileOptions: profile, options});
    assert.equal(result.error.code, 'BUDGET', JSON.stringify(result.error)); closed(result.closed);
  }
});
