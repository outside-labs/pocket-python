import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';
import {execute as executeValues} from './vm.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic repetition fixture'});
const run = (source, options = {}, memoryLimits, compileOptions = profile) =>
  runSourceRequest({modules: [unit(source)], compileOptions, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/repetition.json', import.meta.url)));

test('legacy bytecode-2 sequence multiplication retains its explicit refusal', () => {
  const factor = {type: 'int', value: '2'};
  for (const [create, constants] of [
    [['build-list', 0], [factor]], [['build-tuple', 0], [factor]],
    [['const', 1], [factor, {type: 'str', codepoints: [120]}]],
  ]) {
    const program = {format: 'pocket-python-bytecode', version: 2,
      constants, instructions: [create, ['const', 0], ['multiply'], ['return']]};
    assert.throws(() => executeValues(program), {code: 'UNSUPPORTED'});
  }
});

for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  for (const languageProfile of item.profiles ?? [corpus.profile]) {
    test('repetition ' + languageProfile + ': ' + item.id, async () => {
      const result = await run(item.source, {}, undefined, {languageProfile});
      assert.equal(result.stdout, item.stdout ?? '');
      if (item.error_type) assert.equal(result.error?.type, item.error_type);
      else assert.equal(result.error, undefined, JSON.stringify(result.error));
      closed(result.closed);
    });
  }
}

test('container repetition bounds output before allocation and keeps the old in-place factor quota', async () => {
  for (const source of ['[1]*1025\n', '(1,)*1025\n', 'a=[]\na*=1025\n']) {
    const result = await run(source);
    assert.equal(result.error?.code, 'BUDGET', JSON.stringify(result)); closed(result.closed);
  }
  for (const source of ['print(len([1]*1024))\n', 'print(len(1024*(1,)))\n']) {
    const result = await run(source);
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(result.stdout, '1024\n'); closed(result.closed);
  }
});

test('container repetition uses activation work and allocation budgets', async () => {
  for (const source of ['print("entered")\na=[1]*1024\n', 'print("entered")\na=(1,)*1024\n']) {
    const budget = await run(source, {maxWork: 1000});
    assert.equal(budget.error?.code, 'BUDGET'); assert.equal(budget.stdout, 'entered\n'); closed(budget.closed);
    const oom = await run(source, {maxWork: 20000000}, {maxBytes: 8000});
    assert.equal(oom.error?.code, 'OOM'); assert.equal(oom.stdout, 'entered\n'); closed(oom.closed);
  }
});

test('text repetition bounds Unicode code points before host allocation', async () => {
  const accepted = await run('a="😀"*65536\nprint(len(a),a[65535]=="😀")\n');
  assert.equal(accepted.error, undefined, JSON.stringify(accepted.error));
  assert.equal(accepted.stdout, '65536 True\n'); closed(accepted.closed);
  for (const source of ['"x"*65537\n', '65537*"😀"\n']) {
    const result = await run(source);
    assert.equal(result.error?.code, 'BUDGET'); closed(result.closed);
  }
});

test('text repetition obeys work and arena limits independently of its length quota', async () => {
  const source = 'print("entered")\na="😀"*10000\n';
  const budget = await run(source, {maxWork: 1000});
  assert.equal(budget.error?.code, 'BUDGET'); assert.equal(budget.stdout, 'entered\n'); closed(budget.closed);
  const oom = await run(source, {maxWork: 20000000}, {maxBytes: 8000});
  assert.equal(oom.error?.code, 'OOM'); assert.equal(oom.stdout, 'entered\n'); closed(oom.closed);
});

test('repetition index continuations retain original operands and the outer destination', () => {
  const sequence = {}, count = {}, outer = {}, after = completion('relay', {receiver: outer});
  for (const position of [0, 1]) {
    const args = position ? [sequence, count] : [count, sequence];
    const record = completion('arithmetic-index', {operation: 'multiply', args, position,
      order: false, nativeInplace: false, depth: 1, after});
    assert.deepEqual(completionRoots(record), [...args, outer]);
  }
});

test('temporary repetition operands survive collection and interruption in binding and index frames', async () => {
  for (const [sequence, observed] of [['[[7]]', '[1][0]'], ['([7],)', '[1][0]'], ['"😀"', '[1]=="😀"']]) {
    const source = 'class D:\n def __get__(self,obj,owner):\n  print("binding")\n  held=[2]\n  def count():\n   print("index")\n   return held[0]\n  return count\nclass I: __index__=D()\nprint(('+sequence+'*I())'+observed+')\n';
    const {registry} = await compileSourceModules([unit(source)], profile);
    try {
      for (const phase of ['binding\n', 'binding\nindex\n']) for (const mode of ['finish', 'cancel', 'close']) {
        const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
        session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
        const execution = Execution.modules(session.context);
        try {
          while (execution.state !== 'completed') {
            execution.advance(); session.memory.collect([], {cleanup: true});
            if (output === phase) {
              reached = true;
              if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
              if (mode === 'close') break;
            }
          }
          assert.ok(reached, phase);
          if (mode === 'finish') assert.equal(output, 'binding\nindex\n'+(observed.includes('==') ? 'True' : '7')+'\n');
        } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
        closed(session.stats());
      }
    } finally { registry.close(); }
  }
});

test('repetition binding, callback and invalid-result failures retain source frames', async () => {
  for (const sequence of ['[7]', '(7,)', '"x"']) for (const [definition, error, frames] of [
    [' @property\n def __index__(self):\n  raise AttributeError("binding")\n', 'AttributeError', [['<module>', 5], ['__index__', 4]]],
    [' def __index__(self):\n  raise ValueError("index")\n', 'ValueError', [['<module>', 4], ['__index__', 3]]],
    [' def __index__(self):\n  return []\n', 'TypeError', [['<module>', 4]]],
  ]) {
    const result = await run('class I:\n'+definition+sequence+'*I()\n');
    assert.equal(result.error?.type, error);
    assert.deepEqual(result.error.traceback.map(frame => [frame.function, frame.location.span[0]]), frames);
    closed(result.closed);
  }
});

test('index binding and callback loops share recursion, instruction, work and arena limits', async () => {
  for (const sequence of ['[7]', '(7,)', '"x"']) for (const binding of [false, true]) {
    for (const [body, options, memoryLimits, code] of [
      ['while True: pass', {maxSteps: 300}, undefined, 'BUDGET'],
      ['while True: pass', {maxSteps: 100000, maxWork: 10000}, undefined, 'BUDGET'],
      ['held=[]\n  while True: held.append([1,2,3])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 24000}, 'OOM'],
    ]) {
      const source = 'class I:\n '+(binding ? '@property\n ' : '')+'def __index__(self):\n  print("entered")\n  '+body+'\n'+sequence+'*I()\n';
      const result = await run(source, options, memoryLimits);
      assert.equal(result.error?.code, code, JSON.stringify(result.error));
      assert.equal(result.stdout, 'entered\n'); closed(result.closed);
    }
    const recursive = await run('class I:\n '+(binding ? '@property\n ' : '')+'def __index__(self): return len('+sequence+'*self)\n'+sequence+'*I()\n', {maxDepth: 8});
    assert.equal(recursive.error?.type, 'RecursionError'); closed(recursive.closed);
  }
});

test('native repetition descriptors expose their entries while explicit invocation retains its owner', async () => {
  for (const type of ['list', 'tuple', 'str']) {
    const result = await run('print(type('+type+'.__mul__).__name__)\n');
    assert.equal(result.stdout, 'wrapper_descriptor\n'); assert.equal(result.error, undefined); closed(result.closed);
    const invocation = await run(type+'.__mul__('+({list:'[]',tuple:'()',str:'""'}[type])+',2)\n');
    assert.equal(invocation.error?.code, 'UNSUPPORTED'); assert.match(invocation.error.message, /O90/); closed(invocation.closed);
  }
});

test('repetition copies local list mutations after index conversion, with instruction-boundary collection', async () => {
  const source = 'def repeat():\n a=[[7]]\n class I:\n  def __index__(self):\n   a[0][0]=8\n   a.append([9])\n   return 2\n b=a*I()\n return b[0][0],b[2] is a[0],b[3] is a[1],len(a)\nr=repeat()\nprint(r[0],r[1],r[2],r[3])\n';
  const {registry} = await compileSourceModules([unit(source)], profile), session = new ModuleSession(registry);
  let output = ''; session.context.begin({}, text => { output += text; });
  const execution = Execution.modules(session.context);
  try {
    while (execution.state !== 'completed') { execution.advance(); session.memory.collect([], {cleanup: true}); }
    assert.equal(output, '8 True True 2\n');
  } finally { execution.close(); session.context.finish(); session.close(); registry.close(); }
  closed(session.stats());
});
