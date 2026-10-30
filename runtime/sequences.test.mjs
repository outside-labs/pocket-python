import test from 'node:test';
import assert from 'node:assert/strict';
import {ValueRuntime, valueLayout} from './values.mjs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots, consumeTask, operationRoots} from './operations.mjs';

const profile={languageProfile:'classes-source/1'};
const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic sequence notice'});
const run=(source,options={},memoryLimits)=>runSourceRequest({modules:[unit(source)],compileOptions:profile,options,memoryLimits});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('huge ranges retain four integer parameters instead of materialized items',()=>{
  const values=new ValueRuntime({numeric:true}),range=values.range([10n**100n]);
  assert.equal(valueLayout(range).bytes,112);
  assert.equal(valueLayout(range).children.length,4);
  assert.equal(values.index(range,-1n),10n**100n-1n);
  assert.equal(values.truth(range),true);
  assert.throws(()=>values.unary('len',range),{name:'OverflowError'});
  const tail=values.slice(range,-3n,null,null);
  assert.equal(values.unary('len',tail),3n);
  assert.equal(values.index(tail,0n),10n**100n-3n);
  assert.equal(values.equal(values.range([1n,2n,9n]),values.range([1n,3n,8n])),true);
});

test('range slicing matches ordinary sequence slicing over small signed grids',()=>{
  const values=new ValueRuntime({numeric:true});
  for(const stride of [-3n,-1n,1n,3n])for(const end of [-5n,0n,6n]){
    const range=values.range([2n,end,stride]),items=[];
    for(let n=2n;stride>0n?n<end:n>end;n+=stride)items.push(n);
    const tuple=values.tuple(items);
    for(const start of [null,-8n,-1n,0n,3n,8n])for(const stop of [null,-8n,-1n,0n,3n,8n])for(const step of [-3n,-1n,1n,3n]){
      const sliced=values.slice(range,start,stop,step),expected=values.slice(tuple,start,stop,step);
      assert.equal(values.unary('len',sliced),values.unary('len',expected));
      const it=values.iterator(sliced);
      for(const item of expected.items)assert.equal(values.next(it),item);
      assert.throws(()=>values.next(it),{name:'StopIteration'});
    }
  }
});

test('range membership preserves integer and real/complex equality',async()=>{
  const result=await run('print(2.0 in range(4),2.5 in range(4),complex(2,0) in range(4),complex(2,1) in range(4))\n'+
    'class K:\n def __eq__(self,other):\n  print(other)\n  return other==2\nprint(K() in range(4))\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));
  assert.equal(result.stdout,'True False True False\n0\n1\n2\nTrue\n');closed(result);
});

test('invalid range arguments stop conversion before a later callback',async()=>{
  const result=await run('class I:\n def __index__(self):\n  print("bad")\n  return 3\nrange(1.5,I())\n');
  assert.equal(result.error.type,'TypeError');assert.equal(result.stdout,'');closed(result);
  const attrs=await run('r=range(3)\nr.start=1\n');
  assert.equal(attrs.error.type,'AttributeError');closed(attrs);
});

test('range index continuations survive pauses, collection, cancellation and close',async()=>{
  const source='class I:\n @property\n def __index__(self):\n  print("entered")\n  def use(): return 3\n  return use\nr=range(I(),I(),I())\nprint(len(r))\n';
  const {registry}=await compileSourceModules([unit(source)],profile);
  try{for(const mode of ['finish','cancel','close']){
    const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
    session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});
    const execution=Execution.modules(session.context);
    try{while(execution.state!=='completed'){
      const snapshot=execution.advance();if(execution.state==='paused')session.memory.collect([],{cleanup:true});
      if(output==='entered\n'&&snapshot.frames.some(frame=>frame.completion==='invoke')){
        reached=true;
        if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
        if(mode==='close')break;
      }
    }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\nentered\nentered\n0\n');}
    finally{execution.close();execution.close();session.context.finish();session.close();}
    closed({closed:session.stats()});
  }}finally{registry.close();}
});

test('range iteration and slicing remain rooted at every instruction boundary',async()=>{
  const source='r=range(10**100,10**100+9,2)\ns=r[::-1]\nit=iter(s)\ndel r\ndel s\nprint(next(it)==10**100+8,next(it)==10**100+6)\n';
  const {registry}=await compileSourceModules([unit(source)],profile),session=new ModuleSession(registry);let output='';
  session.context.begin({},text=>{output+=text;});const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();session.memory.collect([],{cleanup:true});}
    assert.equal(output,'True True\n');}
  finally{execution.close();session.context.finish();session.close();registry.close();}closed({closed:session.stats()});
});

test('range work, allocation and cancellation failures release owned values',async()=>{
  const budget=await run('for x in range(10**100): pass\n',{maxSteps:500});
  assert.equal(budget.error.code,'BUDGET');closed(budget);
  let polls=0;const cancel=await run('for x in range(10**100): pass\n',{shouldCancel:()=>++polls>10000});
  assert.equal(cancel.error.code,'CANCELLED');closed(cancel);
  const oom=await run('held=[]\nwhile True: held.append(range(10**100))\n',{maxSteps:100000,maxWork:20000000},{maxBytes:16000});
  assert.equal(oom.error.code,'OOM');closed(oom);
  for(const source of ['hash(range(3))\n','repr(range(3))\n','range(3).count(1)\n']){
    const result=await run(source);assert.equal(result.error.code,'UNSUPPORTED');closed(result);
  }
});

test('primitive constructors preserve aliases, iterator state and empty/fresh containers',async()=>{
  const result=await run('saved=[7]\na=[saved]\nb=list(a)\nt=tuple(a)\nprint(b is a,b[0] is saved,t[0] is saved,tuple(t) is t)\n'+
    'a.append(9)\nsaved.append(3)\nprint(len(b),len(b[0]),len(list()),len(tuple()))\nit=iter(range(2,5))\nprint(next(it),list(it)[-1],len(tuple(it)))\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));
  assert.equal(result.stdout,'False True True True\n1 2 0 0\n2 4 0\n');closed(result);
});

test('constructor limits and huge range hints fail without leaking partial containers',async()=>{
  for(const source of ['list(range(1025))\n','tuple("'+'x'.repeat(1025)+'")\n']){
    const result=await run(source);assert.equal(result.error.code,'BUDGET');closed(result);
  }
  for(const source of ['list(range(10**100))\n','tuple(iter(range(10**100)))\n']){
    const result=await run(source);assert.equal(result.error.type,'OverflowError');closed(result);
  }
  const oom=await run('a=list("'+'x'.repeat(800)+'")\n',{maxWork:20000000},{maxBytes:16000});
  assert.equal(oom.error.code,'OOM');closed(oom);
});

test('primitive construction polls cancellation within one builtin call',async()=>{
  let entered=false,polls=0;
  const {registry}=await compileSourceModules([unit('print("entered")\nlist("'+'x'.repeat(1000)+'")\n')],profile);
  const session=new ModuleSession(registry);
  try{assert.throws(()=>session.run({shouldCancel:()=>entered&&++polls>100},()=>{entered=true;}),{code:'CANCELLED'});}
  finally{session.close();registry.close();}assert.ok(entered);closed({closed:session.stats()});
});

test('primitive results survive collection after construction and iterator exhaustion',async()=>{
  const source='a=list("A🚀")\nb=tuple(a)\nc=list(iter(b))\ndel a\ndel b\nprint(c[0],c[1],len(c))\n';
  const {registry}=await compileSourceModules([unit(source)],profile),session=new ModuleSession(registry);let output='';
  session.context.begin({},text=>{output+=text;});const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();session.memory.collect([],{cleanup:true});}
    assert.equal(output,'A 🚀 2\n');}
  finally{execution.close();session.context.finish();session.close();registry.close();}closed({closed:session.stats()});
});

test('owned consumers retain partial results and outer destinations in every phase',()=>{
  const receiver={},result={},outer={},after=completion('relay',{receiver:outer});
  for(const kind of ['consume-iter','consume-next','consume-truth'])
    assert.deepEqual(completionRoots(completion(kind,{name:'list',receiver,result,after,depth:0})),[receiver,result,outer]);
  assert.deepEqual(operationRoots(consumeTask('all',receiver,null,after)),[receiver,outer]);
  assert.throws(()=>consumeTask('sorted',receiver,null),TypeError);
  assert.throws(()=>completion('consume-next',{name:'list',receiver,result,depth:-1}),TypeError);
});

test('construction refuses user length hints before binding or consuming source hooks',async()=>{
  for(const name of ['list','tuple'])for(const slot of ['__len__','__length_hint__']){
    const result=await run('class A:\n @property\n def __iter__(self):\n  print("bad iter")\n  return str\n @property\n def '+slot+'(self):\n  print("bad hint")\n  return str\n'+name+'(A())\n');
    assert.equal(result.error.code,'UNSUPPORTED');assert.equal(result.stdout,'');
    if(result.closed)closed(result);else{assert.equal(result.error.phase,'bind');assert.equal(result.stats,null);}
  }
  const predicates=await run('class A:\n def __iter__(self): return iter([1])\n def __len__(self):\n  print("bad hint")\n  return 1\nprint(all(A()),any(A()))\n');
  assert.equal(predicates.error,undefined,JSON.stringify(predicates.error));assert.equal(predicates.stdout,'True True\n');closed(predicates);
});

test('short circuit, sentinel iteration and callback errors keep distinct boundaries',async()=>{
  const source='class A:\n def __iter__(self): return self\n def __next__(self):\n  self.n+=1\n  if self.n>1: raise ValueError("late")\n  return self.item\na=A()\na.n=0\na.item=0\nprint(all(a),a.n)\na.n=0\na.item=7\nprint(any(a),a.n)\n'+
    'def supply():\n saved[0]+=1\n return saved[0]\nsaved=[0]\na=tuple(iter(supply,4))\nprint(len(a),a[-1])\n';
  const result=await run(source);assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'False 1\nTrue 1\n3 3\n');closed(result);
  for(const name of ['all','any']){
    const truth=await run('class V:\n def __bool__(self): raise StopIteration("truth")\n'+name+'([V()])\n');
    assert.equal(truth.error.type,'StopIteration');assert.equal(truth.error.traceback.at(-1).function,'__bool__');closed(truth);
    const acquire=await run('class A:\n def __iter__(self): raise StopIteration("acquire")\n'+name+'(A())\n');
    assert.equal(acquire.error.type,'StopIteration');closed(acquire);
  }
});

test('long consumers release prior transient elements under a small arena budget',async()=>{
  const result=await run('class A:\n def __iter__(self): return self\n def __next__(self):\n  self.n+=1\n  if self.n>3000: raise StopIteration\n  return [1]\na=A()\na.n=0\nprint(all(a),a.n)\n',
    {maxSteps:100000,maxWork:60000000},{maxBytes:22000});
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'True 3001\n');closed(result);
});

test('consumer acquisition, advancement and truth keep roots across pause/cancel/close',async()=>{
  const sources=[
    'class A:\n @property\n def __iter__(self):\n  print("entered")\n  def use(): return iter([[7],[8]])\n  return use\na=list(A())\nprint(a[0][0],a[1][0])\n',
    'class A:\n def __iter__(self): return self\n @property\n def __next__(self):\n  print("entered")\n  def use():\n   self.n+=1\n   if self.n>2: raise StopIteration\n   return [self.n]\n  return use\na=A()\na.n=0\nb=tuple(a)\nprint(b[0][0],b[1][0])\n',
    'class V:\n @property\n def __bool__(self):\n  print("entered")\n  def use(): return True\n  return use\nprint(all([V()]))\n'
  ];
  const outputs=['entered\n7 8\n','entered\nentered\nentered\n1 2\n','entered\nTrue\n'];
  for(let index=0;index<sources.length;index++){
    const {registry}=await compileSourceModules([unit(sources[index])],profile);
    try{for(const mode of ['finish','cancel','close']){
      const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
      try{while(execution.state!=='completed'){
        const snapshot=execution.advance();if(execution.state==='paused')session.memory.collect([],{cleanup:true});
        if(output==='entered\n'&&snapshot.frames.some(frame=>frame.completion==='invoke')){
          reached=true;
          if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
          if(mode==='close')break;
        }
      }assert.ok(reached);if(mode==='finish')assert.equal(output,outputs[index]);}
      finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});

test('consumer callback allocation, output and work failures release partial results',async()=>{
  const prefix='class A:\n def __iter__(self): return self\n def __next__(self): return [7]\n';
  const oom=await run(prefix+'tuple(A())\n',{maxSteps:100000,maxWork:20000000},{maxBytes:24000});
  assert.equal(oom.error.code,'OOM');closed(oom);
  const budget=await run(prefix+'all(A())\n',{maxSteps:500});assert.equal(budget.error.code,'BUDGET');closed(budget);
  let polls=0;const cancel=await run('all(range(1,10**100))\n',{shouldCancel:()=>++polls>12000});
  assert.equal(cancel.error.code,'CANCELLED');closed(cancel);
  const output=await run('class V:\n def __bool__(self):\n  while True: print("1234567890")\nall([V()])\n',{maxSteps:100000,maxWork:20000000});
  assert.equal(output.error.code,'BUDGET');assert.match(output.error.message,/output/i);closed(output);
});
