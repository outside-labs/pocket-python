import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from './source-compiler.mjs';
import {runSourceRequest} from './source-request.mjs';
import {verifyFunctions} from './function-bytecode.mjs';
const profile={languageProfile:'classes-source/1'};
const unit=(source,name='app',imports=[])=>({name,source,package:false,imports,notice:'Synthetic class source notice'});
const run=(source,options={})=>runSourceRequest({modules:[unit(source)],compileOptions:profile,...options});

test('classes require explicit source selection and emit frozen verified v5 record kinds',async()=>{
  assert.equal(compileSource('pass').program.version,4);
  const source='class A:\n def f(self): return 7\nprint(A().f())\n';
  assert.throws(()=>compileSource(source),{code:'UNSUPPORTED'});
  assert.throws(()=>compileSource(source,{languageProfile:'unknown/1'}),{code:'UNSUPPORTED'});
  const compiled=compileSource(source,profile);verifyFunctions(compiled.program);
  assert.equal(compiled.program.version,5);assert.equal(compiled.languageProfile,'classes-source/1');
  assert.deepEqual(compiled.program.functions.map(fn=>fn.kind),['module','class','function']);
  assert.equal(compiled.program.functions[2].qualname,'A.f');assert.ok(Object.isFrozen(compiled.program.functions));
  const result=await run(source);assert.equal(result.error,undefined);assert.equal(result.stdout,'7\n');
  assert.equal(result.compilation[0].language_profile,'classes-source/1');assert.equal(result.closed.bytes,0);
});

test('class namespaces and nested methods carry outer cells without capturing class locals',async()=>{
  const source='x=8\ndef make(y):\n class Outer:\n  y=1\n  class Inner:\n   z=x\n   def f(self): return y\n return Outer\nOuter=make(9)\nprint(Outer.y,Outer.Inner.z,Outer.Inner().f(),Outer.Inner.__qualname__)\n';
  const result=await run(source);assert.equal(result.error,undefined,JSON.stringify(result.error));
  assert.equal(result.stdout,'1 8 9 make.<locals>.Outer.Inner\n');assert.equal(result.closed.objects,0);
  const compiled=compileSource(source,profile);
  const outer=compiled.program.functions.find(fn=>fn.name==='Outer');
  assert.ok(outer.locals.includes('y')&&outer.free.includes('y'));
});

test('class imports share object identity while inherited methods retain their defining globals',async()=>{
  const modules=[unit('n=99\nimport helper\nclass B(helper.A): pass\nb=B()\nprint(b.f(),B.__mro__[-1] is object,isinstance(b,helper.A))\n','app',['helper']),
    unit('n=5\nclass A:\n def f(self): return n\n','helper')];
  const result=await runSourceRequest({modules,compileOptions:profile});
  assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.stdout,'5 True True\n');
  assert.equal(result.closed.bytes,0);assert.equal(result.closed.roots,0);
});

test('metadata overrides and later class stages refuse before source effects',async()=>{
  for(const source of [
    'class A:\n __module__="custom"\n',
    'class A:\n def __qualname__(self): pass\n',
    'class A:\n from helper import value as __module__\n',
    'class A:\n def __matmul__(self,x): return 7\n',
    'class A: pass\na=A()\na.__class__=A\n',
    'class A(metaclass=type,**{}): pass\n','class A[T]: pass\n','class A(*bases): pass\n',
    'async def f(): pass\n'
  ]){
    const result=await run("print('never')\n"+source);
    assert.equal(result.error.code,'UNSUPPORTED',source);assert.equal(result.stdout,'');assert.equal(result.stats,null);
  }
});

test('class suites reset return/loop scope and retain construction/body traceback boundaries',async()=>{
  for(const source of ['def f():\n class A:\n  return 1\n','while True:\n class A:\n  break\n'])
    assert.throws(()=>compileSource(source,profile),{code:'SYNTAX'});
  const result=await run('class A:\n 1//0\n');assert.equal(result.error.type,'ZeroDivisionError');
  assert.deepEqual(result.error.traceback.map(frame=>frame.function),['<module>','A']);
  assert.deepEqual(result.error.traceback.map(frame=>frame.location.span[0]),[1,2]);
  const returned=await run('class A:\n def __init__(self): return 7\nA()\n');
  assert.equal(returned.error.type,'TypeError');assert.equal(returned.error.location.span[0],3);
});

test('class source shares compile, execution, recursion, cancellation and C3 growth limits',async()=>{
  const source='class A:\n def f(self): return self.f()\nA().f()\n';
  const recursion=await run(source,{options:{maxDepth:8}});assert.equal(recursion.error.type,'RecursionError');assert.equal(recursion.closed.frames,0);
  const cancelled=await run(source,{compileOptions:{...profile,shouldCancel:()=>true}});assert.equal(cancelled.error.code,'CANCELLED');assert.equal(cancelled.stdout,'');
  const budget=await run(source,{compileOptions:{...profile,maxNodes:2}});assert.equal(budget.error.code,'COMPILE_BUDGET');
  const deep=Array.from({length:64},(_,i)=>'class C'+i+(i?'(C'+(i-1)+')':'')+': pass\n').join('');
  const result=await run(deep,{options:{maxSteps:100000,maxWork:100000000}});
  assert.equal(result.error.code,'BUDGET',JSON.stringify(result.error));assert.match(result.error.message,/MRO/);
  assert.equal(result.closed.bytes,0);assert.equal(result.closed.roots,0);assert.equal(result.closed.frames,0);
});
