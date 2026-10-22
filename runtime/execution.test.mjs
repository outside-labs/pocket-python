import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';

const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/execution.json', import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/execution-resources.json', import.meta.url)));
const units = fixture => [{name: 'app', source: fixture.source, imports: fixture.imports || [], package: false},
  ...(fixture.modules || [])].map(unit => ({...unit, notice: 'Synthetic execution fixture notice\n'}));
const compile = fixture => compileSourceModules(units(fixture), {languageProfile: 'classes-source/1'});
const clean = session => {
  session.close(); session.close();
  for (const key of ['bytes', 'roots', 'frames', 'objects', 'external']) assert.equal(session.stats()[key], 0, key);
};

for (const fixture of corpus.cases) test('execution contract: ' + fixture.id, async () => {
  const {registry} = await compile(fixture), session = new ModuleSession(registry);
  let stdout = '', error = null;
  try {
    try { session.run({maxSteps: 50000, maxWork: 20000000}, text => { stdout += text; }); }
    catch (caught) { error = caught; }
    assert.equal(stdout, fixture.stdout);
    assert.equal(error?.name, fixture.error_type);
    const stats = session.stats();
    assert.deepEqual({steps: session.context.steps, work: session.context.work, ...stats}, baseline.cases[fixture.id]);
    if (fixture.id === 'nested-import-source-error') {
      assert.deepEqual(error.traceback.map(frame => [frame.function, frame.location.filename, frame.location.span[0]]), [
        ['<module>', 'sources/app.py', 7], ['__bool__', 'sources/app.py', 4],
        ['<module>', 'sources/helper.py', 2], ['<module>', 'sources/broken.py', 3], ['fail', 'sources/broken.py', 2]]);
    }
    if (fixture.id === 'binding-error-with-outer-operands') {
      assert.deepEqual(error.traceback.map(frame => [frame.function, frame.location.span[0]]), [['<module>', 7], ['__get__', 3]]);
    }
  } finally { clean(session); registry.close(); }
});

test('hard failures during nested binding and imported finally release all transient owners', async () => {
  const fixture = {source: 'class Flag:\n @property\n def __bool__(self):\n  import helper\n  return helper.yes\nprint([7][0]+(1 if Flag() else 2))\n', imports: ['helper'], modules: [
    {name: 'helper', source: 'print("entered")\nvalues=[]\nwhile True: values.append([1,2,3])\n', imports: [], package: false}]};
  const {registry} = await compile(fixture);
  try {
    for (const mode of ['steps', 'work', 'cancel', 'memory']) {
      let session, stdout = '', polls = 0;
      const options = {maxSteps: 100000, maxWork: 100000000};
      if (mode === 'steps') options.maxSteps = 150;
      if (mode === 'work') options.maxWork = 65000;
      if (mode === 'cancel') options.shouldCancel = () => ++polls > 18000;
      session = new ModuleSession(registry, {memoryLimits: mode === 'memory' ? {maxBytes: 40000} : {}});
      try {
        assert.throws(() => session.run(options, text => { stdout += text; }),
          error => error.code === ({steps: 'BUDGET', work: 'BUDGET', cancel: 'CANCELLED', memory: 'OOM'})[mode]);
        assert.equal(stdout, 'entered\n', mode);
        assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 1);
        assert.deepEqual(session.context.chain, []);
        assert.equal(session.context.module('helper'), null); assert.equal(session.context.module('app'), null);
      } finally { clean(session); }
    }
  } finally { registry.close(); }
});
