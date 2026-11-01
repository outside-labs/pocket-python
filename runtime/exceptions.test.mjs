import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {compileSource} from './source-compiler.mjs';
import {verifyFunctions} from './function-bytecode.mjs';

const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/exceptions.json', import.meta.url)));
const unit = source => ({name: 'app', source, imports: [], package: false, notice: 'Synthetic exception fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  for (const languageProfile of item.profiles ?? [corpus.profile]) test(languageProfile + ': ' + item.id, async () => {
    const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: {languageProfile},
      options: {maxSteps: 50000, maxWork: 20000000}});
    assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    closed(result.closed);
  });
}

async function lifetime(source, expected) {
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

test('lazy exception messages retain their arguments through park/cancel/close', async () => {
  await lifetime('class M:\n def __str__(self):\n  print("entered")\n  return "message"\nprint(str(ValueError(M())))\n', 'entered\nmessage\n');
});

test('exception argument graphs obey shared allocation limits', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True: held.append(ValueError([7]))\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('argument replacement retains the receiver through parked iterator callbacks', async () => {
  await lifetime('class I:\n def __iter__(self):\n  print("entered")\n  yield [7]\ne=Exception(9)\ne.args=I()\nprint(e.args[0][0])\n', 'entered\n7\n');
});

test('cyclic exception arguments and chains survive collection and release together', async () => {
  const source = 'e=ValueError([])\nf=LookupError(e)\ne.args=(f,)\ne.__cause__=f\nf.__context__=e\nprint("entered")\nprint(e.args[0] is f,f.__context__ is e)\n';
  await lifetime(source, 'entered\nTrue True\n');
});

test('explicit cause evaluation survives parking, cancellation and close', async () => {
  await lifetime('def cause():\n print("entered")\n return ValueError(7)\ntry: raise TypeError() from cause()\nexcept TypeError as e: print(e.__cause__.args[0])\n', 'entered\n7\n');
});

test('raise-from verification requires a modern program and exactly two operands', () => {
  const source = compileSource('raise ValueError from None\n').program;
  for (const change of [
    program => { program.version = 3; },
    program => { program.functions[0].blocks[0].instructions.splice(1, 1); program.functions[0].blocks[0].source.spans.splice(1, 1); },
    program => { program.functions[0].blocks[0].instructions.unshift(['const', 0]); program.functions[0].blocks[0].source.spans.unshift([...program.functions[0].blocks[0].source.spans[0]]); },
  ]) {
    const program = structuredClone(source); change(program);
    assert.throws(() => verifyFunctions(program), {code: 'BYTECODE'});
  }
});

test('unhandled chain summaries retain source frames without exporting live exceptions', async () => {
  const result = await runSourceRequest({modules: [unit('def fail():\n raise ValueError("outer") from TypeError("inner")\nfail()\n')], compileOptions: {languageProfile: corpus.profile}});
  assert.equal(result.error.type, 'ValueError'); assert.deepEqual(result.error.cause, {type: 'TypeError', message: 'inner'});
  assert.equal(result.error.suppressContext, true);
  assert.deepEqual(result.error.traceback.map(frame => frame.location.span[0]), [3, 2]); closed(result.closed);
});
