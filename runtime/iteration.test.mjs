import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ProtocolIteratorValue} from './function-objects.mjs';
import {valueLayout} from './values.mjs';
import {completion, completionRoots, containsTask, operationRoots} from './operations.mjs';

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

test('list extension refuses deferred iterables before hook binding or consumption',async()=>{
  const prefixes=[
    'class A:\n def __iter__(self):\n  print("called")\n  return iter([7])\n',
    'class Base:\n @property\n def __iter__(self):\n  print("bound")\n  return str\nclass A(Base): pass\n',
    'class A:\n @property\n def __getitem__(self):\n  print("bound")\n  return str\n',
    'def supply():\n print("called")\n return 1\n'
  ];
  for(let i=0;i<prefixes.length;i++){
    const result=await run(prefixes[i]+'a=[3]\na+='+ (i===3?'iter(supply,1)':'A()')+'\n');
    assert.equal(result.error.code,'UNSUPPORTED');assert.equal(result.stdout,'');closed(result);
  }
  for(const declaration of ['class A: pass\n',
    'class A:\n __iter__=None\n @property\n def __getitem__(self):\n  print("bad")\n  return str\n']){
    const result=await run(declaration+'a=[3]\ntry: a+=A()\nexcept TypeError: print(a[0],len(a))\n');
    assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'3 1\n');closed(result);
  }
});

test('membership records retain the original key, iterator and outer destination',()=>{
  const receiver={},key={},after=completion('relay',{receiver:key});
  for(const kind of ['contains-result','search-iter','search-next'])
    assert.deepEqual(completionRoots(completion(kind,{receiver,key,after,depth:0})),[receiver,key,key]);
  assert.deepEqual(operationRoots(containsTask(receiver,key,null,after)),[receiver,key,key]);
  assert.throws(()=>containsTask(receiver,key,null,null,0,'search'),TypeError);
  assert.throws(()=>completion('search-next',{receiver,key,depth:-1}),TypeError);
});

test('membership stops at the first match and propagates contains/truth callback frames',async()=>{
  const early=await run('class A:\n def __iter__(self): return self\n def __next__(self):\n  self.i+=1\n  if self.i>1: raise ValueError("late")\n  return 7\na=A()\na.i=0\nprint(7 in a,a.i)\n');
  assert.equal(early.error,undefined,JSON.stringify(early.error));assert.equal(early.stdout,'True 1\n');closed(early);
  const error=await run('class R:\n def __bool__(self):\n  return 1//0\nclass A:\n def __contains__(self,key): return R()\nprint(7 in A())\n');
  assert.equal(error.error.type,'ZeroDivisionError');
  assert.deepEqual(error.error.traceback.map(f=>[f.function,f.location.span[0]]),[['<module>',6],['__bool__',3]]);closed(error);
  const stop=await run('class R:\n def __bool__(self): raise StopIteration("truth")\nclass A:\n def __contains__(self,key): return R()\nprint(7 in A())\n');
  assert.equal(stop.error.type,'StopIteration');closed(stop);
});

test('native iterator search releases compared values before continuing',async()=>{
  const result=await run('class A:\n def __iter__(self): return iter("'+'a'.repeat(1200)+'")\nprint("z" in A())\n',{maxWork:20000000},{maxBytes:32000});
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'False\n');closed(result);
});

test('nonterminating membership and recursive descriptors remain bounded',async()=>{
  const source='class A:\n def __getitem__(self,key): return key\nprint(-1 in A())\n';
  const budget=await run(source,{maxSteps:500});assert.equal(budget.error.code,'BUDGET');closed(budget);
  let polls=0;const cancel=await run(source,{shouldCancel:()=>++polls>12000});assert.equal(cancel.error.code,'CANCELLED');closed(cancel);
  const recursive=await run('class A:\n def __contains__(self,key): return key in self\nprint(7 in A())\n',{maxDepth:8});
  assert.equal(recursive.error.type,'RecursionError');closed(recursive);
});

test('paused membership binding, result truth and search callbacks retain temporary keys',async()=>{
  const sources=[
    'class A:\n @property\n def __contains__(self):\n  print("entered")\n  def use(key): return key[0]==7\n  return use\nprint([7] in A())\n',
    'class R:\n @property\n def __bool__(self):\n  print("entered")\n  def use(): return self.saved[0]==7\n  return use\nclass A:\n def __contains__(self,key):\n  r=R()\n  r.saved=key\n  return r\nprint([7] in A())\n',
    'class A:\n @property\n def __iter__(self):\n  print("entered")\n  def use(): return iter([[7]])\n  return use\nprint([7] in A())\n',
    'class A:\n def __iter__(self): return self\n @property\n def __next__(self):\n  print("entered")\n  def use(): return [7]\n  return use\nprint([7] in A())\n'
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
      }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\nTrue\n');}
      finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});

test('contains callback OOM and endless truth callbacks release pending operands',async()=>{
  const oom=await run('class A:\n def __contains__(self,key):\n  print("entered")\n  held=[]\n  while True: held.append([1,2,3])\nprint([7] in A())\n',{maxSteps:100000,maxWork:20000000},{maxBytes:32000});
  assert.equal(oom.error.code,'OOM');assert.equal(oom.stdout,'entered\n');closed(oom);
  const truth=await run('class R:\n def __bool__(self):\n  while True: pass\nclass A:\n def __contains__(self,key): return R()\nprint(7 in A())\n',{maxSteps:500});
  assert.equal(truth.error.code,'BUDGET');closed(truth);
});

test('reentrant callable exhaustion retains active closures while discarding the outer result',async()=>{
  const source='class Supply:\n @property\n def __call__(self):\n  def invoke():\n   if self.inner:\n    print("entered")\n    raise StopIteration\n   self.inner=True\n   print(next(it,[3])[0])\n   return [7]\n  return invoke\nsupply=Supply()\nsupply.inner=False\nit=iter(supply,[9])\ndel supply\nprint(next(it,[5])[0],next(it,[6])[0])\n';
  const {registry}=await compileSourceModules([unit(source)],profile);
  try{for(const mode of ['finish','cancel','close']){
    const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
    session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
    try{while(execution.state!=='completed'){
      execution.advance();if(execution.state==='paused')session.memory.collect([],{cleanup:true});
      if(output==='entered\n'){
        reached=true;if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;
      }
    }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\n3\n5 6\n');}
    finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
  }}finally{registry.close();}
});
