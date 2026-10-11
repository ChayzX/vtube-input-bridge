import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
// Runs the real settings window script against a minimal DOM and a mocked main process.
function fakeNode(id,listeners){
 let text='';const attributes={};const node={id,value:'',checked:false,disabled:false,hidden:false,className:'',type:'',dataset:{},options:[],writes:0,
  get textContent(){return text;},set textContent(v){text=String(v);node.writes++;},
  addEventListener:(type,fn)=>{listeners[id+':'+type]=fn;},
  setAttribute:(k,v)=>{attributes[k]=String(v);},getAttribute:k=>attributes[k]??null,removeAttribute:k=>{delete attributes[k];},
  classList:{toggle(){},add(){},remove(){},contains:()=>false},
  querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,replaceChildren(){},append(){},focus(){},scrollIntoView(){},select(){}};
 return node;
}
async function window(config,{peerReply}={}){
 const nodes={};const listeners={};let poll;const saves=[];const commands=[];
 const node=id=>nodes[id]??=fakeNode(id,listeners);
 const control={get:async()=>({role:config.role,version:'0.3.0',linkError:null,plugins:{tracking:{role:'receiver',state:'Receiving input'}},status:{services:{}},config:structuredClone(config),overlayUrl:'http://127.0.0.1:5058/overlay/x'}),
  save:async c=>{saves.push(c);Object.assign(config,structuredClone(c));return {};},tracking:async()=>({}),
  command:async c=>{commands.push(c);return c.action==='bridge.status'?(peerReply??{ok:true,data:{plugins:{controls:{obs:true}},services:{}}}):{ok:true,data:{scenes:[]}};}};
 const context={document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>fakeNode('',listeners)},window:{control,addEventListener:(type,fn)=>{listeners['window:'+type]=fn;}},
  setInterval:fn=>{poll=fn;},setTimeout:()=>0,clearTimeout:()=>{},structuredClone,console};
 vm.runInNewContext(await readFile(new URL('../ui/app.js',import.meta.url),'utf8'),context);
 const settle=()=>new Promise(r=>setTimeout(r,10));await settle();
 return {node,saves,commands,settle,poll:async()=>{poll();await settle();},submit:async()=>{listeners['settings:submit']({preventDefault(){}});await settle();},edit:async()=>{listeners['settings:input']?.();await settle();}};
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
test('the save bar appears only while there are unsaved edits, and names them',async()=>{
 const config=stored();const w=await window(config);
 assert.equal(w.node('saveBar').hidden,true);
 w.node('obsPassword').value='secret';await w.edit();
 assert.equal(w.node('saveBar').hidden,false);assert.match(w.node('dirtyText').textContent,/1 unsaved change · OBS password/);
 await w.submit();assert.equal(w.node('saveBar').hidden,true);
});
test('status is written in sentences, and only when it changes',async()=>{
 const config=stored();const w=await window(config);
 const title=w.node('heroTitle');assert.doesNotMatch(title.textContent,/[{}"]/);assert.ok(title.textContent.length>0);
 const writes=title.writes;for(let i=0;i<5;i++)await w.poll();
 assert.equal(title.writes,writes,'the live region is not rewritten every second');
 assert.match(w.node('link-detail').textContent,/^Paired with the Gaming PC \(10\.0\.0\.112\)/);
 assert.equal(w.node('pcRole').textContent,'Streaming PC');
});
test('the other PC not answering shows on the PC link card, not as raw JSON',async()=>{
 const w=await window(stored(),{peerReply:{ok:false,code:'unavailable',message:'Could not reach the other PC.'}});
 assert.equal(w.node('link-badge').textContent,'Not answering');assert.equal(w.node('link-detail').textContent,'Could not reach the other PC.');
 assert.ok(w.commands.some(c=>c.target==='peer'&&c.action==='bridge.status'));
});
