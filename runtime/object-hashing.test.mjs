import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic hash fixture'});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/object-hashing.json', import.meta.url)));

for (const fixture of corpus.cases.filter(c => corpus.implemented_stages.includes(c.stage)))
  test('object hash source: ' + fixture.id, async () => {
    const result = await runSourceRequest({modules: [unit(fixture.source)], compileOptions: profile});
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.error?.type, fixture.error_type, JSON.stringify(result.error));
    closed(result.closed);
  });

test('method dictionary keys retain temporary receivers through collection and unwind', async () => {
  const source = 'class A:\n def use(self): return self.value[0]\na=A()\na.value=[7]\nf=a.use\nd={f:[8]}\ndel a\nprint("entered")\nprint(f(),d[f][0])\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (output !== 'entered\n') execution.advance();
      session.memory.collect([], {cleanup: true});
      if (mode === 'finish') { execution.drain(); assert.equal(output, 'entered\n7 8\n'); }
      if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); }
    } finally { execution.close(); session.context.finish(); session.close(); closed(session.stats()); }
  } } finally { registry.close(); }
});
