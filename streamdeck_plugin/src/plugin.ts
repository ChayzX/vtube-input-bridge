import streamDeck,{action,SingletonAction,type KeyDownEvent,type WillAppearEvent,type DidReceiveSettingsEvent,type SendToPluginEvent} from '@elgato/streamdeck';
import type {JsonValue} from '@elgato/utils';
import {randomUUID} from 'node:crypto';import {commandFor,feedback,fixedTargets,titleFor} from './settings.mjs';import {localRequest} from './local.mjs';
type Settings={target?:string;action?:string;value?:string;label?:string};
const OFFLINE="VTube Input Bridge isn't answering on this PC. Make sure it is running (it lives in the tray), then choose Refresh.";
@action({UUID:'com.chayzx.vtubecontrol.command'})
class ControlAction extends SingletonAction<Settings>{
 private pending=new Set<string>();private polling=false;
 override async onKeyDown(ev:KeyDownEvent<Settings>){
  if(!ev.action.isKey()||this.pending.has(ev.action.id))return;this.pending.add(ev.action.id);
  const key=ev.action,settings=ev.payload.settings;
  try{const c=commandFor(settings);await key.setTitle('Sending');const r=await localRequest('POST','/command',c);await key.setTitle(feedback(r));if(r.ok)await key.showOk();else await key.showAlert();}
  catch{await key.setTitle('Check app');await key.showAlert();}
  // The result shows for a moment, then the key's own title returns.
  finally{this.pending.delete(key.id);setTimeout(()=>{if(!this.pending.has(key.id))void key.setTitle(titleFor(settings)).catch(()=>{});},2000);}
 }
 override async onWillAppear(ev:WillAppearEvent<Settings>){if(!ev.action.isKey())return;await ev.action.setTitle(titleFor(ev.payload.settings));}
 override async onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>){if(ev.action.isKey()&&!this.pending.has(ev.action.id))await ev.action.setTitle(titleFor(ev.payload.settings));}
 override async onSendToPlugin(ev:SendToPluginEvent<JsonValue,Settings>){
  const payload=ev.payload as {request?:string;target?:string;token?:number};const discovery:{[request:string]:string}={scenes:'obs.scenes',meldScenes:'meld.scenes',hotkeys:'vts.hotkeys'};
  const reply=async(result:JsonValue)=>{if(streamDeck.ui.action?.id===ev.action.id)await streamDeck.ui.sendToPropertyInspector({request:payload.request??null,token:payload.token??null,result});};
  // The inspector asks which PC this is, so it can name both PCs ("Gaming PC (this PC)") instead of "this/other PC".
  if(payload?.request==='whoami'){
   try{const r=await localRequest('POST','/command',{id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'bridge.status',args:{}});await reply(r.ok?{ok:true,role:r.data?.role??null,paired:!!r.data?.peer&&r.data.peer!=='Not paired'}:{ok:false,message:r.message||'VTube Input Bridge did not answer.'});}
   catch{await reply({ok:false,message:OFFLINE});}
   return;
  }
  if(!Object.hasOwn(discovery,payload?.request||''))return;
  try{await reply(await localRequest('POST','/command',{id:randomUUID(),expiresAt:Date.now()+10000,target:payload.target==='local'?'local':'peer',action:discovery[payload.request as string],args:{}}));}
  catch{await reply({ok:false,message:OFFLINE});}
 }
 async poll(){if(this.polling)return;this.polling=true;const status=new Map<string,Promise<boolean>>();try{for(const item of this.actions){if(!item.isKey()||this.pending.has(item.id))continue;const settings=await item.getSettings();const target=(fixedTargets as {[action:string]:string})[settings.action||'']||(settings.target==='local'?'local':'peer');if(!status.has(target))status.set(target,localRequest('POST','/command',{id:randomUUID(),expiresAt:Date.now()+10000,target,action:'bridge.status',args:{}}).then(r=>r.ok).catch(()=>false));const online=await status.get(target);if(!this.pending.has(item.id))await item.setTitle(online?titleFor(settings):'Offline');}}finally{this.polling=false;}}
}
const controls=new ControlAction();streamDeck.actions.registerAction(controls);streamDeck.connect();setInterval(()=>void controls.poll().catch(()=>{}),10000);
