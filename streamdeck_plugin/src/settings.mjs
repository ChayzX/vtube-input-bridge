import {randomUUID} from 'node:crypto';
const actions=['obs.scene','meld.scene','spotify.play','spotify.pause','spotify.next','spotify.previous','vts.trigger','reactive.show','reactive.hide','reactive.start','reactive.stop'];
// The Stream Deck is on Pantry: the renderer runs here and reactives are shown on Canada, whatever target was saved.
export const fixedTargets={'reactive.show':'peer','reactive.hide':'peer','reactive.start':'local','reactive.stop':'local'};
// One Stream Deck action per job. Every key stores the same settings ({target, action, value, label}); a job's key
// may only send that job's commands. 'command' is the original all-in-one key ("Advanced command"), kept so existing
// keys keep working.
const P='com.chayzx.vtubecontrol.';
export const kinds={[P+'obs']:['obs.scene'],[P+'meld']:['meld.scene'],[P+'vts']:['vts.trigger'],[P+'spotify']:['spotify.play','spotify.pause','spotify.next','spotify.previous'],
 [P+'reactives']:['reactive.show','reactive.hide'],[P+'renderer']:['reactive.start','reactive.stop'],[P+'command']:actions};
// A new key's settings may be empty until its inspector saves them: it takes its job's first command and the other PC.
export function settingsFor(uuid,s){
 const allowed=kinds[uuid];if(!allowed)throw Error('Unknown key type');if(uuid===P+'command')return s||{};
 s=s||{};return {...s,action:allowed.includes(s.action)?s.action:allowed[0],target:['local','peer'].includes(s.target)?s.target:'peer'};
}
export function commandFor(s,now=Date.now()){
 if(s&&Object.hasOwn(fixedTargets,s.action))s={...s,target:fixedTargets[s.action]};
 if(!s||!['local','peer'].includes(s.target)||!actions.includes(s.action))throw new Error('Choose a target and supported action');
 const args={};if(['obs.scene','meld.scene','vts.trigger'].includes(s.action)){if(typeof s.value!=='string'||!s.value.trim()||s.value.length>128)throw Error(s.action==='vts.trigger'?'Choose a hotkey':'Choose a scene');args[s.action==='vts.trigger'?'hotkey':'scene']=s.value;}
 return {id:randomUUID(),expiresAt:now+10000,target:s.target,action:s.action,args};
}
export const commandForKey=(uuid,s,now=Date.now())=>commandFor(settingsFor(uuid,s),now);
// Which PC a key's command goes to.
export const targetFor=s=>fixedTargets[s?.action]||(s?.target==='local'?'local':'peer');
// A short key title for why a press failed; the app's full message goes to the log and the inspector. null = the app
// did not answer at all.
const failures={not_paired:'Not paired',disabled:'Paused',unavailable:'Failed',action_failed:'Failed',expired:'Timed out',timeout:'Timed out',busy:'Busy',unsupported:'Update app'};
export function failureTitle(r){if(!r)return 'App off';return failures[r.code]||'Failed';}
export function feedback(r){return r?.ok?'Done':failureTitle(r);}
export const OFFLINE="VTube Input Bridge isn't answering on this PC. Make sure it is running (it lives in the tray).";
export function failureMessage(r){if(!r)return OFFLINE;return typeof r.message==='string'&&r.message&&r.message!==r.code?r.message:`The app refused the press (${String(r.code||'no reason given').slice(0,40)}).`;}
// The key's resting title: the hotkey's name or the scene, else a short name for the action. A VTube Studio hotkey saved
// before names were stored has only its 32-character ID, which is no title.
const names={'spotify.play':'Play','spotify.pause':'Pause','spotify.next':'Next','spotify.previous':'Previous','reactive.show':'Show reactives','reactive.hide':'Hide reactives','reactive.start':'Start render','reactive.stop':'Stop render','vts.trigger':'VTS hotkey'};
export function titleFor(s){if(typeof s?.label==='string'&&s.label.trim())return s.label.slice(0,40);if(typeof s?.value==='string'&&s.value.trim()&&!(s.action==='vts.trigger'&&/^[0-9a-f]{32}$/i.test(s.value)))return s.value.slice(0,40);return names[s?.action]||'Configure';}
// The 10-second check: the key's own title while its PC answers, else why not. null = this PC's app did not answer.
export function statusTitle(r,s){if(!r)return 'App off';if(r.ok)return titleFor(s);return r.code==='not_paired'?'Not paired':r.code==='disabled'?'Paused':'Offline';}
