import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic wrapper and super directory fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/wrapper-super-directories.json', import.meta.url)));
for (const item of corpus.cases) test('wrapper and super directory: ' + item.id, async () => {
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
    } finally {
      const before = output;
      execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before, 'teardown must not run directory or contained callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

test('detached wrapper directories retain cyclic dictionaries and callable owners', async () => {
 await lifecycle('w=staticmethod(lambda:7)\nw.saved=w\nd=object.__dir__.__get__(w)\ndel w\nprint("entered")\nprint("saved" in d(),d.__self__.saved is d.__self__)\n', 'entered\nTrue True\n');
});
test('detached super directories retain receiver and hierarchy across collection', async () => {
 await lifecycle('class A: pass\nclass B(A): pass\nb=B()\nb.saved=b\ns=super(B,b)\nd=object.__dir__.__get__(s)\ndel b\ndel s\ndel A\ndel B\nprint("entered")\nprint("saved" in d(),d.__self__.__self__.saved is d.__self__.__self__)\n', 'entered\nTrue True\n');
});
test('super dictionary callbacks survive parking cancellation and close', async () => {
 await lifecycle('class A:\n @property\n def __dict__(self):\n  print("entered")\n  return {"virtual":7}\nclass B(A): pass\ns=super(B,B())\nprint("virtual" in dir(s))\n', 'entered\nTrue\n');
});
for (const operation of ['dir(w)','object.__dir__(w)','dir(s)']) test(operation+' shares real limits', async () => {
 for (const [options, limits, expected] of [[{maxSteps:300},undefined,'BUDGET'],[{maxSteps:100000,maxWork:30000},undefined,'BUDGET'],[{maxSteps:100000,maxWork:20000000},{maxBytes:20000},'OOM']]) {
  const result=await run('class A: pass\nw=staticmethod(lambda:7)\ns=super(A)\nprint("entered")\nwhile True: names='+operation+'\n',options,limits);
  assert.equal(result.error?.code,expected,JSON.stringify(result.error));assert.equal(result.stdout,'entered\n');closed(result.closed);
 }
});
