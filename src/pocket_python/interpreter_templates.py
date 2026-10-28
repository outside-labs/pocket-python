"""Source editor and scoped offline installation for the independent interpreter."""

PAGE = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'">
<title>__TITLE__</title><link rel="manifest" href="./manifest.webmanifest"><link rel="icon" href="./icon.svg">
<style>body{font:1rem system-ui,sans-serif;max-width:56rem;margin:3rem auto;padding:0 1.5rem;color:#19362c;background:#f4f7f1}
textarea{box-sizing:border-box;width:100%;min-height:20rem;padding:1rem;font:1rem/1.6 ui-monospace,monospace;tab-size:4;border:1px solid #779287;border-radius:.5rem;background:white}
button{padding:.6rem 1rem;font:inherit;border:1px solid #779287;border-radius:.4rem;background:white;cursor:pointer}button:disabled{opacity:.5;cursor:default}
#run{background:#225841;color:white}nav{display:flex;gap:.5rem;margin:1rem 0}pre{min-height:2rem;overflow-wrap:anywhere;white-space:pre-wrap;padding:1rem;background:white;border-radius:.5rem}
#diagnostic{color:#8b2323;min-height:0}#diagnostic:empty{display:none}.note{color:#4a6358;font-size:.9rem}label{display:block;margin-bottom:.5rem;font-weight:600}</style>
<main><h1>__TITLE__</h1><p>Write Python and run it on this device. Each run starts with fresh variables.</p>
<label for="input">Python source</label><textarea id="input" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="language"></textarea>
<p id="language" class="note">Loading the selected language profile…</p>
<p id="libraries" class="note"></p>
<nav aria-label="Execution"><button id="run" disabled>Run</button><button id="stop">Stop</button><button id="restart">Restart</button></nav>
<p id="status" role="status">Starting…</p><label for="result">Output</label><pre id="result" aria-live="polite"></pre><pre id="diagnostic" role="alert"></pre>
<p id="offline" role="status">Preparing offline use…</p><p class="note">Source stays in this tab. Reload restores the supplied example.</p></main>
<script type="module" src="./__LAUNCHER__"></script></html>'''

APP = '''import {mountInterpreter} from './__ENGINE__/interpreter-host.mjs';
const byId=name=>document.getElementById(name);
let current=null,generation=0;
async function verified(path,digest,maximum){
  const response=await fetch(path,{cache:'no-store'});
  if(!response.ok)throw new Error('Application asset is unavailable: '+path);
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;
    if((size+=value.byteLength)>maximum){await reader.cancel();throw new Error('Application asset byte budget exceeded.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==digest)throw new Error('Application asset hash differs: '+path);
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function showError(error){
  const value=error.detail||error;
  const at=value.location?' ('+value.location.filename+':'+value.location.line+':'+value.location.column+')':'';
  byId('status').textContent=(value.type||error.name||'Error')+': '+value.message+at;
  byId('diagnostic').textContent=(value.frames||[]).map(frame=>frame.function+(frame.location?' at '+frame.location.filename+':'+frame.location.line:'')).join('\\n');
}
let config;
function start(){
  const turn=++generation;current?.stop('restart');current=null;
  byId('run').disabled=true;byId('result').textContent='';byId('diagnostic').textContent='';byId('status').textContent='Starting…';
  try{
    const active=mountInterpreter({application:config.application,capabilities:config.capabilities,limits:config.limits,
      libraryProfile:config.library_profile,libraries:config.library_sources,hostProfile:config.host_profile,
      onOutput:text=>{if(turn===generation)byId('result').append(document.createTextNode(text));},
      onError:error=>{if(turn===generation){byId('run').disabled=true;showError(error);}}});
    current=active;
    active.ready.then(()=>{if(turn===generation){byId('run').disabled=false;byId('status').textContent='Ready';}},error=>{if(turn===generation)showError(error);});
  }catch(error){showError(error);}
}
byId('run').addEventListener('click',async()=>{
  const turn=generation,active=current;if(!active)return;
  byId('run').disabled=true;byId('result').textContent='';byId('diagnostic').textContent='';byId('status').textContent='Running…';
  try{await active.run(byId('input').value);if(turn===generation)byId('status').textContent='Completed';}
  catch(error){if(turn===generation)showError(error);}
  finally{if(turn===generation)byId('run').disabled=active.stats().state!=='ready';}
});
byId('stop').addEventListener('click',()=>{generation++;current?.stop();byId('run').disabled=true;byId('status').textContent='Stopped';});
byId('restart').addEventListener('click',()=>{if(config)start();});
window.addEventListener('pagehide',()=>{generation++;current?.stop();});
window.addEventListener('pageshow',event=>{if(event.persisted&&config)start();});
async function prepareOffline(){
  if(!('serviceWorker' in navigator))throw new Error('This browser does not support offline installation.');
  const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});
  function describe(){byId('offline').textContent=registration.waiting?'Update ready. Close this app’s tabs and windows, then reopen to update.':'Offline ready on this device';}
  function watch(){registration.installing?.addEventListener('statechange',()=>{if(registration.active)describe();});}
  registration.addEventListener('updatefound',watch);watch();
  const installing=registration.installing||registration.waiting;
  if(!registration.active&&installing&&installing.state!=='activated')await new Promise((resolve,reject)=>{
    function changed(){if(installing.state==='activated')resolve();if(installing.state==='redundant')reject(new Error('Offline installation failed.'));}
    installing.addEventListener('statechange',changed);changed();
  });
  await navigator.serviceWorker.ready;describe();
}
prepareOffline().catch(error=>{byId('offline').textContent='Offline unavailable: '+error.message;});
try{
  config=JSON.parse(await verified('./__CONFIG__','__CONFIG_SHA__',65536));
  const descriptions={'classes-source/1':'Language profile: classes-source/1. Supports the core subset plus classes, inheritance, attributes, methods, private names, descriptors, properties, decorators, callable objects, length/truth, repr/str, integer indices and item/slice access and mutation, iteration and containment, equality and hashing. Ranges, list/tuple construction and all/any support adopted user protocols; user length hints are a later stage. Functions support computed/mutable defaults, global/nonlocal state, variadic parameters and starred calls. Assertions, assignment expressions, lambdas, unpacking targets and starred sequence/dictionary displays are available. Finite sets, bytes, bytearrays and memoryviews, with strict UTF-8/ASCII/Latin-1 codecs, are available in both profiles. Bytearray resizing, buffer casts and native buffers are later stages. Numeric operators, helpers and real/complex values are available in both profiles; numeric conversion and abs/round hooks use class type lookup. Generators, yield from, send/throw/close and scoped comprehensions are available. Attribute reflection and arithmetic/reflected/in-place hooks use ordinary class descriptors. Owned construction, super and finite metaclasses with ordinary dictionary namespaces are available. Type relations accept nested tuples of adopted types. Owned instance attribute hooks and advertised class identities are available. Metaclass and ordinary checker custom instance/subclass checks use owned descriptors and truth conversion; native type defaults retain actual ancestry. Builtin instance subclasses and custom class namespace preparation are later stages. Rich ordering methods and bounded list/tuple/slice comparisons are available. Properties support accessor copies and explicit function binding is available. Stable object IDs, optimized function and generator-expression namespace snapshots and custom vars/dir hooks are available. Custom directories support length hints and stable rich ordering. Inlined list/dict/set comprehensions expose enclosing function snapshots or isolated module/class snapshots. Live namespace mappings and default directories are later stages. Float/container/default-object formatting and async are later stages.',
    'core-source/1':'Language profile: core-source/1. Supports values, loops, functions with computed/mutable defaults, global/nonlocal state, variadic parameters and starred calls, assertions, assignment expressions, lambdas, unpacking targets and starred sequence/dictionary displays, exceptions, primitive repr/str, ranges, primitive list/tuple construction, all/any, numeric operators/helpers and real/complex values. Finite sets, bytes, bytearrays and memoryviews, with strict UTF-8/ASCII/Latin-1 codecs, are available. Bytearray resizing, buffer casts and native buffers are later stages. Generators, yield from, send/throw/close and scoped comprehensions are available. Classes require the explicit class profile; async and external packages are later stages.'};
  if(!Object.hasOwn(descriptions,config.application.engine.language_profile))throw new Error('Source language profile is unavailable.');
  byId('language').textContent=descriptions[config.application.engine.language_profile];
  config.library_sources=[];
  for(const module of config.libraries){config.library_sources.push({name:module.name,package:module.package,imports:module.imports,
    source:await verified('./'+module.source.path,module.source.sha256,module.source.size_bytes),
    notice:await verified('./'+module.notice.path,module.notice.sha256,module.notice.size_bytes)});}
  byId('libraries').textContent='Library profile: '+config.library_profile+'. Host profile: '+config.host_profile+'.';
  byId('input').value=await verified('./'+config.source.path,config.source.sha256,65536);
  start();
}catch(error){showError(error);}
'''

SERVICE_WORKER = '''const RECORDS=__RECORDS__;
const FILES=[...RECORDS.map(record=>record.path),'service-worker.js','POCKET-PYTHON.json'];
const PREFIX='pocket-python:'+self.registration.scope+':';
const CACHE=PREFIX+'__VERSION__';
self.addEventListener('install',event=>{
  const requests=RECORDS.map(record=>new Request(new URL(record.path,self.registration.scope),{
    cache:'reload',integrity:'sha256-'+btoa(String.fromCharCode(...record.sha256.match(/../g).map(hex=>parseInt(hex,16))))}));
  requests.push(...['service-worker.js','POCKET-PYTHON.json'].map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
  // Install the complete verified graph. Keep the previous version until every
  // old app tab/window has closed; never switch a running session mid-graph.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(requests)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||url.origin!==scope.origin||!url.href.startsWith(scope.href))return;
  event.respondWith((async()=>{
    const path=url.pathname===scope.pathname?'index.html':decodeURI(url.pathname.slice(scope.pathname.length));
    if(url.search||!FILES.includes(path))return new Response('Not found',{status:404});
    const cache=await caches.open(CACHE),key=new URL(path,scope).href;
    return(await cache.match(key))||new Response('Offline asset missing; reinstall this application.',{status:503});
  })());
});
'''
