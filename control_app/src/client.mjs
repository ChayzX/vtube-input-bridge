import https from 'node:https'; import tls from 'node:tls'; import {createHash,timingSafeEqual} from 'node:crypto';import {describing} from './errors.mjs';
export function requestPeer(pair,method,path,body) {
 if(!pair||!/^[a-f0-9]{64}$/.test(pair.pin)||!/^[a-f0-9]{64}$/.test(pair.token)||!/^\d{1,3}(\.\d{1,3}){3}$/.test(pair.host)||!Number.isInteger(pair.port)||pair.port<1||pair.port>65535) return Promise.reject(new Error('Peer is not configured'));
 const agent=new https.Agent({keepAlive:false});
 // Release the TLS socket to HTTP only after checking the exact certificate. No bearer token is sent to an unpinned peer.
 agent.createConnection=(options,callback)=>{
  const socket=tls.connect({...options,rejectUnauthorized:false,minVersion:'TLSv1.2'});let completed=false;
  const done=(err)=>{if(completed)return;completed=true;if(err)socket.destroy();callback(err,err?undefined:socket);};
  socket.once('error',done);socket.setTimeout(5000,()=>done(new Error('Peer connection timeout')));
  socket.once('secureConnect',()=>{const raw=socket.getPeerCertificate().raw;const pin=raw&&createHash('sha256').update(raw).digest();if(!pin||!timingSafeEqual(pin,Buffer.from(pair.pin,'hex')))done(new Error('Peer certificate mismatch'));else done(null);});
 };
 return new Promise((resolve,reject)=>{
  const binary=Buffer.isBuffer(body);const data=body===undefined?undefined:binary?body:Buffer.from(JSON.stringify(body));
  const req=https.request({hostname:pair.host,port:pair.port,method,path,agent,headers:{Authorization:`Bearer ${pair.token}`,...(data?{'Content-Type':binary?'image/png':'application/json','Content-Length':data.length}:{})}},res=>{
   const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>2*1024*1024)req.destroy(new Error('Peer response too large'));else chunks.push(b);});
   res.on('end',()=>{agent.destroy();try {if(path==='/frame'&&method==='GET') {if(res.statusCode===204)return resolve(null);if(res.statusCode!==200)throw new Error('Frame unavailable');return resolve(Buffer.concat(chunks));}resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(new Error('Invalid peer response'));}});
   res.on('error',reject);
  });
  req.setTimeout(6000,()=>req.destroy(new Error('Peer timeout; outcome unknown'))); req.on('error',e=>{agent.destroy();reject(e);}); req.end(data);
 });
}
// Runs a command on the other PC. The remaining time travels instead of the absolute expiry, so the two PCs' clocks
// need not agree.
export async function forwardCommand(pair,{expiresAt,...c},now=Date.now()){
 const result=await describing('the other PC',()=>requestPeer(pair,'POST','/command',{...c,target:'local',ttl:expiresAt-now}));
 if(!result.ok){const e=new Error('On the other PC: '+result.message);e.code=result.code;e.publicMessage=e.message;throw e;}
 return result.data;
}
