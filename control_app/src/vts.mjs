import {checkDeadline} from './deadline.mjs';
import WebSocket from 'ws'; import {randomUUID} from 'node:crypto';import {loopbackWs} from './obs.mjs';import {userError} from './errors.mjs';
const identity={pluginName:'VTube Control',pluginDeveloper:'ChayzX'};
// VTube Studio may run on either PC; a press from the other PC arrives prefixed with "On the other PC:", so the text
// names no PC itself.
const APPROVE='Click Allow in the VTube Studio window to let VTube Control use it, then press again.';
// One VTube Studio API connection; every request still pending fails when it closes.
function session(url){
 const ws=new WebSocket(loopbackWs(url),{maxPayload:1024*1024}); const pending=new Map();
 const request=(messageType,data)=>new Promise((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});ws.send(JSON.stringify({apiName:'VTubeStudioPublicAPI',apiVersion:'1.0',requestID:id,messageType,data}));});
 const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.on('error',()=>{});ws.on('close',()=>{for(const p of pending.values())p.reject(new Error('VTS disconnected; outcome unknown'));pending.clear();});
 ws.on('message',b=>{try{const r=JSON.parse(b);const p=pending.get(r.requestID);if(!p)return;pending.delete(r.requestID);if(r.messageType==='APIError')p.reject(new Error('VTube Studio rejected the request'+(r.data?.message?': '+String(r.data.message).slice(0,200):'')));else p.resolve(r.data);}catch{ws.close();}});
 const close=()=>{ws.terminate();for(const p of pending.values())p.reject(new Error('VTS request ended'));pending.clear();};
 return {opened,request,close};
}
// VTube Studio answers a token request only once the streamer clicks Allow or Deny in its window, so the request runs on
// its own connection with a long timeout (as the relay does), at most one per address. The press that started it
// returns at once; the token is saved when it arrives.
const approvals=new Map();
export function requestApproval(url,saveToken,timeout=90000){
 if(approvals.has(url))return approvals.get(url);
 let timer;const s=session(url);
 const approval=Promise.race([(async()=>{await s.opened;const token=(await s.request('AuthenticationTokenRequest',identity)).authenticationToken;if(typeof token!=='string'||!token)throw new Error('VTube Studio sent no token');await saveToken?.(token);return token;})(),
  new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('VTS approval timeout')),timeout))]).finally(()=>{clearTimeout(timer);s.close();approvals.delete(url);});
 approvals.set(url,approval);approval.catch(()=>{});return approval;
}
export async function vtsAction(options,action,args={}) {
 if(!['vts.hotkeys','vts.trigger'].includes(action))throw userError('Unsupported VTS action');
 if(action==='vts.trigger'&&(typeof args.hotkey!=='string'||!args.hotkey||args.hotkey.length>128))throw userError('Choose a VTS hotkey');
 const url=options.url||'ws://127.0.0.1:8001';
 if(!options.token){requestApproval(url,options.saveToken,options.approvalTimeout);throw userError(APPROVE,'not_approved');}
 const s=session(url);let timer;
 try{return await Promise.race([(async()=>{
  await s.opened;
  const auth=await s.request('AuthenticationRequest',{...identity,authenticationToken:options.token});
  // The stored token stops working when the plugin is removed in VTube Studio or VTube Studio is reset: ask again.
  if(!auth.authenticated){await options.saveToken?.('');requestApproval(url,options.saveToken,options.approvalTimeout);throw userError('VTube Studio no longer accepts VTube Control’s earlier approval. '+APPROVE,'not_approved');}
  checkDeadline(options);return action==='vts.hotkeys'?s.request('HotkeysInCurrentModelRequest',{}):s.request('HotkeyTriggerRequest',{hotkeyID:args.hotkey});
 })(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('VTS timeout; outcome unknown')),5000))]);}
 finally{clearTimeout(timer);s.close();}
}
