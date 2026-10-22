import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';
import {MemoryArena} from './memory.mjs';
import {ValueRuntime} from './values.mjs';
import {completion, completionRoots, dictionaryTask, dictionaryBuildTask, operationRoots} from './operations.mjs';

const unit=source=>({name:'app',source,imports:[],package:false,notice:'Synthetic hashing notice'});
const profile={languageProfile:'classes-source/1'};
const run=(source,options={},memoryLimits=undefined)=>runSourceRequest({modules:[unit(source)],compileOptions:profile,options,memoryLimits});
const closed=result=>{for(const key of ['bytes','objects','roots','frames','external'])assert.equal(result.closed[key],0,key);};

test('identity hashes belong to live arena objects across value runtimes and close',()=>{
  const memory=new MemoryArena(),a=new ValueRuntime({memory}),b=new ValueRuntime({memory}),roots=[];
  const leave=memory.enter(()=>roots);
  const first=a.string([65]);roots.push(first);const second=a.string([65]);roots.push(second);
  assert.equal(a.identityHash(first),b.identityHash(first));assert.notEqual(a.identityHash(first),b.identityHash(second));
  assert.deepEqual(a.encode(first),b.encode(second));
  leave();memory.close();assert.throws(()=>memory.identityHash(first),{code:'STALE_HANDLE'});closed({closed:memory.stats()});
});

test('dictionary destinations retain keys, original items, hashes, candidates and build operands',()=>{
  const receiver={},key={},item={},candidate={},after=completion('relay',{receiver:key});
  const fields={receiver,key,item,candidate,hash:7n,position:0,version:1,operation:'set',depth:0,after};
  for(const kind of ['dict-hash','dict-key','dict-truth'])
    assert.deepEqual(completionRoots(completion(kind,fields)),[receiver,key,7n,candidate,item,key]);
  assert.deepEqual(operationRoots(dictionaryTask(receiver,key,null,after,0,'set',item,7n)),[receiver,key,7n,item,key]);
  assert.deepEqual(operationRoots(dictionaryBuildTask(receiver,[key,item],null,after)),[receiver,key,item,key]);
  assert.deepEqual(completionRoots(completion('dict-build',{receiver,parts:[key,item],position:0,depth:0,after})),[receiver,key,item,key]);
  assert.throws(()=>completion('dict-key',{...fields,version:-1}),TypeError);
  assert.throws(()=>dictionaryTask(receiver,key,null,null,0,'future'),TypeError);
  assert.throws(()=>dictionaryBuildTask(receiver,[key],null),TypeError);
});

test('hash callbacks and invalid results preserve caller and body error boundaries',async()=>{
  const result=await run('class A:\n def __hash__(self):\n  return 1//0\nhash(A())\n');
  assert.equal(result.error.type,'ZeroDivisionError');
  assert.deepEqual(result.error.traceback.map(f=>[f.function,f.location.span[0]]),[['<module>',4],['__hash__',3]]);closed(result);
  const invalid=await run('class A:\n def __hash__(self): return "bad"\nhash(A())\n');
  assert.equal(invalid.error.type,'TypeError');assert.deepEqual(invalid.error.traceback.map(f=>f.function),['<module>']);closed(invalid);
});

test('recursive Python and native hash bindings share the depth limit',async()=>{
  for(const source of ['class A:\n def __hash__(self): return hash(self)\nhash(A())\n','class A:\n __hash__=property(hash)\nhash(A())\n']){
    const result=await run(source,{maxDepth:8,maxSteps:100000,maxWork:20000000});
    assert.equal(result.error.type,'RecursionError',JSON.stringify(result.error));closed(result);
  }
});

test('hash binding/body budgets, cancellation and actual callback OOM release key graphs',async()=>{
  for(const binding of [false,true]){
    const source='class A:\n '+(binding?'@property\n ':'')+'def __hash__(self):\n  print("entered")\n  while True: pass\nd={A():[[7]]}\n';
    for(const options of [{maxSteps:500},{maxSteps:100000,maxWork:60000}]){
      const result=await run(source,options);assert.equal(result.error.code,'BUDGET');assert.equal(result.stdout,'entered\n');closed(result);
    }
    let polls=0;const cancel=await run(source,{shouldCancel:()=>++polls>12000});assert.equal(cancel.error.code,'CANCELLED');closed(cancel);
  }
  const oom=await run('class A:\n def __hash__(self):\n  print("entered")\n  held=[]\n  while True: held.append([1,2,3])\nd={A():[[7]]}\n',{maxSteps:100000,maxWork:20000000},{maxBytes:32000});
  assert.equal(oom.error.code,'OOM');assert.equal(oom.stdout,'entered\n');closed(oom);
});

test('paused hash, key comparison/truth and dictionary value comparison retain pending graphs',async()=>{
  const sources=[
    ['class K:\n @property\n def __hash__(self):\n  print("entered")\n  def use(): return 7\n  return use\n def __eq__(self,other): return True\nd={K():[[7]]}\nprint(d[K()][0][0])\n','entered\nentered\n7\n'],
    ['class K:\n def __hash__(self): return 7\n @property\n def __eq__(self):\n  print("entered")\n  def use(other): return True\n  return use\nd={K():[7]}\nprint(d[K()][0])\n','entered\n7\n'],
    ['class R:\n @property\n def __bool__(self):\n  print("entered")\n  def use(): return True\n  return use\nclass K:\n def __hash__(self): return 7\n def __eq__(self,other): return R()\nd={K():[3]}\nd[K()]=[7]\nprint(d[next(iter(d))][0])\n','entered\n7\n'],
    ['class A:\n @property\n def __eq__(self):\n  print("entered")\n  def use(other): return True\n  return use\nprint({"x":A()}=={"x":7})\n','entered\nTrue\n']
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
      }assert.ok(reached);if(mode==='finish')assert.equal(output,expected);}
      finally{execution.close();execution.close();session.context.finish();session.close();}closed({closed:session.stats()});
    }}finally{registry.close();}
  }
});

test('structural comparison mutation refuses after effects before a stale lookup result',async()=>{
  const result=await run('class K:\n def __hash__(self): return 7\n def __eq__(self,other):\n  del d[self]\n  print("removed",len(d))\n  return True\na=K()\nd={a:7}\nprint(K() in d)\n');
  assert.equal(result.error.code,'UNSUPPORTED');assert.equal(result.stdout,'removed 0\n');closed(result);
});

test('failed arena resize preserves existing dictionary key/value storage',()=>{
  const memory=new MemoryArena({maxBytes:1980}),values=new ValueRuntime({memory}),roots=[];
  const leave=memory.enter(()=>roots),dict=values.dict([]);roots.push(dict);
  const key=values.string([65]);roots.push(key);values.commitDictionary(dict,key,7n,values.pythonHash(key),-1);
  const second=values.string([66]);roots.push(second);const item=values.list(Array(40).fill(7n));roots.push(item);
  assert.throws(()=>values.commitDictionary(dict,second,item,values.pythonHash(second),-1),{code:'OOM'});
  assert.equal(dict.entries[0].value,7n);assert.equal(dict.entries[0].key,key);
  leave();memory.close();closed({closed:memory.stats()});
});

test('native default-hash dictionary construction transfers operands between insertions',async()=>{
  const keys=Array.from({length:100},()=> 'K()').join(','),entries=Array.from({length:100},(_,i)=>'keys['+i+']:'+i).join(',');
  const result=await run('class K: pass\nkeys=['+keys+']\nd={'+entries+'}\nprint(len(d),d[keys[99]])\n',{maxSteps:100000,maxWork:20000000},{maxBytes:262144});
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'100 99\n');closed(result);
});

test('core-source retains its existing hash-name boundary',async()=>{
  const result=await runSourceRequest({modules:[unit('hash(7)\n')]});assert.equal(result.error.type,'NameError');closed(result);
  const key=await runSourceRequest({modules:[unit('def f(): pass\nd={f:7}\n')]});assert.equal(key.error.code,'UNSUPPORTED');closed(key);
});
