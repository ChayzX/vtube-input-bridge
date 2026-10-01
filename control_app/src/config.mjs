import {isIP} from 'node:net';import {loopbackWs} from './obs.mjs';import {validateFugiUrl} from './frames.mjs';
export function privateIp(s){if(isIP(s)!==4)return false;const [a,b]=s.split('.').map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);}
export function defaults(role='pantry'){return {version:1,role,enabled:false,ownIp:role==='pantry'?'10.0.0.112':'10.0.0.119',peer:null,obs:{enabled:false,url:'ws://127.0.0.1:4455',password:''},vts:{enabled:false,url:'ws://127.0.0.1:8001',token:''},spotify:{enabled:false},reactive:{enabled:false,url:'',visible:true}};}
export function validatePair(p){if(!p||!privateIp(p.host)||p.port!==5056||!/^[a-f0-9]{64}$/.test(p.pin)||!/^[a-f0-9]{64}$/.test(p.token))throw new Error('Invalid pairing file: private IPv4, port 5056, token and certificate pin required');return {host:p.host,port:p.port,pin:p.pin,token:p.token};}
export function validateConfig(c){
 if(c?.version!==1||!['pantry','canada'].includes(c.role)||typeof c.enabled!=='boolean'||!privateIp(c.ownIp))throw new Error('Choose a role and this PC’s private IPv4 address');
 for(const section of ['obs','vts','spotify','reactive'])if(typeof c[section]?.enabled!=='boolean')throw new Error('Invalid feature setting');
 loopbackWs(c.obs.url);loopbackWs(c.vts.url);if(typeof c.obs.password!=='string'||typeof c.vts.token!=='string')throw new Error('Invalid credentials');
 if(c.peer)validatePair(c.peer);if(c.enabled&&!c.peer)throw new Error('Import the other PC’s pairing file before enabling');
 if(c.peer?.host===c.ownIp)throw new Error('The two PCs must have different addresses');
 if(c.reactive.url)validateFugiUrl(c.reactive.url);if(c.reactive.enabled&&c.role!=='pantry')throw new Error('Fugi rendering belongs on Pantry with Discord');
 return c;
}
