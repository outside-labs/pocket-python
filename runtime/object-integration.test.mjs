import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';

const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/object-integration.json', import.meta.url)));
const profile = {languageProfile: 'classes-source/1'};
const unit = item => ({name: 'app', package: false, imports: item.imports ?? [], source: item.source, notice: 'Synthetic object integration fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
for (const item of corpus.cases) test('object composition: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item), ...(item.modules ?? []).map(module => ({...module, notice: 'Synthetic object integration fixture'}))],
    compileOptions: profile, options: {maxSteps: 50000, maxWork: 20000000}});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
