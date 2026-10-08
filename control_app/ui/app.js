const el=id=>document.getElementById(id);let role;
const show=value=>{el('result').textContent=typeof value==='string'?value:value?.ok===false?'Failed: '+value.message:JSON.stringify(value,null,2);};
async function perform(fn){try{show(await fn());}catch(e){show(e.message);}}

// Tracking: one card at the top; the gaming PC gets the sender controls, the stream PC the receiver status.
let editing=false;
function renderTracking(t){
 if(!t)return;
 const trackingState=t.role==='sender'?(t.connectionState||t.state):t.state;
 el('trackState').textContent=t.error&&t.started===false?'Tracking failed to start':(trackingState||'Starting…');
 el('trackState').className='state '+(['Connected','Receiving input'].includes(trackingState)?'ok':'warn');
 if(t.role==='sender'){
  el('senderControls').hidden=false;
  el('trackDetail').textContent=t.legacy?'The old gaming input relay is running. Disable its scheduled task first.'
   :t.error?t.error:t.running?(t.receiverConnected?`Connected to Canada. ${Number(t.packets).toLocaleString()} packets sent; latest acknowledged packet ${t.lastAckSequence}.`:`Sending to ${t.destination} on UDP 5055, but no recent acknowledgement from Canada. Check Tracking on Canada for its VTube Studio and Pantry address status.`):'Starting or reconnecting to the stream PC…';
  el('trackToggle').textContent=t.running?'Stop':'Start';
  el('destination').disabled=t.running;
  if(!editing){el('destination').value=t.destination||'';el('sensitivity').value=t.sensitivity;}
  el('gameMouse').checked=t.gameMode;el('startOnLaunch').checked=t.startSendingOnLaunch;
  el('mouseInfo').textContent=t.rawError?t.rawError:(t.gameMode?'Game movement; returns to center when idle. ':'Desktop cursor position. ')+`${Number(t.rawEvents).toLocaleString()} raw movement events detected.`;
 }else{
  el('trackDetail').textContent=`${t.detail||''} ${t.packets?Number(t.packets).toLocaleString()+' packets applied.':''}`.trim();
 }
}
const tracking=(name,args)=>window.control.tracking(name,args).then(renderTracking).catch(e=>{el('trackDetail').textContent=e.message;});
el('trackToggle').onclick=()=>tracking(el('trackToggle').textContent==='Stop'?'stop':'start',{destination:el('destination').value.trim()});
el('startOnLaunch').onchange=()=>tracking('startOnLaunch',{enabled:el('startOnLaunch').checked});
const mouse=()=>tracking('mouse',{gameMode:el('gameMouse').checked,sensitivity:Number(el('sensitivity').value)});
el('gameMouse').onchange=mouse;el('sensitivity').onchange=()=>{editing=false;mouse();};
for(const id of ['destination','sensitivity']){el(id).onfocus=()=>{editing=true;};el(id).onblur=()=>{editing=false;};}

// Stream Deck controls and reactives: unavailable (and disabled here) when the secure link could not start.
// The window only hides on close, so settings can change behind it (tray, Stream Deck, pairing). The form tracks which
// fields the user edited: everything else follows the stored settings, and Save sends only the form's own fields on top
// of the settings as they are now, so it never undoes a change made elsewhere. Show/hide is never the form's to send.
const fields=[['ownIp','ownIp'],['enabled','enabled','checked'],['obsEnabled','obs.enabled','checked'],['obsUrl','obs.url'],['obsPassword','obs.password'],['meldEnabled','meld.enabled','checked'],['meldUrl','meld.url'],['spotifyEnabled','spotify.enabled','checked'],['vtsEnabled','vts.enabled','checked'],['vtsUrl','vts.url'],['reactiveEnabled','reactive.enabled','checked'],['reactiveUrl','reactive.url']];
const pick=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
let loaded={};
function fill(config,force){for(const [id,path,prop='value'] of fields){const value=pick(config,path)??(prop==='checked'?false:'');if(force||el(id)[prop]===loaded[id])el(id)[prop]=value;loaded[id]=value;}}
function formOnto(config){const c=structuredClone(config);for(const [id,path,prop='value'] of fields){const keys=path.split('.');const last=keys.pop();keys.reduce((o,k)=>o[k]??={},c)[last]=el(id)[prop];}c.ownIp=c.ownIp.trim();return c;}
// A failed bind (this PC's address not up yet) is retried by the app and leaves the form editable to fix the address.
function renderProblem(r){const text=r.linkError?'Unavailable: '+r.linkError.replace(/\.?$/,'.')+' Tracking is not affected.':r.bindError?'Stream Deck controls are not running yet: '+r.bindError:'';el('linkError').hidden=!text;el('linkError').textContent=text;}
function renderControls(r,force){
 renderProblem(r);
 for(const node of document.querySelectorAll('#settings input, #settings select, #settings button, fieldset button, #target'))node.disabled=!!r.linkError;
 el('status').textContent=JSON.stringify(r.plugins,null,2);
 if(!r.config)return;fill(r.config,force);
 el('peer').textContent=r.config.peer?'Paired with '+r.config.peer.host:'Not paired';el('overlay').value=r.overlayUrl;
}
async function refresh(){const r=await window.control.get();role=r.role;el('roleLine').textContent=role==='canada'?'Stream PC (Canada)':'Gaming PC (Pantry)';for(const n of document.querySelectorAll('.pantry-only'))n.hidden=role!=='pantry';for(const n of document.querySelectorAll('.canada-only'))n.hidden=role!=='canada';renderTracking(r.plugins.tracking);renderControls(r,true);}
el('settings').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{const r=await window.control.get();renderControls(r);await window.control.save(formOnto(r.config));await refresh();return 'Saved';});});
window.addEventListener('focus',()=>window.control.get().then(r=>renderControls(r)).catch(()=>{}));
for(const [id,fn] of [['export','exportPair'],['import','importPair'],['login','login'],['startReactive','startReactive'],['stopReactive','stopReactive']])el(id).onclick=()=>perform(async()=>{const r=await window.control[fn]();if(id==='import')await refresh();return r;});
for(const [id,action] of [['scenes','obs.scenes'],['meldScenes','meld.scenes'],['hotkeys','vts.hotkeys'],['pause','spotify.pause']])el(id).onclick=()=>perform(()=>window.control.command({target:el('target').value,action,args:{}}));
setInterval(()=>window.control.get().then(r=>{renderTracking(r.plugins.tracking);renderProblem(r);if(r.config)fill(r.config);el('status').textContent=JSON.stringify(r.plugins,null,2);}).catch(()=>{}),1000);
refresh().catch(e=>show(e.message));
