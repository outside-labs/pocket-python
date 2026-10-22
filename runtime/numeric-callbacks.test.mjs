import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {completion,completionRoots,numericTask,operationRoots} from './operations.mjs';

const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic numeric callback notice'});
const profile={languageProfile:'classes-source/1'};
const run=(source,options={},memoryLimits)=>runSourceRequest({modules:[unit(source)],compileOptions:profile,options,memoryLimits});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('numeric continuations retain every operand and outer destination with closed validation',()=>{
  const receiver={},digits={},pending={},after=completion('relay',{receiver:pending});
  const fields={name:'round',args:[receiver,digits],position:0,slot:'__round__',depth:1,after};
  assert.deepEqual(completionRoots(completion('numeric-result',fields)),[receiver,digits,pending]);
  assert.deepEqual(completionRoots(completion('numeric-index',{...fields,position:1})),[receiver,digits,pending]);
  assert.deepEqual(operationRoots(numericTask('round',[receiver,digits],null,after)),[receiver,digits,pending]);
  assert.throws(()=>numericTask('future',[],null),TypeError);
  assert.throws(()=>numericTask('round',[receiver],null,null,0,3),TypeError);
  assert.throws(()=>completion('numeric-result',{...fields,slot:'__add__'}),TypeError);
  assert.throws(()=>completion('numeric-index',{...fields,position:2}),TypeError);
});

for(const [slot,invoke,params] of [['__int__','int(A())',''],['__float__','float(A())',''],['__complex__','complex(A())',''],['__abs__','abs(A())',''],['__round__','round(A(),[7])',',digits']]){
  test(slot+' binding and body failures preserve original callback/source frames',async()=>{
    const body=await run('class A:\n def '+slot+'(self'+params+'):\n  return 1//0\n'+invoke+'\n');
    assert.equal(body.error.type,'ZeroDivisionError');
    assert.deepEqual(body.error.traceback.map(f=>[f.function,f.location.span[0]]),[['<module>',4],[slot,3]]);closed(body);
    const binding=await run('class A:\n @property\n def '+slot+'(self):\n  raise AttributeError("binding")\n'+invoke+'\n');
    assert.equal(binding.error.type,'AttributeError');assert.deepEqual(binding.error.traceback.map(f=>f.function),['<module>',slot]);closed(binding);
  });
  test(slot+' interruption and actual OOM release pending conversion operands',async()=>{
    for(const binding of [false,true]){
      const source='class A:\n '+(binding?'@property\n ':'')+'def '+slot+'(self'+(binding?'':params)+'):\n  print("entered")\n  while True: pass\n'+invoke+'\n';
      for(const options of [{maxSteps:500},{maxSteps:100000,maxWork:60000}]){
        const result=await run(source,options);assert.equal(result.error.code,'BUDGET');assert.equal(result.stdout,'entered\n');closed(result);
      }
      let polls=0;const cancel=await run(source,{shouldCancel:()=>++polls>12000});assert.equal(cancel.error.code,'CANCELLED');closed(cancel);
    }
    const oom=await run('class A:\n def '+slot+'(self'+params+'):\n  print("entered")\n  held=[]\n  while True: held.append([1,2,3])\n'+invoke+'\n',{maxSteps:100000,maxWork:20000000},{maxBytes:32000});
    assert.equal(oom.error.code,'OOM');assert.equal(oom.stdout,'entered\n');closed(oom);
  });
}

test('numeric result validation and conversion ordering precede later effects',async()=>{
  for(const [slot,result,invoke] of [['__int__','1.25','int'],['__float__','7','float'],['__complex__','7','complex']]){
    const value=await run('class A:\n def '+slot+'(self): return '+result+'\n'+invoke+'(A())\n');
    assert.equal(value.error.type,'TypeError');assert.deepEqual(value.error.traceback.map(f=>[f.function,f.location.span[0]]),[['<module>',3]]);closed(value);
  }
  for(const expression of ['complex("1",A())','round("1",A())','round([],A())']){
    const result=await run('class A:\n def __float__(self):\n  print("never")\n  return 1.25\n def __index__(self):\n  print("never")\n  return 2\n'+expression+'\n');
    assert.equal(result.error.type,'TypeError');assert.equal(result.stdout,'');closed(result);
  }
});

test('native binding loops and Python callback recursion stay depth-bounded',async()=>{
  for(const source of ['class A:\n __int__=property(int)\nint(A())\n','class A:\n def __float__(self): return float(self)\nfloat(A())\n','class A:\n __abs__=property(abs)\nabs(A())\n']){
    const result=await run(source,{maxDepth:8,maxSteps:100000,maxWork:20000000});assert.equal(result.error.type,'RecursionError',JSON.stringify(result.error));closed(result);
  }
});

test('output limits and active exception context cross numeric callbacks',async()=>{
  const output=await run('class A:\n def __abs__(self):\n  while True: print("1234567890")\nabs(A())\n',{maxSteps:100000,maxWork:20000000});
  assert.equal(output.error.code,'BUDGET');assert.match(output.error.message,/output/i);closed(output);
  const context=await run('class A:\n def __int__(self): raise\ntry:\n raise ValueError("active")\nexcept ValueError:\n try: int(A())\n except ValueError as error: print(str(error))\n finally: print("cleanup")\n');
  assert.equal(context.stdout,'active\ncleanup\n');closed(context);
});

test('paused numeric bindings retain conversion results, raw arguments and pending operands',async()=>{
  const sources=[
    ['class A:\n def __complex__(self): return 3+4j\nclass B:\n @property\n def __float__(self):\n  print("entered")\n  held=[1.25]\n  def use(): return held[0]\n  return use\nprint(complex(A(),B())==3+5.25j)\n','entered\nTrue\n'],
    ['class A:\n @property\n def __round__(self):\n  print("entered")\n  def use(digits): return digits[0][0]\n  return use\nprint(round(A(),[[7]]))\n','entered\n7\n'],
    ['class A:\n @property\n def __index__(self):\n  print("entered")\n  def use(): return 16\n  return use\nprint(int("ff",base=A()))\n','entered\n255\n']
  ];
  for(const [source,expected] of sources){const {registry}=await compileSourceModules([unit(source)],profile);
    try{for(const mode of ['finish','cancel','close']){
      const session=new ModuleSession(registry);let output='',cancel=false,reached=false;
      session.context.begin({shouldCancel:()=>cancel},text=>{output+=text;});const execution=Execution.modules(session.context);
      try{while(execution.state!=='completed'){
        const snapshot=execution.advance();if(execution.state==='paused')session.memory.collect([],{cleanup:true});
        if(output==='entered\n'&&snapshot.frames.some(f=>f.completion==='invoke')){
          reached=true;if(mode==='cancel'){cancel=true;assert.throws(()=>execution.advance(),{code:'CANCELLED'});break;}if(mode==='close')break;
        }
      }assert.ok(reached);if(mode==='finish')assert.equal(output,expected);}
      finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});
