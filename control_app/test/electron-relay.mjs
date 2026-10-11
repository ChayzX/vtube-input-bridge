import {app,session} from 'electron';import {ReactiveRenderer} from '../src/reactive.mjs';import {FrameStore} from '../src/frames.mjs';import assert from 'node:assert/strict';
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const store=new FrameStore();const renderer=new ReactiveRenderer(async png=>store.put(png));
 try {
  const s=session.fromPartition('persist:fugi-renderer');await s.protocol.handle('https',request=>request.url.includes('/individual/')?Response.redirect('https://reactive.fugi.tech/login',302):new Response(`<html style="background:transparent"><body style="margin:0"><div id="embed" data-config='{"embed":"group"}'><div style="width:50px;height:50px;background:red"></div></div></body></html>`,{headers:{'content-type':'text/html'}}));
  await renderer.start('https://reactive.fugi.tech/group');for(let i=0;i<50&&!store.get();i++)await new Promise(r=>setTimeout(r,100));assert.ok(store.get(),'actual renderer must deliver PNG');
  assert.equal(renderer.state,'Sending images — verify speaking states');renderer.stop();
  await new Promise(r=>setTimeout(r,2100));assert.equal(store.get(),null,'remote store clears after stopped renderer');
  // Stopping while a capture or upload is in flight leaves the state at Stopped.
  const slow=new ReactiveRenderer(async png=>{await new Promise(r=>setTimeout(r,80));store.put(png);});
  for(let i=0;i<8;i++){await slow.start('https://reactive.fugi.tech/group');await new Promise(r=>setTimeout(r,250+i*20));slow.stop();await new Promise(r=>setTimeout(r,300));assert.equal(slow.state,'Stopped',`state after stop #${i}`);}
  await assert.rejects(renderer.start('https://reactive.fugi.tech/settings'),/account pages/);
  // A Fugi login redirect stays reported as such instead of a generic failure.
  await assert.rejects(renderer.start('https://reactive.fugi.tech/individual/123456789012345678'),e=>e.code==='login_required');
  await new Promise(r=>setTimeout(r,300));assert.match(renderer.state,/Fugi login required/);
  console.log('Renderer → PNG store → stale clearing: PASS');
 }catch(e){console.error(e);process.exitCode=1;}finally{renderer.stop();app.quit();}
});
