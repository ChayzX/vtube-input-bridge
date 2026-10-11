import {isIP} from 'node:net';import {cleanHostname} from './names.mjs';import {loopbackWs} from './obs.mjs';import {validateFugiUrl,validateSourceUrl} from './frames.mjs';
export function privateIp(s){if(isIP(s)!==4)return false;const [a,b]=s.split('.').map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);}
// Every feature starts on, including remote controls (keys aimed at the other PC wait for pairing). Fugi rendering only
// belongs on the gaming PC, where Discord runs. `ownIp` is empty: this PC's address is found on the network each time
// (discovery.mjs), so a new address from the router never needs a settings change.
export function defaults(role='pantry'){return {version:1,role,enabled:true,ownIp:'',peer:null,obs:{enabled:true,url:'ws://127.0.0.1:4455',password:''},vts:{enabled:true,url:'ws://127.0.0.1:8001',token:''},meld:{enabled:true,url:'ws://127.0.0.1:13376'},spotify:{enabled:true},reactive:{enabled:role==='pantry',url:'',visible:true},notify:{enabled:true},updates:{auto:true,fromPeer:true}};}
// Settings saved before Meld Studio support have no meld section; like every feature, it starts on. The PC's role is
// the one it was installed as (the launch flag), never a stored choice, and Fugi rendering only exists on Pantry.
// Settings from before automatic addresses had a typed address; it is found automatically now. Notifications and update
// settings arrived in 1.0.
export function upgradeConfig(c,role){
 if(!c||typeof c!=='object')return c;if(c.meld===undefined)c={...c,meld:{enabled:true,url:'ws://127.0.0.1:13376'}};
 if(c.ownIp)c={...c,ownIp:''};if(c.notify===undefined)c={...c,notify:{enabled:true}};if(c.updates===undefined)c={...c,updates:{auto:true,fromPeer:true}};
 if(role&&c.role!==role)c={...c,role,reactive:c.reactive&&{...c.reactive,enabled:role==='pantry'&&!!c.reactive.enabled}};
 return c;
}
// `name` (the PC's computer name) is optional: pairing files from older versions have none, and a bad one is dropped.
export function validatePair(p){if(!p||!privateIp(p.host)||p.port!==5056||!/^[a-f0-9]{64}$/.test(p.pin)||!/^[a-f0-9]{64}$/.test(p.token))throw new Error('Invalid pairing file: private IPv4, port 5056, token and certificate pin required');const name=cleanHostname(p.name);return {host:p.host,port:p.port,pin:p.pin,token:p.token,...(name?{name}:{})};}
// Reads an imported pairing file (bytes as read from disk).
export function parsePairingFile(bytes){
 if(bytes.length>8192)throw new Error('Pairing file too large');
 // A file opened and saved again in Notepad or written by Windows PowerShell may start with a byte-order mark.
 let value;try{value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw new Error('That is not a pairing file. Choose the file made with “Export pairing file” on the other PC.');}
 return validatePair(value);
}
export function validateConfig(c){
 if(c?.version!==1||!['pantry','canada'].includes(c.role)||typeof c.enabled!=='boolean'||(c.ownIp!==''&&!privateIp(c.ownIp)))throw new Error('Invalid PC link settings');
 for(const section of ['obs','vts','spotify','reactive','meld','notify'])if(typeof c[section]?.enabled!=='boolean')throw new Error('Invalid feature setting');
 if(typeof c.updates?.auto!=='boolean'||typeof c.updates.fromPeer!=='boolean')throw new Error('Invalid update setting');
 loopbackWs(c.obs.url);loopbackWs(c.vts.url);loopbackWs(c.meld.url);if(typeof c.obs.password!=='string'||typeof c.vts.token!=='string')throw new Error('Invalid credentials');
 if(c.peer)validatePair(c.peer);
 if(c.reactive.url)validateFugiUrl(c.reactive.url);if(c.reactive.enabled&&c.role!=='pantry')throw new Error('Reactives are rendered on the Gaming PC, where Discord runs');
 return c;
}
// A save from the settings window is held to what the renderer will accept, so "Saved" never hides a renderer that
// cannot start (stored settings are still loaded with the looser check above).
export function validateSave(c){validateConfig(c);if(c.role==='pantry'&&c.reactive.url)validateSourceUrl(c.reactive.url);return c;}
