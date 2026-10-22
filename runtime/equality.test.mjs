import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {NotImplementedValue, InstanceValue} from './function-objects.mjs';
import {ValueRuntime, valueLayout} from './values.mjs';
import {completion, completionRoots, compareTask, operationRoots} from './operations.mjs';

const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic comparison notice'});
const profile={languageProfile:'classes-source/1'};
const run=(source,options={},memoryLimits=undefined)=>runSourceRequest({modules:[unit(source)],compileOptions:profile,options,memoryLimits});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('comparison phases own both operands, iterator results and outer destinations',()=>{
  const left={},right={},after=completion('relay',{receiver:right});
  assert.deepEqual(valueLayout(new NotImplementedValue()),{bytes:48,children:[]});
  for(const kind of ['compare-result','ne-result','sequence-item','sequence-truth'])
    assert.deepEqual(completionRoots(completion(kind,{left,right,after,operation:'equal',position:0,depth:0})),[left,right,right]);
  for(const kind of ['sentinel-equal','sentinel-truth'])
    assert.deepEqual(completionRoots(completion(kind,{receiver:left,value:right,after,depth:0})),[left,right,right]);
  assert.deepEqual(operationRoots(compareTask('equal',left,right,null,after)),[left,right,right]);
  assert.throws(()=>compareTask('less',left,right,null),TypeError);
  assert.throws(()=>compareTask('equal',left,right,null,null,0,3),TypeError);
});

test('callback errors preserve source frames and enclosing exception/finally state',async()=>{
  const result=await run('class A:\n def __eq__(self,other):\n  return 1//0\nprint(A()==7)\n');
  assert.equal(result.error.type,'ZeroDivisionError');
  assert.deepEqual(result.error.traceback.map(f=>[f.function,f.location.span[0]]),[['<module>',4],['__eq__',3]]);closed(result);
  const active=await run('class A:\n def __eq__(self,other): raise\ntry:\n raise ValueError("original")\nexcept ValueError:\n try: A()==7\n except ValueError as error: print(str(error))\n finally: print("cleanup")\n');
  assert.equal(active.error,undefined,JSON.stringify(active.error));assert.equal(active.stdout,'original\ncleanup\n');closed(active);
});

test('Python equality recursion and frame-free callable slot cycles are depth-bounded',async()=>{
  for(const source of ['class A:\n def __eq__(self,other): return self==other\nprint(A()==7)\n',
    'class A: pass\na=A()\nA.__call__=a\nA.__eq__=a\nprint(a==7)\n']){
    const result=await run(source,{maxDepth:8,maxSteps:100000,maxWork:20000000});
    assert.equal(result.error.type,'RecursionError',JSON.stringify(result.error));closed(result);
  }
});

for(const slot of ['__eq__','__ne__'])test(slot+' binding and body budgets/cancellation release pending operands',async()=>{
  for(const binding of [false,true]){
    const source='class A:\n '+(binding?'@property\n ':'')+'def '+slot+'(self'+(binding?'':',other')+'):\n  print("entered")\n  while True: pass\nprint(A()'+(slot==='__eq__'?'==':'!=')+'[7])\n';
    for(const options of [{maxSteps:500},{maxSteps:100000,maxWork:60000}]){
      const result=await run(source,options);assert.equal(result.error.code,'BUDGET');assert.equal(result.stdout,'entered\n');closed(result);
    }
    let polls=0;const cancel=await run(source,{shouldCancel:()=>++polls>12000});assert.equal(cancel.error.code,'CANCELLED');closed(cancel);
  }
});

test('comparison callback OOM and output exhaustion leave no logical owners',async()=>{
  const oom=await run('class A:\n def __eq__(self,other):\n  print("entered")\n  held=[]\n  while True: held.append([1,2,3])\nprint(A()==[7])\n',{maxSteps:100000,maxWork:20000000},{maxBytes:32000});
  assert.equal(oom.error.code,'OOM');assert.equal(oom.stdout,'entered\n');closed(oom);
  const output=await run('class A:\n def __eq__(self,other):\n  while True: print("1234567890")\nprint(A()==7)\n',{maxSteps:100000,maxWork:20000000});
  assert.equal(output.error.code,'BUDGET');assert.match(output.error.message,/output/i);closed(output);
});

test('paused comparison bindings, sequence operands, result truth and sentinel values survive collection',async()=>{
  const sources=[
    ['class A:\n @property\n def __eq__(self):\n  print("entered")\n  def use(other): return other[0]==7\n  return use\nprint([A()]==[[7]])\n','True'],
    ['class Sentinel:\n @property\n def __eq__(self):\n  print("entered")\n  def use(other): return False\n  return use\ndef supply(): return [7]\nprint(next(iter(supply,Sentinel()))[0])\n','7'],
    ['class R:\n @property\n def __bool__(self):\n  print("entered")\n  def use(): return self.saved[0]==7\n  return use\nclass A:\n def __eq__(self,other):\n  result=R()\n  result.saved=other\n  return result\nprint([7] in [A()])\n','True']
  ];
  for(const [source,expected]of sources){const {registry}=await compileSourceModules([unit(source)],profile);
    try{for(const mode of ['finish','cancel','close']){
      const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
      try{while(execution.state!=='completed'){
        const snapshot=execution.advance();if(execution.state==='paused')session.memory.collect([],{cleanup:true});
        if(output==='entered\n'&&snapshot.frames.some(f=>f.completion==='invoke')){
          reached=true;if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;
        }
      }assert.ok(reached);if(mode==='finish')assert.equal(output,'entered\n'+expected+'\n');}
      finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});

test('protocol discovery walks deep and cyclic graphs without host recursion',()=>{
  let work=0;const values=new ValueRuntime({charge:()=>{if(++work>20000)throw new Error('work');}});
  let item=new InstanceValue({});for(let i=0;i<12000;i++)item=values.list([item]);
  work=0;
  assert.equal(values.hasUserEquality(item),true);
  const cycle=values.list([]);cycle.items.push(cycle);assert.equal(values.hasUserEquality(cycle),false);
});

test('core builtin admission and unadopted ordering remain explicit',async()=>{
  const core=await runSourceRequest({modules:[unit('NotImplemented\n')]});assert.equal(core.error.type,'NameError');closed(core);
  const ordering=await run('class A:\n def __eq__(self,other): return True\nprint([A()]<[A()])\n');
  assert.equal(ordering.error.code,'UNSUPPORTED');assert.equal(ordering.stdout,'');closed(ordering);
});
