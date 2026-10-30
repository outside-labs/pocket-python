import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSourceRequest} from './source-request.mjs';
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {MemoryArena} from './memory.mjs';
import {valueLayout} from './values.mjs';
import {ClassRuntime} from './class-values.mjs';
import {NATIVE_NAMESPACES} from './native-namespaces.mjs';
import {BuiltinValue, ExceptionValue, EXCEPTIONS} from './function-objects.mjs';
import {Execution} from './functions.mjs';

const profile = {languageProfile: 'classes-source/1'};
const unit = source => ({name: 'app', package: false, imports: [], source, notice: 'Synthetic native directory closure fixture'});
const run = (source, options = {}, memoryLimits) => runSourceRequest({modules: [unit(source)], compileOptions: profile, options: {maxWork: 20000000, ...options}, memoryLimits});
const closed = stats => { for (const key of ['bytes', 'objects', 'roots', 'frames', 'external']) assert.equal(stats[key], 0, key); };
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/native-directory-closure.json', import.meta.url)));
for (const item of corpus.cases) test('native directory closure: ' + item.id, async () => {
  const result = await runSourceRequest({modules: [{...unit(item.source), imports: item.imports ?? []}, ...(item.modules ?? []).map(module => ({...module, notice: "Synthetic native layout fixture"}))], compileOptions: profile, options: {maxWork:20000000}});
  if (corpus.implemented_stages.includes(item.stage)) {
    assert.equal(result.stdout, item.stdout);
    assert.equal(result.error?.type, item.error_type, JSON.stringify(result.error));
  } else assert.equal(result.error?.code, 'UNSUPPORTED', JSON.stringify(result.error));
  if (result.closed) closed(result.closed);
});

async function lifecycle(source, expected) {
  const {registry} = await compileSourceModules([unit(source)], profile);
  try { for (const mode of ['finish', 'cancel', 'close']) {
    const session = new ModuleSession(registry); let output = '', cancel = false, reached = false;
    session.context.begin({maxWork: 20000000, shouldCancel: () => cancel}, text => { output += text; });
    const execution = Execution.modules(session.context);
    try {
      while (execution.state !== 'completed') {
        execution.advance(); if (execution.state === 'paused') execution.park();
        session.memory.collect([], {cleanup: true});
        if (!reached && output === 'entered\n' && execution.state === 'parked') {
          reached = true;
          if (mode === 'cancel') { cancel = true; assert.throws(() => execution.advance(), {code: 'CANCELLED'}); break; }
          if (mode === 'close') break;
        }
      }
      assert.ok(reached); if (mode === 'finish') assert.equal(output, expected);
    } finally {
      const before = output;
      execution.close(); execution.close(); session.context.finish(); session.close();
      assert.equal(output, before, 'teardown must not run directory or contained callbacks');
    }
    closed(session.stats());
  } } finally { registry.close(); }
}

const audit = JSON.parse(readFileSync(new URL('../docs/interpreter-directory-layouts.json', import.meta.url)));
test('the layout audit accounts for every actual native type and callable descriptor layout', () => {
 assert.deepEqual(audit.native_types.map(row=>row.type).sort(),Object.keys(NATIVE_NAMESPACES).sort());
 const ids=new Map(corpus.cases.map(item=>[item.id,item]));
 for (const row of audit.native_types) {
  assert.equal(ids.get(row.type_case)?.stage,'O78',row.type);
  if(row.instance_case) assert.equal(ids.get(row.instance_case)?.stage,'O78',row.type);
  else { assert.equal(row.instance_boundary?.owner,'#124');assert.equal(ids.get(row.instance_boundary.case)?.stage,'ExceptionConstruction'); }
 }
 for(const [type, reference] of Object.entries(audit.source_layouts)) {
  const [file,id]=reference.split(':');const source=JSON.parse(readFileSync(new URL('../tests/fixtures/interpreter/'+file,import.meta.url)));
  assert.ok(source.cases.some(item=>item.id===id),type);
 }
});
test('every materialized native callable and descriptor has an actual-layout directory', () => {
 const classes=new ClassRuntime(), nativeTypes=new Map([["object",classes.root()]]);
 classes.builtin=name=>{if(!nativeTypes.has(name))nativeTypes.set(name,classes.make(BuiltinValue,name));return nativeTypes.get(name);};
 for(const [name,entries] of Object.entries(NATIVE_NAMESPACES)) {
  const owner=classes.builtin(name),namespace=classes.namespaceDictionary(owner);
  for(const [key,kind] of entries) {
   if(kind==='value')continue;
   const item=namespace.entries.find(entry=>classes.values.text(entry.key)===key).value;
   assert.ok(classes.hasFixedDirectory(item),name+'.'+key);
   assert.ok(classes.directoryNames(item).some(label=>classes.values.text(label)==='__class__'),name+'.'+key);
  }
 }
 for(const name of Object.keys(EXCEPTIONS)) {
  const item=new ExceptionValue(name,[],''),names=classes.directoryNames(item).map(label=>classes.values.text(label));
  assert.ok(names.includes('__dict__'),name);assert.ok(names.includes('args'),name);
 }
});
for(const [name,source,expected] of [
 ['code and cell','def outer():\n x=[7]\n def f(): return x\n return f\nf=outer()\ncell=f.__closure__[0]\ncode=f.__code__\nd=code.__dir__\nc=cell.__dir__\ndel f\ndel cell\ndel code\nprint("entered")\nprint("co_consts" in d(),"cell_contents" in c())\n','entered\nTrue True\n'],
 ['retained frame','def g(): yield [7]\ngen=g()\nframe=gen.gi_frame\nproxy=frame.f_locals\nd=frame.__dir__\np=proxy.__dir__\ngen.close()\ndel gen\ndel frame\ndel proxy\nprint("entered")\nprint("f_locals" in d(),"keys" in p())\n','entered\nTrue True\n'],
 ['primitive callable','values=[]\nd=values.append.__dir__\ndel values\nprint("entered")\nprint("__self__" in d())\n','entered\nTrue\n'],
]) test(name+' callers survive parking collection cancellation and close',async()=>{await lifecycle(source,expected);});
for(const operation of ['dir(len)','dir(code)','dir(frame)','type.__dir__(type)']) test(operation+' shares limits',async()=>{
 for(const [options,limits,expected] of [[{maxSteps:300},undefined,'BUDGET'],[{maxSteps:100000,maxWork:30000},undefined,'BUDGET'],[{maxSteps:100000,maxWork:20000000},{maxBytes:22000},'OOM']]) {
  const result=await run('def f(): return 7\ndef g(): yield 7\ncode=f.__code__\ngen=g()\nframe=gen.gi_frame\nprint("entered")\nwhile True: names='+operation+'\n',options,limits);
  assert.equal(result.error?.code,expected,JSON.stringify(result.error));assert.equal(result.stdout,'entered\n');closed(result.closed);
 }
});
test('native key caches charge their table and roll back failed allocation and publication',()=>{
 const plain=new ClassRuntime(),sample=plain.make(BuiltinValue,'cell'),labels=plain.nativeNamespaceKeys(sample);
 const finalBytes=valueLayout(sample).bytes+labels.reduce((sum,label)=>sum+valueLayout(label).bytes,0);
 for(const limits of [{maxObjects:7},{maxBytes:finalBytes-1}]) {
  const memory=new MemoryArena(limits),roots=[],leave=memory.enter(()=>roots);
  try {
   const classes=new ClassRuntime({memory}),type=classes.make(BuiltinValue,'cell');roots.push(type);
   const before=valueLayout(type);
   assert.throws(()=>classes.nativeNamespaceKeys(type),{code:'OOM'});
   assert.equal(type.namespaceKeys,undefined);assert.deepEqual(valueLayout(type),before);
   memory.collect([], {cleanup:true});assert.equal(memory.stats().objects,1);
  } finally {leave();memory.close();}closed(memory.stats());
 }
 const classes=new ClassRuntime(),type=classes.make(BuiltinValue,'cell'),keys=classes.nativeNamespaceKeys(type),dictionary=classes.namespaceDictionary(type);
 assert.equal(type.namespaceKeys,undefined);assert.deepEqual(dictionary.entries.map(entry=>entry.key),keys);
});
