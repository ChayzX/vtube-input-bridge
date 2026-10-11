// The VTube Input Bridge window: a Home dashboard that answers "am I live-ready?", and settings pages. Everything goes
// through the preload API (window.control.*); this script never talks to the network itself.
const el=id=>document.getElementById(id);
const all=selector=>[...document.querySelectorAll(selector)];
let role=null,latest=null;

// ---------- Small helpers ----------
// Writes only on change, so the 1-second poll never rewrites (or re-announces) text that stayed the same.
function setText(node,text){text=text??'';if(node&&node.textContent!==text)node.textContent=text;}
function setClass(node,cls){if(node&&node.className!==cls)node.className=cls;}
const badgeClass={ok:'ok',warn:'warn',err:'err',off:'off',setup:'info',info:'info',busy:'info busy',neutral:''};
function setBadge(node,level,text){if(!node)return;setClass(node,('badge '+(badgeClass[level]??'')).trim());setText(node,text||'');node.hidden=!text;}
function setHidden(node,hidden){if(node&&node.hidden!==hidden)node.hidden=hidden;}
const fmt=n=>Number(n||0).toLocaleString();
const sentence=text=>String(text||'').trim().replace(/([^.!?])$/,'$1.');
const listOf=items=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items[items.length-1];
function ago(at){const s=Math.max(0,Math.round((Date.now()-at)/1000));if(s<10)return 'just now';if(s<60)return `${s} s ago`;const m=Math.round(s/60);return m<60?`${m} min ago`:`${Math.round(m/60)} h ago`;}
// Errors from the main process arrive wrapped ("Error invoking remote method 'control:save': Error: …").
const cleanError=e=>String(e?.message||e||'Something went wrong').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/,'');
const names=()=>role==='canada'?{self:'Streaming PC',other:'Gaming PC'}:{self:'Gaming PC',other:'Streaming PC'};

let toastTimer;
function toast(message,kind=''){
 const node=el('toast');if(!node||!message)return;
 setClass(node,'toast'+(kind?' '+kind:''));node.textContent=String(message);
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>{node.textContent='';},kind==='err'?8000:4000);
}
// Runs a button's action with the button marked busy; the answer is shown as a toast.
async function busy(button,fn){
 if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
 try{return await fn();}
 catch(e){toast(cleanError(e),'err');}
 finally{if(button){button.removeAttribute('aria-busy');button.disabled=!!latest?.linkError&&!!button.closest?.('#settings, #page-deck');}}
}

// ---------- Navigation ----------
const pages=['home','tracking','link','apps','deck','reactives','advanced'];
let current='home';
function go(page,focusId){
 if(!pages.includes(page))page='home';
 for(const p of pages)setHidden(el('page-'+p),p!==page);
 for(const a of all('.nav a[data-page]')){if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
 if(page!==current){const main=el('main');if(main){main.scrollTop=0;}}
 current=page;globalThis.history?.replaceState?.(null,'','#'+page);
 if(focusId){const target=el(focusId);target?.scrollIntoView?.({block:'center'});target?.focus?.();}
}
for(const a of all('.nav a[data-page]'))a.addEventListener('click',e=>{e.preventDefault();go(a.dataset.page);el('main')?.focus?.({preventScroll:true});});
for(const b of all('[data-go]'))b.addEventListener('click',()=>go(b.dataset.go,b.dataset.focus));

// ---------- Theme (a per-window preference; the default follows Windows) ----------
function applyTheme(value){const root=document.documentElement;if(!root)return;if(value==='light'||value==='dark')root.dataset.theme=value;else delete root.dataset.theme;}
try{const saved=globalThis.localStorage?.getItem('theme')||'system';applyTheme(saved);if(el('theme'))el('theme').value=saved;}catch{}
el('theme').onchange=()=>{const value=el('theme').value;applyTheme(value);try{globalThis.localStorage?.setItem('theme',value);}catch{}};

// ---------- Toggle switches ----------
function syncToggles(){for(const input of all('.toggle input')){const state=input.previousElementSibling;if(state)setText(state,input.checked?'On':'Off');}}

// ---------- Tracking ----------
// The gaming PC gets the sender controls, the stream PC the receiver status. Changes here take effect at once.
let editing=false,trackRunning=false,latestTracking=null;
function trackingView(t){
 if(!t||!t.role&&!t.state)return {level:'warn',badge:'Starting',title:'Starting tracking…',detail:''};
 if(t.role==='sender'){
  if(t.legacy)return {level:'err',badge:'Blocked',title:'The old tracking app is still running',detail:'The old gaming input relay is running. Disable its scheduled task first.',fix:'Open Task Scheduler on this PC, disable the old gaming input relay task, then restart VTube Input Bridge.'};
  if(t.error&&t.started===false)return {level:'err',badge:'Failed',title:'Tracking failed to start',detail:sentence(t.error)};
  if(t.running&&t.receiverConnected)return {level:'ok',badge:'Sending',title:'Sending to the Streaming PC',detail:`Reaching ${t.destination}. ${fmt(t.packets)} packets sent · ${t.gameMode?'game mouse mode':'desktop cursor'}.`};
  if(t.running)return {level:'warn',badge:'Waiting',title:'Waiting for the Streaming PC',detail:`Sending to ${t.destination}, but the Streaming PC hasn't replied recently.`,fix:'On the Streaming PC, check that VTube Input Bridge and VTube Studio are open and that its Tracking page says Receiving. Check that the address under Tracking here is the Streaming PC\'s current address.'};
  if(t.state==='Stopped'&&!t.error)return {level:'off',badge:'Paused',title:'Tracking is paused',detail:'Nothing is being sent. Start sending when you are ready.'};
  if(t.error)return {level:'err',badge:'Not sending',title:'Tracking could not start',detail:sentence(t.error),fix:'Check the Streaming PC address under Tracking, then choose Start sending.'};
  return {level:'warn',badge:'Starting',title:'Starting tracking…',detail:'Starting or reconnecting to the Streaming PC…'};
 }
 const packets=t.packets?` ${fmt(t.packets)} packets applied.`:'';
 switch(t.state){
  case 'Receiving input':return {level:'ok',badge:'Receiving',title:'Receiving from the Gaming PC',detail:sentence(t.detail)+packets};
  case 'Waiting for VTube Studio':return {level:'warn',badge:'Waiting',title:'Waiting for VTube Studio',detail:sentence(t.detail),fix:'Open VTube Studio, turn on Start API in its settings, and click Allow if it asks about Game Input Relay.'};
  case 'Waiting for the Gaming PC':return {level:'warn',badge:'Waiting',title:'Waiting for the Gaming PC',detail:sentence(t.detail)+packets,fix:'On the Gaming PC, open VTube Input Bridge and start sending to this PC\'s address. The Gaming PC\'s address must match the one under Tracking here.'};
  case 'Receiver stopped':return {level:'err',badge:'Stopped',title:'The tracking receiver has stopped',detail:sentence(t.detail),fix:'If the message mentions the migration or relay setup, run Fix-StreamPC on this PC (see the setup guide). Otherwise restart VTube Input Bridge.'};
  default:return {level:'warn',badge:'Starting',title:t.state||'Starting the receiver…',detail:sentence(t.detail)};
 }
}
function renderTracking(t){
 if(!t)return;latestTracking=t;
 const v=trackingView(t);
 setText(el('trackState'),v.title);setBadge(el('trackBadge'),v.level,v.badge);setText(el('trackDetail'),v.detail);
 if(t.role==='sender'){
  setHidden(el('senderControls'),false);setHidden(el('trackToggle'),false);
  trackRunning=!!t.running;
  setText(el('trackToggle'),t.running?'Stop sending':'Start sending');setClass(el('trackToggle'),t.running?'btn sender-only':'btn primary sender-only');
  el('destination').disabled=!!t.running;
  setText(el('destinationHelp'),t.running?'Stop sending to change the address.':'The Streaming PC\'s local IPv4 address, for example 192.168.1.20.');
  if(!editing){el('destination').value=t.destination||'';el('sensitivity').value=t.sensitivity;}
  el('gameMouse').checked=!!t.gameMode;el('startOnLaunch').checked=!!t.startSendingOnLaunch;
  setText(el('mouseInfo'),t.rawError?t.rawError:t.gameMode?'Follows game movement and returns to the centre when idle.':'Follows the desktop cursor. Turn on for games that lock the cursor in place.');
  el('sensitivityRow')?.classList?.toggle('disabled',!t.gameMode);el('sensitivity').disabled=!t.gameMode;
  setText(el('countAck'),t.lastAckSequence>=0?String(t.lastAckSequence):'None yet');setText(el('countRaw'),fmt(t.rawEvents));
 }else{
  setText(el('trackSource'),t.source||'—');setText(el('trackPackets'),t.packets?`${fmt(t.packets)} packets applied`:'');
 }
 setText(el('countPackets'),fmt(t.packets));
 syncToggles();
}
function showTrackError(message){setText(el('trackErrorText'),message);setHidden(el('trackError'),!message);if(message)toast(message,'err');}
const tracking=(name,args)=>window.control.tracking(name,args).then(t=>{showTrackError('');renderTracking(t);if(latest)renderStatus(latest);return t;}).catch(e=>{showTrackError(cleanError(e));});
const toggleSending=()=>tracking(trackRunning?'stop':'start',{destination:el('destination').value.trim()});
el('trackToggle').onclick=toggleSending;
el('startOnLaunch').onchange=()=>{syncToggles();tracking('startOnLaunch',{enabled:el('startOnLaunch').checked});};
const mouse=()=>{syncToggles();return tracking('mouse',{gameMode:el('gameMouse').checked,sensitivity:Number(el('sensitivity').value)});};
el('gameMouse').onchange=mouse;el('sensitivity').onchange=()=>{editing=false;mouse();};
for(const id of ['destination','sensitivity']){el(id).onfocus=()=>{editing=true;};el(id).onblur=()=>{editing=false;};}
el('destination').onkeydown=e=>{if(e.key==='Enter'&&!trackRunning){e.preventDefault();toggleSending();}};

// ---------- Settings (PC link, Apps, Reactives) ----------
// The window only hides on close, so settings can change behind it (tray, Stream Deck, pairing). The form tracks which
// fields the user edited: everything else follows the stored settings, and Save sends only the form's own fields on top
// of the settings as they are now, so it never undoes a change made elsewhere. Show/hide is never the form's to send.
const fields=[['ownIp','ownIp'],['enabled','enabled','checked'],['obsEnabled','obs.enabled','checked'],['obsUrl','obs.url'],['obsPassword','obs.password'],['meldEnabled','meld.enabled','checked'],['meldUrl','meld.url'],['spotifyEnabled','spotify.enabled','checked'],['vtsEnabled','vts.enabled','checked'],['vtsUrl','vts.url'],['reactiveEnabled','reactive.enabled','checked'],['reactiveUrl','reactive.url']];
const labels={ownIp:'This PC\'s address',enabled:'Remote controls',obsEnabled:'OBS Studio',obsUrl:'OBS address',obsPassword:'OBS password',meldEnabled:'Meld Studio',meldUrl:'Meld address',spotifyEnabled:'Spotify',vtsEnabled:'VTube Studio',vtsUrl:'VTube Studio address',reactiveEnabled:'Render reactives',reactiveUrl:'Fugi URL'};
const pick=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
let loaded={};
function fill(config,force){for(const [id,path,prop='value'] of fields){const value=pick(config,path)??(prop==='checked'?false:'');if(force||el(id)[prop]===loaded[id])el(id)[prop]=value;loaded[id]=value;}}
function formOnto(config){const c=structuredClone(config);for(const [id,path,prop='value'] of fields){const keys=path.split('.');const last=keys.pop();keys.reduce((o,k)=>o[k]??={},c)[last]=el(id)[prop];}c.ownIp=c.ownIp.trim();return c;}
const edited=()=>!latest?.config?[]:fields.filter(([id,,prop='value'])=>el(id)[prop]!==loaded[id]);
// The save bar appears only while something is unsaved, and names what.
function updateDirty(){
 const changes=edited();setHidden(el('saveBar'),!changes.length);
 setText(el('dirtyText'),changes.length?`${changes.length} unsaved change${changes.length>1?'s':''} · ${changes.map(([id])=>labels[id]).join(', ')}`:'');
}
// A setting that depends on a switch dims and locks while the switch is off. Everything locks while the link is down.
function syncDependents(){
 const down=!!latest?.linkError;
 for(const row of all('[data-needs]')){
  const on=!!el(row.dataset.needs)?.checked;row.classList.toggle('disabled',!on);
  for(const node of row.querySelectorAll('input,button,select'))node.disabled=down||!on;
 }
 // Remote controls need a pairing; once on, they can always be turned off.
 el('enabled').disabled=down||(!latest?.config?.peer&&!el('enabled').checked);
}
function onEdit(){syncDependents();syncToggles();updateDirty();}
el('settings').addEventListener('input',onEdit);el('settings').addEventListener('change',onEdit);

// A failed bind (this PC's address not up yet) is retried by the app and leaves the form editable to fix the address.
function renderProblem(r){
 const down=r.linkError?`Remote controls and reactives are unavailable: ${sentence(r.linkError)} Tracking is not affected.`:'';
 for(const bar of all('.link-problem')){setHidden(bar,!down);const text=bar.querySelector('.link-problem-text');if(text)setText(text,down);}
 const retry=!r.linkError&&r.bindError?'Remote controls are not running yet: '+sentence(r.bindError):'';
 setHidden(el('linkError'),!retry);setText(el('linkErrorText'),retry);
}
function renderControls(r,force){
 latest=r;renderProblem(r);
 const down=!!r.linkError;
 for(const node of all('#settings input, #settings select, #settings button, #page-deck button, #page-deck select'))if(node.disabled!==down)node.disabled=down;
 if(r.config){
  fill(r.config,force);
  const n=names();
  setText(el('peer'),r.config.peer?`Paired with the ${n.other} (${r.config.peer.host})`:'Not paired yet');
  setBadge(el('peerBadge'),r.config.peer?'ok':'setup',r.config.peer?'Paired':'Not paired');
  setText(el('enabledHelp'),r.config.peer?'Lets Stream Deck keys control apps on this PC, and shows reactives. Turning it off is the same as Pause remote controls in the tray.':'Turns on by itself when you import the other PC\'s pairing file.');
  if(el('overlay').value!==r.overlayUrl)el('overlay').value=r.overlayUrl||'';
 }
 syncDependents();syncToggles();updateDirty();renderStatus(r);
}

// ---------- Role ----------
function applyRole(){
 const n=names();
 for(const node of all('.sender-only'))if(node.id!=='trackToggle'&&node.id!=='senderControls')setHidden(node,role!=='pantry');
 for(const node of all('.receiver-only'))setHidden(node,role!=='canada');
 for(const node of all('.pantry-only'))setHidden(node,role!=='pantry');
 for(const node of all('.canada-only'))setHidden(node,role!=='canada');
 setText(el('pcRole'),n.self);
 setText(el('trackingLead'),role==='canada'?'Keyboard and mouse input arriving from the Gaming PC, applied to your model in VTube Studio.':'Keyboard and mouse input from this PC, sent to VTube Studio on the Streaming PC.');
 setText(el('appsLead'),`Which apps on the ${n.self} the Stream Deck may control, and how to reach them.`);
 setText(el('linkLead'),`The encrypted connection to the ${n.other}. It lets the Stream Deck reach apps on both PCs.`);
 setText(el('homeLead'),`Live status of tracking, the link to the ${n.other} and your stream apps.`);
 setText(el('deckHelp'),role==='canada'?'The Stream Deck is plugged into the Gaming PC. Its keys reach apps on this PC through the PC link, so keep the apps you use turned on under Apps.':'In the Stream Deck app, drag VTube Control › Bridge command onto a key, then choose the PC and the action. Scene and hotkey lists fill in by themselves when you open a key\'s settings.');
 const target=el('target');
 for(const option of target?.options||[])setText(option,option.value==='local'?`This PC (${n.self})`:`The ${n.other}`);
}

// ---------- Apps: status, tests and the other PC ----------
const APPS={
 obs:{name:'OBS Studio',settings:'OBS settings',test:'obs.scenes',okBadge:'Connected',off:'Turn on to switch OBS scenes from the Stream Deck.',fix:w=>`Open OBS on the ${w}. In Tools › WebSocket Server Settings, turn on the WebSocket server and enter its password under Apps on that PC. If you don't use OBS there, turn it off under Apps.`},
 vts:{name:'VTube Studio',settings:'VTube Studio settings',test:'vts.hotkeys',okBadge:'Connected',off:'Turn on to trigger VTube Studio hotkeys and Item Scenes.',fix:w=>`Open VTube Studio on the ${w} and turn on Start API in its settings. If it asks to allow VTube Control, click Allow, then test again.`},
 meld:{name:'Meld Studio',settings:'Meld settings',test:'meld.scenes',okBadge:'Connected',off:'Turn on if you switch scenes with Meld Studio instead of OBS.',fix:w=>`Open Meld Studio on the ${w} and turn on Settings › Advanced › Allow remote connections. If you don't use Meld there, turn it off under Apps.`},
 spotify:{name:'Spotify',settings:'Spotify settings',test:'spotify.status',okBadge:'Ready',off:'Turn on to play, pause and skip tracks from the Stream Deck.',fix:w=>`Open Spotify on the ${w} and play a track once, so Windows can see it. If you don't use Spotify there, turn it off under Apps.`}
};
const tests={};let peerStatus=null,peerError='',peerAt=0,checkedAt=0;
function describe(id,data){
 if(id==='obs'){const scenes=data?.scenes||[];return `Answered with ${scenes.length} scene${scenes.length===1?'':'s'}${data?.currentProgramSceneName?`; on air: ${data.currentProgramSceneName}`:''}.`;}
 if(id==='meld'){const scenes=data?.scenes||[];return `Answered with ${scenes.length} scene${scenes.length===1?'':'s'}${data?.currentScene?`; on air: ${data.currentScene}`:''}.`;}
 if(id==='vts'){const keys=data?.availableHotkeys||[];return `Answered with ${keys.length} hotkey${keys.length===1?'':'s'}${data?.modelName?` for ${data.modelName}`:''}.`;}
 if(id==='spotify')return data?.title?`${data.playback==='Playing'?'Playing':'Ready'}: ${data.title}${data.artist?' by '+data.artist:''}.`:'Spotify answered.';
 return 'It answered.';
}
function appView(id,r){
 const app=APPS[id];const n=names();
 const localOn=!!r.config?.[id]?.enabled,peerOn=!!peerStatus?.plugins?.controls?.[id];
 const where=localOn&&peerOn?'Both PCs':localOn?`${n.self} (this PC)`:peerOn?`${n.other}`:'Not turned on';
 const target=localOn?'local':peerOn?'peer':null;const place=target==='peer'?n.other:n.self;
 const base={id,name:app.name,settings:app.settings,where,target,localOn,peerOn,fix:app.fix(place)};
 if(r.linkError&&!localOn)return {...base,level:'off',badge:'Unavailable',unavailable:true,detail:'Needs the PC link, which could not start.'};
 if(!target)return {...base,level:'off',badge:'Off',detail:app.off};
 if(tests[id]?.busy)return {...base,level:'busy',badge:'Checking…',detail:`Asking ${app.name} on the ${place}…`};
 // The newest answer wins: a test from this window, or a Stream Deck press on either PC.
 const answers=[];
 if(tests[id]?.at&&(tests[id].target==='local'?localOn:peerOn))answers.push(tests[id]);
 if(localOn&&r.status?.services?.[id])answers.push({...r.status.services[id],target:'local'});
 if(peerOn&&peerStatus?.services?.[id])answers.push({...peerStatus.services[id],target:'peer'});
 const last=answers.sort((a,b)=>b.at-a.at)[0];
 const on=last?.target==='peer'?n.other:n.self;
 if(!last)return {...base,level:'neutral',badge:'On',detail:`Turned on${target==='peer'?` on the ${n.other}`:''}. Use Test to check that it answers.`};
 if(last.ok)return {...base,level:'ok',badge:app.okBadge,detail:`${last.message||'Last command worked.'} ${localOn&&peerOn?`(${on}, `:'('}${ago(last.at)})`};
 return {...base,level:'warn',badge:'Not answering',detail:`${last.message?sentence(last.message):`The last command on the ${on} did not work.`} (${ago(last.at)})`,fix:app.fix(on),target:last.target};
}
async function testApp(id,quiet){
 const v=appView(id,latest||{});if(!v.target||tests[id]?.busy)return;
 tests[id]={...tests[id],busy:true};if(latest)renderStatus(latest);
 try{
  const result=await window.control.command({target:v.target,action:APPS[id].test,args:{}});
  tests[id]=result?.ok?{ok:true,at:Date.now(),target:v.target,message:describe(id,result.data)}:{ok:false,at:Date.now(),target:v.target,message:result?.message||`${APPS[id].name} did not answer.`};
 }catch(e){tests[id]={ok:false,at:Date.now(),target:v.target,message:cleanError(e)};}
 if(latest)renderStatus(latest);
 if(!quiet)toast(`${APPS[id].name}: ${tests[id].ok?'it answers':'it did not answer'}.`,tests[id].ok?'':'err');
}
// When the window opens (and when it comes back after a while), quietly check the apps this PC uses. VTube Studio is
// left to the Test button: its first check asks the streamer to approve the plugin in VTube Studio.
function autoCheck(){
 if(!latest?.config||latest.linkError||Date.now()-checkedAt<120000)return;checkedAt=Date.now();
 for(const id of ['obs','meld','spotify'])if(latest.config[id]?.enabled)void testApp(id,true);
}
// The other PC's own status (which apps it uses, their last answers) arrives over the PC link every 15 seconds while
// this window is open.
async function pollPeer(force){
 const r=latest;
 if(!r?.config?.peer||!r.config.enabled||r.linkError){peerStatus=null;peerError='';return;}
 if(!force&&(Date.now()-peerAt<15000||document.visibilityState==='hidden'))return;
 peerAt=Date.now();
 try{const result=await window.control.command({target:'peer',action:'bridge.status',args:{}});
  if(result?.ok){peerStatus=result.data;peerError='';}else{peerStatus=null;peerError=result?.message||'The other PC did not answer.';}}
 catch(e){peerStatus=null;peerError=cleanError(e);}
 if(latest)renderStatus(latest);
}

function linkView(r){
 const n=names();const c=r.config;
 if(r.linkError)return {level:'err',badge:'Down',detail:`The PC link couldn't start: ${sentence(r.linkError)} Tracking is not affected.`,fix:'Restart VTube Input Bridge from the tray. Windows must be signed in with the account the app was installed under, so it can unlock the saved settings.'};
 if(!c)return {level:'warn',badge:'Starting',detail:'Starting the PC link…'};
 if(!c.peer)return {level:'setup',badge:'Not paired',detail:`Pair with the ${n.other} to use the Stream Deck on both PCs and to show reactives.`};
 if(!c.enabled)return {level:'warn',badge:'Paused',detail:'Remote controls are paused on this PC. Turn them on under PC link.'};
 if(r.bindError)return {level:'warn',badge:'Retrying',detail:sentence(r.bindError),fix:'Check that This PC\'s address under PC link is this PC\'s current address.'};
 if(peerError)return {level:'warn',badge:'Not answering',detail:sentence(peerError),retry:true,fix:`Check that VTube Input Bridge is running on the ${n.other} with remote controls on, that both PCs are on the same network, and that Windows Firewall there allows VTube Input Bridge on private networks.`};
 return {level:'ok',badge:'Paired',detail:`Paired with the ${n.other} (${c.peer.host}).${peerStatus?' It is answering.':''}`};
}
function reactivesView(r){
 const c=r.config,p=r.plugins?.reactives||{};
 if(r.linkError)return {level:'err',badge:'Unavailable',detail:'Reactives need the PC link, which could not start.'};
 if(!c)return {level:'off',badge:'',detail:''};
 if(role==='pantry'){
  if(!c.reactive.enabled)return {level:'off',badge:'Off',detail:'Turn on to show Discord reactive avatars on stream.'};
  if(!c.reactive.url)return {level:'setup',badge:'Needs a URL',detail:'Paste your Fugi browser-source URL under Reactives.'};
  if(!c.peer)return {level:'setup',badge:'Needs pairing',detail:'Pair the PCs so the overlay can reach the Streaming PC.'};
  const state=p.state||'Stopped';
  if(state==='Sending images to the Streaming PC')return {level:'ok',badge:'Sending',detail:'Sending the Fugi overlay to the Streaming PC.'};
  if(state==='Stopped')return {level:'off',badge:'Stopped',detail:'The renderer is stopped. Start it under Reactives.'};
  if(state==='Starting renderer'||state==='Rendering')return {level:'info',badge:'Starting',detail:'Loading the Fugi overlay…'};
  return {level:'warn',badge:'Needs attention',detail:sentence(state),fix:'Check the Fugi URL under Reactives and sign in to Fugi if asked, then start the renderer again.'};
 }
 if(!c.peer)return {level:'setup',badge:'Needs pairing',detail:'Pair the PCs to receive the overlay from the Gaming PC.'};
 if(p.visible===false)return {level:'off',badge:'Hidden',detail:'Hidden with a Stream Deck key. Show them again from the Stream Deck.'};
 if(p.frameFresh)return {level:'ok',badge:'Showing',detail:'Receiving the overlay from the Gaming PC.'};
 return {level:'off',badge:'No images',detail:'Waiting for images from the Gaming PC. Start the renderer there.'};
}

// ---------- Home, nav badges, Advanced ----------
const icons={ok:'#i-check',warn:'#i-warn',err:'#i-error',off:'#i-pause',setup:'#i-info'};
function renderCard(id,v,{test,go}={}){
 const card=el('card-'+id);if(!card)return;
 setClass(card,'card conn'+(v.level==='warn'?' attention':v.level==='err'?' error':v.level==='off'?' off':''));
 if(v.where!==undefined)setText(el(id+'-where'),v.where);
 setBadge(el(id+'-badge'),v.level,v.badge);setText(el(id+'-detail'),v.detail);
 const fix=el(id+'-fix'),howto=el(id+'-howto');const canFix=!!v.fix&&(v.level==='warn'||v.level==='err');
 setText(fix,v.fix||'');setHidden(howto,!canFix);
 if(!canFix){setHidden(fix,true);howto?.setAttribute('aria-expanded','false');}
 if(test){setHidden(test,!v.target);setText(test,v.level==='warn'?'Retry':'Test');test.disabled=v.level==='busy';}
 if(go){const on=v.target||v.level!=='off'||v.unavailable;setText(go,on?'Settings':'Turn on');go.setAttribute('aria-label',on?v.settings:`Turn on ${v.name}`);}
}
let heroFn=null;
function renderStatus(r){
 if(!r)return;const n=names();const c=r.config;
 const t=r.plugins?.tracking||latestTracking;const tv=trackingView(t);
 const lv=linkView(r),rv=reactivesView(r);
 const apps=Object.fromEntries(Object.keys(APPS).map(id=>[id,appView(id,r)]));

 renderCard('tracking',{...tv,where:'Gaming PC → Streaming PC'});
 const action=el('tracking-action');
 if(action){setHidden(action,role!=='pantry');setText(action,trackRunning?'Stop sending':'Start sending');}
 renderCard('link',lv);setHidden(el('link-test'),!lv.retry);setText(el('link-go'),r.linkError?'PC link':c?.peer?'Manage pairing':'Pair PCs');
 for(const id of Object.keys(APPS)){renderCard(id,apps[id],{test:el(id+'-test'),go:el(id+'-go')});setBadge(el(id+'-badge2'),apps[id].level,apps[id].localOn&&apps[id].level!=='off'?apps[id].badge:'');}
 renderCard('reactives',{...rv,where:'Gaming PC → Streaming PC'});

 // The hero answers one question: can I go live? Worst problem first.
 const attention=Object.values(apps).filter(v=>v.level==='warn').map(v=>v.name);if(rv.level==='warn')attention.push('Reactives');
 const flowing=role==='canada'?'Tracking is arriving from the Gaming PC':'Tracking is reaching the Streaming PC';
 let h;
 if(r.linkError&&tv.level!=='err')h={level:'err',title:'The PC link couldn\'t start',text:'Tracking still works, but Stream Deck controls and reactives are off until the PC link starts.',label:'How to fix',fn:()=>go('link')};
 else if(tv.level==='err')h={level:'err',title:tv.title,text:tv.detail,label:'Tracking settings',fn:()=>go('tracking')};
 else if(lv.level==='setup')h={level:'setup',title:'Finish setting up',text:(tv.level==='ok'?flowing+'. ':'')+lv.detail,label:'Pair PCs',fn:()=>go('link'),primary:true};
 else if(tv.level==='off')h={level:'off',title:tv.title,text:'Start sending when you are ready to go live.',label:'Start sending',fn:toggleSending,primary:true};
 else if(tv.level==='warn')h={level:'warn',title:tv.title,text:tv.detail};
 else if(lv.level==='warn')h={level:'warn',title:'Live-ready, but the PC link needs attention',text:lv.detail,label:'PC link',fn:()=>go('link')};
 else if(attention.length)h={level:'warn',title:`Live-ready, ${attention.length===1?'1 app needs':attention.length+' apps need'} attention`,text:`${flowing} and the PCs are paired. Check ${listOf(attention)}.`};
 else h={level:'ok',title:'You\'re live-ready',text:`${flowing} and the PCs are paired.`};
 if(!h.fn&&role==='pantry'&&t?.role==='sender')Object.assign(h,{label:trackRunning?'Stop sending':'Start sending',fn:toggleSending});
 setClass(el('heroDisc'),'big '+h.level);el('heroIcon')?.setAttribute('href',icons[h.level]);
 setText(el('heroTitle'),h.title);setText(el('heroText'),h.text);
 const hero=el('heroAction');heroFn=h.fn||null;setHidden(hero,!h.fn);setText(hero,h.label||'');setClass(hero,h.primary?'btn primary':'btn');

 // The link diagram: tracking flows from the Gaming PC to the Streaming PC.
 const wire={ok:'Connected',warn:'Waiting',err:'Not connected',off:'Paused'}[tv.level]||'';
 setClass(el('wire'),'wire '+tv.level);setText(el('wireText'),wire);
 const other=c?.peer?.host||(role==='pantry'?t?.destination:t?.source)||'';
 setText(el('nodeGaming'),role==='pantry'?'this PC':other);setText(el('nodeStreaming'),role==='canada'?'this PC':other);

 // Nav: a dot where something needs attention.
 const navBadge=(id,level,text,label)=>{const b=el('nav-'+id);if(!b)return;const show=level==='warn'||level==='err';setBadge(b,level,show?text:'');if(show)b.setAttribute('aria-label',label);};
 navBadge('tracking',tv.level,'!','Tracking needs attention');navBadge('link',lv.level,'!','PC link needs attention');
 const appIssues=Object.values(apps).filter(v=>v.level==='warn').length;navBadge('apps',appIssues?'warn':'ok',String(appIssues),`${appIssues} app${appIssues===1?'':'s'} need attention`);
 navBadge('reactives',rv.level,'!','Reactives need attention');

 // Sidebar PC card and Advanced.
 setText(el('pcAddress'),c?.ownIp?`${c.ownIp}`:'');setText(el('pcVersion'),r.version?`Version ${r.version}`:'');
 setText(el('factRole'),role==='canada'?'Streaming PC: receives tracking and runs VTube Studio':'Gaming PC: sends tracking and has the Stream Deck');
 setText(el('factAddress'),c?.ownIp||'—');setText(el('factPeer'),c?.peer?`${n.other} (${c.peer.host})`:'Not paired');setText(el('factVersion'),r.version||'—');
 const feature=(id,plugin,detail)=>{const running=!!plugin?.started;setBadge(el(`feat-${id}-badge`),running?'ok':'err',plugin?running?'Running':'Not running':'');setText(el('feat-'+id),plugin?.error?sentence(plugin.error):detail);};
 feature('tracking',r.plugins?.tracking,tv.title);
 const using=Object.keys(APPS).filter(id=>c?.[id]?.enabled).map(id=>APPS[id].name);
 feature('controls',r.plugins?.controls,using.length?`Turned on: ${listOf(using)}.`:'No apps turned on.');
 feature('reactives',r.plugins?.reactives,rv.detail);

 // Reactives page.
 const state=r.plugins?.reactives?.state||'Stopped';
 setText(el('rendererState'),state==='Sending images to the Streaming PC'?'Sending to the Streaming PC':state);setBadge(el('rendererBadge'),rv.level,rv.badge);
 setText(el('overlayState'),rv.level==='ok'?'Receiving images':rv.badge==='Hidden'?'Hidden from stream':'Waiting for images');setBadge(el('overlayBadge'),rv.level,rv.badge);
}
el('heroAction').onclick=()=>heroFn?.();
el('tracking-action').onclick=toggleSending;
el('link-test').onclick=()=>busy(el('link-test'),()=>pollPeer(true));
for(const id of Object.keys(APPS))el(id+'-test').onclick=()=>testApp(id);
for(const id of ['tracking','link',...Object.keys(APPS),'reactives']){
 const howto=el(id+'-howto');
 if(howto)howto.onclick=()=>{const fix=el(id+'-fix');const open=fix.hidden;fix.hidden=!open;howto.setAttribute('aria-expanded',String(open));setText(howto,open?'Hide steps':'How to fix');};
}
for(const id of Object.keys(APPS)){const go=el(id+'-go');if(go)go.addEventListener('click',()=>{if(!appView(id,latest||{}).target)el(id+'Enabled')?.focus?.();});}

// ---------- Refresh, save, buttons ----------
async function refresh(){
 const r=await window.control.get();role=r.role;applyRole();renderTracking(r.plugins.tracking);renderControls(r,true);
 autoCheck();void pollPeer();
}
async function save(){
 const r=await window.control.get();renderControls(r);await window.control.save(formOnto(r.config));await refresh();return 'Saved';
}
el('settings').addEventListener('submit',event=>{event.preventDefault();busy(el('save'),async()=>{toast(await save());});});
el('discard').onclick=()=>{if(latest?.config){fill(latest.config,true);onEdit();}};
el('obsPasswordShow').onclick=()=>{const input=el('obsPassword');const show=input.type==='password';input.type=show?'text':'password';el('obsPasswordShow').setAttribute('aria-pressed',String(show));setText(el('obsPasswordShow'),show?'Hide':'Show');};
window.addEventListener('focus',()=>window.control.get().then(r=>{renderControls(r);autoCheck();}).catch(()=>{}));

const messages={export:'Exported. Copy the file to the other PC and import it there, then delete the copy.'};
for(const [id,fn] of [['export','exportPair'],['import','importPair'],['login','login'],['startReactive','startReactive'],['stopReactive','stopReactive']])
 el(id).onclick=()=>busy(el(id),async()=>{
  const result=await window.control[fn]();if(result===undefined||result===null)return;// a cancelled file dialog
  if(id==='import')await refresh();
  if(typeof result==='string')toast(id==='export'?messages.export:result);
  else if(result.ok===false)toast(result.message,'err');
  else toast(id==='startReactive'?'Renderer started.':id==='stopReactive'?'Renderer stopped.':'Done.');
  if(latest)window.control.get().then(r=>renderControls(r)).catch(()=>{});
 });
el('copyOverlay').onclick=()=>copy(el('overlay').value,'Web Item URL copied.',el('overlay'));
el('copyStatus').onclick=()=>{const r=latest||{};copy(JSON.stringify({role:r.role,version:r.version,linkError:r.linkError,bindError:r.bindError,plugins:r.plugins,services:r.status?.services,peerError},null,2),'Status copied. Paste it into a message to get help.');};
async function copy(text,done,field){
 try{await navigator.clipboard.writeText(text);toast(done);}
 catch{if(field){field.select();document.execCommand('copy');toast(done);}else toast('Could not copy.','err');}
}

// ---------- Stream Deck: try a command ----------
function showResult(action,result){
 const card=el('resultCard');card.hidden=false;
 const list=el('resultList');let title,text='',items=[];
 if(!result?.ok){title='It didn\'t work';text=sentence(result?.message||'No answer.');}
 else if(action==='obs.scenes'){const scenes=[...(result.data?.scenes||[])].sort((a,b)=>(b.sceneIndex??0)-(a.sceneIndex??0));items=scenes.map(s=>s.sceneName);title=`${items.length} OBS scene${items.length===1?'':'s'}`;text=items.length?`${result.data?.currentProgramSceneName?`On air: ${result.data.currentProgramSceneName}. `:''}Choose these on Stream Deck scene keys.`:'OBS has no scenes yet.';}
 else if(action==='meld.scenes'){items=(result.data?.scenes||[]).map(s=>s.sceneName);title=`${items.length} Meld Studio scene${items.length===1?'':'s'}`;text=items.length?`${result.data?.currentScene?`On air: ${result.data.currentScene}. `:''}Choose these on Stream Deck scene keys.`:'Meld Studio has no scenes yet.';}
 else if(action==='vts.hotkeys'){items=(result.data?.availableHotkeys||[]).map(h=>h.name||h.hotkeyID);title=`${items.length} VTube Studio hotkey${items.length===1?'':'s'}`;text=items.length?`For ${result.data?.modelName||'the current model'}.`:'The current model has no hotkeys. Add them in VTube Studio first.';}
 else{title='Spotify paused';text=result.data?.title?`${result.data.title}${result.data.artist?' by '+result.data.artist:''}.`:'';}
 setClass(card,'card result '+(result?.ok?'ok':'err'));el('resultIcon')?.setAttribute('href',result?.ok?'#i-check':'#i-error');
 setText(el('resultTitle'),title);setText(el('resultText'),text);
 list.replaceChildren(...items.map(name=>{const li=document.createElement('li');li.textContent=name;return li;}));
}
for(const [id,action] of [['scenes','obs.scenes'],['meldScenes','meld.scenes'],['hotkeys','vts.hotkeys'],['pause','spotify.pause']])
 el(id).onclick=()=>busy(el(id),async()=>{let result;try{result=await window.control.command({target:el('target').value,action,args:{}});}catch(e){result={ok:false,message:cleanError(e)};}showResult(action,result);});

// ---------- Start ----------
go((globalThis.location?.hash||'').slice(1)||'home');
setInterval(()=>window.control.get().then(r=>{renderTracking(r.plugins.tracking);renderControls(r);void pollPeer();}).catch(()=>{}),1000);
refresh().catch(e=>toast(cleanError(e),'err'));
