import assert from 'node:assert/strict';
import {runSourceRequest} from '../runtime/source-request.mjs';

for (const [languageProfile, source] of [
  ['core-source/1', 'print(6 * 7)\n'],
  ['classes-source/1', 'class Answer:\n def value(self): return 42\nprint(Answer().value())\n'],
]) {
  const result = await runSourceRequest({
    modules: [{name: 'app', source, package: false, imports: [], notice: 'Synthetic startup fixture'}],
    compileOptions: {languageProfile},
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.stdout, '42\n');
  console.log(`${languageProfile} source startup passed`);
}
