import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {ClassRuntime} from './class-values.mjs';
import {environmentCell,FrameLocalsValue} from './function-objects.mjs';
const profile={languageProfile:'classes-source/1'};
const unit=source=>({name:'app',package:false,imports:[],source,notice:'Synthetic frame reflection fixture'});
const closed=stats=>{for(const name of ['bytes','objects','roots','frames','external'])assert.equal(stats[name],0,name);};
const corpus=JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/generator-frames.json',import.meta.url)));
for(const item of corpus.cases)test('generator/frame reflection: '+item.id,async()=>{
 const result=await runSourceRequest({modules:[unit(item.source)],compileOptions:profile,options:{maxWork:20000000,maxSteps:50000}});
 assert.equal(result.stdout,item.stdout,JSON.stringify(result.error));assert.equal(result.error?.type,item.error_type,JSON.stringify(result.error));
 if(item.error_context_type)assert.equal(result.error?.context?.type,item.error_context_type);
 if(result.closed)closed(result.closed);
});
test('frame proxy callbacks and retained cells survive parked collection, cancellation and close',async()=>{
 const source='def f(x):\n yield x\ng=f([7])\np=g.gi_frame.f_locals\np["self"]=p\nclass K:\n def __hash__(self): return hash("x")\n def __eq__(self,other):\n  print("lookup")\n  return other=="x"\nprint(p[K()][0])\nprint(next(g)[0],p["self"] is p)\n';
 const {registry}=await compileSourceModules([unit(source)],profile);
 try{for(const mode of ['finish','cancel','close']){
  const session=new ModuleSession(registry);let output='',cancel=false;session.context.begin({maxWork:20000000,shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
  try{while(execution.state!=='completed'){execution.advance();if(execution.state==='paused')execution.park();session.memory.collect([],{cleanup:true});
   if(output==='lookup\n'){if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;}}
   if(mode==='finish')assert.equal(output,'lookup\n7\n7 True\n');
  }finally{execution.close();session.context.finish();session.close();}closed(session.stats());
 }}finally{registry.close();}
});
test('abandoning an active callback closes its generator while retained frame locals stay owned',async()=>{
 const source='retained=None\ndef produce():\n global retained\n held=[7]\n retained=g.gi_frame\n print("entered")\n while True: pass\n yield 7\ng=produce()\ndef start(): next(g)\ndef inspect(): print(g.gi_frame is None,g.gi_running,g.gi_suspended,retained.f_locals["held"][0],retained.f_back is None)\n';
 const {registry}=await compileSourceModules([unit(source)],profile);
 try{for(const mode of ['cancel','budget']){
  const session=new ModuleSession(registry);let output='';
  try{session.run();const start=session.register('start'),inspect=session.register('inspect');
   const event=session.enqueue(start,[],{maxSteps:120,maxWork:20000000},text=>{output+=text;});event.result.catch(()=>{});
   while(session.pending){session.pump(1);session.memory.collect([],{cleanup:true});if(mode==='cancel'&&output==='entered\n'){event.cancel();break;}}
   await assert.rejects(event.result,{code:mode==='cancel'?'CANCELLED':'BUDGET'});
   session.enqueue(inspect,[],{maxWork:20000000},text=>{output+=text;});while(session.pending)session.pump(1);
   assert.equal(output,'entered\nTrue False False 7 True\n');
  }finally{session.close();}closed(session.stats());
 }}finally{registry.close();}
});
test('reflection and proxy callbacks share instruction, work, recursion and allocation limits',async()=>{
 for(const [body,options,memoryLimits,code] of [
  ['while True: pass',{maxSteps:300,maxWork:20000000},undefined,'BUDGET'],
  ['while True: pass',{maxSteps:100000,maxWork:40000},undefined,'BUDGET'],
  ['return p[K()]',{maxSteps:100000,maxWork:20000000,maxDepth:10},undefined,'PYTHON'],
  ['held=[]\n  while True: held.append([7])',{maxSteps:100000,maxWork:20000000},{maxBytes:50000},'OOM'],
 ]){
  const source='def f(x):yield x\ng=f([7])\np=g.gi_frame.f_locals\nclass K:\n def __hash__(self): return hash("x")\n def __eq__(self,other):\n  print("entered")\n  '+body+'\np[K()]\n';
  const result=await runSourceRequest({modules:[unit(source)],compileOptions:profile,options,memoryLimits});
  assert.equal(result.error?.code,code,JSON.stringify(result.error));assert.ok(result.stdout.startsWith('entered\n'));closed(result.closed);
 }
});


test('reflected frames reject foreign ownership and failed key materialization stays unpublished',async()=>{
 const {registry}=await compileSourceModules([unit('def f(x):yield x\ng=f([7])\nframe=g.gi_frame\n')],profile);
 const first=new ModuleSession(registry),second=new ModuleSession(registry);
 try{
  first.run();second.run();
  const frame=environmentCell(first.context.module('app').environment,'frame').value;
  const foreign=environmentCell(second.context.module('app').environment,'frame').value;
  const classes=new ClassRuntime({memory:first.memory});
  assert.throws(()=>classes.make(FrameLocalsValue,foreign),{code:'STALE_HANDLE'});
  assert.throws(()=>classes.frameKeys(foreign),{code:'STALE_HANDLE'});
  const before=frame.locals.get('x').value;
  assert.throws(()=>classes.write(frame.locals.get('x'),'cell_contents',foreign.locals.get('x').value),{code:'STALE_HANDLE'});
  assert.equal(frame.locals.get('x').value,before);assert.equal(frame.keys,null);
  const release=first.memory.external(first.memory.limits.maxBytes-first.memory.stats().bytes-8);
  try{assert.throws(()=>classes.frameKeys(frame),{code:'OOM'});assert.equal(frame.keys,null);}finally{release();}
  assert.equal(environmentCell(first.context.module('app').environment,'g').value.status,'created');
 }finally{first.close();second.close();registry.close();}closed(first.stats());closed(second.stats());
});
