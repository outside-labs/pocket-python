import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ProtocolIteratorValue} from './function-objects.mjs';
import {valueLayout} from './values.mjs';
import {completion, completionRoots} from './operations.mjs';

const unit = source => ({name:'app',source,imports:[],package:false,notice:'Synthetic iteration notice'});
const profile = {languageProfile:'classes-source/1'};
const run = (source,options={},memoryLimits=undefined) => runSourceRequest({modules:[unit(source)],compileOptions:profile,options,memoryLimits});
const closed = result => { for(const key of ['bytes','objects','roots','frames','external']) assert.equal(result.closed[key],0,key); };

test('iterator layouts and closed destinations retain sources, sentinels and defaults',()=>{
  const source={},sentinel={},fallback={},after=completion('relay',{receiver:sentinel});
  assert.deepEqual(valueLayout(new ProtocolIteratorValue('callable',source,sentinel)),{bytes:88,children:[source,sentinel,0n]});
  for(const kind of ['iter-result','indexed-result','callable-result'])
    assert.deepEqual(completionRoots(completion(kind,{receiver:source,after})),[source,sentinel]);
  assert.deepEqual(completionRoots(completion('next-default',{receiver:source,default:fallback,after})),[source,fallback,sentinel]);
  for(const kind of ['for-iter','for-next','for-exhausted']) assert.deepEqual(completionRoots(completion(kind)),[]);
});

test('iterator acquisition, body and binding errors preserve their original frames',async()=>{
  for(const slot of ['__iter__','__next__','__getitem__']){
    const source='class A:\n def '+slot+'(self'+(slot==='__getitem__'?',key':'')+'):\n  return 1//0\n'+
      (slot==='__next__'?'next(A(),7)':'for x in A(): print(x)')+'\n';
    const result=await run(source);assert.equal(result.error.type,'ZeroDivisionError');
    assert.deepEqual(result.error.traceback.map(f=>[f.function,f.location.span[0]]),[['<module>',4],[slot,3]]);closed(result);
  }
  const body=await run('class A:\n def __iter__(self): return iter([7])\nfor x in A():\n raise StopIteration("body")\n');
  assert.equal(body.error.type,'StopIteration');assert.equal(body.error.location.span[0],4);closed(body);
});

test('advancement recovery preserves the enclosing active exception and finally control',async()=>{
  const result=await run('class A:\n def __iter__(self): return self\n def __next__(self): raise StopIteration\ntry:\n raise ValueError("original")\nexcept ValueError:\n for x in A(): print("bad")\n try: raise\n except ValueError as error: print(str(error))\n finally: print("cleanup")\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'original\ncleanup\n');closed(result);
});

test('nested iterator acquisition and advancement remain bounded by Python frame limits',async()=>{
  for(const source of ['class A:\n def __iter__(self): return iter(self)\niter(A())\n',
    'class A:\n def __next__(self): return next(self)\nnext(A(),7)\n',
    'class A:\n __iter__=property(iter)\niter(A())\n',
    'class A:\n __next__=property(next)\nnext(A(),7)\n',
    'class A:\n def __getitem__(self,key): return next(iter(self))\nnext(iter(A()))\n']){
    const result=await run(source,{maxDepth:8,maxSteps:100000,maxWork:20000000});
    assert.equal(result.error.type,'RecursionError',JSON.stringify(result.error));closed(result);
  }
});

for(const slot of ['__iter__','__next__','__getitem__','__call__']) test(slot+' pending binding and body interruption release their graphs',async()=>{
  for(const binding of [false,true]){
    const invoke={__iter__:'iter(A())',__next__:'next(A(),[7])',__getitem__:'next(iter(A()),[7])',__call__:'next(iter(A(),[3]),[7])'}[slot];
    const source='class A:\n '+(binding?'@property\n ':'')+'def '+slot+'(self'+(slot==='__getitem__'&&!binding?',key':'')+'):\n  print("entered")\n  while True: pass\n'+invoke+'\n';
    for(const options of [{maxSteps:500},{maxSteps:100000,maxWork:60000}]){
      const result=await run(source,options);assert.equal(result.error.code,'BUDGET');assert.equal(result.stdout,'entered\n');closed(result);
    }
    let polls=0;const result=await run(source,{shouldCancel:()=>++polls>12000});assert.equal(result.error.code,'CANCELLED');closed(result);
  }
});

test('actual iterator callback OOM and output exhaustion close pending defaults',async()=>{
  const oom=await run('class A:\n def __next__(self):\n  print("entered")\n  held=[]\n  while True: held.append([1,2,3])\nnext(A(),[7])\n',{maxSteps:100000,maxWork:20000000},{maxBytes:32000});
  assert.equal(oom.error.code,'OOM');assert.equal(oom.stdout,'entered\n');closed(oom);
  const output=await run('class A:\n def __next__(self):\n  while True: print("1234567890")\nnext(A(),[7])\n',{maxSteps:100000,maxWork:20000000});
  assert.equal(output.error.code,'BUDGET');assert.match(output.error.message,/output/i);closed(output);
});

test('paused bindings, internal sources, sentinels and default values survive collection and close',async()=>{
  const sources=[
    'class A:\n @property\n def __iter__(self):\n  print("entered")\n  def use(): return iter([[7]])\n  return use\nfor x in A(): print(x[0])\n',
    'class A:\n @property\n def __next__(self):\n  print("entered")\n  def use(): raise StopIteration\n  return use\nprint(next(A(),[7])[0])\n',
    'class A:\n @property\n def __getitem__(self):\n  print("entered")\n  def use(key): return [7]\n  return use\nprint(next(iter(A()))[0])\n',
    'class A:\n @property\n def __call__(self):\n  print("entered")\n  def use(): return self.saved\n  return use\na=A()\na.saved=[3]\nit=iter(a,a.saved)\ndel a\nprint(next(it,[7])[0])\n'
  ];
  for(const source of sources){const {registry}=await compileSourceModules([unit(source)],profile);
    try{for(const mode of ['finish','cancel','close']){
      const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
      try{while(execution.state!=='completed'){
        const snapshot=execution.advance();if(execution.state==='paused')session.memory.collect([],{cleanup:true});
        if(output==='entered\n'&&snapshot.frames.some(f=>f.completion==='invoke')){
          reached=true;if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;
        }
      }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\n7\n');}
      finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});

test('primitive core-source traversal keeps its explicit builtin signatures',async()=>{
  const result=await runSourceRequest({modules:[unit('for x in [3,7]: print(x)\nprint(next(iter([8])))\n')]});
  assert.equal(result.stdout,'3\n7\n8\n');assert.equal(result.error,undefined);closed(result);
  for(const source of ['next(iter([]),7)\n','iter(str,7)\n']){
    const result=await runSourceRequest({modules:[unit(source)]});assert.equal(result.error.code,'UNSUPPORTED');closed(result);
  }
});
