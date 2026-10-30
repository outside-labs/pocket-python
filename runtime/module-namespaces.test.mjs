import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
import {Environment, Cell} from './function-objects.mjs';
const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name:'app',package:false,imports:[],source,notice:'Synthetic live namespace fixture'});
const closed = stats => { for (const key of ['bytes','objects','roots','frames','external']) assert.equal(stats[key],0,key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/module-namespaces.json',import.meta.url)));
for (const item of corpus.cases) test('live module namespace: '+item.id,async()=>{
  const modules=[{...unit(item.source),imports:item.imports||[]},...(item.modules||[]).map(module=>({...module,notice:'Synthetic live namespace fixture'}))];
  const result=await runSourceRequest({modules,compileOptions:profile,options:{maxWork:20000000,maxSteps:50000}});
  assert.equal(result.stdout,item.stdout);assert.equal(result.error?.type,item.error_type,JSON.stringify(result.error));
  if(result.closed) closed(result.closed);
});
async function lifecycle(source,expected){
  const {registry}=await compileSourceModules([unit(source)],profile);
  try{for(const mode of ['finish','cancel','close']){
    const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
    session.context.begin({maxWork:20000000,shouldCancel:()=>cancel},text=>{output+=text;});
    const execution=Execution.modules(session.context);
    try{
      while(execution.state!=='completed'){
        execution.advance();if(execution.state==='paused')execution.park();
        session.memory.collect([],{cleanup:true});
        if(!reached&&output==='entered\n'&&execution.state==='parked'){
          reached=true;if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}
          if(mode==='close')break;
        }
      }
      assert.ok(reached);if(mode==='finish')assert.equal(output,expected);
    }finally{const before=output;execution.close();execution.close();session.context.finish();session.close();assert.equal(output,before);}
    closed(session.stats());
  }}finally{registry.close();}
}
test('live namespace graphs survive parked hash/equality callbacks and collection',async()=>{
  await lifecycle('class Key:\n def __hash__(self): return hash("value")\n def __eq__(self,other):\n  print("entered")\n  return other=="value"\nns=globals()\nns[Key()]=[7]\nprint(value[0])\n','entered\n7\n');
});
test('escaped global dictionaries survive generator suspension and cancellation',async()=>{
  await lifecycle('ns=globals()\nns["value"]=[7]\ndef f():\n print("entered")\n yield value[0]\ng=f()\nprint(next(g))\nns["value"]=[9]\nprint(value[0])\n','entered\n7\n9\n');
});
test('persistent callbacks share their defining dictionary across separate activations',async()=>{
  const {registry}=await compileSourceModules([unit('ns=globals()\nvalue=7\ndef update():\n ns["value"]=value+2\n return value\n')],profile);
  const session=new ModuleSession(registry);
  try{session.run();const handle=session.register('update');
    const invoke=async()=>{const event=session.enqueue(handle,[]);while(session.pending){session.pump(1);session.memory.collect([],{cleanup:true});}return event.result;};
    assert.deepEqual(await invoke(),{type:'int',value:'9'});
    assert.deepEqual(await invoke(),{type:'int',value:'11'});assert.deepEqual(session.read('value'),{type:'int',value:'11'});
  }finally{session.close();registry.close();}closed(session.stats());
});
test('namespace materialization is transactional under actual allocation failure',()=>{
  const memory=new MemoryArena({maxObjects:2}),roots=[],leave=memory.enter(()=>roots);
  try{
    const environment=memory.allocate(98,[],()=>new Environment());roots.push(environment);
    const cell=memory.allocate(48,[7n],()=>{const cell=new Cell();cell.bound=true;cell.value=7n;return cell;});
    environment.cells.set('x',cell);environment.order.add('x');let layout=valueLayout(environment);memory.resize(environment,layout.bytes,layout.children);
    const values=new ValueRuntime({memory});assert.throws(()=>values.environmentDictionary(environment),{code:'OOM'});
    assert.equal(environment.dictionary,null);assert.equal(environment.cells.get('x').value,7n);
  }finally{leave();memory.close();}closed(memory.stats());
});
for(const [options,limits,code] of [
 [{maxSteps:250},undefined,'BUDGET'],[{maxSteps:100000,maxWork:6000},undefined,'BUDGET'],
 [{maxSteps:100000,maxWork:20000000},{maxBytes:18000},'OOM']
])test('live namespace growth shares '+code+' limits '+JSON.stringify(options),async()=>{
 const result=await runSourceRequest({modules:[unit('ns=globals()\nvalue=0\nwhile True:\n ns[value]=[value]\n value=value+1\n')],compileOptions:profile,options,memoryLimits:limits});
 assert.equal(result.error?.code,code,JSON.stringify(result.error));closed(result.closed);
});
