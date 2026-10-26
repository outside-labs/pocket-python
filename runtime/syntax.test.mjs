import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {runSourceRequest} from './source-request.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic ordinary syntax notice'});
const run=(source,options={},memoryLimits,compileOptions={})=>runSourceRequest({modules:[unit(source)],options,memoryLimits,compileOptions});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('assertion identity survives binding shadows and message evaluation stays lazy',async()=>{
  const result=await run('AssertionError=7\ndef message():\n print("message")\n return "saved"\nassert True,message()\ntry: assert False,message()\nexcept Exception as error: print(str(error))\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'message\nsaved\n');closed(result);
});

test('assertion bytecode verifies message flags, stack joins and legacy admission',()=>{
  const input=structuredClone(compileSource('assert False,7\n').program);
  for(const value of [0,null,false]){
    const p=structuredClone(input);p.functions[0].blocks[0].instructions.find(i=>i[0]==='assertion-error')[1]=value;
    assert.throws(()=>verifyFunctions(p),{code:'BYTECODE'});
  }
  const old=structuredClone(input);old.version=3;assert.throws(()=>verifyFunctions(old),{code:'BYTECODE'});
});

test('assignment results remain owned after rebinding at each instruction pause',async()=>{
  const source='a=[7]\nsaved=a\nprint((a:=[a])[0] is saved)\nprint(a[0][0])\n';
  const {registry}=await compileSourceModules([unit(source)]),session=new ModuleSession(registry);let output='';
  session.context.begin({},text=>{output+=text;});const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();session.memory.collect([],{cleanup:true});}assert.equal(output,'True\n7\n');}
  finally{execution.close();session.context.finish();session.close();registry.close();}closed({closed:session.stats()});
});

test('assertion truth binding retains receiver and branch state through pause/cancel/close',async()=>{
  const source='class A:\n @property\n def __bool__(self):\n  print("entered")\n  def use(): return False\n  return use\ntry: assert (saved:=A()),"message"\nexcept AssertionError: print("caught")\n';
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
    }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\ncaught\n');}
    finally{execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
  }}finally{registry.close();}
});

test('assignment expression allocation and assertion callback work failures tear down',async()=>{
  const oom=await run('x=[]\nwhile True: (x:=[x])\n',{maxSteps:100000,maxWork:20000000},{maxBytes:16000});
  assert.equal(oom.error.code,'OOM');closed(oom);
  const budget=await run('class A:\n def __bool__(self):\n  while True: pass\nassert A()\n',{maxSteps:100},undefined,{languageProfile:'classes-source/1'});
  assert.equal(budget.error.code,'BUDGET');closed(budget);
});

test('lambda defaults, lexical cells, precedence and metadata use ordinary functions',async()=>{
  const result=await run('def outer():\n callbacks=[]\n for value in [1,2]: callbacks.append(lambda: value)\n return callbacks\na=outer()\nf=lambda x=lambda y=3:y: x()\ng=lambda x: 7 if x else 8\nprint(a[0](),a[1](),f(),g(False),(lambda:1,2)[1])\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'2 2 3 8 2\n');closed(result);
  const failure=await run('f=lambda x: 1//0\nf(7)\n');assert.equal(failure.error.type,'ZeroDivisionError');assert.equal(failure.error.traceback.at(-1).function,'<lambda>');closed(failure);
});

test('lambda definitions retain outer operands and defaults through collection and cancellation',async()=>{
  const source='def make():\n print("entered")\n return [7]\nprint((lambda x=make(): x)()[0])\n';
  const {registry}=await compileSourceModules([unit(source)]);
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
    }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\n7\n');}
    finally{execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
  }}finally{registry.close();}
});

test('lambda metadata and mangled parameter conflicts remain verified before effects',async()=>{
  const input=structuredClone(compileSource('f=lambda x:x\n').program);assert.equal(input.functions[1].name,'<lambda>');verifyFunctions(input);
  const old=structuredClone(input);old.version=3;assert.throws(()=>verifyFunctions(old),{code:'BYTECODE'});
  const bad=structuredClone(input);bad.functions[0].name='<lambda>';assert.throws(()=>verifyFunctions(bad),{code:'BYTECODE'});
  const collision=await run('print("bad")\nclass A:\n f=staticmethod(lambda __x,_A__x: 1)\n',{},undefined,{languageProfile:'classes-source/1'});
  assert.equal(collision.error.code,'SYNTAX');assert.equal(collision.stdout,'');assert.equal(collision.stats,null);
});

test('lambda allocation and recursion failures release default and environment cycles',async()=>{
  const oom=await run('held=[]\nwhile True: held.append(lambda x=[7]:x)\n',{maxSteps:100000,maxWork:20000000},{maxBytes:16000});
  assert.equal(oom.error.code,'OOM');closed(oom);
  const recursion=await run('f=lambda:f()\nf()\n',{maxDepth:8});assert.equal(recursion.error.type,'RecursionError');closed(recursion);
});
