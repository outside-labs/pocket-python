import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic native callable directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-callable-directories.json', import.meta.url)));
for (const item of corpus.cases) test('native callable directory: ' + item.id, async () => {
  const result = await run(item.source);
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

async function lifecycle(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
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


for (const member of ['getter', '__get__']) test(member + ' callers retain detached cyclic native receiver chains', async () => {
  await lifecycle('def f(self): return 7\np=property(f)\nmethod=p.' + member + '\nf.saved=method\nd=method.__dir__\ndel p\ndel method\ndel f\nprint("entered")\nprint(len(d()),d.__self__.__self__.fget(None),d.__self__.__self__.fget.saved is d.__self__)\n', 'entered\n30 7 True\n');
});

test('native callers retain detached cyclic live namespace views', async () => {
  await lifecycle('class C: tag=[7]\np=C.__dict__\nmethod=p.get\nC.saved=method\nd=method.__dir__\ndel p\ndel C\ndel method\nprint("entered")\nprint(len(d()),d.__self__("tag")[0],d.__self__("saved") is d.__self__)\n', 'entered\n30 7 True\n');
});

test('nested native directory callers retain their original descriptor', async () => {
  await lifecycle('original=object.__dir__\nfirst=original.__dir__\nd=first.__dir__\ndel first\ndel original\nprint("entered")\nprint(len(d()),d.__self__.__self__ is object.__dir__)\n', 'entered\n30 True\n');
});

for (const expression of ['object.__dir__', 'property.__get__', 'property().getter', 'property().__get__'])
  test(expression + ' directories obey real instruction, work and allocation limits', async () => {
    for (const [options, limits, expected] of [
      [{maxSteps: 300}, undefined, 'BUDGET'],
      [{maxSteps: 100000, maxWork: 30000}, undefined, 'BUDGET'],
      [{maxSteps: 100000, maxWork: 20000000}, {maxBytes: 15000}, 'OOM'],
    ]) {
      const result = await run('d=' + expression + '\nprint("entered")\nwhile True: names=dir(d)\n', options, limits);
      assert.equal(result.error?.code, expected, JSON.stringify(result.error));
      assert.equal(result.stdout, 'entered\n'); closed(result.closed);
    }
  });

test('native callable metadata reports absent dictionary storage', async () => {
  for (const source of ['d=property.getter\nobject.__getattribute__(d,"__dict__")\n']) {
    const result = await run(source);
    assert.equal(result.error?.type, 'AttributeError'); closed(result.closed);
  }
});
