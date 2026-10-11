import dgram from 'node:dgram';import {networkInterfaces} from 'node:os';import {privateIp} from './config.mjs';import {PAIRING_PORT} from './pairing.mjs';

// Finding the other PC on the home network, so nobody types an IP address. Each PC answers small UDP broadcasts on
// 5059: "who is waiting to pair?" (answered only while pairing) and "where is the PC with this certificate?" (answered
// by that PC only). An answer only says where to look: the PC link still checks the pinned certificate before it sends
// anything, so a false answer can cause a failed request, never a connection to the wrong PC.
const MAX=1024;
const parse=bytes=>{if(bytes.length>MAX)return null;try{const m=JSON.parse(bytes.toString());return m?.app==='vtube-input-bridge'&&m.v===1?m:null;}catch{return null;}};
const encode=value=>Buffer.from(JSON.stringify({app:'vtube-input-bridge',v:1,...value}));

// This PC's private IPv4 addresses with their subnets, real adapters first (virtual ones such as Hyper-V, WSL, VPN or
// VirtualBox adapters last, since the other PC is rarely behind them).
const VIRTUAL=/vethernet|wsl|hyper-v|virtualbox|vmware|vpn|tailscale|zerotier|hamachi|loopback|docker/i;
export function localAddresses(interfaces=networkInterfaces()){
 const list=[];
 for(const [name,entries] of Object.entries(interfaces||{}))for(const e of entries||[]){
  if((e.family!=='IPv4'&&e.family!==4)||e.internal||!(privateIp(e.address)||e.address.startsWith('127.')))continue;
  const mask=e.netmask&&/^\d+\.\d+\.\d+\.\d+$/.test(e.netmask)?e.netmask:'255.255.255.0';
  list.push({name,address:e.address,netmask:mask,broadcast:broadcastOf(e.address,mask),virtual:VIRTUAL.test(name)});
 }
 return list.sort((a,b)=>a.virtual-b.virtual);
}
const toInt=ip=>ip.split('.').reduce((n,p)=>(n<<8|Number(p))>>>0,0);
const toIp=n=>[24,16,8,0].map(s=>n>>>s&255).join('.');
function broadcastOf(address,mask){return toIp((toInt(address)|~toInt(mask))>>>0);}
const sameSubnet=(a,b,mask)=>((toInt(a)^toInt(b))&toInt(mask))===0;
// The address the other PC reaches this PC at: the one on its subnet, else the first real adapter's.
export function addressToward(peer,interfaces){
 const list=localAddresses(interfaces);
 return (peer&&list.find(e=>sameSubnet(e.address,peer,e.netmask))||list[0])?.address||'';
}

// True when one of this PC's adapters is on that address's subnet.
export const onSubnet=(address,interfaces)=>localAddresses(interfaces).some(e=>sameSubnet(e.address,address,e.netmask));

export class Discovery {
 // `me()` describes this PC: {role, name, version, pin, pairing (true while showing a code)}.
 constructor({me,port=PAIRING_PORT,createSocket=dgram.createSocket,interfaces=()=>networkInterfaces(),onError=()=>{},allow=privateIp}){
  Object.assign(this,{me,port,createSocket,interfaces,onError,allow});this.socket=null;this.error=null;this.answered=[];
 }
 // Listens for questions. A failure (the port in use) is kept in `error` and retried by start() again.
 start(){
  if(this.socket)return Promise.resolve();
  return new Promise(resolve=>{
   const socket=this.createSocket({type:'udp4',reuseAddr:true});
   socket.on('message',(bytes,from)=>this.answer(socket,bytes,from));
   socket.once('error',e=>{this.error=`Could not listen on UDP ${this.port}: ${e.message}`;this.onError(this.error);try{socket.close();}catch{}if(this.socket===socket)this.socket=null;resolve();});
   socket.bind(this.port,'0.0.0.0',()=>{this.socket=socket;this.error=null;resolve();});
  });
 }
 stop(){const s=this.socket;this.socket=null;if(s)try{s.close();}catch{}}
 answer(socket,bytes,from){
  const m=parse(bytes);if(!m||m.type!=='find'||!this.allow(from.address))return;
  // At most 20 answers a second, so this cannot be used to flood the network.
  const now=Date.now();this.answered=this.answered.filter(t=>now-t<1000);if(this.answered.length>=20)return;
  const me=this.me();if(!me)return;
  const answer=m.want==='pairing'?me.pairing&&m.role&&m.role!==me.role:m.want==='peer'?typeof m.pin==='string'&&m.pin===me.pin:false;
  if(!answer)return;this.answered.push(now);
  socket.send(encode({type:'here',want:m.want,role:me.role,name:me.name,version:me.version}),from.port,from.address,()=>{});
 }
 // Asks the network and collects answers for `wait` ms: [{address, role, name, version}], one per address.
 find(question,{wait=1500}={}){
  return new Promise(resolve=>{
   const found=new Map();let socket;
   const finish=()=>{try{socket.close();}catch{}resolve([...found.values()]);};
   try{socket=this.createSocket({type:'udp4'});}catch{return resolve([]);}
   socket.on('error',()=>{});
   socket.on('message',(bytes,from)=>{const m=parse(bytes);if(m?.type==='here'&&m.want===question.want&&this.allow(from.address)&&!found.has(from.address))found.set(from.address,{address:from.address,role:m.role,name:typeof m.name==='string'?m.name.slice(0,63):'',version:typeof m.version==='string'?m.version.slice(0,40):''});});
   socket.bind(0,()=>{
    try{socket.setBroadcast(true);}catch{}
    const targets=new Set(['255.255.255.255',...localAddresses(this.interfaces()).map(e=>e.broadcast)]);const message=encode({type:'find',...question});
    // Twice, a moment apart: a single UDP packet can be lost.
    const send=()=>{for(const target of targets)socket.send(message,this.port,target,()=>{});};send();setTimeout(send,300);
    setTimeout(finish,wait);
   });
  });
 }
}
