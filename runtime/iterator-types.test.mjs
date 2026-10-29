import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';

const run = (source, options = {}) => runSourceRequest({modules: [{name: 'app', package: false, imports: [], source,
  notice: 'Synthetic iterator type fixture'}], compileOptions: {languageProfile: 'classes-source/1'}, options});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
for (const [expression, expected] of [
  ['""', 'str_ascii_iterator'], ['"abc"', 'str_ascii_iterator'], ['"\\x7f"', 'str_ascii_iterator'],
  ['"é"', 'str_iterator'], ['"😀"', 'str_iterator'], ['range(2)', 'range_iterator'],
  ['range(10**40,10**40+2)', 'longrange_iterator'], ['range(-10**40,-10**40+2)', 'longrange_iterator'],
  ['range(10**40,10**40)', 'longrange_iterator'], ['range(1,5,10**40)', 'longrange_iterator'],
  ['range(-2**63,2**63-1)', 'longrange_iterator'], ['range(2**63-3,2**63-1,2)', 'longrange_iterator'],
  ['range(-2**63+2,-2**63,-2)', 'longrange_iterator'], ['range(2**63-2,2**63-1)', 'range_iterator'],
]) test('canonical iterator type: '+expression, async () => {
  const result = await run('it=iter('+expression+')\na=type(it)\nprint(a.__name__,it.__class__ is a)\nnext(it,None)\nprint(type(it) is a)\n');
  assert.equal(result.stdout, expected+' True\nTrue\n', JSON.stringify(result.error));
  assert.equal(result.ok, true); closed(result.closed);
});

test('ASCII identity scanning shares the work budget without consuming the iterator', async () => {
  const result = await run('it=iter("x"*1000)\nprint(next(it))\nwhile True: type(it)\n', {maxSteps: 100000, maxWork: 50000});
  assert.equal(result.error?.code, 'BUDGET'); assert.equal(result.stdout, 'x\n'); closed(result.closed);
});
