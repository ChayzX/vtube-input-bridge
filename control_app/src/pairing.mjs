import {createHash,createHmac,randomBytes,randomInt,hkdfSync,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import http from 'node:http';import {privateIp} from './config.mjs';

// Pairing with a six-digit code. One PC shows the code and waits; the other finds it on the network and the streamer
// types the code there. The two PCs then run SPAKE2 (a password-authenticated key exchange) over plain HTTP on 5059:
// both end up with the same key only if both used the same code, and someone watching or answering in between learns
// nothing they could test codes against offline, so each wrong guess costs a real attempt (three are allowed). That key
// seals the pairing details each PC hands over (certificate pin and connection token), exactly what a pairing file
// carries. Each PC's address is the one it was reached at, so nobody types an IP.
export const PAIRING_PORT=5059;
// RFC 3526 group 14 (2048-bit MODP). P is a safe prime and 2 generates the subgroup of order Q=(P-1)/2.
const P=BigInt('0x'+
 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD'+
 'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED'+
 'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F'+
 '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B'+
 'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510'+
 '15728E5A8AACAA68FFFFFFFFFFFFFFFF');
const Q=(P-1n)/2n;const G=2n;const SIZE=256;
function power(base,exponent){let result=1n;base%=P;while(exponent>0n){if(exponent&1n)result=result*base%P;base=base*base%P;exponent>>=1n;}return result;}
const toInt=bytes=>BigInt('0x'+(Buffer.from(bytes).toString('hex')||'0'));
const toBytes=n=>Buffer.from(n.toString(16).padStart(SIZE*2,'0'),'hex');
// A group element nobody knows the discrete log of: a hash, squared into the order-Q subgroup.
function hashToGroup(label){
 const parts=[];for(let i=0;parts.length*32<SIZE+32;i++)parts.push(createHash('sha256').update(`${label}|${i}`).digest());
 return power(toInt(Buffer.concat(parts))%P,2n);
}
const M=hashToGroup('vtube-input-bridge pairing M'),N=hashToGroup('vtube-input-bridge pairing N');
function element(hex){
 if(typeof hex!=='string'||!/^[0-9a-f]{512}$/.test(hex))throw new Error('Pairing message is malformed.');
 const value=BigInt('0x'+hex);if(value<=1n||value>=P-1n||power(value,Q)!==1n)throw new Error('Pairing message is malformed.');
 return value;
}
const codeSecret=code=>toInt(createHash('sha256').update('vtube-input-bridge pairing code|'+code).digest())%Q;

export function newCode(){return String(randomInt(0,1000000)).padStart(6,'0');}
// What the streamer typed: six digits, spaces and dashes ignored.
export function readCode(text){const digits=String(text??'').replace(/[\s-]/g,'');if(!/^\d{6}$/.test(digits))throw new Error('Enter the 6-digit code shown on the other PC.');return digits;}
export const showCode=code=>code.slice(0,3)+' '+code.slice(3);

// One side of the exchange. `side` is 'A' (showing the code) or 'B' (typing it).
export class Spake {
 constructor(side,code){
  this.side=side;this.w=codeSecret(readCode(code));this.x=toInt(randomBytes(40))%Q;
  this.own=power(G,this.x)*power(side==='A'?M:N,this.w)%P;
 }
 get message(){return toBytes(this.own).toString('hex');}
 // `context` names who is pairing with whom; both sides must pass the same.
 finish(otherHex,context){
  const other=element(otherHex);const theirs=this.side==='A'?N:M;
  const shared=power(other*power(power(theirs,this.w),P-2n)%P,this.x);
  const [a,b]=this.side==='A'?[this.message,otherHex]:[otherHex,this.message];
  const transcript=createHash('sha256').update(JSON.stringify(['vtube-input-bridge pairing 1',context,a,b])).digest();
  const keys=Buffer.from(hkdfSync('sha256',toBytes(shared),transcript,'keys',64));
  const confirm=label=>createHmac('sha256',keys.subarray(0,32)).update(label).digest('hex');
  const key=keys.subarray(32);
  return {
   confirmA:confirm('A'),confirmB:confirm('B'),
   matches:(label,value)=>typeof value==='string'&&value.length===64&&timingSafeEqual(Buffer.from(confirm(label)),Buffer.from(value)),
   seal:(from,value)=>{const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(from));const body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');},
   open:(from,box)=>{try{const bytes=Buffer.from(String(box),'base64');const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAAD(Buffer.from(from));d.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString());}catch{throw new Error('Pairing details could not be read.');}}
  };
 }
}

// The pairing details each PC hands over. The address is not among them: it is the one the PC was reached at.
export function pairingDetails(value){
 if(!value||!['pantry','canada'].includes(value.role)||value.port!==5056||!/^[a-f0-9]{64}$/.test(value.pin)||!/^[a-f0-9]{64}$/.test(value.token))throw new Error('The other PC sent incomplete pairing details. Update VTube Input Bridge on both PCs to the same version.');
 return {role:value.role,port:5056,pin:value.pin,token:value.token,name:typeof value.name==='string'?value.name.slice(0,63):'',version:typeof value.version==='string'?value.version.slice(0,40):''};
}
const opposite=role=>role==='canada'?'pantry':'canada';
const context=(a,b)=>[a,b].join('>');

// The PC showing the code. `details()` gives this PC's pairing details; `accept(details, address)` saves the other PC's
// and may throw to refuse. Three attempts per code; the code also expires.
export class PairingHost {
 constructor({role,details,accept,code=newCode(),attempts=3,ttl=300000,now=Date.now}){
  Object.assign(this,{role,details,accept,code,attemptsLeft:attempts,now});this.expiresAt=now()+ttl;this.sessions=new Map();this.state='waiting';this.message='';this.peer=null;
 }
 get open(){if(this.state==='waiting'&&this.now()>this.expiresAt){this.state='expired';this.message='The code expired. Start pairing again.';}return this.state==='waiting';}
 // One HTTP request from the other PC: {path, body, address}. Returns [status, body].
 async handle(path,body,address){
  if(!this.open)return [410,{ok:false,code:'closed'}];
  if(path==='/pair/hello'){
   if(body?.role!==opposite(this.role))return [409,{ok:false,code:'same_role'}];
   if(this.attemptsLeft<=0)return [429,{ok:false,code:'closed'}];
   this.attemptsLeft--;
   const spake=new Spake('A',this.code);let keys;try{keys=spake.finish(body.message,context(this.role,body.role));}catch{return [400,{ok:false,code:'invalid_request'}];}
   const id=randomBytes(16).toString('hex');this.sessions.set(id,{keys,address,role:body.role});
   return [200,{ok:true,session:id,message:spake.message,confirm:keys.confirmA}];
  }
  if(path==='/pair/finish'){
   const session=this.sessions.get(body?.session);this.sessions.delete(body?.session);
   if(!session||session.address!==address)return [400,{ok:false,code:'invalid_request'}];
   if(!session.keys.matches('B',body.confirm)){if(this.attemptsLeft<=0){this.state='failed';this.message='Too many wrong codes. Start pairing again.';}return [403,{ok:false,code:'wrong_code'}];}
   let theirs;try{theirs=pairingDetails(session.keys.open('B',body.details));if(theirs.role!==session.role)throw new Error('The other PC sent mismatched pairing details.');}catch(e){return [400,{ok:false,code:'invalid_request',message:e.message}];}
   try{await this.accept(theirs,address);}catch(e){return [500,{ok:false,code:'not_saved',message:e.message}];}
   this.state='paired';this.peer={...theirs,host:address};
   return [200,{ok:true,details:session.keys.seal('A',this.details())}];
  }
  return [404,{ok:false,code:'not_found'}];
 }
}

// The pairing listener on 5059 for a PairingHost. Only private addresses may pair.
export function createPairingServer(getHost,{allow=privateIp}={}){
 const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  const address=req.socket.remoteAddress?.replace(/^::ffff:/,'');
  if(!allow(address))return reply(res,403,{ok:false,code:'forbidden'});
  const host=getHost();if(!host)return reply(res,410,{ok:false,code:'closed'});
  if(req.method!=='POST')return reply(res,405,{ok:false,code:'not_found'});
  try{
   const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>16384)return reply(res,413,{ok:false,code:'too_large'});chunks.push(b);}
   const [status,body]=await host.handle(req.url,JSON.parse(Buffer.concat(chunks).toString()),address);reply(res,status,body);
  }catch{if(!res.headersSent)reply(res,400,{ok:false,code:'invalid_request'});}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=8;return server;
}

async function post(address,path,body,port){
 const response=await fetch(`http://${address}:${port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 let value;try{value=await response.json();}catch{throw new Error('The other PC answered with something that is not VTube Input Bridge pairing.');}return value;
}
const refusals={same_role:'Both PCs are set up as the same kind of PC. Pair the Gaming PC with the Streaming PC.',closed:'The other PC is no longer waiting for a code. Start pairing there again.',wrong_code:'That code is not the one on the other PC. Check it and try again.'};
// The PC typing the code: pairs with the PC waiting at `address`. Returns the other PC's details with its address.
export async function joinPairing({address,code,role,details,port=PAIRING_PORT,request=post,allow=privateIp}){
 if(!allow(address))throw new Error('The other PC must be on your home network.');
 const spake=new Spake('B',code);
 const hello=await request(address,'/pair/hello',{role,message:spake.message},port);
 if(!hello?.ok)throw new Error(refusals[hello?.code]||'The other PC refused to pair. Update VTube Input Bridge on both PCs to the same version.');
 const theirRole=opposite(role);const keys=spake.finish(hello.message,context(theirRole,role));
 const finish=keys.matches('A',hello.confirm);
 // A wrong code still goes back to the waiting PC, so it can count the attempt and close the code after three.
 const done=await request(address,'/pair/finish',{session:hello.session,confirm:finish?keys.confirmB:'0'.repeat(64),details:finish?keys.seal('B',details):''},port);
 if(!finish||done?.code==='wrong_code')throw new Error(refusals.wrong_code);
 if(!done?.ok)throw new Error(done?.message||refusals[done?.code]||'Pairing did not complete. Start again on both PCs.');
 const theirs=pairingDetails(keys.open('A',done.details));if(theirs.role!==theirRole)throw new Error(refusals.same_role);
 return {...theirs,host:address};
}
