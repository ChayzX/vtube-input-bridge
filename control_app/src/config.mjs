import {isIP} from 'node:net';import {loopbackWs} from './obs.mjs';import {validateFugiUrl} from './frames.mjs';
export function privateIp(s){if(isIP(s)!==4)return false;const [a,b]=s.split('.').map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);}
// Every feature starts on. Controls themselves switch on when the PCs are paired (they need the other PC), and Fugi
// rendering only belongs on the gaming PC, where Discord runs.
export function defaults(role='pantry'){return {version:1,role,enabled:false,ownIp:role==='pantry'?'10.0.0.112':'10.0.0.119',peer:null,obs:{enabled:true,url:'ws://127.0.0.1:4455',password:''},vts:{enabled:true,url:'ws://127.0.0.1:8001',token:''},meld:{enabled:true,url:'ws://127.0.0.1:13376'},spotify:{enabled:true},reactive:{enabled:role==='pantry',url:'',visible:true}};}
// Settings saved before Meld Studio support have no meld section; like every feature, it starts on. The PC's role is
// the one it was installed as (the launch flag), never a stored choice, and Fugi rendering only exists on Pantry.
export function upgradeConfig(c,role){
 if(!c||typeof c!=='object')return c;if(c.meld===undefined)c={...c,meld:{enabled:true,url:'ws://127.0.0.1:13376'}};
 if(role&&c.role!==role)c={...c,role,reactive:c.reactive&&{...c.reactive,enabled:role==='pantry'&&!!c.reactive.enabled}};
 return c;
}
export function validatePair(p){if(!p||!privateIp(p.host)||p.port!==5056||!/^[a-f0-9]{64}$/.test(p.pin)||!/^[a-f0-9]{64}$/.test(p.token))throw new Error('Invalid pairing file: private IPv4, port 5056, token and certificate pin required');return {host:p.host,port:p.port,pin:p.pin,token:p.token};}
// Reads an imported pairing file (bytes as read from disk).
export function parsePairingFile(bytes){
 if(bytes.length>8192)throw new Error('Pairing file too large');
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('That is not a pairing file. Choose the file exported with “Export this PC’s pairing file” on the other PC.');}
 return validatePair(value);
}
export function validateConfig(c){
 if(c?.version!==1||!['pantry','canada'].includes(c.role)||typeof c.enabled!=='boolean'||!privateIp(c.ownIp))throw new Error('Choose a role and this PC’s private IPv4 address');
 for(const section of ['obs','vts','spotify','reactive','meld'])if(typeof c[section]?.enabled!=='boolean')throw new Error('Invalid feature setting');
 loopbackWs(c.obs.url);loopbackWs(c.vts.url);loopbackWs(c.meld.url);if(typeof c.obs.password!=='string'||typeof c.vts.token!=='string')throw new Error('Invalid credentials');
 if(c.peer)validatePair(c.peer);if(c.enabled&&!c.peer)throw new Error('Import the other PC’s pairing file before enabling');
 if(c.peer?.host===c.ownIp)throw new Error('The two PCs must have different addresses');
 if(c.reactive.url)validateFugiUrl(c.reactive.url);if(c.reactive.enabled&&c.role!=='pantry')throw new Error('Fugi rendering belongs on Pantry with Discord');
 return c;
}
