import {checkDeadline} from './deadline.mjs';
import OBSWebSocket from 'obs-websocket-js/json';import {userError} from './errors.mjs';
export function loopbackWs(value){const u=new URL(value);if(u.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw new Error('App API must use a loopback WebSocket');return u.href;}
export async function obsAction(options,action,args={}) {
 if(!['obs.scenes','obs.scene'].includes(action))throw userError('Unsupported OBS action');
 if(action==='obs.scene'&&(typeof args.scene!=='string'||!args.scene.trim()||args.scene.length>128))throw userError('Choose an OBS scene');
 const obs=new OBSWebSocket();let timer;
 try{return await Promise.race([(async()=>{await obs.connect(loopbackWs(options.url||'ws://127.0.0.1:4455'),options.password||undefined,{rpcVersion:1});
  if(action==='obs.scenes')return obs.call('GetSceneList');
  checkDeadline(options);await obs.call('SetCurrentProgramScene',{sceneName:args.scene});return obs.call('GetCurrentProgramScene');
 })(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('OBS timeout; outcome unknown')),4000))]);}
 finally{clearTimeout(timer);await obs.disconnect().catch(()=>{});}
}
