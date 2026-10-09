// Executes the exact run function with controlled async boundaries. Not a browser test.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function runExperiment(){'),source.indexOf('async function recover(){'));
for(const mode of ['cleanup-resolves','cleanup-aborts']){
 let settleCleanup,startedRuns=0,lastStatus;
 const nodes=new Map(),node=()=>({disabled:false,hidden:false,value:'retired',checked:false,classList:{add(){},remove(){}},replaceChildren(){},removeAttribute(){}});
 const previous={id:'previous',abort:new AbortController()};
 const context=vm.createContext({busy:false,core:{},current:previous,phase:0,events:[],report:null,replaying:false,replayGeneration:0,performance,crypto:{randomUUID},AbortController,DOMException,frame:node(),document:{querySelector:()=>({value:'retired'})},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},setBusy(v){context.busy=v;},setText(){},resetMetrics(){},message(text){lastStatus=text;},step(e){assert.equal(e,8);context.phase=7;},add(){},saveReport(){context.report={cancelled:true};},cleanup:r=>r===previous?new Promise((resolve,reject)=>{settleCleanup=()=>mode==='cleanup-resolves'?resolve():reject(new DOMException('Cancelled','AbortError'));}):Promise.resolve(),controller:async()=>{startedRuns++;},load:async()=>{throw new Error('Unexpected load after cancel');}});
 vm.runInContext(fn,context);const running=context.runExperiment();
 assert.notEqual(context.current,previous,'New cancellable scope must own the pending cleanup');
 vm.runInContext('current.abort.abort()',context);settleCleanup();await running;
 assert.equal(startedRuns,0);assert.equal(context.phase,7);assert.equal(context.busy,false);assert.equal(context.current.abort.signal.aborted,true);assert.match(lastStatus,/^Cancelled\./);
 console.log(`${mode}: no new controller reset after cancel; cancelled report, ownership and idle state verified.`);
}
