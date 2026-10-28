import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
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
