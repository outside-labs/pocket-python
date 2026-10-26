import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {runSourceRequest} from './source-request.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

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
