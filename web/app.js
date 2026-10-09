const $ = id => document.getElementById(id);
const isLocal = location.origin === 'http://127.0.0.1:4183';
const mode = isLocal ? 'local-controller' : 'static-browser-fixture';
let core, current = null, phase = 0, events = [], start = 0, busy = false;
let replaying = false, replayGeneration = 0, report = null;
const frame = $('fixture');
const scenarioNames = {retired:'Retire old assets',retained:'Keep old assets',expired:'Expire the session'};
const delay = (ms, signal) => new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
  const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};
  const timer=setTimeout(finish,ms);
  const cancel=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
  signal?.addEventListener('abort',cancel,{once:true});
});
function setText(id,text){$(id).textContent=text;}
function message(text,error=false){if(error){$('error').hidden=false;setText('error',text);}else setText('status',text);}
function setBusy(value){busy=value;$('run').disabled=value||!core;$('scenarioFields').disabled=value;$('cancel').hidden=!value;$('replay').disabled=value||!report;$('export').disabled=value||!report;}
function step(event){const next=core.shift_transition(phase,event)>>>0;if(next===0xffffffff)throw new Error('Rust core rejected an out-of-order transition.');phase=next;}
function renderEvent(event,index){
  const li=document.createElement('li'); if(event.kind==='warning')li.className='warning';
  const mark=document.createElement('span');mark.textContent=event.kind==='warning'?'!':'✓';mark.setAttribute('aria-hidden','true');
  const body=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small'),time=document.createElement('time');
  title.textContent=event.title;detail.textContent=event.detail;time.textContent=`+${(event.atMs/1000).toFixed(2)}s`;
  body.append(title,detail);li.append(mark,body,time);$('timeline').append(li);setText('traceCount',`${index+1} events`);
}
function add(title,detail,kind='ok',evidence={}){
  if(events.length>=core.shift_max_events())throw new Error('The trace reached its 64-event limit.');
  const event={sequence:events.length+1,atMs:Math.round(performance.now()-start),title,detail,kind,evidence};events.push(event);renderEvent(event,events.length-1);
  $('timeline').scrollTop=$('timeline').scrollHeight;
}
function resetMetrics(){for(const id of ['draftMetric','cacheMetric','sessionMetric'])setText(id,'Not observed');setText('draftDetail','Checked across the transition');setText('cacheDetail','Normal browser behavior');setText('sessionDetail','Synthetic fixture session only');setText('nextMetric','Observing the handoff');setText('nextDetail','Evidence, then a safe decision');$('recover').hidden=true;$('nextDetail').hidden=false;}
async function controller(action,run,scenario,signal){
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(!isLocal)return;
  const request=new AbortController();
  const cancel=()=>request.abort(new DOMException('Cancelled','AbortError'));
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>request.abort(new DOMException('Local fixture controller timed out.','TimeoutError')),2500);
  try{
    const response=await fetch(`/__shift/${action}?run=${encodeURIComponent(run)}${scenario?`&scenario=${scenario}`:''}`,{method:'POST',signal:request.signal});
    if(!response.ok)throw new Error(`Local fixture controller returned HTTP ${response.status}.`);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
async function cleanup(run,signal){if(!run)return;try{sessionStorage.removeItem(`shift.fixture.${run.id}`);}catch{}try{await controller('end',run.id,undefined,signal);}catch{/* Cleanup failure never fabricates a pass; next reset will surface server capacity. */}}
function sanitizeResources(resources){
  if(!Array.isArray(resources))return [];
  const allowed=['/fixtures/v1/checkout.js','/fixtures/retired-v1/checkout.js','/fixture/v1/checkout.js'];
  return resources.slice(0,4).filter(r=>r&&allowed.includes(r.path)).map(r=>({path:r.path,durationMs:Math.max(0,Math.min(30000,Number(r.durationMs)||0)),transferBytes:Math.max(0,Math.min(1048576,Number(r.transferBytes)||0)),encodedBytes:Math.max(0,Math.min(1048576,Number(r.encodedBytes)||0))}));
}
function waitFrame(types,run){
  return new Promise((resolve,reject)=>{
    let timer;
    const dispose=()=>{window.removeEventListener('message',handler);run.abort.signal.removeEventListener('abort',cancel);clearTimeout(timer);};
    const cancel=()=>{dispose();reject(new DOMException('Cancelled','AbortError'));};
    const handler=event=>{
      const data=event.data;
      if(event.source!==frame.contentWindow||event.origin!==location.origin||!data||data.source!=='shift-fixture'||data.run!==run.id||run!==current)return;
      if(data.type==='error'){dispose();reject(new Error(typeof data.message==='string'?data.message.slice(0,180):'The fixture reported an error.'));}
      else if(types.includes(data.type)){dispose();resolve(data);}
    };
    if(run.abort.signal.aborted){cancel();return;}
    window.addEventListener('message',handler);run.abort.signal.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{dispose();reject(new Error('The fixture did not respond within 8 seconds. Retry this experiment.'));},8000);
  });
}
async function load(version,run){
  const pending=waitFrame(['ready'],run);
  const params=new URLSearchParams({run:run.id,scenario:run.scenario,warm:run.warm?'1':'0'});
  frame.src=isLocal?`/fixture/?${params}`:`/fixtures/${version}/index.html?${params}`;
  frame.hidden=false;$('emptyPreview').hidden=true;setText('versionTag',`${version}.0`);setText('fixtureAddress',isLocal?`localhost / ${version} fixture`:`shift / ${version} journal fixture`);
  const data=await pending;if(data.version!==version)throw new Error('The fixture loaded an unexpected pinned build.');return data;
}
async function command(type,types,run){const pending=waitFrame(types,run);frame.contentWindow.postMessage({source:'shift-controller',run:run.id,type},location.origin);return pending;}
function saveReport(run,preserved){
  report={schema:'shift.trace.v1',product:'Shift',createdAt:new Date().toISOString(),execution:mode,scenario:run.scenario,oldBuild:'v1.0-fixture',newBuild:'v2.0-fixture',warmModuleRegistry:run.warm,phase,outcomeCode:core.shift_outcome(phase,preserved?1:0),draftPreserved:preserved,events:[...events],limitations:['Built-in synthetic fixture; no external deployment tested.','Static mode models retirement with an unavailable route; only localhost controller retires the exact pinned URL.','Replay is an event playback, not deterministic browser replay.','No service worker is installed or disabled by Shift.','Draft contents, session values and absolute URLs are omitted.','No actual Safari or physical-phone result is inferred.']};
  $('replay').disabled=false;$('export').disabled=false;
}
async function runExperiment(){
  if(busy||!core)return;
  setBusy(true);
  replaying=false;replayGeneration++;setText('replay','↺ Replay trace');
  const previous=current;if(previous)previous.abort.abort();
  const run={id:`s${crypto.randomUUID().replaceAll('-','').slice(0,20)}`,scenario:document.querySelector('input[name=scenario]:checked').value,warm:$('warm').checked,abort:new AbortController()};
  current=run;phase=0;events=[];report=null;start=performance.now();$('timeline').replaceChildren();setText('traceCount','0 events');resetMetrics();message('Opening the pinned old build…');$('error').hidden=true;setBusy(true);setText('browserBadge','Running');$('browserBadge').classList.add('active');
  try{
    await cleanup(previous,run.abort.signal);if(run!==current||run.abort.signal.aborted)throw new DOMException('Cancelled','AbortError');
    await controller('reset',run.id,run.scenario,run.abort.signal);if(run!==current||run.abort.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const loaded=await load('v1',run);step(1);add('Old build is alive','A real same-origin page loaded v1.0.', 'ok',{build:'v1.0',serviceWorkerControlled:loaded.serviceWorkerControlled===true});
    if(loaded.serviceWorkerControlled) add('Existing service worker observed','Shift leaves the controlling worker unchanged.','warning',{serviceWorkerControlled:true});
    if(run.warm){add('Lazy module loaded before release','Module is now in this document’s module registry.');setText('cacheMetric','Module already loaded');setText('cacheDetail','Not evidence of an HTTP-cache hit');}
    await delay(400,run.abort.signal);const saved=await command('save',['saved'],run);
    if(!Number.isInteger(saved.bytes)||!core.shift_validate_draft(saved.bytes))throw new Error('Draft exceeds the Rust core’s 1–4096 byte limit.');
    if(typeof saved.draftDigest!=='string'||!/^[a-f0-9]{64}$/.test(saved.draftDigest))throw new Error('The fixture did not provide valid draft evidence.');run.draftDigest=saved.draftDigest;
    step(2);add('Draft saved in this tab',`${saved.bytes} UTF-8 bytes. Contents stay on this origin.`, 'ok',{draftBytes:saved.bytes});setText('draftMetric','Saved in session storage');setText('draftDetail',`${saved.bytes} UTF-8 bytes · no text in export`);setText('sessionMetric','Synthetic v1 session');
    message('Switching the fixture release…');await delay(450,run.abort.signal);await controller('deploy',run.id,undefined,run.abort.signal);if(run.abort.signal.aborted)throw new DOMException('Cancelled','AbortError');
    step(3);add(isLocal?'Local controller activated v2':'Fixture switched to v2 policy',isLocal?'The same server now serves v2; the old tab stays open.':'Simulated deployment boundary. No hosted release was changed.','ok',{deploymentSwitch:isLocal?'actual-local-controller':'simulated-static-fixture'});
    message('Continuing the old tab’s journey…');await delay(400,run.abort.signal);const result=await command('continue',['passed','failed'],run);
    const resources=sanitizeResources(result.resources);const preserved=result.draftPresent===true && result.draftDigest===run.draftDigest;
    if(result.type==='passed'){
      step(4);add('Old-tab journey completed','The loaded v1 code completed the continuation.','ok',{draftPreserved:preserved,resources});
      setText('draftMetric',preserved?'Preserved':'Missing');setText('sessionMetric','Accepted by fixture');setText('sessionDetail','No real authentication was tested');setText('cacheMetric',run.warm?'Reused loaded module':'Module loaded');setText('cacheDetail',run.warm?'In-memory module registry':'Resource timing included in trace');setText('nextMetric',preserved?'Continuity observed':'Inspect missing state');setText('nextDetail','Bounded fixture result only');message(preserved?'Old tab completed the journey. Draft preserved.':'Journey completed, but draft preservation failed.');setText('browserBadge',preserved?'Passed':'Unsafe state');
    }else{
      if(!['CHUNK_MISSING','SESSION_EXPIRED'].includes(result.code))throw new Error('Unknown fixture failure code.');
      step(result.code==='CHUNK_MISSING'?5:6);
      const chunk=result.code==='CHUNK_MISSING';
      add(chunk?'Old lazy module unavailable':'Synthetic session rejected',chunk?(isLocal?'The local controller retired the exact v1 asset URL.':'The static fixture requested a deliberately unavailable module.'):(isLocal?'The local fixture session endpoint returned 401.':'The fixture’s application rule rejected its synthetic session.'),'warning',{code:result.code,draftPreserved:preserved,resources,sessionHttpStatus:Number.isInteger(result.sessionHttpStatus)?result.sessionHttpStatus:null});
      setText('draftMetric',preserved?'Preserved, ready to restore':'Missing');setText('cacheMetric',chunk?'Module unavailable':run.warm?'Reused loaded module':'Module loaded');setText('cacheDetail',chunk?'Actual module request failed':'Normal cache settings unchanged');setText('sessionMetric',chunk?'Not reached':'Expired in fixture');setText('sessionDetail',chunk?'Journey stopped before session check':'Synthetic account only');setText('nextMetric','Recover the saved draft');$('recover').hidden=false;$('nextDetail').hidden=true;message('Failure captured. Recover in v2 to check draft continuity.');setText('browserBadge','Failure captured');
    }
    saveReport(run,preserved);
  }catch(error){
    if(run!==current)return;
    if(error.name==='AbortError'){
      if([0,1,2,3,5].includes(phase))step(8);add('Experiment cancelled','Pending results cannot overwrite a newer run.','warning');saveReport(run,false);message('Cancelled. You can start a fresh experiment.');setText('browserBadge','Cancelled');setText('nextMetric','Start a fresh run');frame.hidden=true;frame.removeAttribute('src');$('emptyPreview').hidden=false;await cleanup(run);
    }else{message(error.message,true);message('Experiment stopped with an error.');setText('browserBadge','Stopped');setText('nextMetric','Fix the error, then retry');$('recover').hidden=true;await cleanup(run);}
  }finally{if(run===current)setBusy(false);}
}
async function recover(){
  const run=current;if(!run||busy||phase!==5)return;
  setBusy(true);$('recover').disabled=true;message('Opening v2 and restoring the saved draft…');
  try{
    await load('v2',run);await delay(350,run.abort.signal);await controller('renew',run.id,undefined,run.abort.signal);const result=await command('recover',['recovered'],run);step(7);const preserved=result.draftPresent===true && result.draftDigest===run.draftDigest;
    add(preserved?'Draft restored in the new build':'Recovery lost the draft',preserved?'v2 restored the same draft, renewed the fixture session and completed the journey.':'Do not treat this transition as safe.',preserved?'ok':'warning',{draftPreserved:preserved,draftBytes:result.bytes});
    setText('draftMetric',preserved?'Restored in v2':'Missing after recovery');setText('sessionMetric','Renewed in fixture');setText('sessionDetail','No real sign-in was performed');setText('nextMetric',preserved?'Recovery verified':'Recovery unsafe');$('recover').hidden=true;$('nextDetail').hidden=false;setText('nextDetail','Try retaining the old assets next');message(preserved?'Recovered in v2. The draft survived the handoff.':'Recovery did not preserve the draft.');setText('browserBadge',preserved?'Recovered':'Unsafe state');saveReport(run,preserved);
  }catch(error){if(run!==current)return;if(error.name==='AbortError'){step(8);add('Recovery cancelled','No recovery result is accepted after cancellation.','warning');saveReport(run,false);message('Recovery cancelled. Start a fresh experiment.');setText('nextMetric','Start a fresh run');$('recover').hidden=true;frame.hidden=true;frame.removeAttribute('src');$('emptyPreview').hidden=false;await cleanup(run);}else message(error.message,true);}
  finally{if(run===current){$('recover').disabled=false;setBusy(false);}}
}
async function replay(){
  if(!report||busy)return;
  if(replaying){replaying=false;replayGeneration++;$('timeline').replaceChildren();events.forEach(renderEvent);setText('replay','↺ Replay trace');message('Replay stopped. Original evidence restored.');return;}
  replaying=true;const generation=++replayGeneration;const recorded=[...report.events];$('timeline').replaceChildren();setText('traceCount','0 events');setText('replay','Stop replay');message('Playing recorded events. No browser journey is being rerun.');
  for(let i=0;i<recorded.length;i++){await delay(350);if(generation!==replayGeneration)return;renderEvent(recorded[i],i);}
  replaying=false;setText('replay','↺ Replay trace');message('Trace playback complete. These are the original recorded events.');
}
function exportReport(){if(!report)return;const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`shift-${report.scenario}-trace.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Sanitized trace download requested. Draft text and session values are omitted.');}
$('run').addEventListener('click',runExperiment);$('cancel').addEventListener('click',()=>current?.abort.abort());$('recover').addEventListener('click',recover);$('replay').addEventListener('click',replay);$('export').addEventListener('click',exportReport);
$('scopeToggle').addEventListener('click',()=>{const expanded=$('scopeToggle').getAttribute('aria-expanded')==='true';$('scopeToggle').setAttribute('aria-expanded',String(!expanded));$('scopeDetails').hidden=expanded;});
window.addEventListener('pagehide',()=>{current?.abort.abort();if(current){try{sessionStorage.removeItem(`shift.fixture.${current.id}`);}catch{}if(isLocal)fetch(`/__shift/end?run=${current.id}`,{method:'POST',keepalive:true}).catch(()=>{});}});
try{
  const response=await fetch('/assets/shift_core.wasm');if(!response.ok)throw new Error(`Rust core could not be loaded (HTTP ${response.status}).`);const binary=await response.arrayBuffer();if(binary.byteLength>1048576)throw new Error('Rust core exceeds the 1 MB safety limit.');
  const {instance}=await WebAssembly.instantiate(binary);core=instance.exports;if(core.shift_version()!==1)throw new Error('Unsupported Rust core version.');
  if(isLocal){const capability=await fetch('/__shift/capabilities');if(!capability.ok||(await capability.json()).mode!=='local-controller')throw new Error('The local fixture controller is unavailable.');setText('modeBadge','Rust localhost fixture');setText('scope','This localhost Rust controller serves real pinned old/new fixture builds. It retires the exact old asset URL without request interception. It does not test external deployments.');}
  setText('engine','Rust core · WebAssembly · no dependencies');$('run').disabled=false;
}catch(error){core=null;message(error.message,true);setText('engine','Rust core unavailable');message('Experiment unavailable until the Rust core loads.');}
