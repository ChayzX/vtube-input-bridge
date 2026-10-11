// Property inspector for every key type. Each job's key (OBS scene, Spotify, …) shows only its own fields; the
// "Advanced command" key (the original "Bridge command") offers every action. All keep the original settings shape
// ({target, action, value, label}) so existing keys keep working. Scene and hotkey lists are fetched as soon as the
// inspector opens.
let ws,context,uuid='com.chayzx.vtubecontrol.command',kind=null,label='',role=null,token=0;const el=id=>document.getElementById(id);
// Reactive keys always go to the PC that runs them (as the plugin enforces): the renderer on the gaming PC, show/hide
// on the stream PC. The Stream Deck sits on the gaming PC.
const fixed={'reactive.show':'peer','reactive.hide':'peer','reactive.start':'local','reactive.stop':'local'};
const P='com.chayzx.vtubecontrol.';
const kinds={[P+'obs']:{actions:['obs.scene']},[P+'meld']:{actions:['meld.scene']},[P+'vts']:{actions:['vts.trigger']},
 [P+'spotify']:{actions:['spotify.play','spotify.pause','spotify.next','spotify.previous'],label:'Control',names:['Play','Pause','Next track','Previous track']},
 [P+'reactives']:{actions:['reactive.show','reactive.hide'],label:'Reactives',names:['Show','Hide']},
 [P+'renderer']:{actions:['reactive.start','reactive.stop'],label:'Renderer',names:['Start','Stop']}};
const lists={'obs.scene':{request:'scenes',noun:'scene',app:'OBS'},'meld.scene':{request:'meldScenes',noun:'scene',app:'Meld Studio'},'vts.trigger':{request:'hotkeys',noun:'hotkey',app:'VTube Studio'}};
const settings=()=>({target:el('target').value,action:el('action').value,value:el('value').value,label});
const save=()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({event:'setSettings',context,payload:settings()}));};
const send=payload=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({event:'sendToPlugin',action:uuid,context,payload}));};
// Names for both PCs once the app says which one this is.
const pcName=target=>role==='canada'?(target==='local'?'Streaming PC':'Gaming PC'):role==='pantry'?(target==='local'?'Gaming PC':'Streaming PC'):(target==='local'?'this PC':'the other PC');
function status(level,text){el('status').className='status '+level;el('statusText').textContent=text;}
function message(text,isError){el('message').textContent=text||'';el('message').className='message'+(isError?' err':'');}
function labelTargets(){
 for(const option of el('target').options)option.textContent=role?`${pcName(option.value)}${option.value==='local'?' (this PC)':''}`:option.value==='local'?'This PC':'The other PC';
}
// Shows the fields the chosen action needs, and pins the PC for reactive keys.
function layout(){
 const action=el('action').value,list=lists[action],t=fixed[action];
 el('target').disabled=!!t;if(t)el('target').value=t;el('targetHint').hidden=!t;
 el('pickField').hidden=!list;el('valueField').hidden=!list||action==='vts.trigger';
 if(list)el('choiceLabel').textContent=list.noun==='hotkey'?'Hotkey or Item Scene':'Scene';
 if(!list)message('');
}
// The saved value always stays selectable, even before (or without) a list from the app.
function fillChoices(items){
 const select=el('choice'),value=el('value').value;select.replaceChildren();
 const add=(v,text)=>{const o=document.createElement('option');o.value=v;o.textContent=text;select.append(o);return o;};
 add('',items.length?`Choose a ${lists[el('action').value]?.noun||'item'}…`:'Nothing to choose yet');
 for(const item of items)add(item.value,item.label);
 if(value&&!items.some(i=>i.value===value))add(value,`${label||value} (saved)`);
 select.value=value;
}
function refreshList(){
 const list=lists[el('action').value];if(!list)return;
 fillChoices([]);token++;el('discover').disabled=true;
 message(`Asking ${list.app} on the ${pcName(el('target').value)}…`);
 send({request:list.request,target:el('target').value,token});
}
function onList(data){
 const list=lists[el('action').value];el('discover').disabled=false;
 if(!list||data.request!==list.request||data.token!==null&&data.token!==undefined&&data.token!==token)return;// an answer to an earlier choice
 const r=data.result||{};
 // When the app itself is not answering, the status line already says so.
 if(!r.ok){fillChoices([]);const same=r.message&&r.message===el('statusText').textContent;message(same?'The list fills in once VTube Input Bridge answers.':r.message||`${list.app} is unavailable.`,!same);return;}
 const items=list.noun==='hotkey'?(r.data?.availableHotkeys||[]).map(h=>({value:h.hotkeyID,label:h.name||h.hotkeyID}))
  :(r.data?.scenes||[]).slice().sort((a,b)=>(b.sceneIndex??0)-(a.sceneIndex??0)).map(s=>({value:s.sceneName,label:s.sceneName}));
 fillChoices(items);
 const where=`the ${pcName(el('target').value)}`;
 message(items.length?`${items.length} ${list.noun}${items.length===1?'':'s'} from ${list.app} on ${where}.`
  :list.noun==='hotkey'?`No hotkeys yet. Open VTube Studio on ${where}, load a model and add a hotkey, then choose Refresh.`
  :`No scenes yet. Open ${list.app} on ${where} and add a scene, then choose Refresh.`);
}
function onWhoami(r){
 if(r?.ok){role=r.role;labelTargets();status(r.paired?'ok':'warn',r.paired?`Connected to VTube Input Bridge on the ${pcName('local')}.`:`Connected on the ${pcName('local')}, but it is not paired with the other PC yet.`);}
 else status('err',r?.message||'VTube Input Bridge is not answering on this PC.');
}
function apply(s){for(const id of ['target','action','value'])el(id).value=s[id]||(id==='target'?'peer':id==='action'?(kind?.actions[0]||'obs.scene'):'');if(kind&&!kind.actions.includes(el('action').value))el('action').value=kind.actions[0];label=s.label||'';layout();}
// A job's key offers only its own actions, and hides the choice when there is just one.
function narrow(){
 if(!kind)return;for(const o of [...el('action').options])if(!kind.actions.includes(o.value))o.remove();
 kind.names?.forEach((name,i)=>{el('action').options[i].textContent=name;});
 el('actionField').hidden=kind.actions.length<2;if(kind.label)el('actionLabel').textContent=kind.label;
}
// What happened when this key was last pressed, from the plugin (it keeps the app's full reason).
function onLast(r){
 el('last').hidden=!r;if(!r)return;const at=new Date(r.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
 el('last').textContent=`Last press (${at}): ${r.ok?'it worked.':r.message}`;el('last').className='message'+(r.ok?'':' err');
}

window.connectElgatoStreamDeckSocket=(port,pi,registerEvent,_info,actionInfo)=>{
 const info=JSON.parse(actionInfo),saved=info.payload.settings||{};context=info.context;uuid=info.action||uuid;kind=kinds[uuid]||null;narrow();apply(saved);fillChoices([]);
 ws=new WebSocket(`ws://127.0.0.1:${port}`);
 ws.onopen=()=>{ws.send(JSON.stringify({event:registerEvent,uuid:pi}));
  // A job's new key is saved with its defaults straight away, so the key and its settings agree.
  if(kind&&(saved.action!==el('action').value||saved.target!==el('target').value))save();
  send({request:'whoami'});send({request:'lastPress'});refreshList();};
 ws.onclose=()=>status('err','Lost the connection to Stream Deck. Close and reopen this key\'s settings.');
 ws.onmessage=e=>{const data=JSON.parse(e.data);
  if(data.event==='sendToPropertyInspector'){const p=data.payload||{};if(p.request==='whoami')onWhoami(p.result);else if(p.request==='lastPress')onLast(p.result);else onList(p);}
  if(data.event==='didReceiveSettings'){const before=settings();apply(data.payload.settings||{});if(before.action!==el('action').value||before.target!==el('target').value)refreshList();else fillChoices([...el('choice').options].filter(o=>o.value&&!o.textContent.endsWith('(saved)')).map(o=>({value:o.value,label:o.textContent})));}
 };
};
el('action').addEventListener('change',()=>{el('value').value='';label='';layout();save();refreshList();});
el('target').addEventListener('change',()=>{save();refreshList();});
// A VTube Studio hotkey is saved by ID; its name goes with it as the key's title.
el('choice').addEventListener('change',()=>{const o=el('choice').selectedOptions[0];if(!o?.value)return;el('value').value=o.value;label=o.textContent!==o.value&&!o.textContent.endsWith('(saved)')?o.textContent:o.textContent.endsWith('(saved)')?label:'';save();});
el('value').addEventListener('change',()=>{label='';el('choice').value=[...el('choice').options].some(o=>o.value===el('value').value)?el('value').value:'';save();});
el('discover').onclick=()=>{send({request:'whoami'});refreshList();};
layout();labelTargets();
