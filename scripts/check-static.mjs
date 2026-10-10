// Vercel build gate: only verifies prebuilt assets. No Cargo, npm install or network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8'));
assert.equal(config.framework,null);assert.equal(config.outputDirectory,'web');assert.equal(config.buildCommand,'node scripts/check-static.mjs');
const notices=JSON.parse(await readFile(path.join(root,'third-party/manifest.json'),'utf8'));
assert.equal(notices.toolchain,'Rust 1.99.0');
assert.equal(notices.sha256,'5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27');
assert.equal(notices.bytes,1499465);
for(const file of ['third-party/rust-1.99.0/COPYRIGHT-library.html','web/RUST-STANDARD-LIBRARY-NOTICES.html']){
  const bytes=await readFile(path.join(root,file));assert.equal(bytes.length,notices.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),notices.sha256,'Pinned Rust notice must remain verbatim');
}
let total=0,runtimeTotal=0,count=0;
async function walk(dir){for(const entry of await readdir(dir)){const file=path.join(dir,entry),stat=await lstat(file);assert.ok(!stat.isSymbolicLink(),'No symlinks in static output');if(stat.isDirectory()){await walk(file);continue;}if(file===path.join(root,'web/RUST-STANDARD-LIBRARY-NOTICES.html')){assert.equal(stat.size,notices.bytes);}else{assert.ok(stat.size<=1048576,'Bounded runtime asset size');runtimeTotal+=stat.size;}total+=stat.size;count++;}}
await walk(path.join(root,'web'));assert.ok(runtimeTotal<1048576,'Runtime assets stay below one MB; pinned notice is a separate exact-hash artifact');
for(const file of ['index.html','app.js','style.css','fixtures/frame.js','fixtures/v1/index.html','fixtures/v2/index.html','assets/shift_core.wasm'])assert.ok((await lstat(path.join(root,'web',file))).isFile());
const {instance}=await WebAssembly.instantiate(await readFile(path.join(root,'web/assets/shift_core.wasm')));
assert.equal(instance.exports.shift_version(),1);assert.equal(instance.exports.shift_transition(0,1),1);assert.equal(instance.exports.shift_transition(0,7)>>>0,0xffffffff);
console.log(`Static build gate passed: ${count} files, ${total} total bytes (${runtimeTotal} runtime bytes plus pinned Rust notice), actual WASM instantiated. No Rust toolchain needed.`);
