import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ValueRuntime} from './values.mjs';
import {MemoryArena} from './memory.mjs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {modularPower} from './numeric.mjs';

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

test('round matches independent binary64 observations including ties and non-finite inputs',()=>{
  const corpus=JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/numeric-rounding.json',import.meta.url)));
  const values=new ValueRuntime({numeric:true});
  for(const record of corpus.cases){
    const value=values.decode({type:'float',bits:record.bits}),digits=record.ndigits===null?null:BigInt(record.ndigits);
    const calculate=()=>values.numericCall('round',[value,digits]);
    if(record.error)assert.throws(calculate,{name:record.error});
    else if(record.integer!==undefined)assert.equal(calculate(),BigInt(record.integer));
    else assert.deepEqual(values.encode(calculate()),{type:'float',bits:record.result_bits});
  }
});

test('modular inverse and exponentiation stay exact and poll cancellation',()=>{
  const values=new ValueRuntime({numeric:true});
  assert.equal(values.numericCall('pow',[3n,-1001n,11n]),4n);
  assert.equal(values.numericCall('pow',[3n,-1n,-11n]),-7n);
  assert.equal(values.numericCall('pow',[0n,-1n,1n]),0n);
  assert.throws(()=>values.numericCall('pow',[6n,-1n,12n]),{name:'ValueError'});
  assert.throws(()=>values.numericCall('pow',[2n,3n,0n]),{name:'ValueError'});
  let polls=0;assert.throws(()=>modularPower(3n,-(10n**300n),1000000007n,{
    charge:()=>{if(++polls===20)throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});},
    fail:()=>assert.fail('unexpected numeric error')
  }),{code:'CANCELLED'});
});

test('helper signatures retain Python errors and preceding output at source frames',async()=>{
  for(const expression of ['abs(x=1)','divmod(x=7,y=3)','pow(2,base=2,exp=3)','round(1,2,3)','hex(1.0)','ord("ab")','chr(1114112)']){
    const result=await run('print("before")\n'+expression+'\n');
    assert.equal(result.stdout,'before\n');assert.equal(result.error.type,expression.startsWith('chr')?'ValueError':'TypeError');
    assert.equal(result.error.traceback[0].location.span[0],2);closed(result);
  }
});

test('divmod retains both owned results across collection and rolls back allocation failure',async()=>{
  const source='pair=divmod(-7.5,2.0)\nprint(pair[0]==-4.0,pair[1]==0.5,round(number=2.675,ndigits=2)==2.67)\n';
  const {registry}=await compileSourceModules([unit(source)]),session=new ModuleSession(registry);
  let output='';session.context.begin({maxWork:20000000},text=>{output+=text;});
  const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();session.memory.collect([],{cleanup:true});}
    assert.equal(output,'True True True\n');
  }finally{execution.close();session.context.finish();session.close();registry.close();}
  closed({closed:session.stats()});
  const memory=new MemoryArena({maxBytes:300}),values=new ValueRuntime({numeric:true,memory}),roots=[];
  const leave=memory.enter(()=>roots);
  try{
    const quotient=values.float(2);roots.push(quotient);
    const remainder=values.float(1);roots.push(remainder);
    assert.throws(()=>values.tuple(roots),{code:'OOM'});
    assert.equal(memory.stats().objects,2);
  }finally{leave();memory.close();}closed({closed:memory.stats()});
});

test('real string constructors match the pinned decimal and whitespace observations',()=>{
  const corpus=JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/numeric-construction.json',import.meta.url)));
  assert.equal(corpus.unicode_version,'16.0.0');const values=new ValueRuntime({numeric:true});
  for(const record of corpus.cases){
    const text=values.string(Array.from(record.text,char=>char.codePointAt(0)));
    const calculate=()=>values.realConstructor(record.name,record.name==='int'?[text,BigInt(record.base)]:[text],record.name==='int');
    if(record.error)assert.throws(calculate,{name:record.error},JSON.stringify(record));
    else if(record.integer!==undefined)assert.equal(calculate(),BigInt(record.integer),JSON.stringify(record));
    else assert.deepEqual(values.encode(calculate()),{type:'float',bits:record.bits},JSON.stringify(record));
  }
});

test('real conversion preserves float identity and refuses bounded oversized work',async()=>{
  const values=new ValueRuntime({numeric:true}),real=values.float(-0);
  assert.equal(values.realConstructor('float',[real]),real);
  assert.equal(values.realConstructor('int',[values.float(-3.75)]),-3n);
  const text=values.string(Array.from('9'.repeat(5000),char=>char.codePointAt(0)));
  assert.throws(()=>values.realConstructor('int',[text]),{code:'BUDGET'});
  let polls=0;const cancelled=new ValueRuntime({numeric:true,charge:()=>{
    if(++polls===10)throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});
  }});
  assert.throws(()=>cancelled.realConstructor('int',[text]),{code:'CANCELLED'});
  const result=await run('a=float("-0")\nprint(a is float(a),int("١٢")==12,isinstance(True,int),isinstance(False,bool))\n');
  assert.equal(result.stdout,'True True True True\n');closed(result);
});

test('real constructor allocation failures release owned text and results',()=>{
  const memory=new MemoryArena({maxBytes:271}),values=new ValueRuntime({numeric:true,memory}),roots=[];
  const leave=memory.enter(()=>roots);
  try{
    const text=values.string([49,46,50,53]);roots.push(text);
    assert.throws(()=>values.realConstructor('float',[text]),{code:'OOM'});
    assert.equal(memory.stats().objects,1);
  }finally{leave();memory.close();}closed({closed:memory.stats()});
});
