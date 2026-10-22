import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
import {completion, completionRoots, itemTask, sliceTask, operationRoots} from './operations.mjs';

const unit = source => ({name: 'app', source, imports: [], package: false, notice: 'Synthetic indexing notice'});
const profile = {languageProfile: 'classes-source/1'};
const run = (source, options = {}, memoryLimits = undefined) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options, memoryLimits});
const closed = result => { for (const key of ['bytes','objects','roots','frames','external']) assert.equal(result.closed[key], 0); };

test('slice layout and closed continuation visitors retain all converted and pending operands', () => {
  const values = new ValueRuntime(), receiver = {}, key = {}, stop = {}, step = {}, after = completion('relay', {receiver: key});
  const slice = values.sliceKey(key, stop, step);
  assert.deepEqual(valueLayout(slice), {bytes: 88, children: [key, stop, step]}); assert.ok(Object.isFrozen(slice));
  assert.deepEqual(operationRoots(itemTask(receiver, slice, null, after)), [receiver, slice, key]);
  assert.deepEqual(operationRoots(sliceTask(receiver, [key, stop, step], null, after)), [receiver,key,stop,step,key]);
  assert.deepEqual(completionRoots(completion('index-result', {receiver, after})), [receiver,key]);
  assert.deepEqual(completionRoots(completion('index-key', {receiver,key,after,depth:1})), [receiver,key,key]);
  assert.deepEqual(completionRoots(completion('slice-index', {receiver,parts:[key,stop,step],position:1,after,depth:1})), [receiver,key,stop,step,key]);
  assert.throws(() => completion('slice-index', {receiver,parts:[],position:1,depth:0}), TypeError);
  assert.throws(() => sliceTask(receiver, [], null), TypeError);
  assert.throws(() => itemTask(receiver,key,null,null,257), TypeError);
});

test('conversion callback and strict-result errors preserve the original source frame', async () => {
  const body = await run('class K:\n def __index__(self):\n  return 1//0\nprint([7][K()])\n');
  assert.equal(body.error.type, 'ZeroDivisionError');
  assert.deepEqual(body.error.traceback.map(f=>[f.function,f.location.span[0]]), [['<module>',4],['__index__',3]]); closed(body);
  const invalid = await run('class K:\n def __index__(self): return self\nprint([7][K()])\n');
  assert.equal(invalid.error.type, 'TypeError');
  assert.deepEqual(invalid.error.traceback.map(f=>[f.function,f.location.span[0]]), [['<module>',3]]); closed(invalid);
});

test('item callback frames compose with enclosing exception and finally control', async () => {
  const result = await run('class A:\n def __getitem__(self,key): raise\ntry:\n raise ValueError("original")\nexcept ValueError:\n try: A()[0]\n except ValueError as error: print(str(error))\n finally: print("cleanup")\n');
  assert.equal(result.error, undefined, JSON.stringify(result.error)); assert.equal(result.stdout, 'original\ncleanup\n'); closed(result);
});

test('native index binding and recursive item callbacks remain depth-bounded', async () => {
  for (const source of ['class A:\n __index__=property(len)\n def __len__(self): return self\n[7][A()]\n',
    'class A:\n def __getitem__(self,key): return self[key]\nA()[0]\n']) {
    const result = await run(source, {maxDepth:8,maxSteps:100000,maxWork:20000000});
    assert.equal(result.error.type, 'RecursionError', JSON.stringify(result.error)); closed(result);
  }
});

for (const slot of ['__index__','__getitem__']) test(slot+' binding/body interruption releases pending operands', async () => {
  const invocation = slot === '__index__' ? '[7][A()]' : 'A()[0]';
  for (const binding of [true,false]) {
    const source = 'class A:\n '+(binding?'@property\n ':'')+'def '+slot+'(self'+(slot==='__getitem__'&&!binding?',key':'')+'):\n  print("entered")\n  while True: pass\n'+invocation+'\n';
    for (const options of [{maxSteps:500},{maxSteps:100000,maxWork:60000}]) {
      const result = await run(source, options); assert.equal(result.error.code, 'BUDGET'); assert.equal(result.stdout, 'entered\n'); closed(result);
    }
    let polls=0;
    const cancelled=await run(source,{shouldCancel:()=>++polls>12000}); assert.equal(cancelled.error.code,'CANCELLED'); closed(cancelled);
  }
});

test('actual callback allocation failure and output limits clean up the conversion graph', async () => {
  const oom = await run('class K:\n def __index__(self):\n  print("entered")\n  held=[]\n  while True: held.append([1,2,3])\n[7][K()]\n',{maxSteps:100000,maxWork:20000000},{maxBytes:32000});
  assert.equal(oom.error.code,'OOM'); assert.equal(oom.stdout,'entered\n'); closed(oom);
  const output=await run('class A:\n def __getitem__(self,key):\n  while True: print("1234567890")\nA()[0]\n',{maxSteps:100000,maxWork:20000000});
  assert.equal(output.error.code,'BUDGET'); assert.match(output.error.message,/output/i); closed(output);
});

test('paused index bindings and raw slice fields survive collection, cancellation and close', async () => {
  const sources = [
    'class K:\n @property\n def __index__(self):\n  print("entered")\n  held=[1]\n  def use(): return held[0]\n  return use\nprint([0,7,8][K():][0])\n',
    'class A:\n @property\n def __getitem__(self):\n  print("entered")\n  def use(key): return key.start[0]+key.stop[0]\n  return use\nprint(A()[[3]:[4]])\n'
  ];
  for (const source of sources) {
    const {registry} = await compileSourceModules([unit(source)],profile);
    try { for (const mode of ['finish','cancel','close']) {
      const session=new ModuleSession(registry); let output='',cancel=false,pauses=0,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});
      const execution=Execution.modules(session.context);
      try {
        while(execution.state!=='completed') {
          const snapshot=execution.advance();
          if(execution.state==='paused'){session.memory.collect([], {cleanup:true});pauses++;}
          if(snapshot.frames.some(f=>f.completion==='invoke')&&output==='entered\n') {
            reached=true;
            if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
            if(mode==='close')break;
          }
        }
        assert.ok(reached);assert.ok(pauses>10);
        if(mode==='finish')assert.equal(output,'entered\n7\n');
      } finally {execution.close();execution.close();session.context.finish();session.close();}
      closed({closed:session.stats()});
    }} finally {registry.close();}
  }
});

test('default source profile keeps class and slice-constructor admission explicit', async () => {
  const core=await runSourceRequest({modules:[unit('print("A😀"[::-1])\n')]});
  assert.equal(core.stdout,'😀A\n'); closed(core);
  const refused=await runSourceRequest({modules:[unit('slice(7)\n')]}); assert.equal(refused.error.type,'NameError'); closed(refused);
  const future=await run('print("never")\nclass A:\n def __add__(self,other): return 7\n'); assert.equal(future.error.code,'UNSUPPORTED'); assert.equal(future.stdout,'');
});
