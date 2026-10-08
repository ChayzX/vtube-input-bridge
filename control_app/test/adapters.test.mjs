import test from 'node:test';import assert from 'node:assert/strict';import {WebSocketServer} from 'ws';import {once} from 'node:events';
import {obsAction} from '../src/obs.mjs';import {vtsAction} from '../src/vts.mjs';import {mediaAction} from '../src/media.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('OBS adapter sends requested scene and discovers real scene list',async()=>{
 const s=new WebSocketServer({port:0,host:'127.0.0.1'});await once(s,'listening');let selected;
 s.on('connection',w=>{w.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.0.0',rpcVersion:1}}));w.on('message',b=>{
  const p=JSON.parse(b);if(p.op===1)w.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));
  if(p.op===6){if(p.d.requestType==='SetCurrentProgramScene')selected=p.d.requestData.sceneName;
   w.send(JSON.stringify({op:7,d:{requestId:p.d.requestId,requestType:p.d.requestType,requestStatus:{result:true,code:100},responseData:p.d.requestType==='GetSceneList'?{currentProgramSceneName:'Gaming',currentPreviewSceneName:null,scenes:[{sceneName:'Gaming',sceneIndex:0},{sceneName:'BRB',sceneIndex:1}]}:{}}}));}
 });});
 try{const opts={url:`ws://127.0.0.1:${s.address().port}`};const r=await obsAction(opts,'obs.scenes',{});assert.equal(r.scenes[1].sceneName,'BRB');await obsAction(opts,'obs.scene',{scene:'BRB'});assert.equal(selected,'BRB');await assert.rejects(obsAction(opts,'obs.scene',{scene:''}));}finally{await new Promise(r=>s.close(r));}
});
test('VTS authenticates separate plugin token then triggers exact hotkey',async()=>{
 const s=new WebSocketServer({port:0,host:'127.0.0.1'});await once(s,'listening');let triggered;
 s.on('connection',w=>w.on('message',b=>{const p=JSON.parse(b);let data;
  if(p.messageType==='AuthenticationRequest') {assert.equal(p.data.authenticationToken,'control-token');data={authenticated:true,reason:'Token valid'};}
  if(p.messageType==='HotkeyTriggerRequest'){triggered=p.data.hotkeyID;data={hotkeyID:triggered};}
  if(p.messageType==='HotkeysInCurrentModelRequest')data={modelLoaded:true,modelID:'model',availableHotkeys:[{hotkeyID:'show-friends',name:'Friends',type:'ToggleItemScene',file:'friends'}]};
  w.send(JSON.stringify({apiName:'VTubeStudioPublicAPI',apiVersion:'1.0',requestID:p.requestID,messageType:p.messageType.replace('Request','Response'),data}));
 }));
 try{const opts={url:`ws://127.0.0.1:${s.address().port}`,token:'control-token'};assert.equal((await vtsAction(opts,'vts.hotkeys',{})).availableHotkeys[0].hotkeyID,'show-friends');await vtsAction(opts,'vts.trigger',{hotkey:'show-friends'});assert.equal(triggered,'show-friends');}finally{await new Promise(r=>s.close(r));}
});
test('media adapter propagates unavailable Spotify and never sends arbitrary commands',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-test-'));const file=join(dir,'fake-helper.mjs');
 await writeFile(file,`console.log(JSON.stringify({ok:false,code:'spotify_unavailable'}));`);
 try{await assert.rejects(mediaAction({exe:process.execPath,prefix:[file]},'spotify.next'),/spotify_unavailable/);await assert.rejects(mediaAction({exe:process.execPath,prefix:[file]},'run.exe'),/Unsupported/);}finally{await rm(dir,{recursive:true});}
});
test('VTS does not trigger a hotkey after slow authentication consumes deadline',async()=>{
 const s=new WebSocketServer({port:0,host:'127.0.0.1'});await once(s,'listening');let triggered=0;
 s.on('connection',w=>w.on('message',b=>{const p=JSON.parse(b);if(p.messageType==='AuthenticationRequest')setTimeout(()=>{if(w.readyState===1)w.send(JSON.stringify({requestID:p.requestID,messageType:'AuthenticationResponse',data:{authenticated:true}}));},60);if(p.messageType==='HotkeyTriggerRequest')triggered++;}));
 try{await assert.rejects(vtsAction({url:`ws://127.0.0.1:${s.address().port}`,token:'token',expiresAt:Date.now()+10},'vts.trigger',{hotkey:'friends'}),/expired/);assert.equal(triggered,0);}finally{await new Promise(r=>s.close(r));}
});
test('Meld Studio adapter lists scenes and switches by name over the WebChannel API',async()=>{
 const {meldAction}=await import('../src/meld.mjs');
 const items={AAAA:{type:'scene',index:1,name:'BRB',current:false},BBBB:{type:'scene',index:0,name:'Gaming',current:true},CCCC:{type:'layer',parent:'BBBB',name:'Cam'}};
 // Meld publishes `session` as a QObject; the other run sends it as a plain map to cover both WebChannel shapes.
 for(const published of [true,false]){
  const s=new WebSocketServer({port:0,host:'127.0.0.1'});await once(s,'listening');const shown=[];
  const session=published?{'__QObject*__':true,id:'{s}',data:{methods:[],signals:[],properties:[[0,'objectName',[1,2],''],[1,'items',[3,4],items]]}}:{items};
  s.on('connection',w=>w.on('message',b=>{const m=JSON.parse(b);
   if(m.type===3)w.send(JSON.stringify({type:10,id:m.id,data:{meld:{methods:[['sessionChanged',5],['showScene',12],['showScene(QString)',12]],signals:[['sessionChanged',5]],properties:[[0,'objectName',[1,2],'meld'],[1,'session',[5,5],session]]}}}));
   if(m.type===6){assert.equal(m.object,'meld');assert.equal(m.method,12);shown.push(m.args[0]);w.send(JSON.stringify({type:10,id:m.id,data:null}));}
  }));
  try{
   const opts={url:`ws://127.0.0.1:${s.address().port}`};
   const r=await meldAction(opts,'meld.scenes',{});
   assert.deepEqual(r.scenes.map(x=>x.sceneName),['Gaming','BRB']);assert.equal(r.currentScene,'Gaming');
   assert.deepEqual(await meldAction(opts,'meld.scene',{scene:'BRB'}),{scene:'BRB'});assert.deepEqual(shown,['AAAA']);
   await assert.rejects(meldAction(opts,'meld.scene',{scene:'Nope'}),/no scene named "Nope"/);
   await assert.rejects(meldAction(opts,'meld.scene',{scene:''}),/Choose a Meld Studio scene/);
  }finally{await new Promise(r=>s.close(r));}
 }
});
