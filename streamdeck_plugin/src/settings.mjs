import {randomUUID} from 'node:crypto';
const actions=['obs.scene','meld.scene','spotify.play','spotify.pause','spotify.next','spotify.previous','vts.trigger','reactive.show','reactive.hide','reactive.start','reactive.stop'];
// The Stream Deck is on Pantry: the renderer runs here and reactives are shown on Canada, whatever target was saved.
export const fixedTargets={'reactive.show':'peer','reactive.hide':'peer','reactive.start':'local','reactive.stop':'local'};
export function commandFor(s,now=Date.now()){
 if(s&&Object.hasOwn(fixedTargets,s.action))s={...s,target:fixedTargets[s.action]};
 if(!s||!['local','peer'].includes(s.target)||!actions.includes(s.action))throw new Error('Choose a target and supported action');
 const args={};if(['obs.scene','meld.scene','vts.trigger'].includes(s.action)){if(typeof s.value!=='string'||!s.value.trim()||s.value.length>128)throw Error('Choose a scene or hotkey');args[s.action==='vts.trigger'?'hotkey':'scene']=s.value;}
 return {id:randomUUID(),expiresAt:now+10000,target:s.target,action:s.action,args};
}
export function feedback(r){if(!r)return 'Offline';if(r.ok)return 'Done';return ['action_failed','timeout'].includes(r.code)?'Check app':'Error';}
