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
