import assert from 'node:assert/strict';
import net from 'node:net';
const host='127.0.0.1',port=4183;
const connect=()=>new Promise((resolve,reject)=>{const s=net.createConnection({host,port},()=>resolve(s));s.on('error',reject);});
async function raw(request){const s=await connect();return new Promise((resolve,reject)=>{let data='';s.on('data',b=>data+=b);s.on('end',()=>resolve(data));s.on('error',reject);s.write(request);});}
const base='POST /__shift/reset?run=security01&scenario=retained HTTP/1.1\r\nHost: 127.0.0.1:4183\r\nOrigin: https://untrusted.example';
const cases=[
 ['body-origin-override',base+'\r\nContent-Length: 31\r\n\r\nOrigin: http://127.0.0.1:4183\r\n'],
 ['body-host-origin-override',base.replace('Host: 127.0.0.1:4183','Host: untrusted.example:4183')+'\r\nContent-Length: 53\r\n\r\nHost: 127.0.0.1:4183\r\nOrigin: http://127.0.0.1:4183\r\n'],
 ['unframed-body-never-headers',base+'\r\nContent-Length: 0\r\n\r\nOrigin: http://127.0.0.1:4183\r\n'],
 ['duplicate-origin',base+'\r\nOrigin: http://127.0.0.1:4183\r\n\r\n'],
 ['duplicate-host',base+'\r\nhOsT: 127.0.0.1:4183\r\n\r\n'],
 ['folded-header',base+'\r\n Origin: http://127.0.0.1:4183\r\n\r\n'],
 ['duplicate-length',base+'\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n'],
 ['transfer-encoding',base+'\r\nTransfer-Encoding: chunked\r\n\r\n'],
 ['oversized-headers',base+'\r\nX-Oversized: '+'x'.repeat(8300)+'\r\n\r\n'],
];
const evidence=[];
for(const [name,request]of cases){const response=await raw(request);assert.match(response,/^HTTP\/1\.1 4\d\d /,name);evidence.push({test:name,status:response.split('\r\n')[0]});}
const slow=await connect();slow.on('error',()=>{});const slowStart=performance.now();let closedAt;slow.on('close',()=>closedAt=performance.now());slow.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:4183\r\nX-Slow: ');
const drip=setInterval(()=>{if(!slow.destroyed)slow.write('x');},150);
const normalStart=performance.now();const normal=await raw('GET / HTTP/1.1\r\nHost: 127.0.0.1:4183\r\n\r\n');const elapsed=performance.now()-normalStart;
assert.match(normal,/^HTTP\/1\.1 200 /);assert.ok(elapsed<1000,`One slow connection blocked normal request for ${elapsed}ms`);
await new Promise(resolve=>setTimeout(resolve,2400));clearInterval(drip);slow.destroy();assert.ok(closedAt&&closedAt-slowStart<2350,'Continuous header drip must close within total deadline');
evidence.push({test:'slow-connection-isolated',normalRequestMs:Math.round(elapsed),slowClosedMs:Math.round(closedAt-slowStart)});
const slots=[];for(let i=0;i<8;i++){const socket=await connect();socket.on('error',()=>{});socket.write('GET / HTTP/1.1\r\n');slots.push(socket);}
const overflow=await connect();overflow.on('error',()=>{});const overflowClosed=new Promise(resolve=>{overflow.on('close',()=>resolve(true));setTimeout(()=>resolve(false),600);});overflow.write('GET / HTTP/1.1\r\n');assert.equal(await overflowClosed,true,'Ninth simultaneous connection must close promptly');for(const s of slots)s.destroy();overflow.destroy();
evidence.push({test:'eight-connection-bound',extraConnectionClosed:true});
console.log(JSON.stringify(evidence,null,2));console.log('Controller security: 9 rejection cases plus isolation, absolute deadline and admission-cap regressions passed.');
