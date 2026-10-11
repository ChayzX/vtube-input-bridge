import WebSocket from 'ws';import {checkDeadline} from './deadline.mjs';import {loopbackWs} from './obs.mjs';import {userError} from './errors.mjs';

// Meld Studio scene switching over its local Qt WebChannel API (Settings > Advanced > Allow remote connections,
// default ws://127.0.0.1:13376; see MeldStudio/streamdeck WebChannelAPI.md). Only the few WebChannel messages needed
// are spoken here: init to read the `meld` object, then one method call.
const INIT=3,IDLE=4,INVOKE=6,RESPONSE=10;
// A WebChannel value is either a plain object or a published QObject ({properties:[[index,name,notify,value]]}).
function field(value,name){
 if(value?.['__QObject*__'])value=value.data;
 if(Array.isArray(value?.properties)){const p=value.properties.find(entry=>entry[1]===name);value=p?.[3];return value?.['__QObject*__']?value.data:value;}
 return value?.[name];
}
export function meldScenes(meld){
 const items=field(field(meld,'session'),'items');
 return Object.entries(items&&typeof items==='object'?items:{}).filter(([,item])=>item?.type==='scene')
  .sort(([,a],[,b])=>(a.index??0)-(b.index??0)).map(([id,item])=>({sceneName:String(item.name??id),id,current:!!item.current}));
}
export async function meldAction(options,action,args={}){
 if(!['meld.scenes','meld.scene'].includes(action))throw userError('Unsupported Meld Studio action');
 if(action==='meld.scene'&&(typeof args.scene!=='string'||!args.scene.trim()||args.scene.length>128))throw userError('Choose a Meld Studio scene');
 const ws=new WebSocket(loopbackWs(options.url||'ws://127.0.0.1:13376'),{maxPayload:4*1024*1024});const pending=new Map();let next=0,timer;
 const send=message=>ws.send(JSON.stringify(message));
 const request=message=>new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});send({...message,id});});
 const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.on('error',()=>{});ws.on('close',()=>{for(const p of pending.values())p.reject(new Error('Meld Studio disconnected; outcome unknown'));pending.clear();});
 ws.on('message',b=>{try{const m=JSON.parse(b);if(m.type!==RESPONSE)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);p.resolve(m.data);}catch{ws.close();}});
 try{return await Promise.race([(async()=>{
  await opened;const objects=await request({type:INIT});send({type:IDLE});
  const meld=objects?.meld;if(!meld)throw new Error('the API did not offer the meld object; update Meld Studio');
  const scenes=meldScenes(meld);
  if(action==='meld.scenes')return {scenes,currentScene:scenes.find(s=>s.current)?.sceneName??null};
  const wanted=args.scene.trim();const scene=scenes.find(s=>s.sceneName===wanted)||scenes.find(s=>s.id===wanted);
  if(!scene)throw userError(`Meld Studio has no scene named "${wanted}". Fetch the scene list and pick one.`,'not_found');
  const method=meld.methods?.find(m=>m[0]==='showScene'||String(m[0]).startsWith('showScene('));
  if(!method)throw new Error('this Meld Studio version cannot switch scenes over its API');
  checkDeadline(options);await request({type:INVOKE,object:'meld',method:method[1],args:[scene.id]});
  return {scene:scene.sceneName};
 })(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Meld Studio timeout; outcome unknown')),4000))]);}
 finally{clearTimeout(timer);ws.terminate();for(const p of pending.values())p.reject(new Error('Meld Studio request ended'));pending.clear();}
}
