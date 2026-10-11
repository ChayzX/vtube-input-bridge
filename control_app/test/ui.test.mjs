import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
// Runs the real settings window script against a minimal DOM and a mocked main process.
async function window(config,overrides={}){
 const nodes={};const listeners={};let poll;const saves=[];
 const node=id=>nodes[id]??={id,value:'',checked:false,disabled:false,hidden:false,textContent:'',addEventListener:(type,fn)=>{listeners[id+':'+type]=fn;}};
 const control={get:async()=>({role:config.role,linkError:null,plugins:{tracking:{role:'receiver',state:'Receiving input'}},config:structuredClone(config),overlayUrl:'http://127.0.0.1:5058/overlay/x'}),
  save:async c=>{saves.push(c);Object.assign(config,structuredClone(c));return {};},tracking:async()=>({}),...overrides};
 const context={document:{getElementById:node,querySelectorAll:()=>[]},window:{control,addEventListener:(type,fn)=>{listeners['window:'+type]=fn;}},setInterval:fn=>{poll=fn;},structuredClone,console};
 vm.runInNewContext(await readFile(new URL('../ui/app.js',import.meta.url),'utf8'),context);
 const settle=()=>new Promise(r=>setTimeout(r,10));await settle();
 return {node,saves,settle,poll:async()=>{poll();await settle();},submit:async()=>{listeners['settings:submit']({preventDefault(){}});await settle();}};
}
const stored=()=>({version:1,role:'canada',enabled:true,ownIp:'10.0.0.119',peer:{host:'10.0.0.112',port:5056,pin:'a'.repeat(64)},obs:{enabled:true,url:'ws://127.0.0.1:4455',password:''},vts:{enabled:true,url:'ws://127.0.0.1:8001'},meld:{enabled:true,url:'ws://127.0.0.1:13376'},spotify:{enabled:true},reactive:{enabled:false,url:'',visible:true}});
test('saving in a window left open does not undo the tray or the Stream Deck',async()=>{
 const config=stored();const w=await window(config);
 assert.equal(w.node('enabled').checked,true);
 // Behind the open window: the tray turns controls off and the Stream Deck hides the reactive overlay.
 config.enabled=false;config.reactive.visible=false;
 w.node('obsPassword').value='secret';await w.submit();
 assert.equal(w.saves.length,1);const [saved]=w.saves;
 assert.equal(saved.enabled,false);assert.equal(saved.reactive.visible,false);assert.equal(saved.obs.password,'secret');
});
test('fields the user is editing survive a refresh; the rest follow the stored settings',async()=>{
 const config=stored();const w=await window(config);
 w.node('obsUrl').value='ws://127.0.0.1:4456';w.node('enabled').checked=false;
 config.obs.url='ws://127.0.0.1:9999';config.spotify.enabled=false;config.enabled=true;
 await w.poll();
 assert.equal(w.node('obsUrl').value,'ws://127.0.0.1:4456');assert.equal(w.node('enabled').checked,false);assert.equal(w.node('spotifyEnabled').checked,false);
 await w.submit();const [saved]=w.saves;
 assert.equal(saved.obs.url,'ws://127.0.0.1:4456');assert.equal(saved.enabled,false,'an explicit untick is kept');assert.equal(saved.spotify.enabled,false);
});
test('a refused save shows the reason, not the IPC wrapper of Electron',async()=>{
 const w=await window(stored(),{save:async()=>{throw new Error("Error invoking remote method 'control:save': Error: App API must use a loopback WebSocket");}});
 await w.submit();assert.equal(w.node('result').textContent,'App API must use a loopback WebSocket');
});
