import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ValueRuntime} from './values.mjs';
import {MemoryArena} from './memory.mjs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic numeric notice'});
const run=(source,options={})=>runSourceRequest({modules:[unit(source)],options});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('integer ratios match independent CPython binary64 golden observations',()=>{
  const corpus=JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/integer-division.json',import.meta.url)));
  assert.equal(corpus.reference_version,'3.14.7');
  const values=new ValueRuntime({numeric:true});
  for(const record of corpus.cases){
    const calculate=()=>values.binary('divide',BigInt(record.left),BigInt(record.right));
    if(record.error)assert.throws(calculate,{name:record.error});
    else assert.deepEqual(values.encode(calculate()),{type:'float',bits:record.bits});
  }
});

test('negative integer powers follow explicit floating coercion and signed underflow',()=>{
  const values=new ValueRuntime({numeric:true});
  for(const [base,exponent,bits] of [[-2n,-1075n,'8000000000000000'],[2n,-1074n,'0000000000000001'],
    [9007199254740993n,-1n,'3ca0000000000000'],[-1n,-9007199254740993n,'3ff0000000000000']])
    assert.deepEqual(values.encode(values.binary('power',base,exponent)),{type:'float',bits});
  for(const [base,exponent] of [[10n**400n,-1n],[0n,-(10n**400n)],[1n,-(10n**400n)]])
    assert.throws(()=>values.binary('power',base,exponent),{name:'OverflowError'});
});

test('large shifts and powers enforce bounds before native oversized allocation',()=>{
  const values=new ValueRuntime({numeric:true}),huge=10n**300n;
  assert.equal(values.binary('left-shift',0n,huge),0n);
  assert.equal(values.binary('right-shift',-7n,huge),-1n);
  assert.equal(values.binary('right-shift',7n,huge),0n);
  assert.equal(values.binary('power',-1n,huge+1n),-1n);
  for(const op of ['left-shift','power'])assert.throws(()=>values.binary(op,2n,huge),{code:'BUDGET'});
  assert.throws(()=>values.binary('left-shift',1n,-1n),{name:'ValueError'});
  let polls=0;const cancelled=new ValueRuntime({numeric:true,charge:()=>{
    if(++polls===5)throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});
  }});
  assert.throws(()=>cancelled.binary('power',123456789n,256n),{code:'CANCELLED'});
});

test('legacy value execution keeps its previous integer division gate',async()=>{
  assert.throws(()=>new ValueRuntime().binary('divide',7n,2n),{code:'UNSUPPORTED'});
  const result=await run('print((10**400)/(10**400)==1.0,2**3**2,~7,(-7>>1))\n');
  assert.equal(result.error,undefined,JSON.stringify(result.error));
  assert.equal(result.stdout,'True 512 -8 -4\n');closed(result);
});

test('division allocation failure leaves no arena object behind',()=>{
  const memory=new MemoryArena({maxBytes:191}),values=new ValueRuntime({numeric:true,memory});
  const leave=memory.enter(()=>[]);
  try{assert.throws(()=>values.binary('divide',1n,3n),{code:'OOM'});assert.equal(memory.stats().objects,0);}
  finally{leave();memory.close();}closed({closed:memory.stats()});
});

test('numeric results survive collection at every instruction boundary',async()=>{
  const source='a=10**400\nb=(a+1)/a\na>>=3\na^=7\nprint(b==1.0,a>0,2**-3==0.125)\n';
  const {registry}=await compileSourceModules([unit(source)]),session=new ModuleSession(registry);
  let output='';session.context.begin({maxWork:20000000},text=>{output+=text;});
  const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();session.memory.collect([],{cleanup:true});}
    assert.equal(output,'True True True\n');
  }finally{execution.close();session.context.finish();session.close();registry.close();}
  closed({closed:session.stats()});
});

test('power budget failures preserve preceding output and close execution',async()=>{
  const result=await run('print("entered")\nx=2**10000\n',{maxWork:30000});
  assert.equal(result.error.code,'BUDGET');assert.equal(result.stdout,'entered\n');closed(result);
});
