const params = new URLSearchParams(location.search);
const run = params.get('run');
const version = document.documentElement.dataset.version;
const scenario = params.get('scenario');
const local = location.pathname.startsWith('/fixture/');
const warm = params.get('warm') === '1';
const key = `shift.fixture.${run}`;
const text = document.querySelector('#draft');
const message = document.querySelector('#message');
const save = document.querySelector('#save');
let continued = false, recovered = false, operation = false;
const send = (type, data = {}) => parent.postMessage({ source: 'shift-fixture', run, type, ...data }, location.origin);
const bytes = value => new TextEncoder().encode(value).length;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const chunk = local ? `/fixture/v1/checkout.js?run=${run}` : '/fixtures/v1/checkout.js';
const unavailable = '/fixtures/retired-v1/checkout.js';
function readDraft() {
  const value = sessionStorage.getItem(key);
  if (!value || value.length > 8192) return null;
  const parsed = JSON.parse(value);
  if (parsed.schema !== 1 || typeof parsed.draft !== 'string' || bytes(parsed.draft) > 4096) return null;
  return parsed;
}
function persist() {
  const draft = text.value;
  if (!draft.trim() || bytes(draft) > 4096) throw new Error('Draft must contain 1–4096 UTF-8 bytes.');
  sessionStorage.setItem(key, JSON.stringify({schema:1,draft,session:'synthetic-session-v1'}));
  message.textContent = 'Draft saved to this tab’s session storage.';
  return bytes(draft);
}
function resources() {
  return performance.getEntriesByType('resource').filter(e=>e.name.includes('checkout.js')).slice(-4).map(e=>({path:new URL(e.name).pathname,durationMs:Math.round(e.duration),transferBytes:e.transferSize,encodedBytes:e.encodedBodySize}));
}
save.addEventListener('click',()=>{try{persist();}catch(error){message.textContent=error.message;message.className='fault';}});
window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.source!=='shift-controller'||event.data.run!==run)return;
  const {type}=event.data;
  if (operation) return;
  operation = true;
  try {
    if(type==='save') {
      const size=persist(); send('saved',{bytes:size,draftDigest:await digest(text.value)});
    } else if(type==='continue'&&!continued&&version==='v1') {
      continued=true; save.disabled=true; text.disabled=true;
      try {
        // Static demo uses a deliberately unavailable path. Local mode retires the exact old URL.
        const module=await import(!local && scenario==='retired' && !warm ? unavailable : chunk);
        module.finish();
      } catch {
        message.textContent='The old lazy module is unavailable. Your draft is still here.';message.className='fault';
        send('failed',{code:'CHUNK_MISSING',draftPresent:!!readDraft(),draftDigest:await digest(readDraft()?.draft||''),resources:resources()});return;
      }
      const response=await fetch(local ? `/fixture/session?run=${run}` : '/fixtures/session.json');
      const session=await response.json();
      if(!session.valid||(!local&&scenario==='expired')) {
        message.textContent='The synthetic session expired. Your draft is still here.';message.className='fault';
        send('failed',{code:'SESSION_EXPIRED',draftPresent:!!readDraft(),draftDigest:await digest(readDraft()?.draft||''),resources:resources(),sessionHttpStatus:response.status});return;
      }
      message.textContent='Journey finished on the old build. Draft intact.';message.className='success';
      send('passed',{draftPresent:readDraft()?.draft===text.value,draftDigest:await digest(text.value),resources:resources(),sessionHttpStatus:response.status});
    } else if(type==='recover'&&!recovered&&version==='v2') {
      recovered=true;
      const saved=readDraft();
      if (!saved) throw new Error('No compatible saved draft is available.');
      text.value=saved.draft;
      const recoveredModule=await import(local ? `/fixture/v2/checkout.js?run=${run}` : '/fixtures/v2/checkout.js');
      if(!recoveredModule.finish().completed) throw new Error('The v2 journey did not complete.');
      const sessionResponse=await fetch(local ? `/fixture/session?run=${run}` : '/fixtures/session.json');
      if(!sessionResponse.ok || !(await sessionResponse.json()).valid) throw new Error('The synthetic session could not be renewed.');
      sessionStorage.setItem(key,JSON.stringify({...saved,session:'synthetic-session-v2'}));
      message.textContent='Draft restored in v2. Synthetic session renewed.';message.className='success';
      send('recovered',{draftPresent:readDraft()?.draft===text.value,bytes:bytes(text.value),draftDigest:await digest(text.value),continuedInV2:true});
    }
  } catch(error) {send('error',{message:error instanceof Error?error.message:'Fixture operation failed.'});}
  finally {operation=false;}
});
try {
  if(!run||!/^[a-zA-Z0-9]{8,32}$/.test(run)||!['retired','retained','expired'].includes(scenario)) throw new Error('Invalid bounded fixture configuration.');
  if(version==='v1'&&warm){await import(chunk);message.textContent='Old lazy module loaded before release.';}
  send('ready',{version,warm:version==='v1'&&warm,serviceWorkerControlled:!!navigator.serviceWorker?.controller});
} catch(error) {send('error',{message:error.message});}
