const el=id=>document.getElementById(id);let saved,role;
const show=value=>{el('result').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
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
function renderControls(r){
 el('linkError').hidden=!r.linkError;el('linkError').textContent=r.linkError?'Unavailable: '+r.linkError.replace(/\.?$/,'.')+' Tracking is not affected.':'';
 for(const node of document.querySelectorAll('#settings input, #settings select, #settings button, fieldset button, #target'))node.disabled=!!r.linkError;
 el('status').textContent=JSON.stringify(r.plugins,null,2);
 if(!r.config)return;saved=r.config;
 el('role').value=saved.role;el('ownIp').value=saved.ownIp;el('enabled').checked=saved.enabled;el('peer').textContent=saved.peer?'Paired with '+saved.peer.host:'Not paired';el('obsEnabled').checked=saved.obs.enabled;el('obsUrl').value=saved.obs.url;el('obsPassword').value=saved.obs.password;el('spotifyEnabled').checked=saved.spotify.enabled;el('vtsEnabled').checked=saved.vts.enabled;el('vtsUrl').value=saved.vts.url;el('reactiveEnabled').checked=saved.reactive.enabled;el('reactiveUrl').value=saved.reactive.url;el('overlay').value=r.overlayUrl;
}
async function refresh(){const r=await window.control.get();role=r.role;el('roleLine').textContent=role==='canada'?'Stream PC (Canada)':'Gaming PC (Pantry)';renderTracking(r.plugins.tracking);renderControls(r);}
el('settings').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{const c={...saved,role:el('role').value,ownIp:el('ownIp').value.trim(),enabled:el('enabled').checked,obs:{enabled:el('obsEnabled').checked,url:el('obsUrl').value,password:el('obsPassword').value},vts:{...saved.vts,enabled:el('vtsEnabled').checked,url:el('vtsUrl').value},spotify:{enabled:el('spotifyEnabled').checked},reactive:{...saved.reactive,enabled:el('reactiveEnabled').checked,url:el('reactiveUrl').value}};await window.control.save(c);await refresh();return 'Saved';});});
for(const [id,fn] of [['export','exportPair'],['import','importPair'],['login','login'],['startReactive','startReactive'],['stopReactive','stopReactive']])el(id).onclick=()=>perform(async()=>{const r=await window.control[fn]();if(id==='import')await refresh();return r;});
for(const [id,action] of [['scenes','obs.scenes'],['hotkeys','vts.hotkeys'],['pause','spotify.pause']])el(id).onclick=()=>perform(()=>window.control.command({target:el('target').value,action,args:{}}));
setInterval(()=>window.control.get().then(r=>{renderTracking(r.plugins.tracking);el('status').textContent=JSON.stringify(r.plugins,null,2);}).catch(()=>{}),1000);
refresh().catch(e=>show(e.message));
