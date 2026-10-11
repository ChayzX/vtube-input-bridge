import streamDeck,{SingletonAction,type KeyDownEvent,type WillAppearEvent,type DidReceiveSettingsEvent,type SendToPluginEvent,type KeyAction} from '@elgato/streamdeck';
import type {JsonValue} from '@elgato/utils';
import {randomUUID} from 'node:crypto';import {commandForKey,feedback,failureMessage,kinds,OFFLINE,settingsFor,statusTitle,targetFor,titleFor} from './settings.mjs';import {localRequest} from './local.mjs';
type Settings={target?:string;action?:string;value?:string;label?:string};
type Result={ok:boolean;code?:string;message?:string;data?:any};
const REFRESH=OFFLINE+' Then choose Refresh.';
// Shared by every key type: what is in flight, and each key's last press for its inspector ("Last press: …").
const pending=new Set<string>(),last=new Map<string,{ok:boolean;message:string;at:number}>();
const ask=(target:string,action:string)=>localRequest('POST','/command',{id:randomUUID(),expiresAt:Date.now()+10000,target,action,args:{}}) as Promise<Result>;
const showLast=async(id:string)=>{if(streamDeck.ui.action?.id===id)await streamDeck.ui.sendToPropertyInspector({request:'lastPress',token:null,result:last.get(id)??null});};
// One class serves every key type (OBS scene, Spotify, …); the manifest UUID decides which commands a key may send.
class ControlAction extends SingletonAction<Settings>{
 constructor(override readonly manifestId:string){super();}
 override async onKeyDown(ev:KeyDownEvent<Settings>){
  if(!ev.action.isKey()||pending.has(ev.action.id))return;pending.add(ev.action.id);
  const key=ev.action,settings=settingsFor(this.manifestId,ev.payload.settings);
  const fail=async(title:string,message:string)=>{streamDeck.logger.warn(`${this.manifestId} ${settings.action||'(no action)'} failed: ${message}`);last.set(key.id,{ok:false,message,at:Date.now()});await key.setTitle(title);await key.showAlert();};
  try{
   let c;try{c=commandForKey(this.manifestId,settings);}catch(e){await fail('Set up',`${(e as Error).message} in this key's settings.`);return;}
   await key.setTitle('Sending');let r:Result|null=null;
   try{r=await localRequest('POST','/command',c);}
   catch(e){if((e as Error)?.name==='TimeoutError'){await fail('Timed out','VTube Input Bridge did not answer in time. The action may still have happened; check before pressing again.');return;}}
   if(r?.ok){last.set(key.id,{ok:true,message:'Done',at:Date.now()});await key.setTitle(feedback(r));await key.showOk();}
   else await fail(feedback(r),failureMessage(r));
  }
  catch(e){streamDeck.logger.error(`${this.manifestId} press failed: ${e}`);}
  // The result shows for a moment, then the key's own title returns.
  finally{pending.delete(key.id);void showLast(key.id).catch(()=>{});setTimeout(()=>{if(!pending.has(key.id))void key.setTitle(titleFor(settings)).catch(()=>{});},2000);}
 }
 override async onWillAppear(ev:WillAppearEvent<Settings>){if(!ev.action.isKey())return;await ev.action.setTitle(titleFor(settingsFor(this.manifestId,ev.payload.settings)));}
 override async onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>){if(ev.action.isKey()&&!pending.has(ev.action.id))await ev.action.setTitle(titleFor(settingsFor(this.manifestId,ev.payload.settings)));}
 override async onSendToPlugin(ev:SendToPluginEvent<JsonValue,Settings>){
  const payload=ev.payload as {request?:string;target?:string;token?:number};const discovery:{[request:string]:string}={scenes:'obs.scenes',meldScenes:'meld.scenes',hotkeys:'vts.hotkeys'};
  const reply=async(result:JsonValue)=>{if(streamDeck.ui.action?.id===ev.action.id)await streamDeck.ui.sendToPropertyInspector({request:payload.request??null,token:payload.token??null,result});};
  if(payload?.request==='lastPress'){await showLast(ev.action.id);return;}
  // The inspector asks which PC this is, so it can name both PCs ("Gaming PC (this PC)") instead of "this/other PC".
  if(payload?.request==='whoami'){
   try{const r=await ask('local','bridge.status');await reply(r.ok?{ok:true,role:r.data?.role??null,paired:!!r.data?.peer&&r.data.peer!=='Not paired'}:{ok:false,message:r.message||'VTube Input Bridge did not answer.'});}
   catch{await reply({ok:false,message:REFRESH});}
   return;
  }
  if(!Object.hasOwn(discovery,payload?.request||''))return;
  try{await reply(await ask(payload.target==='local'?'local':'peer',discovery[payload.request as string]) as JsonValue);}
  catch{await reply({ok:false,message:REFRESH});}
 }
}
const keys=Object.keys(kinds).map(uuid=>new ControlAction(uuid));for(const k of keys)streamDeck.actions.registerAction(k);
// Every 10 s each key shows whether its PC answers: "App off" when this PC's app does not, "Not paired" when the
// other PC is the target and the app has no pairing. One status request per PC covers all keys.
let polling=false;
async function poll(){if(polling)return;polling=true;const status=new Map<string,Promise<Result|null>>();try{for(const item of streamDeck.actions){if(!item.isKey()||pending.has(item.id)||!Object.hasOwn(kinds,item.manifestId))continue;const settings=settingsFor(item.manifestId,await item.getSettings() as Settings),target=targetFor(settings);if(!status.has(target))status.set(target,ask(target,'bridge.status').catch(()=>null));const r=await status.get(target)!;if(!pending.has(item.id))await (item as KeyAction<Settings>).setTitle(statusTitle(r,settings));}}finally{polling=false;}}
streamDeck.connect();setInterval(()=>void poll().catch(()=>{}),10000);
