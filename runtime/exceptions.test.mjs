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

async function lifetime(source, expected, helpers = []) {
  const {registry} = await compileSourceModules([{...unit(source), imports: helpers.map(helper => helper.name)},
    ...helpers.map(helper => ({...unit(helper.source), ...helper}))], {languageProfile: corpus.profile});
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

test('attribute enrichment setters retain the original error and temporary receiver across interruption', async () => {
  await lifetime('class E(AttributeError):\n def __setattr__(self,key,value):\n  if key=="name": print("entered")\n  super().__setattr__(key,value)\nclass A:\n def __getattr__(self,key): raise E()\ntry: A().missing\nexcept AttributeError as e: print(e.name,type(e.obj) is A)\n', 'entered\nmissing True\n');
});

test('runtime attribute metadata retains cyclic receivers through parked collection', async () => {
  await lifetime('class A: pass\na=A()\ntry: a.missing\nexcept AttributeError as e: a.error=e\nprint("entered")\nprint(a.error.obj is a,a.error.name)\n', 'entered\nTrue missing\n');
});

test('retained runtime attribute errors share the allocation limit', async () => {
  const result = await runSourceRequest({modules: [unit('class A: pass\nheld=[]\nprint("ready")\nwhile True:\n try: A().missing\n except AttributeError as e: held.append(e)\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('runtime import provenance survives suspended generators and interruption', async () => {
  await lifetime('import helper\ndef work():\n try: from helper import missing\n except ImportError as e: yield e\ni=work()\ne=next(i)\nprint("entered")\nprint(e.name,e.path is helper.__file__,e.name_from,e.msg is e.args[0])\ni.close()\n',
    'entered\nhelper True missing True\n', [{name: 'helper', source: 'pass\n'}]);
});

test('registry denial keeps finite import metadata without granting host imports', async () => {
  const result = await runSourceRequest({modules: [unit('try: __import__("undeclared_host_module")\nexcept ImportError as e: print(e.name is None,e.path is None,e.name_from is None,e.msg is e.args[0])\n')],
    compileOptions: {languageProfile: corpus.profile}});
  assert.equal(result.stdout, 'True True True True\n'); assert.equal(result.ok, true); closed(result.closed);
});

test('runtime metadata enrichment preserves original dynamic failure frames', async () => {
  const source = corpus.cases.find(item => item.id === 'runtime-metadata-dynamic-failure').source;
  const result = await runSourceRequest({modules: [unit(source)], compileOptions: {languageProfile: corpus.profile}});
  assert.equal(result.error.type, 'AttributeError');
  assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.filename, frame.location.span[0]]), [
    ['<module>', 'sources/app.py', 2], ['<module>', 'metadata-original.py', 4], ['fail', 'metadata-original.py', 3]]);
  closed(result.closed);
});

test('SyntaxError details retain temporary native field graphs through interrupted iteration', async () => {
  await lifetime('class Info:\n def __iter__(self):\n  print("entered")\n  yield [7]\n  yield 1\n  yield 2\n  yield "text"\n  yield 3\n  yield 4\n  yield [8]\ne=SyntaxError([],Info())\nprint(e.filename[0],e._metadata[0])\n', 'entered\n7 8\n');
});

test('five SyntaxError details publish their partial native fields before failure', async () => {
  await lifetime('class Info:\n def __iter__(self):\n  print("entered")\n  yield [7]\n  yield 1\n  yield 2\n  yield "text"\n  yield [8]\ne=SyntaxError("old")\ntry: SyntaxError.__init__(e,"new",Info())\nexcept TypeError: print(e.msg,e.filename[0],e.end_lineno[0],e.end_offset is None)\n', 'entered\nnew 7 8 True\n');
});

test('cyclic SyntaxError native fields survive parked collection independently of args', async () => {
  await lifetime('e=SyntaxError()\ne.msg=e\ne.filename=e\ne._metadata=[e]\ne.args=()\nprint("entered")\nprint(e.msg is e,e.filename is e,e._metadata[0] is e)\n', 'entered\nTrue True True\n');
});

test('structured syntax exception graphs obey the shared allocation limit', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True: held.append(SyntaxError([],("file",1,2,[],3,4,[])))\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

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

test('native name fields retain temporary values through parked collection and cancellation', async () => {
  await lifetime('class E(NameError):\n def __init__(self):\n  super().__init__(name=[7])\n  print("entered")\ne=E()\nprint(e.name[0])\n', 'entered\n7\n');
});

test('cyclic native name fields remain independent of the instance dictionary', async () => {
  await lifetime('e=UnboundLocalError()\ne.name=e\ne.__dict__={}\nprint("entered")\nprint(e.name is e)\ndel e.name\nprint(e.name is None)\n', 'entered\nTrue\nTrue\n');
});

test('native name fields use the shared allocation budget', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True: held.append(NameError(name=[7]))\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('attribute error native fields retain values through owned constructors and parked collection', async () => {
  await lifetime('class E(AttributeError):\n def __init__(self):\n  super().__init__(name=[7],obj=[8])\n  print("entered")\ne=E()\nprint(e.name[0],e.obj[0])\n', 'entered\n7 8\n');
});

test('attribute error native fields survive owned getter callbacks and cycles', async () => {
  await lifetime('class E(AttributeError):\n @property\n def obj(self):\n  print("entered")\n  return AttributeError.obj.__get__(self,E)\ne=E(obj=[7])\ne.name=e\nprint(e.obj[0],e.name is e)\n', 'entered\n7 True\n');
});

test('attribute error field graphs obey the shared allocation limit', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True: held.append(AttributeError(name=[7],obj=[8]))\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('composed native error fields survive generator suspension and interrupted cleanup', async () => {
  await lifetime('def work():\n try:\n  raise AttributeError("missing",name=[7],obj={})\n except AttributeError as e:\n  e.add_note("detail")\n  try: yield e\n  finally: print(e.name[0],e.__notes__[0])\ni=work()\ne=next(i)\nprint("entered")\nprint(e.obj is not None)\ni.close()\n', 'entered\nTrue\n7 detail\n');
});

test('mixed native exception MRO retains fields across owned constructor callbacks', async () => {
  await lifetime('class E(ValueError,AttributeError):\n def __init__(self):\n  super().__init__(name=[7],obj=[8])\n  print("entered")\ne=E()\nprint(e.name[0],e.obj[0])\n', 'entered\n7 8\n');
});

test('import error fields retain temporary graphs during owned constructors and interruption', async () => {
  await lifetime('class E(ImportError):\n def __init__(self):\n  super().__init__([7],name=[8],path=[9],name_from=[10])\n  print("entered")\ne=E()\nprint(e.msg[0],e.name[0],e.path[0],e.name_from[0])\n', 'entered\n7 8 9 10\n');
});

test('native import message selection preserves callbacks and cyclic field owners', async () => {
  await lifetime('class M:\n def __str__(self):\n  print("entered")\n  return "message"\ne=ModuleNotFoundError(M())\ne.name=e\ne.path=e\ne.name_from=e\nprint(str(e),e.name is e,e.path is e,e.name_from is e)\n', 'entered\nmessage True True True\n');
});

test('import error native fields share the allocation budget', async () => {
  const result = await runSourceRequest({modules: [unit('held=[]\nprint("ready")\nwhile True: held.append(ImportError(name=[7],path=[8],name_from=[9]))\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('import error string-subclass argument callbacks retain the message across interruption', async () => {
  await lifetime('class S(str):\n def __str__(self):\n  print("entered")\n  return "message"\ne=ImportError(S("native"))\nprint(str(e))\n', 'entered\nmessage\n');
});

test('StopIteration native values remain owned during subclass initialization and interruption', async () => {
  await lifetime('class E(StopIteration):\n def __init__(self):\n  super().__init__([7])\n  print("entered")\ne=E()\nBaseException.__init__(e,8)\nprint(e.value[0],e.args[0])\n', 'entered\n7 8\n');
});

test('cyclic StopIteration values survive parked collection and args replacement', async () => {
  await lifetime('class E(StopIteration): pass\ne=E()\ne.value=e\ne.args=(7,)\nprint("entered")\nprint(e.value is e,e.args[0])\n', 'entered\nTrue 7\n');
});

test('StopIteration subclass exhaustion retains the exception until its callback completes', async () => {
  await lifetime('class E(StopIteration): pass\nclass I:\n def __iter__(self): return self\n def __next__(self):\n  e=E([7])\n  print("entered")\n  raise e\nprint(next(I(),8))\n', 'entered\n8\n');
});

test('independent StopIteration values obey the shared allocation budget', async () => {
  const result = await runSourceRequest({modules: [unit('class E(StopIteration): pass\nheld=[]\nprint("ready")\nwhile True:\n e=E()\n e.value=[7]\n held.append(e)\n')],
    compileOptions: {languageProfile: corpus.profile}, options: {maxWork: 20000000}, memoryLimits: {maxBytes: 24000}});
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.error?.type, 'MemoryError'); closed(result.closed);
});

test('delegated native values retain temporary graphs through parked collection and interruption', async () => {
  await lifetime('class E(StopIteration): pass\nclass I:\n def __iter__(self): return self\n def __next__(self):\n  e=E(9)\n  e.value=[7]\n  raise e\ndef work():\n value=yield from I()\n print("entered")\n print(value[0])\ntry: next(work())\nexcept StopIteration: pass\n', 'entered\n7\n');
});

for (const item of corpus.reference_boundaries ?? []) test('safe retained reference limitation: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: {languageProfile: corpus.profile}});
  assert.equal(result.error, undefined); assert.equal(result.stdout, item.interpreter_stdout); closed(result.closed);
});

test('composed import/exhaustion cycles retain native fields through generator cleanup', async () => {
  await lifetime('class Done(StopIteration): pass\ndef work():\n e=ModuleNotFoundError([7],name=[8],path={})\n stop=Done(e)\n try: yield stop\n finally: print(e.msg[0],e.name[0],e.path is stop)\ni=work()\nstop=next(i)\nstop.value.path=stop\nprint("entered")\ni.close()\n', 'entered\n7 8 True\n');
});
