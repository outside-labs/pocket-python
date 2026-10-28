import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSource} from './source-compiler.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {FunctionValue} from './function-objects.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime} from './values.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic documentation fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/documentation.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('documentation: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

test('documentation metadata survives registry verification and rejects invalid constant/layout admission', () => {
  const program = compileSource('def f():\n "value"\n return 7\n', profile).program;
  assert.equal(verifyFunctions(program).code.functions[1].doc, program.functions[1].doc);
  for (const change of [
    p => { p.functions[1].doc = -1; },
    p => { p.functions[1].doc = p.constants.length; },
    p => { p.functions[1].doc = 1; },
    p => { p.functions[0].doc = 0; },
    p => { p.version = 4; for (const fn of p.functions) delete fn.kind; },
    p => { p.version = 3; for (const fn of p.functions) delete fn.kind; },
  ]) {
    const invalid = structuredClone(program); change(invalid);
    assert.throws(() => verifyFunctions(invalid), {code: 'BYTECODE'});
  }
});

test('function documentation growth restores the previous value on ownership and memory failure', () => {
  const memory = new MemoryArena({maxBytes: 3000}), roots = [], leave = memory.enter(() => roots);
  const foreign = new MemoryArena(), foreignRoots = [], foreignLeave = foreign.enter(() => foreignRoots);
  try {
    const classes = new ClassRuntime({memory}), other = new ClassRuntime({memory: foreign});
    const fn = classes.make(FunctionValue, null, 0, null, new Map()); roots.push(fn);
    classes.write(fn, '__doc__', fn);
    const foreignDoc = other.values.list([]); foreignRoots.push(foreignDoc);
    assert.throws(() => classes.write(fn, '__doc__', foreignDoc), {code: 'STALE_HANDLE'});
    assert.equal(fn.documentation, fn);
    const huge = new ValueRuntime().string(new Array(4000).fill(65));
    assert.throws(() => classes.write(fn, '__doc__', huge), {code: 'OOM'});
    assert.equal(fn.documentation, fn);
    memory.collect([], {cleanup: true}); assert.equal(classes.get(fn, '__doc__'), fn);
    classes.write(fn, '__doc__', null, true); assert.equal(classes.get(fn, '__doc__'), null);
  } finally { leave(); memory.close(); foreignLeave(); foreign.close(); }
  closed(memory.stats()); closed(foreign.stats());
});

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

test('function documentation and captured cycles survive parked collection, cancellation and close', async () => {
  await lifecycle('def make():\n saved=[7]\n def read():\n  "source"\n  return saved[0]\n read.__doc__=[read,saved]\n return read\nf=make()\nprint("held")\nprint(f.__doc__[0] is f,f.__doc__[1][0],f())\n',
    'held\nTrue 7 7\n', ['held\n']);
});
