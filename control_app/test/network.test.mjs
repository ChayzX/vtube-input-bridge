import test from 'node:test'; import assert from 'node:assert/strict'; import {once} from 'node:events'; import selfsigned from 'selfsigned';
import {createApi} from '../src/server.mjs'; import {requestPeer,forwardCommand} from '../src/client.mjs'; import {Dispatcher} from '../src/commands.mjs';
import {X509Certificate,createHash} from 'node:crypto';
const token='a'.repeat(64); const listen=async(s)=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;};
const close=(s)=>new Promise(r=>{s.closeAllConnections();s.close(r);});
const peerCert=async()=>{const cert=await selfsigned.generate([{name:'commonName',value:'VTube Control'}],{keySize:2048,days:365,algorithm:'sha256'});return {cert,pin:createHash('sha256').update(new X509Certificate(cert.cert).raw).digest('hex')};};
test('local API requires auth, rejects browser origin and malformed bodies',async()=>{
 const s=createApi({token,dispatcher:new Dispatcher(async()=>({value:42})),status:()=>({enabled:true})}); const port=await listen(s);
 try {
  const url=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(url+'/status')).status,401);
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(url+'/status',{headers:{...headers,Origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(url+'/command',{method:'POST',headers,body:'{'})).status,400);
  assert.equal((await fetch(url+'/command',{method:'POST',headers,body:'x'.repeat(40000)})).status,413);
  const c={id:'http1',target:'local',action:'status',args:{},expiresAt:Date.now()+5000};
  const r=await fetch(url+'/command',{method:'POST',headers,body:JSON.stringify(c)}); assert.equal(r.status,200); assert.equal((await r.json()).data.value,42);
 } finally {await close(s);}
});
test('LAN TLS pin checked before token/body is sent; peers filtered by source',async()=>{
 const cert=await selfsigned.generate([{name:'commonName',value:'VTube Control'}],{keySize:2048,days:365,algorithm:'sha256'});
 const pin=createHash('sha256').update(new X509Certificate(cert.cert).raw).digest('hex'); let calls=0;
 const s=createApi({token,tls:cert,source:'127.0.0.1',dispatcher:new Dispatcher(async()=>{calls++;return {};})});const port=await listen(s);
 const pair={host:'127.0.0.1',port,token,pin};const c={id:'lan1',target:'local',action:'status',args:{},expiresAt:Date.now()+5000};
 try {
  await assert.rejects(requestPeer({...pair,pin:'0'.repeat(64)},'POST','/command',c),/certificate/i);assert.equal(calls,0);
  assert.equal((await requestPeer(pair,'POST','/command',c)).ok,true);assert.equal(calls,1);
  assert.equal((await requestPeer({...pair,token:'b'.repeat(64)},'POST','/command',{...c,id:'unauth'})).ok,false); assert.equal(calls,1);
 }finally{await close(s);}
 const blocked=createApi({token,tls:cert,source:'10.0.0.112',dispatcher:new Dispatcher(async()=>{calls++;})});const blockedPort=await listen(blocked);
 try {assert.equal((await requestPeer({...pair,port:blockedPort},'POST','/command',c)).code,'forbidden');assert.equal(calls,1);}finally{await close(blocked);}
});
test('commands reach the other PC when its clock is behind or ahead',async()=>{
 const {cert,pin}=await peerCert();
 for(const offset of [-200,-9000,9000,60000]){
  const s=createApi({token,tls:cert,source:'127.0.0.1',dispatcher:new Dispatcher(async c=>({left:c.expiresAt-(Date.now()+offset)}),{clock:()=>Date.now()+offset})});const port=await listen(s);
  try{const data=await forwardCommand({host:'127.0.0.1',port,token,pin},{id:'skew'+offset,target:'peer',action:'obs.scene',args:{scene:'Game'},expiresAt:Date.now()+10000});
   assert.ok(data.left>8000&&data.left<=10000,`offset ${offset}: ${data.left}`);}
  finally{await close(s);}
 }
});
