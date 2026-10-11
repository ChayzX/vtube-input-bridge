import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import {cleanHostname,pcLabel,peerHostname,roleLabel} from '../src/names.mjs';import {parsePairingFile,validateConfig,defaults} from '../src/config.mjs';import {trayHealth} from '../src/health.mjs';
const pair={host:'10.0.0.119',port:5056,pin:'a'.repeat(64),token:'b'.repeat(64)};
test('a PC is shown by computer name, role and address, falling back to role and address',()=>{
 assert.equal(pcLabel({hostname:'CHASEBOT',role:'pantry',ip:'10.0.0.112'}),'CHASEBOT · Gaming PC · 10.0.0.112');
 assert.equal(pcLabel({role:'canada',ip:'10.0.0.119'}),'Streaming PC · 10.0.0.119');
 assert.equal(roleLabel('canada'),'Streaming PC');
 assert.equal(cleanHostname(' DESK\u0007TOP\n '),'DESKTOP');assert.equal(cleanHostname('x'.repeat(100)).length,63);
 assert.equal(cleanHostname(42),'');assert.equal(cleanHostname(undefined),'');
});
test('an older peer that sends no hostname keeps the last known name, then the pairing file name',()=>{
 const old={role:'canada',enabled:true,services:{}};
 assert.equal(peerHostname(old,'',''),'');
 assert.equal(peerHostname(old,'','STREAMBOX'),'STREAMBOX','the pairing file name stands in');
 assert.equal(peerHostname(old,'STREAMBOX-2','STREAMBOX'),'STREAMBOX-2','a name it sent earlier wins');
 assert.equal(peerHostname({...old,hostname:'NEWNAME'},'STREAMBOX-2','STREAMBOX'),'NEWNAME');
 assert.equal(peerHostname({hostname:{evil:true}},'',''),'','a non-string name is ignored');
 assert.equal(peerHostname(null,'',undefined),'');
});
test('pairing files carry an optional computer name; old files without one still import',()=>{
 assert.deepEqual(parsePairingFile(Buffer.from(JSON.stringify(pair))),pair);
 assert.equal(parsePairingFile(Buffer.from(JSON.stringify({...pair,name:'STREAMBOX'}))).name,'STREAMBOX');
 assert.equal('name' in parsePairingFile(Buffer.from(JSON.stringify({...pair,name:['x']}))),false,'a bad name is dropped, not fatal');
 const config={...defaults('pantry'),peer:{...pair,name:'STREAMBOX'},enabled:true};assert.equal(validateConfig(config).peer.name,'STREAMBOX');
});
test('the tray tooltip names this PC and the paired PC, and stays within the Windows limit',()=>{
 const h=trayHealth({tracking:{role:'sender',running:true,receiverConnected:true},config:{peer:pair,enabled:true},self:'CHASEBOT · Gaming PC · 10.0.0.112',peer:'STREAMBOX'});
 assert.match(h.tooltip,/\nCHASEBOT · Gaming PC · 10\.0\.0\.112\n/);assert.match(h.tooltip,/PC link: Paired with STREAMBOX/);assert.ok(h.tooltip.length<=127);
 const long=trayHealth({tracking:{},config:null,self:'X'.repeat(63)+' · Gaming PC · 192.168.100.200',peer:'Y'.repeat(63)});assert.ok(long.tooltip.length<=127);
});

// The window, with the other PC answering from a new version (hostname) and from an old one (none).
function fakeNode(id){let text='';const attributes={};const node={id,value:'',checked:false,disabled:false,hidden:false,className:'',dataset:{},options:[],
 get textContent(){return text;},set textContent(v){text=String(v);},addEventListener(){},setAttribute:(k,v)=>{attributes[k]=String(v);},getAttribute:k=>attributes[k]??null,removeAttribute:k=>{delete attributes[k];},
 classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,replaceChildren(){},append(){},focus(){},scrollIntoView(){},select(){}};return node;}
async function open(peerData,hostname='CHASEBOT'){
 const nodes={};const node=id=>nodes[id]??=fakeNode(id);
 const config={...defaults('pantry'),ownIp:'10.0.0.112',enabled:true,peer:{host:'10.0.0.119',port:5056,pin:'a'.repeat(64)}};
 const control={get:async()=>({role:'pantry',hostname,peerName:'',version:'0.3.0',linkError:null,plugins:{tracking:{role:'sender',running:true,receiverConnected:true,destination:'10.0.0.119'}},status:{services:{}},config:structuredClone(config),overlayUrl:''}),
  tracking:async()=>({}),save:async()=>({}),command:async c=>c.action==='bridge.status'?{ok:true,data:peerData}:{ok:true,data:{}}};
 vm.runInNewContext(await readFile(new URL('../ui/app.js',import.meta.url),'utf8'),{document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>fakeNode('')},window:{control,addEventListener(){}},setInterval(){},setTimeout:()=>0,clearTimeout(){},structuredClone,console});
 await new Promise(r=>setTimeout(r,20));return node;
}
test('the window names both PCs when the other PC sends its hostname',async()=>{
 const node=await open({role:'canada',hostname:'STREAMBOX',plugins:{controls:{obs:true}},services:{}});
 assert.equal(node('pcRole').textContent,'CHASEBOT');assert.equal(node('pcAddress').textContent,'Gaming PC · 10.0.0.112');
 assert.equal(node('nodeStreamingName').textContent,'STREAMBOX');assert.equal(node('nodeStreaming').textContent,'Streaming PC · 10.0.0.119');
 assert.equal(node('nodeGamingName').textContent,'CHASEBOT (this PC)');assert.equal(node('nodeGaming').textContent,'Gaming PC · 10.0.0.112');
 assert.match(node('link-detail').textContent,/^Paired with STREAMBOX, the Streaming PC \(10\.0\.0\.119\)/);
 assert.equal(node('obs-where').textContent,'Both PCs: CHASEBOT and STREAMBOX');
 assert.equal(node('factPeer').textContent,'STREAMBOX · Streaming PC · 10.0.0.119');
});
test('an older other PC without a hostname is shown by role and address',async()=>{
 const node=await open({role:'canada',plugins:{controls:{obs:true}},services:{}});
 assert.equal(node('nodeStreamingName').textContent,'Streaming PC');assert.equal(node('nodeStreaming').textContent,'10.0.0.119');
 assert.match(node('link-detail').textContent,/^Paired with the Streaming PC \(10\.0\.0\.119\)/);
 assert.equal(node('factPeer').textContent,'Streaming PC · 10.0.0.119');
});
