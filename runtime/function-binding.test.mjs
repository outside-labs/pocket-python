import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {runSourceRequest} from './source-request.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion, completionRoots} from './operations.mjs';
import {CallArguments} from './function-objects.mjs';
import {valueLayout} from './values.mjs';

const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic function binding notice'});
const run=(source,options={},memoryLimits)=>runSourceRequest({modules:[unit(source)],options,memoryLimits});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('runtime defaults retain mutable identity, closure reads and recursive graphs',async()=>{
  const result=await run('def outer(x):\n held=[]\n def f(a=[x],*,b=held):\n  b.append(f)\n  return a,b\n return f\nf=outer(7)\na=f()\nb=f()\nprint(a[0] is b[0],a[1] is b[1],len(a[1]),a[1][0] is f)\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'True True 2 True\n');closed(result);
});

test('verified runtime defaults require the exact target vector and modern format',()=>{
  const input=structuredClone(compileSource('def f(a=[],*,b={}): return a\n').program);
  verifyFunctions(input);
  const instruction=input.functions[0].blocks[0].instructions.find(i=>i[0]==='function-defaults');
  for(const change of [p=>{p[0]='function';p.splice(2);},p=>p[2]++,p=>p[3]=['other'],p=>p[3]=['b','b']]){
    const mutated=structuredClone(input),op=mutated.functions[0].blocks[0].instructions.find(i=>i[0]==='function-defaults');
    change(op);assert.throws(()=>verifyFunctions(mutated),{code:'BYTECODE'});
  }
  assert.equal(instruction[2],1);
  const old=structuredClone(input);old.version=3;assert.throws(()=>verifyFunctions(old),{code:'BYTECODE'});
  const mixed=structuredClone(input);mixed.constants.push({type:'none'});mixed.functions[1].params.defaults[0]=mixed.constants.length-1;
  assert.throws(()=>verifyFunctions(mixed),{code:'BYTECODE'});
});

test('default callbacks and completed default vectors survive collection at every pause',async()=>{
  const source='def make(n):\n print("entered")\n return [n]\ndef f(a=make(3),*,b=make(4)):\n return a[0]+b[0]\nprint(f())\n';
  const {registry}=await compileSourceModules([unit(source)]);
  try{for(const mode of ['finish','cancel','close']){
    const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
    session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
    try{while(execution.state!=='completed'){
      execution.advance();session.memory.collect([],{cleanup:true});
      if(output==='entered\n'){
        reached=true;
        if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
        if(mode==='close')break;
      }
    }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\nentered\n7\n');}
    finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
  }}finally{registry.close();}
});

test('default allocation and work failures release partial vectors and defining frames',async()=>{
  const source='held=[]\nwhile True:\n def f(a=[7]): return a\n held.append(f)\n';
  const oom=await run(source,{maxSteps:100000,maxWork:20000000},{maxBytes:18000});assert.equal(oom.error.code,'OOM');closed(oom);
  const budget=await run('def busy():\n while True: pass\ndef f(a=busy()): pass\n',{maxSteps:100});assert.equal(budget.error.code,'BUDGET');closed(budget);
});

test('scope writes share enclosing cells while globals stay in the defining module',async()=>{
  const source='import helper\nx=1\nhelper.set_value()\nprint(x,helper.x,helper.read())\n';
  const helper={...unit('x=2\ndef set_value():\n global x\n x=7\ndef read(): return x\n'),name:'helper'};
  const result=await runSourceRequest({modules:[{...unit(source),imports:['helper']},helper]});
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'1 7 7\n');closed(result);
  const nested=await run('def outer():\n x=1\n def change():\n  nonlocal x\n  x=[7]\n def read(): return x[0]\n change()\n return read\nprint(outer()())\n');
  assert.equal(nested.error,undefined,JSON.stringify(nested.error));assert.equal(nested.stdout,'7\n');closed(nested);
});

test('scope metadata cannot authorize undeclared writes or conflicting capture',()=>{
  const input=structuredClone(compileSource('x=1\ndef f():\n global x\n x=2\nf()\n').program);
  verifyFunctions(input);
  for(const change of [fn=>delete fn.globals,fn=>fn.globals.push('x'),fn=>fn.globals=null,fn=>fn.locals.push('x'),fn=>fn.free.push('x'),fn=>fn.nonlocals=['absent']]){
    const p=structuredClone(input);change(p.functions[1]);assert.throws(()=>verifyFunctions(p),{code:'BYTECODE'});
  }
});

test('scope declaration errors reject the whole source before effects',async()=>{
  for(const source of ['def f():\n print(x)\n global x\n','def f(x):\n global x\n','def f():\n nonlocal x\n','nonlocal x\n',
    'def f():\n global x\n x=2\n global x\n']){
    const result=await run('print("bad")\n'+source);
    assert.equal(result.error.code,'SYNTAX');assert.equal(result.stdout,'');assert.equal(result.stats,null);
  }
});

test('nonlocal rebinding and global creation retain new graphs across every pause',async()=>{
  const source='def outer():\n x=[]\n def f():\n  nonlocal x\n  global saved\n  x=[7]\n  saved=x\n  print("entered")\n  return x\n return f\nf=outer()\na=f()\nprint(a is saved,saved[0])\n';
  const {registry}=await compileSourceModules([unit(source)]);
  try{for(const mode of ['finish','cancel','close']){
    const session=new ModuleSession(registry);let output='',cancel=false;
    session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
    try{while(execution.state!=='completed'){
      execution.advance();session.memory.collect([],{cleanup:true});
      if(output==='entered\n'&&mode!=='finish'){
        if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});}break;
      }
    }if(mode==='finish')assert.equal(output,'entered\nTrue 7\n');}
    finally{execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
  }}finally{registry.close();}
});

test('variadic packs preserve aliases, lexical cells and fresh keyword dictionaries',async()=>{
  const result=await run('saved=[]\nheld=[]\ndef f(x,/,*a,y=3,**kw):\n held.append(kw)\n def read(): return a[0] is saved and kw["x"] is saved\n return read\ng=f(1,saved,x=saved)\nh=f(1,saved,x=saved)\nprint(g(),h(),held[0] is held[1])\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'True True False\n');closed(result);
});

test('variadic signatures verify parameter conflicts and reject malformed grammar',()=>{
  const input=structuredClone(compileSource('def f(a,*args,**kw): pass\n').program);verifyFunctions(input);
  for(const change of [p=>p.vararg='a',p=>p.kwarg='args',p=>p.vararg=[],p=>p.kwarg='@source:0']){
    const mutated=structuredClone(input);change(mutated.functions[1].params);assert.throws(()=>verifyFunctions(mutated),{code:'BYTECODE'});
  }
  for(const source of ['def f(*a,*b): pass','def f(**a,b): pass','def f(*,**kw): pass','def f(*args=1): pass'])
    assert.throws(()=>compileSource(source),{code:'SYNTAX'});
});

test('packed parameters survive every instruction pause and fail quotas cleanly',async()=>{
  const source='def f(*a,**kw):\n print("entered")\n return a[0][0]+kw["x"][0]\nprint(f([3],x=[4]))\n';
  const {registry}=await compileSourceModules([unit(source)]),session=new ModuleSession(registry);let output='';
  session.context.begin({},text=>{output+=text;});const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();session.memory.collect([],{cleanup:true});}assert.equal(output,'entered\n7\n');}
  finally{execution.close();session.context.finish();session.close();registry.close();}closed({closed:session.stats()});
  const oom=await run('held=[]\ndef f(*a,**kw):\n held.append(a)\n held.append(kw)\nwhile True: f([7],x=[8])\n',
    {maxSteps:100000,maxWork:20000000},{maxBytes:18000});assert.equal(oom.error.code,'OOM');closed(oom);
});

test('starred positional calls consume before later arguments and explicit keywords',async()=>{
  const result=await run('events=[]\ndef mark(n):\n events.append(n)\n return [n]\ndef keyword():\n events.append(3)\n return 3\ndef f(*a,x): print(a[0],a[1],x)\nf(x=keyword(),*mark(1),*mark(2))\nprint(events[0],events[1],events[2])\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'1 2 3\n1 2 3\n');closed(result);
});

test('positional expansion retains callable, prior arguments and iterators across callback pauses',async()=>{
  const source='class A:\n def __iter__(self): return self\n @property\n def __next__(self):\n  print("entered")\n  def use():\n   self.n+=1\n   if self.n>2: raise StopIteration\n   return [self.n]\n  return use\na=A()\na.n=0\ndef f(first,*rest): print(first[0],rest[0][0],rest[1][0])\nf([7],*a)\n';
  const {registry}=await compileSourceModules([unit(source)],{languageProfile:'classes-source/1'});
  try{for(const mode of ['finish','cancel','close']){
    const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
    session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
    try{while(execution.state!=='completed'){
      const snapshot=execution.advance();session.memory.collect([],{cleanup:true});
      if(output==='entered\n'&&snapshot.frames.some(frame=>frame.completion==='invoke')){
        reached=true;
        if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
        if(mode==='close')break;
      }
    }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\nentered\nentered\n7 1 2\n');}
    finally{execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
  }}finally{registry.close();}
});

test('positional assembly limits and primitive consumption cancellation release partial arguments',async()=>{
  const budget=await run('def f(*a): pass\nf(*range(10000))\n');assert.equal(budget.error.code,'BUDGET');assert.match(budget.error.message,/argument/);closed(budget);
  const oom=await run('held=[]\ndef f(*a): held.append(a)\nwhile True: f(*[[7],[8],[9]])\n',
    {maxSteps:100000,maxWork:20000000},{maxBytes:18000});assert.equal(oom.error.code,'OOM');closed(oom);
  const {registry}=await compileSourceModules([unit('def f(*a): pass\nprint("entered")\nf(*range(100))\n')]),session=new ModuleSession(registry);
  let entered=false,polls=0;
  try{assert.throws(()=>session.run({shouldCancel:()=>entered&&++polls>40},()=>{entered=true;}),{code:'CANCELLED'});}
  finally{session.close();registry.close();}assert.ok(entered);closed({closed:session.stats()});
});

test('call assembly verifies its stack operations and roots pending iteration owners',()=>{
  const input=structuredClone(compileSource('def f(*a): pass\nf(*[1],x=2)\n').program);
  for(const change of [op=>op[1]='bad-name',op=>op.push(3)]){
    const p=structuredClone(input),op=p.functions[0].blocks[0].instructions.find(i=>i[0]==='call-keyword');
    change(op);assert.throws(()=>verifyFunctions(p),{code:'BYTECODE'});
  }
  const underflow=structuredClone(input);underflow.functions[0].blocks[0].instructions.find(i=>i[0]==='call-start')[0]='call-argument';
  assert.throws(()=>verifyFunctions(underflow),{code:'BYTECODE'});
  const callable={},argument={},iterator={},outer={},owner=new CallArguments(callable);owner.args.push(argument);
  assert.deepEqual(valueLayout(owner).children,[callable,argument]);
  const after=completion('relay',{receiver:outer});
  assert.deepEqual(completionRoots(completion('call-star-next',{receiver:owner,iterator,after})),[owner,iterator,outer]);
});

test('mapping lookup, key iteration and item binding retain partial calls at every pause',async()=>{
  const sources=[
    'class M:\n @property\n def keys(self):\n  print("entered")\n  def use(): return ["x"]\n  return use\n def __getitem__(self,key): return [3]\n',
    'class I:\n def __iter__(self): return self\n def __next__(self):\n  print("entered")\n  self.n+=1\n  if self.n>1: raise StopIteration\n  return "x"\nclass M:\n def keys(self):\n  it=I()\n  it.n=0\n  return it\n def __getitem__(self,key): return [3]\n',
    'class M:\n def keys(self): return ["x"]\n @property\n def __getitem__(self):\n  print("entered")\n  def use(key): return [3]\n  return use\n'
  ];
  for(let index=0;index<sources.length;index++){
    const source=sources[index]+'def f(a,**kw): print(a[0],kw["x"][0])\nf([7],**M())\n';
    const {registry}=await compileSourceModules([unit(source)],{languageProfile:'classes-source/1'});
    try{for(const mode of ['finish','cancel','close']){
      const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
      try{while(execution.state!=='completed'){
        const snapshot=execution.advance();session.memory.collect([],{cleanup:true});
        if(output==='entered\n'&&snapshot.frames.length>1){
          reached=true;
          if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
          if(mode==='close')break;
        }
      }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\n'.repeat(index===1?2:1)+'7 3\n');}
      finally{execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});

test('keyword merging validates after reads and stops before duplicate value lookup',async()=>{
  const prefix='class M:\n def keys(self): return ["x","x"]\n def __getitem__(self,key):\n  print("get")\n  return [7]\ndef f(**kw): pass\n';
  const duplicate=await runSourceRequest({modules:[unit(prefix+'f(**M())\n')],compileOptions:{languageProfile:'classes-source/1'}});
  assert.equal(duplicate.error.type,'TypeError');assert.equal(duplicate.stdout,'get\n');closed(duplicate);
  const arbitrary=await run('def f(**kw): print(kw["not-an-identifier"],kw["__proto__"])\nf(**{"not-an-identifier":7},**{"__proto__":8})\n');
  assert.equal(arbitrary.error,undefined,JSON.stringify(arbitrary.error));assert.equal(arbitrary.stdout,'7 8\n');closed(arbitrary);
});

test('keyword quotas and pending mapping work release accumulated dictionaries',async()=>{
  const prefix='class M:\n def keys(self): return range(200)\n def __getitem__(self,key): return [key]\ndef f(**kw): pass\nf(**M())\n';
  const budget=await runSourceRequest({modules:[unit(prefix)],compileOptions:{languageProfile:'classes-source/1'},options:{maxSteps:100000,maxWork:200000}});
  assert.equal(budget.error.code,'BUDGET');closed(budget);
  const oom=await runSourceRequest({modules:[unit(prefix)],compileOptions:{languageProfile:'classes-source/1'},
    options:{maxSteps:100000,maxWork:20000000},memoryLimits:{maxBytes:21000}});
  assert.equal(oom.error.code,'OOM');closed(oom);
  const work=await runSourceRequest({modules:[unit('class M:\n def keys(self):\n  while True: pass\ndef f(**kw): pass\nf(**M())\n')],
    compileOptions:{languageProfile:'classes-source/1'},options:{maxSteps:100}});
  assert.equal(work.error.code,'BUDGET');closed(work);
});

test('mapping completion records retain every owner and reject invalid phases',()=>{
  const receiver={},mapping={},keys={},key={},item={},outer={},after=completion('relay',{receiver:outer});
  assert.deepEqual(completionRoots(completion('call-map-value',{receiver,mapping,keys,key,item,hash:3n,after})),[receiver,mapping,keys,key,item,3n,outer]);
  for(const fields of [{position:-1},{position:1025},{hash:3},{mode:'other'},{version:-1}])
    assert.throws(()=>completion('call-map-probe',{receiver,...fields}),TypeError);
});

test('mapping hash and duplicate formatting callbacks root keys, fetched items and outer calls',async()=>{
  const sources=[
    'class K:\n @property\n def __hash__(self):\n  print("entered")\n  def use(): return 7\n  return use\n def __eq__(self,other): return True\n',
    'class K:\n def __hash__(self): return 7\n def __eq__(self,other): return True\n @property\n def __str__(self):\n  print("entered")\n  def use(): return "KEY"\n  return use\n'
  ];
  for(let index=0;index<sources.length;index++){
    const source=sources[index]+'class M:\n def keys(self): return [K(),K()]\n def __getitem__(self,key): return [7]\ndef f(**kw): pass\ntry: f(**M())\nexcept TypeError: print("caught")\n';
    const {registry}=await compileSourceModules([unit(source)],{languageProfile:'classes-source/1'});
    try{for(const mode of ['finish','cancel','close']){
      const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
      try{while(execution.state!=='completed'){
        const snapshot=execution.advance();session.memory.collect([],{cleanup:true});
        if(output==='entered\n'&&snapshot.frames.length>1){
          reached=true;
          if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
          if(mode==='close')break;
        }
      }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\n'.repeat(index===0?3:1)+'caught\n');}
      finally{execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});
