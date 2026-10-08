import {checkDeadline} from './deadline.mjs';
import WebSocket from 'ws'; import {randomUUID} from 'node:crypto';import {loopbackWs} from './obs.mjs';import {userError} from './errors.mjs';
export async function vtsAction(options,action,args={}) {
 if(!['vts.hotkeys','vts.trigger'].includes(action))throw userError('Unsupported VTS action');
 if(action==='vts.trigger'&&(typeof args.hotkey!=='string'||!args.hotkey||args.hotkey.length>128))throw userError('Choose a VTS hotkey');
 const ws=new WebSocket(loopbackWs(options.url||'ws://127.0.0.1:8001'),{maxPayload:1024*1024}); const pending=new Map();let timer;
 const request=(messageType,data)=>new Promise((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});ws.send(JSON.stringify({apiName:'VTubeStudioPublicAPI',apiVersion:'1.0',requestID:id,messageType,data}));});
 const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.on('error',()=>{});ws.on('close',()=>{for(const p of pending.values())p.reject(new Error('VTS disconnected; outcome unknown'));pending.clear();});
 ws.on('message',b=>{try{const r=JSON.parse(b);const p=pending.get(r.requestID);if(!p)return;pending.delete(r.requestID);if(r.messageType==='APIError')p.reject(new Error('VTube Studio rejected the request'+(r.data?.message?': '+String(r.data.message).slice(0,200):'')));else p.resolve(r.data);}catch{ws.close();}});
 try{return await Promise.race([(async()=>{
  await opened;const identity={pluginName:'VTube Control',pluginDeveloper:'ChayzX'};let token=options.token;
  if(!token){token=(await request('AuthenticationTokenRequest',identity)).authenticationToken;await options.saveToken?.(token);}
  const auth=await request('AuthenticationRequest',{...identity,authenticationToken:token});if(!auth.authenticated)throw userError('VTube Studio has not approved VTube Control. Click Allow in VTube Studio, or reset the plugin token there and try again.','not_approved');
  checkDeadline(options);return action==='vts.hotkeys'?request('HotkeysInCurrentModelRequest',{}):request('HotkeyTriggerRequest',{hotkeyID:args.hotkey});
 })(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('VTS timeout; outcome unknown')),5000))]);}
 finally{clearTimeout(timer);ws.terminate();for(const p of pending.values())p.reject(new Error('VTS request ended'));pending.clear();}
}
