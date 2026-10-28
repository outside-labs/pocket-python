import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic native descriptor fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = stats => {
  for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key);
};
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-descriptors.json', import.meta.url)));
for (const item of corpus.cases.filter(item => corpus.implemented_stages.includes(item.stage))) {
  test('native descriptor: ' + item.id, async () => {
    const result = await run(item.source);
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
    if (item.error_frames) assert.deepEqual(result.error.traceback.map(frame => ({function: frame.function, line: frame.location.span[0]})), item.error_frames);
    closed(result.closed);
  });
}

async function lifecycle(source, expected, phases) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const phase of phases) for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance();
        if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (output === phase) {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached, phase);
      if (mode === 'finish') assert.equal(output, expected);
    } finally { execution.close(); execution.close(); session.context.finish(); session.close(); }
    closed(session.stats());
  } } finally { registry.close(); }
}

for (const method of ['__get__', '__set__', '__delete__']) {
  const setting = method === '__set__', reading = method === '__get__';
  const fields = reading ? 'callback' : setting ? 'None,callback' : 'None,None,callback';
  const args = setting ? '[7],[8]' : '[7]';
  test('native property '+method+' retains detached method/accessors and arguments through parked collection and interruption', async () => {
    const source = 'def factory():\n captured=[9]\n def callback(obj'+(setting?',value':'')+'):\n  print("entered")\n  print(captured[0],obj[0]'+(setting?',value[0]':'')+')\n  return captured\n return property('+fields+').'+method+'\nm=factory()\nr=m('+args+')\nprint("done"'+(reading?',r[0]':',r is None')+')\n';
    await lifecycle(source, 'entered\n9 7'+(setting?' 8':'')+'\ndone '+(reading?'9':'True')+'\n', ['entered\n']);
  });
  test('native property '+method+' shares recursion, instruction, work and actual allocation budgets', async () => {
    const wrap = body => 'def callback(obj'+(setting?',value':'')+'):\n print("entered")\n '+body+'\np=property('+fields+')\np.'+method+'('+args+')\n';
    for (const [body, options, limits, code] of [
      ['return p.'+method+'('+args+')', {maxDepth: 12}, undefined, 'PYTHON'],
      ['while True: pass', {maxSteps: 350}, undefined, 'BUDGET'],
      ['while True: pass', {maxSteps: 100000, maxWork: 35000}, undefined, 'BUDGET'],
      ['held=[]\n while True: held.append([7])', {maxSteps: 100000, maxWork: 20000000}, {maxBytes: 28000}, 'OOM'],
    ]) {
      const result = await run(wrap(body), options, limits);
      assert.equal(result.error?.code, code, JSON.stringify(result));
      if (code === 'PYTHON') assert.equal(result.error.type, 'RecursionError');
      assert.ok(result.stdout.includes('entered\n'), JSON.stringify(result.error)); closed(result.closed);
    }
  });
}

test('explicit native property source retains core admission', async () => {
  const result = await runSourceRequest({modules: [unit('print("never")\nclass A: pass\np=property(lambda obj: obj)\np.__get__(A())\n')]});
  assert.equal(result.error?.code, 'UNSUPPORTED'); assert.equal(result.stdout, ''); assert.equal(result.stats, null);
});

for (const kind of ['staticmethod', 'classmethod']) {
  test(kind+' native binding retains the detached wrapper, closure and explicit owner through parked collection and interruption', async () => {
    const source = 'def factory():\n captured=[9]\n def callback(*args):\n  print("entered")\n  print(captured[0],len(args)'+(kind === 'classmethod' ? ',args[0][0]' : '')+')\n  return captured\n return '+kind+'(callback).__get__\nbind=factory()\nmethod=bind(None,[7])\ndel bind\nr=method()\nprint(r[0])\n';
    await lifecycle(source, 'entered\n9 '+(kind === 'classmethod' ? '1 7' : '0')+'\n9\n', ['entered\n']);
  });
}
