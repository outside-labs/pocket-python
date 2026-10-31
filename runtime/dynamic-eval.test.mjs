import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic dynamic eval fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/dynamic-eval.json', import.meta.url)));
for (const item of corpus.cases) test('owned eval: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports ?? []}, ...(item.modules ?? []).map(item => ({...item, notice: 'Synthetic eval helper'}))], compileOptions: profile, options: {maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error)); closed(result.closed);
});
test('dynamic diagnostics retain compiled filenames and source spans', async () => {
  const result = await runSourceRequest({modules: [unit('eval(compile("1/0","original-expression.py","eval"))\n')], compileOptions: profile});
  assert.equal(result.error.type, 'ZeroDivisionError');
  assert.ok(result.error.traceback.some(frame => frame.location?.filename === 'original-expression.py' && frame.location.span[0] === 1));
  closed(result.closed);
});
test('nested evaluation shares instruction/work/recursion limits', async () => {
  const source = 'def f(): return eval("f()")\nf()\n';
  for (const options of [{maxDepth: 8}, {maxSteps: 120}, {maxWork: 15000}]) {
    const result = await runSourceRequest({modules: [unit(source)], compileOptions: profile, options});
    assert.ok(['BUDGET', 'PYTHON'].includes(result.error.code), JSON.stringify(result.error));
    if (result.error.code === 'PYTHON') assert.equal(result.error.type, 'RecursionError'); closed(result.closed);
  }
});
test('code, lambdas and explicit globals survive parked collection and cancel/close', async () => {
  const source = 'def make():\n g={"x":[7]}\n return eval("lambda: x[0]",g)\nf=make()\nprint("ready")\nprint(eval("f()"))\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park(); session.memory.collect([], {cleanup: true});
        if (output === 'ready\n') {
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      if (mode === 'finish') assert.equal(output, 'ready\n7\n');
    } finally { execution.close(); session.context.finish(); session.close(); } closed(session.stats());
  } } finally { registry.close(); }
});

test('eval rejects foreign owners and forged unverified executable pools', async () => {
  const {MemoryArena} = await import('./memory.mjs');
  const {ClassRuntime} = await import('./class-values.mjs');
  const {CodePool, CodeValue} = await import('./function-objects.mjs');
  const {compileSource} = await import('./source-compiler.mjs');
  const {verifyFunctions} = await import('./function-bytecode.mjs');
  const {dynamicEvaluator} = await import('./dynamic-evaluation.mjs');
  const verified = verifyFunctions(compileSource('7', {...profile, mode: 'eval'}).program);
  const memory = new MemoryArena(), other = new MemoryArena(), roots = [], foreignRoots = [];
  const leave = memory.enter(() => roots), leaveOther = other.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), foreign = new ClassRuntime({memory: other});
    const pool = foreign.make(CodePool, verified.code, verified.bytes); foreignRoots.push(pool);
    const foreignCode = foreign.codeObject(pool, 0); foreignRoots.push(foreignCode);
    const forgedPool = classes.make(CodePool, {constants: [], functions: [{free: []}]}, 64); roots.push(forgedPool);
    const forged = classes.make(CodeValue, forgedPool, 0); roots.push(forged);
    const globals = classes.values.dict([]); roots.push(globals);
    const evaluator = dynamicEvaluator({state: {frames: []}, values: classes.values, classes,
      allocate: () => assert.fail('invalid code cannot allocate execution namespaces'), enter: () => assert.fail('invalid code cannot enter'),
      bind: () => new Map(), compiler: null, python: (name, message) => { const error = new Error(message); error.name = name; throw error; }});
    for (const [source, expected] of [[foreignCode, {code: 'STALE_HANDLE'}], [forged, {name: 'TypeError'}]])
      assert.throws(() => evaluator.resume({kind: 'eval-builtins-stored', source, globals, locals: globals, builtins: globals, after: null}, null, null), expected);
  } finally { leave(); memory.close(); leaveOther(); other.close(); } closed(memory.stats()); closed(other.stats());
});
