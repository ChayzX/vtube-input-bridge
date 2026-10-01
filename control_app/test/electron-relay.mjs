import {app,session} from 'electron';import {ReactiveRenderer} from '../src/reactive.mjs';import {FrameStore} from '../src/frames.mjs';import assert from 'node:assert/strict';
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const store=new FrameStore();const renderer=new ReactiveRenderer(async png=>store.put(png));
 try {
  const s=session.fromPartition('persist:fugi-renderer');await s.protocol.handle('https',()=>new Response(`<html style="background:transparent"><body style="margin:0"><div id="embed" data-config='{"embed":"group"}'><div style="width:50px;height:50px;background:red"></div></div></body></html>`,{headers:{'content-type':'text/html'}}));
  await renderer.start('https://reactive.fugi.tech/group');await new Promise(r=>setTimeout(r,800));assert.ok(store.get(),'actual renderer must deliver PNG');
  assert.equal(renderer.state,'Sending images — verify speaking states');renderer.stop();
  await new Promise(r=>setTimeout(r,2100));assert.equal(store.get(),null,'remote store clears after stopped renderer');
  await assert.rejects(renderer.start('https://reactive.fugi.tech/settings'),/account pages/);
  console.log('Renderer → PNG store → stale clearing: PASS');
 }catch(e){console.error(e);process.exitCode=1;}finally{renderer.stop();app.quit();}
});
