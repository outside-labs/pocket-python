import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {MethodWrapperValue} from './function-objects.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic wrapper metadata fixture'});
const closed = stats => { for (const key of ['bytes','objects','roots','frames','external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/wrapper-metadata.json', import.meta.url)));
for (const item of corpus.cases) test('wrapper metadata: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [unit(item.source)], compileOptions: profile});
  assert.equal(result.stdout, item.stdout, JSON.stringify(result.error));
  assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});
test('wrapper dictionaries reject foreign owners atomically', () => {
  const memory = new MemoryArena(), other = new MemoryArena(), roots = [], others = [];
  const leave = memory.enter(() => roots), leaveOther = other.enter(() => others);
  try {
    const classes = new ClassRuntime({memory}), foreign = new ClassRuntime({memory: other});
    const wrapper = classes.make(MethodWrapperValue, 'staticmethod', null); roots.push(wrapper);
    const dictionary = classes.get(wrapper, '__dict__'); roots.push(dictionary);
    const invalid = foreign.values.dict([]); others.push(invalid);
    assert.throws(() => classes.write(wrapper, '__dict__', invalid), {code: 'STALE_HANDLE'});
    assert.equal(classes.get(wrapper, '__dict__'), dictionary);
  } finally { leave(); memory.close(); leaveOther(); other.close(); }
  closed(memory.stats()); closed(other.stats());
});
test('metadata lookup and cyclic dictionaries survive parked collection, cancellation and close', async () => {
  const source = 'class C:\n def __getattribute__(self,name):\n  print(name)\n  return [self]\nw=staticmethod(C())\nw.self=w\nprint(w.__doc__[0] is w.__wrapped__,w.self is w)\n';
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish','cancel','close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (output === '__module__\n') {
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code:'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      if (mode === 'finish') assert.equal(output, '__module__\n__name__\n__qualname__\n__doc__\nTrue True\n');
    } finally { execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
});
