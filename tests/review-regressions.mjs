import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const fn=source.match(/^function message\(.*$/m)?.[0];assert.ok(fn);
const nodes={error:{hidden:true,textContent:''},status:{textContent:''}};
const context={$:id=>nodes[id],setText:(id,text)=>{nodes[id].textContent=text;}};
vm.runInNewContext(`${fn};message('WASM startup failed.',true);message('Experiment unavailable until the Rust core loads.');`,context);
assert.equal(nodes.error.hidden,false);assert.equal(nodes.error.textContent,'WASM startup failed.');assert.equal(nodes.status.textContent,'Experiment unavailable until the Rust core loads.');
vm.runInNewContext(`${fn};message('Draft exceeds limit.',true);message('Experiment stopped with an error.');`,context);
assert.equal(nodes.error.hidden,false);assert.equal(nodes.error.textContent,'Draft exceeds limit.');assert.equal(nodes.status.textContent,'Experiment stopped with an error.');
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');assert.ok(!html.includes('Chromium automation is separately tested'));assert.ok(html.includes('Automated browser verification is pending.'));
const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));assert.ok(Object.hasOwn(config,'framework'));assert.equal(config.framework,null);assert.equal(config.buildCommand,'node scripts/check-static.mjs');assert.equal(config.installCommand,'echo "No dependencies to install"');
console.log('Review regressions: 13 assertions passed (persistent errors, honest UI claim, explicit static build). These are VM/static checks, not browser UI passes.');
const css=await readFile(new URL('../web/style.css',import.meta.url),'utf8'),frameCss=await readFile(new URL('../web/fixtures/frame.css',import.meta.url),'utf8');
assert.ok(!css.includes('#8fae4f'));assert.ok(!frameCss.includes('#8fae4f'));assert.ok(css.includes('outline:3px solid #45682e'));assert.ok(frameCss.includes('outline:3px solid #45682e'));
const luminance=hex=>{const c=hex.replace('#','').match(/../g).map(h=>parseInt(h,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
const focus=luminance('#45682e');for(const bg of ['#ffffff','#f7f8f5','#f5f8ef','#fcfcfa','#e3eadc']){const contrast=(luminance(bg)+.05)/(focus+.05);assert.ok(contrast>=3,`Focus ring contrast on ${bg}: ${contrast}`);console.log(`Focus token source contrast on ${bg}: ${contrast.toFixed(2)}:1`);}
