"""Browser observations for immutable, known local application fixtures."""

import json
import time


PAGE_OBSERVER = '''(()=>{
  window.measurement={ready_ms:null,offline_ms:null};
  const observer=new MutationObserver(()=>{
    if(window.measurement.ready_ms===null&&document.getElementById('status')?.textContent==='Ready')window.measurement.ready_ms=performance.now();
    if(window.measurement.offline_ms===null&&document.getElementById('offline')?.textContent==='Offline ready on this device')window.measurement.offline_ms=performance.now();
  });
  observer.observe(document,{subtree:true,childList:true,characterData:true});
  window.measureWorkload=async entries=>{
    const samples=[];
    for(const entry of entries){
      const before=performance.now();
      const done=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{watch.disconnect();reject(new Error('Workload output timed out'));},10000);
        const watch=new MutationObserver(()=>{
          if(document.getElementById('result').textContent===entry.expected_stdout){clearTimeout(timer);watch.disconnect();resolve(performance.now()-before);}
        });
        watch.observe(document.getElementById('result'),{subtree:true,childList:true,characterData:true});
      });
      document.getElementById('input').value=entry.input;
      document.getElementById('run').click();
      samples.push({id:entry.id,result_ms:await done,stdout:document.getElementById('result').textContent});
    }
    return samples;
  };
})();'''


def ready(page):
    page.wait_for_function('document.getElementById("status").textContent==="Ready"')
    page.wait_for_function('document.getElementById("offline").textContent==="Offline ready on this device"')
    page.wait_for_function('navigator.serviceWorker.controller!==null')


def worker_heap(browser, page):
    connection = browser.new_browser_cdp_session()
    session = None
    try:
        page_connection = page.context.new_cdp_session(page)
        try:
            context_id = page_connection.send('Target.getTargetInfo')['targetInfo']['browserContextId']
        finally:
            page_connection.detach()
        target = next(item for item in connection.send('Target.getTargets')['targetInfos']
                      if item['type']=='worker' and item['url']==page.workers[0].url
                      and item.get('browserContextId')==context_id)
        session = connection.send('Target.attachToTarget',{'targetId':target['targetId'],'flatten':False})['sessionId']
        responses = {}
        def receive(event):
            message = json.loads(event['message'])
            if event['sessionId']==session and 'id' in message:
                responses[message['id']] = message
        connection.on('Target.receivedMessageFromTarget',receive)
        for identity, method in enumerate(['HeapProfiler.collectGarbage','Runtime.getHeapUsage'],1):
            connection.send('Target.sendMessageToTarget',{'sessionId':session,'message':json.dumps({'id':identity,'method':method})})
            deadline = time.monotonic()+10
            while identity not in responses and time.monotonic()<deadline:
                page.wait_for_timeout(5)
            response = responses.get(identity)
            if response is None or 'error' in response:
                raise RuntimeError(('Worker heap observation failed',response))
        return responses[2]['result']
    finally:
        if session is not None:
            connection.send('Target.detachFromTarget',{'sessionId':session})
        connection.detach()
