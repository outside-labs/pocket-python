import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {verifyFunctions} from "./function-bytecode.mjs";
import {verifyRegistry} from "./module-registry.mjs";
import {ModuleSession} from "./module-session.mjs";

const block = instructions => ({kind:"statement", instructions, source:{filename:"sources/app.py",spans:instructions.map(()=>[1,1,1,2])}});
const fn = (name,kind,locals,instructions,positional=[],free=[]) => ({name,qualname:name,kind,
  params:{posonly:[],positional,kwonly:[],defaults:[],kwdefaults:{}},locals,free,body:0,blocks:[block(instructions)]});
function program() {
  return {format:"pocket-python-bytecode",version:5,constants:[{type:"none"},{type:"int",value:"7"},{type:"int",value:"1"}],functions:[
    fn("<module>","module",["A","a"],[['class',1,0],['store','A'],['load','A'],['const',1],['call',1,[]],['store','a'],
      ['load','print'],['load','a'],['attribute-get','f'],['call',0,[]],['call',1,[]],['pop'],['end']]),
    fn("A","class",["__module__","__qualname__","__init__","f"],[['function',2],['store','__init__'],['function',3],['store','f'],['end']]),
    fn("__init__","function",["self","x"],[['load','self'],['load','x'],['attribute-set','n'],['pop'],['const',0],['return']],['self','x']),
    fn("f","function",["self"],[['load','self'],['attribute-get','n'],['const',2],['add'],['return']],['self'])]};
}
async function registry(program) {
  const assets=new Map(), encode=text=>new TextEncoder().encode(text);
  const asset=(path,text)=>{const bytes=encode(text);assets.set(path,bytes);return{path,size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
  const notice=asset('LICENSES/fixture.txt','Synthetic bytecode fixture notice\n');
  return verifyRegistry({kind:'pocket-python-module-registry',schema_version:1,entry:'app',roots:['code','sources'],modules:[{
    name:'app',package:false,bytecode:asset('code/app.pbc.json',JSON.stringify(program)),source:asset('sources/app.py','# Synthetic v5 bytecode fixture\n'),imports:[],licenses:[notice]}]},assets);
}
async function run(code, options = {}, memoryLimits={}) {
  const reg=await registry(code), session=new ModuleSession(reg,{memoryLimits});let stdout='',error=null;
  try{session.run(options,text=>{stdout+=text;});}catch(caught){error=caught;}
  const stats=session.stats();session.close();reg.close();
  assert.equal(session.stats().bytes,0);assert.equal(session.stats().roots,0);assert.equal(session.stats().frames,0);
  return{stdout,error,stats};
}

test('version 5 class bodies, initialization and method frames run through the ordinary VM',async()=>{
  const code=program();verifyFunctions(code);
  const reg=await registry(code);
  assert.equal(reg.program('app').functions[1].kind,'class');reg.close();
  const result=await run(code);assert.equal(result.error,null);assert.equal(result.stdout,'8\n');assert.equal(result.stats.frames,0);
});

test('initializers must return None and their failure is attributed to the class call',async()=>{
  const code=program();code.functions[2].blocks=[block([['const',2],['return']])];
  const result=await run(code);assert.equal(result.error.name,'TypeError');assert.equal(result.stdout,'');
  assert.deepEqual(result.error.traceback.map(frame=>frame.function),['<module>']);
});

test('class construction errors follow completed body side effects without adding a body traceback',async()=>{
  const code=program();
  code.functions[0]=fn('<module>','module',['A','B'],[['class',1,0],['store','A'],['load','A'],['load','A'],['class',4,2],['store','B'],['end']]);
  code.functions.push(fn('B','class',['__module__','__qualname__'],[['load','print'],['const',1],['call',1,[]],['pop'],['end']]));
  const result=await run(code);assert.equal(result.error.name,'TypeError');assert.equal(result.stdout,'7\n');
  assert.deepEqual(result.error.traceback.map(frame=>frame.function),['<module>']);
});

test('v5 verification rejects class/function confusion, bad bases, captures and attribute stack shapes',()=>{
  for(const change of [
    c=>{c.version=4;},c=>{c.functions[1].kind='function';},
    c=>{c.functions[0].blocks[0].instructions[0]=['function',1];},
    c=>{c.functions[0].blocks[0].instructions[0]=['class',1,17];},
    c=>{c.functions[1].blocks[0].instructions=[['const',0],['return']];c.functions[1].blocks[0].source.spans=[[1,1,1,2],[1,1,1,2]];},
    c=>{c.functions[1].locals.push('hidden');c.functions[3].free=['hidden'];},
    c=>{c.functions[2].blocks=[block([['const',0],['attribute-set','n'],['pop'],['end']])];},
    c=>{c.functions[2].blocks[0].instructions[2]=['attribute-set','../private'];}
  ]){const code=program();change(code);assert.throws(()=>verifyFunctions(code),{code:'BYTECODE'});}
});

test('class frames share instruction, recursion, cancellation and arena limits with functions',async()=>{
  for(const options of [{maxSteps:5},{maxDepth:1},{shouldCancel:()=>true}]){
    const result=await run(program(),options);assert.ok(result.error);assert.equal(result.stats.frames,0);
    assert.ok(['BUDGET','CANCELLED','PYTHON'].includes(result.error.code));
  }
  const reg=await registry(program()), initial=new ModuleSession(reg), baseline=initial.stats().bytes;
  initial.close();reg.close();
  const result=await run(program(),{}, {maxBytes:baseline+512});assert.equal(result.error.code,'OOM');assert.equal(result.stats.frames,0);
});

test('verified v5 unary operations resume user length and truth without source lowering',async()=>{
  for(const [operation,expected] of [['len','8'],['truth','True'],['not','False']]){
    const code=program();
    code.functions[1].locals[3]='__len__';
    code.functions[1].blocks[0].instructions[3]=['store','__len__'];
    code.functions[3].name=code.functions[3].qualname='__len__';
    code.functions[0].blocks=[block([['class',1,0],['store','A'],['load','A'],['const',1],['call',1,[]],['store','a'],
      ['load','print'],['load','a'],[operation],['call',1,[]],['pop'],['end']])];
    const result=await run(code);
    assert.equal(result.error,null);assert.equal(result.stdout,expected+'\n');assert.equal(result.stats.frames,0);
  }
});
