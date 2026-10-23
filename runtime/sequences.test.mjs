import test from 'node:test';
import assert from 'node:assert/strict';
import {ValueRuntime, valueLayout} from './values.mjs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

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
