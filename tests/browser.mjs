// No routing, request interception, service-worker override or cache disabling.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const require=createRequire(new URL('./browser-runner/package.json',import.meta.url));
assert.equal(require('playwright/package.json').version,'1.62.1','Use the locked standalone browser runner.');
const {chromium}=require('playwright');
const base=process.env.SHIFT_URL||'http://127.0.0.1:4183';
async function checkLocalhostFraming(context){
  if(new URL(base).origin!=='http://127.0.0.1:4183')return;
  const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><iframe src="http://127.0.0.1:4183/" title="Cross-origin framing probe"></iframe>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const probe=await context.newPage();
  try{
    const blocked=probe.waitForEvent('console',{predicate:message=>message.type()==='error'&&message.text().includes('frame-ancestors'),timeout:10000});
    await Promise.all([blocked,probe.goto(`http://127.0.0.1:${server.address().port}/`)]);
    assert.equal(await probe.frameLocator('iframe').locator('#run').count(),0,'Cross-origin ancestor must not load the controller UI');
    console.log('Localhost framing: same-origin fixture workflows pass and cross-origin framing is refused by CSP.');
  }finally{await probe.close();await new Promise(resolve=>server.close(resolve));}
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1180},acceptDownloads:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const result=async text=>page.getByRole('status').first().filter({hasText:text}).waitFor({timeout:15000});
const run=async()=>{await page.getByRole('button',{name:'Run experiment'}).click();};
try{
  await page.goto(base);await page.getByRole('button',{name:'Run experiment'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#run').disabled);
  await mkdir(new URL('../docs/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../docs/desktop-ready.png',import.meta.url).pathname,fullPage:true});
  await run();await result('Failure captured');
  assert.equal(await page.locator('#draftMetric').textContent(),'Preserved, ready to restore');
  await page.getByRole('button',{name:'Recover in v2'}).click();await result('Recovered in v2');
  assert.equal(await page.locator('#draftMetric').textContent(),'Restored in v2');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const download=await downloadPromise;
  const raw=await readFile(await download.path(),'utf8'),report=JSON.parse(raw);
  assert.equal(report.draftPreserved,true);assert.equal(report.outcomeCode,3);assert.ok(!raw.includes('Leave a little room'));assert.ok(!raw.includes('synthetic-session-v1'));assert.ok(!raw.includes('draftDigest'));
  await page.getByRole('button',{name:'Replay trace'}).click();await result('Trace playback complete');
  await page.getByRole('radio',{name:'Keep old assets'}).check();await run();await result('Old tab completed');
  assert.equal(await page.locator('#browserBadge').textContent(),'Passed');
  await page.getByRole('radio',{name:'Retire old assets'}).check();await page.getByRole('checkbox').check();await run();await result('Old tab completed');
  assert.equal(await page.locator('#cacheMetric').textContent(),'Reused loaded module');
  await page.getByRole('checkbox').uncheck();await page.getByRole('radio',{name:'Expire the session'}).check();await run();await result('Failure captured');
  assert.equal(await page.locator('#sessionMetric').textContent(),'Expired in fixture');
  await page.getByRole('button',{name:'Recover in v2'}).click();await result('Recovered in v2');
  await run();await page.getByRole('button',{name:'Cancel',exact:true}).click();await result('Cancelled.');
  await page.waitForTimeout(1600);assert.ok((await page.locator('#status').textContent()).startsWith('Cancelled.'));
  await page.getByRole('radio',{name:'Keep old assets'}).check();await run();await result('Old tab completed');
  await page.getByRole('button',{name:'Replay trace'}).click();await page.getByRole('button',{name:'Stop replay'}).click();await result('Replay stopped');
  await page.getByRole('button',{name:'How it works'}).click();assert.equal(await page.locator('#scopeDetails').isVisible(),true);
  assert.ok((await page.locator('#scopeDetails').textContent()).includes('Safari and real phones remain unverified.'));
  for(const selector of ['#scopeToggle .icon','.scenario-symbol.amber .icon']){const icon=page.locator(selector);assert.equal(await icon.getAttribute('aria-hidden'),'true');assert.equal(await icon.getAttribute('focusable'),'false');const box=await icon.boundingBox();assert.ok(box&&box.width>0&&box.height>0,'Decorative vector must render at a nonzero size');}
  await page.getByRole('button',{name:'How it works'}).click();assert.equal(await page.locator('#scopeDetails').isVisible(),false);
  await page.screenshot({path:new URL('../docs/desktop-result.png',import.meta.url).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL('../docs/phone-result.png',import.meta.url).pathname,fullPage:true});
  await page.getByRole('radio',{name:'Retire old assets'}).check();await run();await result('Failure captured');await page.getByRole('button',{name:'Recover in v2'}).click();await result('Recovered in v2');
  assert.deepEqual(errors,[]);
  await checkLocalhostFraming(context);
  console.log('Browser workflow passed: cold retirement/recovery, retention, warm module, expired session/recovery, cancellation, rerun, replay/stop, sanitized export, responsive overflow, phone-sized recovery.');
}finally{await browser.close();}
