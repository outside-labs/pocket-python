import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {MemoryArena} from './memory.mjs';
import {FunctionValue} from './function-objects.mjs';
const profile = {languageProfile:'classes-source/1'};
const unit = source => ({name:'app',package:false,imports:[],source,notice:'Synthetic function state fixture'});
const closed = stats => { for (const name of ['bytes','objects','roots','frames','external']) assert.equal(stats[name],0,name); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/function-state.json',import.meta.url)));
for(const item of corpus.cases) test('function state: '+item.id,async()=>{
 const result=await runSourceRequest({modules:[unit(item.source)],compileOptions:profile,options:{maxWork:20000000}});
 assert.equal(result.stdout,item.stdout,JSON.stringify(result.error)); assert.equal(result.error?.type,item.error_type,JSON.stringify(result.error)); if(result.closed)closed(result.closed);
});
test('function default replacement rejects foreign owners and restores original values',()=>{
 const memory=new MemoryArena(),foreign=new MemoryArena(),roots=[],others=[];
 const leave=memory.enter(()=>roots),leaveOther=foreign.enter(()=>others);
 try {
  const classes=new ClassRuntime({memory}),other=new ClassRuntime({memory:foreign});
  const fn=classes.make(FunctionValue,null,0,null,new Map());roots.push(fn);
  for(const [name,value] of [['__defaults__',other.values.tuple([])],['__kwdefaults__',other.values.dict([])]]){
   others.push(value);const previous=classes.get(fn,name);
   assert.throws(()=>classes.write(fn,name,value),{code:'STALE_HANDLE'});assert.equal(classes.get(fn,name),previous);
  }
 }finally{leave();memory.close();leaveOther();foreign.close();}closed(memory.stats());closed(foreign.stats());
});
test('binding callbacks retain defaults and locals through parked collection and teardown',async()=>{
 const source='def f(x=[7],*,y): return x[0]+y[0]\nclass Key:\n def __hash__(self): return hash("y")\n def __eq__(self,other):\n  global f\n  f.__defaults__=([30],)\n  print("lookup")\n  return other=="y"\nf.__kwdefaults__={Key():[9]}\nprint(f())\n';
 const {registry}=await compileSourceModules([unit(source)],profile);
 try{for(const mode of ['finish','cancel','close']){
  const session=new ModuleSession(registry);let output='',cancel=false;
  session.context.begin({maxWork:20000000,shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){
   execution.advance();if(execution.state==='paused')execution.park();session.memory.collect([],{cleanup:true});
   if(output==='lookup\n'){if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;}
  }if(mode==='finish')assert.equal(output,'lookup\n16\n');}
  finally{execution.close();session.context.finish();session.close();}closed(session.stats());
 }}finally{registry.close();}
});
test('registered callbacks observe updated defaults and defining namespaces',async()=>{
 const source='value=1\ndef read(x=7,*,y=8): print(value,x,y)\ndef update():\n global value\n value=3\n read.__defaults__=(9,)\n read.__kwdefaults__={"y":10}\n';
 const {registry}=await compileSourceModules([unit(source)],profile);const session=new ModuleSession(registry);let output='';
 try{session.run();const read=session.register('read'),update=session.register('update');
  session.enqueue(read,[],{},text=>{output+=text;});while(session.pending)session.pump(1);
  session.enqueue(update);while(session.pending)session.pump(1);session.memory.collect([],{cleanup:true});
  session.enqueue(read,[],{},text=>{output+=text;});while(session.pending)session.pump(1);
  assert.equal(output,'1 7 8\n3 9 10\n');
 }finally{session.close();registry.close();}closed(session.stats());
});
