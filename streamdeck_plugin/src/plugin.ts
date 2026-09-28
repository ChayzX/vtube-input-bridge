import streamDeck,{action,SingletonAction,type KeyDownEvent,type WillAppearEvent,type SendToPluginEvent} from '@elgato/streamdeck';
import type {JsonValue} from '@elgato/utils';
import {randomUUID} from 'node:crypto';import {commandFor,feedback} from './settings.mjs';import {localRequest} from './local.mjs';
type Settings={target?:string;action?:string;value?:string};
@action({UUID:'com.chayzx.vtubecontrol.command'})
class ControlAction extends SingletonAction<Settings>{
 private pending=new Set<string>();private polling=false;
 override async onKeyDown(ev:KeyDownEvent<Settings>){
  if(!ev.action.isKey()||this.pending.has(ev.action.id))return;this.pending.add(ev.action.id);
  try{const c=commandFor(ev.payload.settings);await ev.action.setTitle('Sending');const r=await localRequest('POST','/command',c);await ev.action.setTitle(feedback(r));if(r.ok)await ev.action.showOk();else await ev.action.showAlert();}
  catch{await ev.action.setTitle('Check app');await ev.action.showAlert();}finally{this.pending.delete(ev.action.id);}
 }
 override async onWillAppear(ev:WillAppearEvent<Settings>){if(!ev.action.isKey())return;await ev.action.setTitle(ev.payload.settings.value||ev.payload.settings.action?.replace('spotify.','')||'Configure');}
 override async onSendToPlugin(ev:SendToPluginEvent<JsonValue,Settings>){
  const payload=ev.payload as {request?:string;target?:string};if(!['scenes','hotkeys'].includes(payload?.request||''))return;
  try{const response=await localRequest('POST','/command',{id:randomUUID(),expiresAt:Date.now()+10000,target:payload.target==='local'?'local':'peer',action:payload.request==='scenes'?'obs.scenes':'vts.hotkeys',args:{}});if(streamDeck.ui.action?.id===ev.action.id)await streamDeck.ui.sendToPropertyInspector({request:payload.request,result:response});}
  catch{if(streamDeck.ui.action?.id===ev.action.id)await streamDeck.ui.sendToPropertyInspector({request:payload.request,result:{ok:false,message:'Companion offline or action unavailable'}});}
 }
 async poll(){if(this.polling)return;this.polling=true;const status=new Map<string,Promise<boolean>>();try{for(const item of this.actions){if(!item.isKey()||this.pending.has(item.id))continue;const settings=await item.getSettings();const target=settings.target==='local'?'local':'peer';if(!status.has(target))status.set(target,localRequest('POST','/command',{id:randomUUID(),expiresAt:Date.now()+10000,target,action:'bridge.status',args:{}}).then(r=>r.ok).catch(()=>false));const online=await status.get(target);if(!this.pending.has(item.id))await item.setTitle(online?(settings.value||settings.action?.replace('spotify.','')||'Configure'):'Offline');}}finally{this.polling=false;}}
}
const controls=new ControlAction();streamDeck.actions.registerAction(controls);streamDeck.connect();setInterval(()=>void controls.poll().catch(()=>{}),10000);
