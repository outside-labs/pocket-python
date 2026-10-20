"""Local text-input UI for the compiled-javascript application profile."""

PAGE = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>__TITLE__</title><link rel="manifest" href="./manifest.webmanifest"><link rel="icon" href="./icon.svg">
<style>body{font:1.1rem system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.5rem;color:#19362c;background:#f4f7f1}
textarea{box-sizing:border-box;width:100%;min-height:12rem;padding:1rem;font:inherit;border:1px solid #779287;border-radius:.5rem;background:white}
button{padding:.6rem 1rem;font:inherit;border:1px solid #779287;border-radius:.4rem;background:white;cursor:pointer}
#run{background:#225841;color:white}nav{display:flex;gap:.5rem;margin:1rem 0}pre{min-height:3rem;white-space:pre-wrap;padding:1rem;background:white;border-radius:.5rem}</style>
<main><h1>__TITLE__</h1><p>Run this application locally in your browser.</p>
<label for="input">Text</label><textarea id="input" placeholder="Write something…"></textarea>
<nav><button id="run" disabled>Run</button><button id="stop">Stop</button><button id="restart">Restart</button></nav>
<label for="result">Result</label><pre id="result" aria-live="polite"></pre><p id="status" role="status"></p><p id="offline" role="status">Preparing offline use…</p></main>
<script type="module" src="./__LAUNCHER__"></script></html>'''

APP = '''import {mountCompiledApplication} from './__APPLICATION__/browser-host.mjs';
const byId=name=>document.getElementById(name);
const config=await(await fetch('./__CONFIG__')).json();
let current;
function start(){
  current?.stop();byId('run').disabled=true;byId('result').textContent='';byId('status').textContent='Starting…';
  const active=mountCompiledApplication({application:config.application,capabilities:config.capabilities,
    controls:Object.fromEntries(['input','run','result','status'].map(name=>[name,byId(name)])),
    eventInputs:{run:'input'},output:byId('result'),onError:error=>{
      byId('run').disabled=true;
      const at=error.location?' ('+error.location.filename+':'+error.location.line+':'+error.location.column+')':'';
      byId('status').textContent=error.type+': '+error.message+at;
    }});
  current=active;
  active.ready.then(async()=>{
    while(current===active&&active.stats().state==='ready'&&active.stats().subscriptions<1)await new Promise(requestAnimationFrame);
    if(current===active&&active.stats().state==='ready'){byId('run').disabled=false;byId('status').textContent='Ready';}
  },()=>{});
}
byId('run').addEventListener('click',()=>{byId('result').textContent='';});
byId('stop').addEventListener('click',()=>{current?.stop();byId('run').disabled=true;byId('status').textContent='Stopped';});
byId('restart').addEventListener('click',start);
async function prepareOffline(){
  if(!('serviceWorker' in navigator))throw new Error('This browser does not support offline installation.');
  const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});
  const installing=registration.installing||registration.waiting;
  if(installing&&installing.state!=='activated')await new Promise((resolve,reject)=>{
    function changed(){if(installing.state==='activated')resolve();if(installing.state==='redundant')reject(new Error('Offline installation failed.'));}
    installing.addEventListener('statechange',changed);changed();
  });
  await navigator.serviceWorker.ready;
  byId('offline').textContent='Offline ready on this device';
}
prepareOffline().catch(error=>{byId('offline').textContent='Offline unavailable: '+error.message;});
start();
'''
