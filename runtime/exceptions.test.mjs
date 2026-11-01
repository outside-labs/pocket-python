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
    const modules = [{...unit(item.source), imports: item.imports ?? []},
      ...(item.modules ?? []).map(module => ({...module, notice: 'Synthetic exception helper'}))];
    const result = await runSourceRequest({modules, compileOptions: {languageProfile},
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

for (const slot of ['new', 'init']) test('exception subclass ' + slot + ' callbacks retain construction across park/cancel/close', async () => {
  const source = slot === 'new' ?
    'class E(Exception):\n def __new__(cls,x):\n  print("entered")\n  return super().__new__(cls,x)\ne=E([7])\nprint(e.args[0][0])\n' :
    'class E(Exception):\n def __init__(self,x):\n  print("entered")\n  self.saved=x\n  super().__init__(x)\ne=E([7])\nprint(e.saved is e.args[0])\n';
  await lifetime(source, 'entered\n' + (slot === 'new' ? '7\n' : 'True\n'));
});

for (const role of ['raised', 'cause']) test('owned ' + role + ' class normalization survives park/cancel/close', async () => {
  const source = 'class E(Exception):\n def __init__(self):\n  print("entered")\n  super().__init__(7)\n' +
    (role === 'raised' ? 'try: raise E\nexcept E as e: print(e.args[0])\n' :
      'try: raise ValueError([]) from E\nexcept ValueError as e: print(e.__cause__.args[0],len(e.args[0]))\n');
  await lifetime(source, 'entered\n' + (role === 'raised' ? '7\n' : '7 0\n'));
});

test('a generated KeyError retains its temporary key after the hash callback exits', async () => {
  await lifetime('class K:\n def __hash__(self):\n  print("entered")\n  return 7\ntry: {}[K()]\nexcept KeyError as e: print(type(e.args[0]) is K)\n', 'entered\nTrue\n');
});

test('lazy generated message arguments obey shared allocation limits', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True:\n try: len(7)\n except TypeError as e: held.append(e.args)\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('handler expression callbacks preserve the caught exception through park/cancel/close', async () => {
  await lifetime('def choose():\n print("entered")\n return (ValueError,)\ne=ValueError([7])\ntry: raise e\nexcept choose() as caught: print(caught is e,caught.args[0][0])\n', 'entered\nTrue 7\n');
});

test('temporary handler tuples and classes remain owned during descriptor callbacks', async () => {
  await lifetime('class H:\n @property\n def handlers(self):\n  print("entered")\n  class E(Exception): pass\n  return (E,ValueError)\ntry: raise ValueError([7])\nexcept H().handlers as e: print(e.args[0][0])\n', 'entered\n7\n');
});

test('handler expression blocks require modern bytecode and a verified expression result', () => {
  const original = compileSource('try: raise ValueError()\nexcept ValueError: pass\n').program;
  for (const change of [
    program => { program.version = 3; },
    program => { program.functions[0].blocks[0].instructions.find(item => item[0] === 'try')[2][0][0] = null; },
    program => { program.functions[0].blocks[0].instructions.find(item => item[0] === 'try')[2][0][0] = 0; },
    program => { program.functions[0].blocks[0].instructions.find(item => item[0] === 'try')[2][0][0] = 999999; },
  ]) {
    const program = structuredClone(original); change(program);
    assert.throws(() => verifyFunctions(program), {code: 'BYTECODE'});
  }
});

test('note getters retain the note and exception through park/cancel/close', async () => {
  await lifetime('notes=[]\nclass E(Exception):\n @property\n def __notes__(self):\n  print("entered")\n  return notes\ne=E()\ne.add_note("detail")\nprint(notes[0])\n', 'entered\ndetail\n');
});

test('lazy note creation retains the new list across owned setters', async () => {
  await lifetime('class E(Exception):\n @property\n def __notes__(self): raise AttributeError()\n @__notes__.setter\n def __notes__(self,value):\n  print("entered")\n  self.saved=value\ne=E()\ne.add_note("detail")\nprint(e.saved[0])\n', 'entered\ndetail\n');
});

test('cyclic note dictionaries survive collection and release together', async () => {
  await lifetime('e=Exception()\ne.__notes__=[e]\ne.add_note("detail")\nprint("entered")\nprint(e.__notes__[0] is e,e.__notes__[1])\n', 'entered\nTrue detail\n');
});

test('growing note graphs use the shared allocation budget', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True:\n e=Exception()\n e.add_note("detail")\n held.append(e)\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('suspended handler selection retains exception state through collection and cancel/close', async () => {
  await lifetime('def work():\n try:\n  try: raise ValueError([7])\n  except (yield ValueError) as e:\n   e.add_note("selected")\n   yield e\n finally: print("closed")\ni=work()\nnext(i)\nprint("entered")\ne=i.send((ValueError,))\nprint(e.args[0][0],e.__notes__[0])\ni.close()\n', 'entered\n7 selected\nclosed\n');
});
