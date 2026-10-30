import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSource} from './source-compiler.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
import {FunctionValue,CodePool,CodeValue,Environment,Cell} from './function-objects.mjs';
const profile={languageProfile:'classes-source/1'};
const unit=source=>({name:'app',package:false,imports:[],source,notice:'Synthetic code/cell fixture'});
const closed=stats=>{for(const name of ['bytes','objects','roots','frames','external'])assert.equal(stats[name],0,name);};
const corpus=JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/code-cells.json',import.meta.url)));
for(const item of corpus.cases)test('code/cells: '+item.id,async()=>{
 const result=await runSourceRequest({modules:[{...unit(item.source),imports:item.imports??[]},...(item.modules??[]).map(m=>({...m,notice:'Synthetic code fixture'}))],compileOptions:profile,options:{maxWork:20000000}});
 assert.equal(result.stdout,item.stdout,JSON.stringify(result.error));assert.equal(result.error?.type,item.error_type,JSON.stringify(result.error));if(result.closed)closed(result.closed);
});
test('code exposure requires independent verification and never adopts foreign pools',()=>{
 const raw=compileSource('def first(): return 7\ndef other(): return 9\n',profile).program,verified=verifyFunctions(raw);
 const memory=new MemoryArena(),foreign=new MemoryArena(),roots=[],others=[];
 const leave=memory.enter(()=>roots),leaveOther=foreign.enter(()=>others);
 try{
  const classes=new ClassRuntime({memory}),other=new ClassRuntime({memory:foreign});
  const make=(runtime,list)=>{const pool=runtime.make(CodePool,verified.code,verified.bytes);list.push(pool);const globals=runtime.make(Environment);list.push(globals);const fn=runtime.make(FunctionValue,pool,1,globals,new Map());list.push(fn);return fn;};
  const fn=make(classes,roots),another=make(other,others),original=classes.get(fn,'__code__');roots.push(original);
  assert.throws(()=>classes.write(fn,'__code__',other.get(another,'__code__')),{code:'STALE_HANDLE'});assert.equal(classes.get(fn,'__code__'),original);
  const bad=classes.make(CodePool,{functions:[{kind:'function'}],constants:[]},64);roots.push(bad);
  assert.throws(()=>classes.codeObject(bad,0),{name:'TypeError'});
  const forged=classes.make(CodeValue,bad,0);roots.push(forged);
  assert.throws(()=>classes.write(fn,'__code__',forged),{name:'TypeError'});assert.equal(classes.get(fn,'__code__'),original);
  const reserve=memory.external(memory.limits.maxBytes-memory.stats().bytes-8);
  try{assert.throws(()=>classes.write(fn,'__code__',classes.codeObject(fn.pool,2)),{code:'OOM'});assert.equal(classes.get(fn,'__code__'),original);}finally{reserve();}
  const cell=classes.make(Cell);roots.push(cell);classes.write(cell,'cell_contents',7n);
  const foreignValue=other.values.list([]);others.push(foreignValue);
  assert.throws(()=>classes.write(cell,'cell_contents',foreignValue),{code:'STALE_HANDLE'});assert.equal(cell.value,7n);
 }finally{leave();memory.close();leaveOther();foreign.close();}closed(memory.stats());closed(foreign.stats());
});
test('definition lines remain verifier-owned and source constants are independent of CPython bytecode optimization',async()=>{
 const raw=compileSource('def f():\n "document"\n return 7\n',profile).program;
 for(const value of [0,-1,'1',1000001]){const bad=structuredClone(raw);bad.functions[1].firstLine=value;assert.throws(()=>verifyFunctions(bad),{code:'BYTECODE'});}
 const result=await runSourceRequest({modules:[unit('def f():\n "document"\n return 7\nprint(7 in f.__code__.co_consts)\n')],compileOptions:profile});assert.equal(result.stdout,'True\n');closed(result.closed);
});
test('active code snapshots and shared cells survive parked collection, cancellation and close',async()=>{
 const source='def make():\n x=[7]\n def update():\n  first.__code__=second.__code__\n  print("changed")\n def first():\n  update()\n  return x[0]\n def second():\n  if False: update()\n  return x[0]+10\n return first\nf=make()\nprint(f(),f())\n';
 const {registry}=await compileSourceModules([unit(source)],profile);
 try{for(const mode of ['finish','cancel','close']){
 const session=new ModuleSession(registry);let output='',cancel=false;session.context.begin({maxWork:20000000,shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
 try{while(execution.state!=='completed'){execution.advance();if(execution.state==='paused')execution.park();session.memory.collect([],{cleanup:true});if(output==='changed\n'){if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;}}if(mode==='finish')assert.equal(output,'changed\n7 17\n');}
 finally{execution.close();session.context.finish();session.close();}closed(session.stats());
 }}finally{registry.close();}
});


test('code filenames retain the independently registered source path', async () => {
 const result=await runSourceRequest({modules:[unit('def f(): return 7\nprint(f.__code__.co_filename)\n')],compileOptions:profile});
 assert.equal(result.stdout,'sources/app.py\n');assert.equal(result.ok,true);closed(result.closed);
});
