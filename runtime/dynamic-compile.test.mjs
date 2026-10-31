import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic dynamic source fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/dynamic-compile.json', import.meta.url)));
for (const item of corpus.cases) test('dynamic compile: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile, options: {maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error)); closed(result.closed);
});
test('source modes and interactive display are independently verified', async () => {
  for (const mode of ['exec', 'eval', 'single']) {
    const code = compileSource(mode === 'single' ? 'if True:\n "hello"\n None\n' : '7', {...profile, mode}).program;
    assert.equal(verifyFunctions(code).code.mode, mode);
    const malformed = structuredClone(code); malformed.mode = 'javascript'; assert.throws(() => verifyFunctions(malformed), {code: 'BYTECODE'});
    if (mode === 'single') {
      const modules = await compileSourceModules([unit('if True:\n "hello"\n None\n')], {...profile, mode});
      const session = new ModuleSession(modules.registry);
      let output = "";
      try { session.run({}, text => { output += text; }); assert.equal(output, "'hello'\n"); } finally { session.close(); modules.registry.close(); } closed(session.stats());
      const legacy = structuredClone(code); delete legacy.mode; assert.throws(() => verifyFunctions(legacy), {code: 'BYTECODE'});
    }
  }
});
test('AST, future, async flags and unsupported grammar never become executable code', async () => {
  for (const expression of ['compile("7","x","eval",1024)', 'compile("7","x","eval",8192)',
    'compile("7","x","eval",16777216)', 'compile("await x","x","eval")',
    'compile("from __future__ import annotations","x","exec")']) {
    const result = await runSourceRequest({modules: [unit('print("before")\n' + expression + '\n')], compileOptions: profile});
    assert.equal(result.stdout, 'before\n'); assert.equal(result.error.code, 'UNSUPPORTED'); closed(result.closed);
  }
});
test('compilation failures share work, memory and cancellation with their caller', async () => {
  const source = 'i=0\nwhile i<100:\n try: compile("broken =","x","exec")\n except SyntaxError: i+=1\n';
  const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxSteps: 100000, maxWork: 3000}});
  assert.equal(result.error.code, 'BUDGET'); closed(result.closed);
  const compilation = await compileSourceModules([unit('print("ready")\nc=compile("x="+"1+"*200+"1","x","exec")\n')], profile);
  try { for (const mode of ['cancel', 'memory', 'close']) {
    const session = new ModuleSession(compilation.registry); let output = '', cancel = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context); let release;
    try {
      while (!output) execution.advance(); execution.park(); session.memory.collect([], {cleanup: true});
      if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
      if (mode === 'memory') {
        release = session.memory.external(session.memory.limits.maxBytes - session.stats().bytes - 64);
        assert.throws(() => execution.drain(), {code: 'OOM'});
      }
    } finally { release?.(false); execution.close(); session.context.finish(); session.close(); } closed(session.stats());
  } } finally { compilation.registry.close(); }
});
