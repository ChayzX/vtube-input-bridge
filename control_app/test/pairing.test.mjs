import test from 'node:test';import assert from 'node:assert/strict';
import {PairingHost,createPairingServer,joinPairing,readCode,showCode,newCode,Spake,pairingDetails} from '../src/pairing.mjs';
import {Discovery,localAddresses,addressToward} from '../src/discovery.mjs';

const details=(role,c)=>({role,port:5056,pin:c.repeat(64),token:(c==='a'?'b':'d').repeat(64),name:role==='pantry'?'CHASEBOT':'STREAMBOX',version:'1.0.0'});
const loopback=()=>true;
async function hostOn(host){const server=createPairingServer(()=>host,{allow:loopback});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,port:server.address().port};}

test('codes are six digits, typed with or without a space',()=>{
 for(let i=0;i<50;i++)assert.match(newCode(),/^\d{6}$/);
 assert.equal(readCode(' 123 456 '),'123456');assert.equal(readCode('123-456'),'123456');assert.equal(showCode('123456'),'123 456');
 for(const bad of ['12345','1234567','abcdef',''])assert.throws(()=>readCode(bad),/6-digit code/);
});

test('both sides of the key exchange agree only when they used the same code',()=>{
 const a=new Spake('A','123456'),b=new Spake('B','123456');const ka=a.finish(b.message,'x'),kb=b.finish(a.message,'x');
 assert.equal(ka.confirmA,kb.confirmA);assert.equal(ka.confirmB,kb.confirmB);assert.deepEqual(kb.open('A',ka.seal('A',{hi:1})),{hi:1});
 assert.throws(()=>kb.open('B',ka.seal('A',{hi:1})),'a sealed message cannot be reflected back as the other side');
 const wrong=new Spake('B','654321');const kw=wrong.finish(a.message,'x');const ka2=a.finish(wrong.message,'x');assert.notEqual(kw.confirmA,ka2.confirmA);
 assert.throws(()=>a.finish('00'.repeat(256),'x'),/malformed/);assert.throws(()=>a.finish('1'.padStart(512,'0'),'x'),/malformed/);
});

test('pairing with a code exchanges both PCs\' details, each at the address it was reached at',async()=>{
 let saved=null;const host=new PairingHost({role:'canada',code:'424242',details:()=>details('canada','c'),accept:async(peer,address)=>{saved={...peer,address};}});
 const {server,port}=await hostOn(host);
 try{
  const peer=await joinPairing({address:'127.0.0.1',port,code:'424 242',role:'pantry',details:details('pantry','a'),allow:loopback});
  assert.deepEqual(peer,{...details('canada','c'),host:'127.0.0.1'});
  assert.deepEqual(saved,{...details('pantry','a'),address:'127.0.0.1'});assert.equal(host.state,'paired');
  await assert.rejects(joinPairing({address:'127.0.0.1',port,code:'424242',role:'pantry',details:details('pantry','a'),allow:loopback}),/no longer waiting/);
 }finally{server.close();}
});

test('a wrong code is refused and three wrong codes close pairing',async()=>{
 let saved=0;const host=new PairingHost({role:'canada',code:'111111',details:()=>details('canada','c'),accept:async()=>{saved++;}});
 const {server,port}=await hostOn(host);
 try{
  for(let i=0;i<3;i++)await assert.rejects(joinPairing({address:'127.0.0.1',port,code:'222222',role:'pantry',details:details('pantry','a'),allow:loopback}),/not the one on the other PC|no longer waiting/);
  assert.equal(host.state,'failed');assert.match(host.message,/Too many wrong codes/);assert.equal(saved,0);
  await assert.rejects(joinPairing({address:'127.0.0.1',port,code:'111111',role:'pantry',details:details('pantry','a'),allow:loopback}),/no longer waiting/);
 }finally{server.close();}
});

test('two PCs of the same kind cannot pair, codes expire, and public addresses are refused',async()=>{
 let now=0;const host=new PairingHost({role:'canada',code:'333333',details:()=>details('canada','c'),accept:async()=>{},now:()=>now});
 const {server,port}=await hostOn(host);
 try{
  await assert.rejects(joinPairing({address:'127.0.0.1',port,code:'333333',role:'canada',details:details('canada','a'),allow:loopback}),/same kind of PC/);
  now=400000;await assert.rejects(joinPairing({address:'127.0.0.1',port,code:'333333',role:'pantry',details:details('pantry','a'),allow:loopback}),/no longer waiting/);
  assert.equal(host.state,'expired');
 }finally{server.close();}
 await assert.rejects(joinPairing({address:'8.8.8.8',code:'333333',role:'pantry',details:details('pantry','a')}),/home network/);
 assert.throws(()=>pairingDetails({role:'pantry',port:5056,pin:'x',token:'y'}),/incomplete pairing details/);
});

const nics={Ethernet:[{family:'IPv4',address:'192.168.1.20',netmask:'255.255.255.0',internal:false}],'vEthernet (WSL)':[{family:'IPv4',address:'172.20.0.1',netmask:'255.255.240.0',internal:false}],
 'Wi-Fi':[{family:'IPv4',address:'10.0.0.112',netmask:'255.255.255.0',internal:false},{family:'IPv6',address:'fe80::1',internal:false}],lo:[{family:'IPv4',address:'127.0.0.1',netmask:'255.0.0.0',internal:true}]};
test('this PC\'s address is the one on the other PC\'s subnet, real adapters before virtual ones',()=>{
 const list=localAddresses(nics);assert.deepEqual(list.map(e=>e.address),['192.168.1.20','10.0.0.112','172.20.0.1']);
 assert.equal(list[0].broadcast,'192.168.1.255');assert.equal(list[2].broadcast,'172.20.15.255');
 assert.equal(addressToward('10.0.0.119',nics),'10.0.0.112');assert.equal(addressToward('',nics),'192.168.1.20');assert.equal(addressToward('10.0.0.1',{}),'');
});

test('discovery answers "who is pairing" only while pairing, and "where is" only for its own certificate',()=>{
 let me={role:'canada',name:'STREAMBOX',version:'1.0.0',pin:'c'.repeat(64),pairing:false};const sent=[];
 const d=new Discovery({me:()=>me});const socket={send:(bytes,port,address)=>sent.push({m:JSON.parse(bytes),port,address})};
 const ask=(q,from='10.0.0.112')=>d.answer(socket,Buffer.from(JSON.stringify({app:'vtube-input-bridge',v:1,type:'find',...q})),{address:from,port:50000});
 ask({want:'pairing',role:'pantry'});assert.equal(sent.length,0);
 me={...me,pairing:true};ask({want:'pairing',role:'canada'});assert.equal(sent.length,0,'same role');
 ask({want:'pairing',role:'pantry'});assert.equal(sent.length,1);assert.deepEqual(sent[0],{m:{app:'vtube-input-bridge',v:1,type:'here',want:'pairing',role:'canada',name:'STREAMBOX',version:'1.0.0'},port:50000,address:'10.0.0.112'});
 ask({want:'peer',pin:'a'.repeat(64)});assert.equal(sent.length,1);ask({want:'peer',pin:'c'.repeat(64)});assert.equal(sent.length,2);
 ask({want:'peer',pin:'c'.repeat(64)},'8.8.8.8');assert.equal(sent.length,2,'public address');
 d.answer(socket,Buffer.from('not json'),{address:'10.0.0.112',port:1});assert.equal(sent.length,2);
 for(let i=0;i<40;i++)ask({want:'peer',pin:'c'.repeat(64)});assert.ok(sent.length<=22,'rate limited');
});

test('discovery finds a PC answering on the network',async()=>{
 const me={role:'canada',name:'STREAMBOX',version:'1.0.0',pin:'c'.repeat(64),pairing:true};
 // Loopback stands in for the home network here (a /8 whose broadcast address reaches this machine).
 const loop={lo:[{family:'IPv4',address:'127.0.0.1',netmask:'255.0.0.0',internal:false}]};
 const d=new Discovery({me:()=>me,port:0,interfaces:()=>loop,allow:()=>true});await d.start();const port=d.socket.address().port;
 const asker=new Discovery({me:()=>null,port,interfaces:()=>loop,allow:()=>true});
 try{
  const found=await asker.find({want:'pairing',role:'pantry'},{wait:400});
  // The same PC may answer from more than one of its addresses (here loopback and the container's own adapter).
  assert.ok(found.length>=1);assert.ok(found.every(f=>f.role==='canada'&&f.name==='STREAMBOX'&&f.version==='1.0.0'));
  assert.deepEqual(await asker.find({want:'peer',pin:'a'.repeat(64)},{wait:300}),[]);
 }finally{d.stop();}
});
