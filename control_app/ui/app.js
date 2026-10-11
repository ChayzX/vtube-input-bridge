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
// Each PC by its Windows computer name, role and address ("CHASEBOT · Gaming PC · 10.0.0.112"). The other PC's name
// comes over the PC link; an older version sends none, and then its role and address stand in.
const pcLabel=pc=>[pc.name,pc.role,pc.ip].filter(Boolean).join(' · ');
const shortName=pc=>pc.name||pc.role;
const theOther=pc=>`${pc.name?pc.name+', ':''}the ${pc.role}${pc.ip?` (${pc.ip})`:''}`;
function pcs(){
 const n=names(),c=latest?.config,t=latestTracking;
 const self={name:latest?.hostname||'',role:n.self,ip:c?.ownIp||''};
 const other={name:peerStatus?.hostname||latest?.peerName||'',role:n.other,ip:c?.peer?.host||(role==='pantry'?t?.destination:t?.source)||''};
 return {self,other,gaming:role==='canada'?other:self,streaming:role==='canada'?self:other};
}
function setWhere(node,text,title){setText(node,text);if(node&&node.getAttribute?.('title')!==(title||text))node.setAttribute?.('title',title||text);}

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
const pages=['home','tracking','link','apps','deck','reactives','metrics','logs','advanced'];
let current='home';
function go(page,focusId){
 if(!pages.includes(page))page='home';
 for(const p of pages)setHidden(el('page-'+p),p!==page);
 for(const a of all('.nav a[data-page]')){if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
 if(page!==current){const main=el('main');if(main){main.scrollTop=0;}}
 current=page;globalThis.history?.replaceState?.(null,'','#'+page);
 pageShown(page);
 if(focusId){const target=el(focusId);target?.scrollIntoView?.({block:'center'});target?.focus?.();}
}
// The Metrics (and Logs) pages fetch only while they are open.
function pageShown(page){
 if(page==='metrics'){if(!metricsTimer)void pollMetrics();}else if(metricsTimer){clearTimeout(metricsTimer);metricsTimer=null;}
 if(page==='logs'){if(!logState.timer)void pollLogs();}else if(logState.timer){clearTimeout(logState.timer);logState.timer=null;}
}
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState!=='hidden')pageShown(current);});
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
  case 'Waiting for pairing':return {level:'warn',badge:'Not paired',title:'Waiting for pairing',detail:sentence(t.detail),fix:'Pair this PC with the Gaming PC under PC link. Tracking starts by itself once they are paired.'};
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
const fields=[['enabled','enabled','checked'],['notifyEnabled','notify.enabled','checked'],['updatesAuto','updates.auto','checked'],['updatesFromPeer','updates.fromPeer','checked'],['obsEnabled','obs.enabled','checked'],['obsUrl','obs.url'],['obsPassword','obs.password'],['meldEnabled','meld.enabled','checked'],['meldUrl','meld.url'],['spotifyEnabled','spotify.enabled','checked'],['vtsEnabled','vts.enabled','checked'],['vtsUrl','vts.url'],['reactiveEnabled','reactive.enabled','checked'],['reactiveUrl','reactive.url']];
const labels={notifyEnabled:'Notifications',updatesAuto:'Check for updates automatically',updatesFromPeer:'Accept updates from the other PC',enabled:'Remote controls',obsEnabled:'OBS Studio',obsUrl:'OBS address',obsPassword:'OBS password',meldEnabled:'Meld Studio',meldUrl:'Meld address',spotifyEnabled:'Spotify',vtsEnabled:'VTube Studio',vtsUrl:'VTube Studio address',reactiveEnabled:'Render reactives',reactiveUrl:'Fugi URL'};
const pick=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
let loaded={};
function fill(config,force){for(const [id,path,prop='value'] of fields){const value=pick(config,path)??(prop==='checked'?false:'');if(force||el(id)[prop]===loaded[id])el(id)[prop]=value;loaded[id]=value;}}
function formOnto(config){const c=structuredClone(config);for(const [id,path,prop='value'] of fields){const keys=path.split('.');const last=keys.pop();keys.reduce((o,k)=>o[k]??={},c)[last]=el(id)[prop];}return c;}
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
 el('enabled').disabled=down;
}
function onEdit(){syncDependents();syncToggles();updateDirty();}
el('settings').addEventListener('input',onEdit);el('settings').addEventListener('change',onEdit);
// Settings shown on the Advanced page belong to the same form (form="settings") but sit outside it, so they report here.
for(const id of ['notifyEnabled','updatesAuto','updatesFromPeer'])el(id).addEventListener('change',onEdit);

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
  setText(el('peer'),r.config.peer?`Paired with ${theOther(pcs().other)}`:'Not paired yet');
  setBadge(el('peerBadge'),r.config.peer?'ok':'setup',r.config.peer?'Paired':'Not paired');
  setText(el('enabledHelp'),r.config.peer?'Lets Stream Deck keys control apps on this PC, and shows reactives. Turning it off is the same as Pause remote controls in the tray.':'Lets Stream Deck keys control apps on this PC. Keys for the other PC work once the PCs are paired.');
  setHidden(el('pairStartRow'),!!pairMode);setText(el('pairStartLabel'),r.config.peer?'Pair again':'Pair with a code');
  setText(el('pairStartHelp'),r.config.peer?`Only needed if the ${n.other} was reinstalled or reset. Show a code on one PC and type it on the other.`:'Show a code on one PC and type it on the other. Both PCs must be on the same home network.');
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
 for(const node of all('.other-pc'))setText(node,n.other);
 setText(el('homeLead'),`Live status of tracking, the link to the ${n.other} and your stream apps.`);
 setText(el('deckHelp'),role==='canada'?'The Stream Deck is plugged into the Gaming PC. Its keys reach apps on this PC through the PC link, so keep the apps you use turned on under Apps.':'In the Stream Deck app, open the VTube Input Bridge category and drag the action you want (OBS scene, VTube Studio hotkey, Spotify…) onto a key, then choose the PC. Scene and hotkey lists fill in by themselves.');
 nameTargets();
}
// The Stream Deck page's "Send to" list names both PCs.
function nameTargets(){
 const p=pcs();
 for(const option of el('target')?.options||[])setText(option,option.value==='local'?`This PC (${pcLabel(p.self)})`:p.other.name?pcLabel(p.other):`The ${p.other.role}${p.other.ip?' · '+p.other.ip:''}`);
}

// ---------- Apps: status, tests and the other PC ----------
const APPS={
 obs:{name:'OBS Studio',settings:'OBS settings',test:'obs.scenes',okBadge:'Connected',off:'Turn on to switch OBS scenes from the Stream Deck.',fix:w=>`Open OBS on the ${w}. In Tools › WebSocket Server Settings, turn on the WebSocket server and enter its password under Apps on that PC. If you don't use OBS there, turn it off under Apps.`},
 vts:{name:'VTube Studio',settings:'VTube Studio settings',test:'vts.hotkeys',okBadge:'Connected',off:'Turn on to trigger VTube Studio hotkeys and Item Scenes.',fix:w=>`Open VTube Studio on the ${w} and turn on Start API in its settings. If it asks to allow VTube Input Bridge, click Allow, then test again.`},
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
 const app=APPS[id];const n=names();const p=pcs();
 const localOn=!!r.config?.[id]?.enabled,peerOn=!!peerStatus?.plugins?.controls?.[id];
 const where=localOn&&peerOn?`Both PCs: ${shortName(p.self)} and ${shortName(p.other)}`:localOn?`${pcLabel(p.self)} (this PC)`:peerOn?pcLabel(p.other):'Not turned on';
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
 if(r.bindError)return {level:'warn',badge:'Retrying',detail:sentence(r.bindError),fix:'Another program may be using the port. Restarting this PC usually clears it.'};
 if(peerStatus?.version&&r.version&&peerStatus.version!==r.version)return {level:'warn',badge:'Different versions',detail:`The ${n.other} runs version ${peerStatus.version} and this PC runs ${r.version}. Some keys may fail until both run the same version.`,fix:'Open Advanced › Updates on the PC with the newer version and choose Update both PCs, or run the same installer on both PCs.'};
 if(peerError)return {level:'warn',badge:'Not answering',detail:sentence(peerError),retry:true,fix:`Check that the ${n.other} is on and VTube Input Bridge is running there, and that both PCs are on the same home network. If Windows calls the network Public on either PC, set it to Private (Settings › Network & internet).`};
 return {level:'ok',badge:'Paired',detail:`Paired with ${theOther(pcs().other)}.${peerStatus?' It is answering.':''}`};
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
 if(v.where!==undefined)setWhere(el(id+'-where'),v.where,v.whereTitle);
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

 const p=pcs();const flow={where:`${shortName(p.gaming)} → ${shortName(p.streaming)}`,whereTitle:`${pcLabel(p.gaming)} → ${pcLabel(p.streaming)}`};
 renderCard('tracking',{...tv,...flow});
 const action=el('tracking-action');
 if(action){setHidden(action,role!=='pantry');setText(action,trackRunning?'Stop sending':'Start sending');}
 renderCard('link',lv);setHidden(el('link-test'),!lv.retry);setText(el('link-go'),r.linkError?'PC link':c?.peer?'Manage pairing':'Pair PCs');
 for(const id of Object.keys(APPS)){renderCard(id,apps[id],{test:el(id+'-test'),go:el(id+'-go')});setBadge(el(id+'-badge2'),apps[id].level,apps[id].localOn&&apps[id].level!=='off'?apps[id].badge:'');}
 renderCard('reactives',{...rv,...flow});

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
 // Each end shows the PC's computer name (and which one is this PC), with its role and address underneath.
 for(const [id,pc,mine] of [['Gaming',p.gaming,role==='pantry'],['Streaming',p.streaming,role==='canada']]){
  setText(el(`node${id}Name`),shortName(pc)+(mine?' (this PC)':''));
  setText(el('node'+id),[pc.name?pc.role:'',pc.ip].filter(Boolean).join(' · '));
 }
 nameTargets();

 // Nav: a dot where something needs attention.
 const navBadge=(id,level,text,label)=>{const b=el('nav-'+id);if(!b)return;const show=level==='warn'||level==='err';setBadge(b,level,show?text:'');if(show)b.setAttribute('aria-label',label);};
 navBadge('tracking',tv.level,'!','Tracking needs attention');navBadge('link',lv.level,'!','PC link needs attention');
 const appIssues=Object.values(apps).filter(v=>v.level==='warn').length;navBadge('apps',appIssues?'warn':'ok',String(appIssues),`${appIssues} app${appIssues===1?'':'s'} need attention`);
 navBadge('reactives',rv.level,'!','Reactives need attention');

 // Sidebar PC card and Advanced.
 setText(el('pcRole'),shortName(p.self));setText(el('pcAddress'),[p.self.name?p.self.role:'',p.self.ip].filter(Boolean).join(' · '));setText(el('pcVersion'),r.version?`Version ${r.version}`:'');
 setText(el('factName'),r.hostname||'—');
 setText(el('factRole'),role==='canada'?'Streaming PC: receives tracking and runs VTube Studio':'Gaming PC: sends tracking and has the Stream Deck');
 setText(el('factAddress'),c?.ownIp?`${c.ownIp} (found automatically)`:'—');
 renderSetup(r,{tv,lv});renderUpdate(r.update);setText(el('factPeer'),c?.peer?pcLabel(p.other):'Not paired');setText(el('factVersion'),r.version||'—');
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
// Support status: the state of each feature, plus the latest warnings and errors from the log (already redacted).
el('copyStatus').onclick=()=>busy(el('copyStatus'),async()=>{
 const r=latest||{};let recent=[];
 try{recent=((await window.control.logs?.({levels:['error','warn'],limit:30}))?.entries||[]).map(logLine);}catch{}
 const status={role:r.role,hostname:r.hostname,peerName:peerStatus?.hostname||r.peerName,version:r.version,linkError:r.linkError,bindError:r.bindError,plugins:r.plugins,services:r.status?.services,peerError,recentWarningsAndErrors:recent.length?recent:'None'};
 await copy(JSON.stringify(status,null,2),`Status copied${recent.length?` with ${recent.length} recent warning${recent.length===1?'':'s'} and errors`:''}. Paste it into a message to get help.`);
});
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

// ---------- Metrics ----------
// One point per second from the main process, fetched only while this page is open and the window is visible. Each
// chart has one unit on one axis, a legend with the latest values, and a crosshair readout (mouse, or arrow keys).
const SERIES_CLASS=['s1','s2','s3'];
function metricCharts(){
 const pantry=role==='pantry';const tracked=pantry?'Sent':'Received';
 const pct=(key,label='')=>[{key:key+'.p50',label:'Median'+label},{key:key+'.p95',label:'95th percentile'+label}];
 return [
  {group:'Tracking',id:'tPackets',title:'Tracking packets',unit:'packets/s',series:[{key:'tracking.packets',label:tracked}]},
  {group:'Tracking',id:'tBytes',title:'Tracking data',unit:'KB/s',scale:1/1024,series:[{key:'tracking.bytes',label:tracked}],none:`Not reported by the tracking ${pantry?'helper':'relay'} on this PC yet. It needs the updated tracking files from this version.`},
  pantry?{group:'Tracking',id:'tAge',title:'Acknowledgement age',unit:'ms',series:[{key:'tracking.ackAge',label:'Since the Streaming PC last confirmed a packet'}],help:'Low and steady while sending. Climbing means acknowledgements are not getting back. Gaps: not sending.'}
   :{group:'Tracking',id:'tAge',title:'Time since the last packet',unit:'ms',series:[{key:'tracking.packetAge',label:'Since the last packet from the Gaming PC'}],help:'Low and steady while the Gaming PC is sending. Capped at 30 s.'},
  {group:'PC link',id:'pRate',title:'Requests',kind:'bars',unit:'requests',series:[{key:'peer.sent',label:'Sent'},{key:'peer.received',label:'Received'},{key:'peer.errors',label:'Errors'}],help:'Commands and status between the PCs, stacked. Reactive frames are counted under Reactives.'},
  {group:'PC link',id:'pLatency',title:'Response time of the other PC',unit:'ms',series:pct('peer.latency')},
  {group:'Stream Deck',id:'aRate',title:'Commands by result',kind:'bars',unit:'commands',series:[{key:'api.ok',label:'Worked'},{key:'api.failed',label:'Failed'},{key:'api.refused',label:'Refused'}],help:'Key presses and key settings lists from the Stream Deck on this PC. Refused: nothing ran (expired, turned off, busy).'},
  {group:'Stream Deck',id:'aTime',title:'Command time',unit:'ms',series:pct('api.ms')},
  {group:'Reactives',id:'rRate',title:pantry?'Frames sent to the Streaming PC':'Frames received from the Gaming PC',unit:'frames/s',series:[{key:pantry?'reactive.frames':'reactive.received',label:pantry?'Uploaded':'Received'},{key:'reactive.errors',label:'Failed'}]},
  {group:'Reactives',id:'rSize',title:'Frame size',unit:'KB',scale:1/1024,series:pct('reactive.frameBytes')},
  pantry?{group:'Reactives',id:'rUpload',title:'Upload time',unit:'ms',series:pct('reactive.uploadMs')}
   :{group:'Reactives',id:'oRate',title:'Overlay frames served to VTube Studio',unit:'frames/s',series:[{key:'overlay.frames',label:'With an image'},{key:'overlay.empty',label:'Empty'}]}
 ];
}
const metricsData={times:[],series:{},totals:{},recent:{},uptime:0};
let metricsSince=0,metricsTimer=null,metricsBuilt='',charts=[],metricsRange=300;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
// New points are appended; a series that first appears later is padded with gaps so every series lines up with times.
function mergeMetrics(d){
 if(!d||!Array.isArray(d.times))return;
 const before=metricsData.times.length;const added=d.times.length;
 metricsData.times.push(...d.times);
 for(const [key,values] of Object.entries(d.series||{})){const arr=metricsData.series[key]??=new Array(before).fill(NaN);arr.push(...values.map(v=>v===null?NaN:v));}
 for(const arr of Object.values(metricsData.series))while(arr.length<before+added)arr.push(NaN);
 const extra=metricsData.times.length-(d.capacity||900);
 if(extra>0){metricsData.times.splice(0,extra);for(const arr of Object.values(metricsData.series))arr.splice(0,extra);}
 if(added)metricsSince=d.times[added-1];
 Object.assign(metricsData,{totals:d.totals||{},recent:d.recent||{},uptime:d.uptime||0,now:d.now});
}
function niceMax(v){if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v));const f=v/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
function num(v,unit){
 if(!finite(v))return '—';
 const digits=Math.abs(v)>=100||unit==='packets/s'&&Math.abs(v)>=10?0:Math.abs(v)>=10?1:2;
 return Number(v.toFixed(digits)).toLocaleString();
}
function duration(ms){const s=Math.floor(ms/1000);const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h} h ${m} min`:m?`${m} min ${s%60} s`:`${s} s`;}
function clock(t){const d=new Date(t);return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function make(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function buildMetrics(){
 const key=role+'';if(metricsBuilt===key)return;metricsBuilt=key;
 const host=el('metricCharts');if(!host?.append)return;
 host.replaceChildren();charts=[];let grid=null,group='';
 for(const def of metricCharts()){
  if(def.group!==group){group=def.group;host.append(make('h2','section',group));grid=make('div','charts');host.append(grid);}
  const card=make('article','card chart');const head=make('h3','',def.title);const unit=make('span','unit',def.unit);unit.hidden=true;head.append(unit);card.append(head);
  if(def.help)card.append(make('p','chart-help',def.help));
  const legend=make('ul','legend');const values=[];
  def.series.forEach((s,i)=>{const li=make('li');li.append(make('span','key '+SERIES_CLASS[i]),make('span','',s.label));const b=make('b','','—');li.append(b);legend.append(li);values.push(b);});
  const plot=make('div','plot');const canvas=make('canvas');canvas.tabIndex=0;canvas.setAttribute('role','img');
  const empty=make('div','empty','No data yet');const tip=make('div','tip');tip.hidden=true;plot.append(canvas,empty,tip);
  if(def.series.length>1)card.append(legend);else{legend.classList.add('single');card.append(legend);}
  card.append(plot);grid.append(card);
  const chart={def,canvas,empty,tip,values,unit,hover:-1};charts.push(chart);
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();chart.hover=indexAt(chart,e.clientX-r.left);drawChart(chart);});
  canvas.addEventListener('pointerleave',()=>{chart.hover=-1;drawChart(chart);});
  canvas.addEventListener('blur',()=>{chart.hover=-1;drawChart(chart);});
  canvas.addEventListener('keydown',e=>{
   const n=metricsData.times.length;if(!n)return;const first=Math.max(0,n-metricsRange);
   if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const at=chart.hover<0?n-1:chart.hover;chart.hover=Math.min(n-1,Math.max(first,at+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1)));drawChart(chart);}
   else if(e.key==='Escape'){chart.hover=-1;drawChart(chart);}
  });
 }
}
const PAD={l:44,r:8,t:24,b:20};
// Bar charts sum each series into 30 buckets across the window (10 s at 5 minutes, 30 s at 15 minutes): single events
// such as a key press stay visible, and the stacked total is every request or command in that bucket.
const bucketSize=()=>Math.max(1,Math.round(metricsRange/30));
const unitOf=def=>def.kind==='bars'?`${def.unit} per ${bucketSize()} s`:def.unit;
function indexAt(chart,x){
 const w=chart.canvas.clientWidth;const n=metricsData.times.length;if(!n)return -1;
 const first=n-metricsRange;const plotW=w-PAD.l-PAD.r;
 const i=Math.round(first+(x-PAD.l)/plotW*(metricsRange-1));return i<Math.max(0,first)||i>n-1?-1:i;
}
function chartValues(chart){
 const n=metricsData.times.length;const first=Math.max(0,n-metricsRange);const scale=chart.def.scale||1;
 return chart.def.series.map(s=>{const arr=metricsData.series[s.key];return arr?arr.slice(first).map(v=>finite(v)?v*scale:NaN):null;});
}
function drawChart(chart){
 const {canvas,def}=chart;const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h||!canvas.getContext)return;
 const dpr=globalThis.devicePixelRatio||1;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const css=getComputedStyle(document.documentElement);const color=name=>css.getPropertyValue(name).trim();
 const n=metricsData.times.length;const first=Math.max(0,n-metricsRange);const offset=first-(n-metricsRange);// empty slots at the left
 const bars=def.kind==='bars';const unit=unitOf(def);setText(chart.unit,unit);
 const series=chartValues(chart);
 const all=series.flatMap(a=>a||[]).filter(finite);
 const hasData=all.length>0;
 setHidden(chart.empty,hasData);
 setText(chart.empty,hasData?'':series.every(a=>!a)&&def.none?def.none:'No data yet');
 // Buckets for bar charts, newest bucket ending at "now": [{from,to,values:[per series]}].
 const size=bucketSize(),count=Math.ceil(metricsRange/size);let buckets=[];
 if(bars)for(let b=0;b<count;b++){
  const to=n-1-(count-1-b)*size,from=to-size+1;const values=series.map(arr=>{if(!arr)return 0;let sum=0;for(let i=Math.max(from,first);i<=to;i++){const v=arr[i-first];if(finite(v))sum+=v;}return sum;});
  buckets.push({from,to,values,total:values.reduce((x,y)=>x+y,0)});
 }
 const top=bars?Math.max(0,...buckets.map(b=>b.total)):Math.max(0,...all);
 const max=niceMax(top);
 const plotW=w-PAD.l-PAD.r,plotH=h-PAD.t-PAD.b;
 const X=i=>PAD.l+(i+offset)/(metricsRange-1)*plotW,Y=v=>PAD.t+plotH-v/max*plotH;
 // Axes: three recessive gridlines with values, the unit above them, and the time under the plot.
 ctx.font=`12px ${color('--font')||'sans-serif'}`;ctx.textBaseline='middle';
 for(const f of hasData?[0,0.5,1]:[0]){
  const y=Math.round(Y(max*f))+0.5;ctx.strokeStyle=f===0?color('--axis'):color('--grid');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(w-PAD.r,y);ctx.stroke();
  ctx.fillStyle=color('--text-2');ctx.textAlign='right';ctx.fillText(num(max*f,def.unit),PAD.l-6,y);
 }
 ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle=color('--text-2');ctx.fillText(unit,0,11);
 ctx.textBaseline='bottom';const minutes=metricsRange/60;
 ctx.textAlign='left';ctx.fillText(`${minutes} min ago`,PAD.l,h);ctx.textAlign='center';ctx.fillText(`${minutes/2} min ago`,PAD.l+plotW/2,h);ctx.textAlign='right';ctx.fillText('now',w-PAD.r,h);
 const stroke=[color('--series-1'),color('--series-2'),color('--series-3')];const surface=color('--card');
 const slot=plotW/count;const hoverBucket=bars&&chart.hover>=first?Math.floor((chart.hover-(n-1-count*size+1))/size):-1;
 if(bars){
  // Stacked columns with a 2 px surface gap between bars and between segments; rounded where the stack ends.
  buckets.forEach((b,k)=>{
   const x=PAD.l+k*slot+1,bw=Math.max(1,slot-2);let base=0;
   if(k===hoverBucket){ctx.fillStyle=color('--nav-hover');ctx.fillRect(PAD.l+k*slot,PAD.t,slot,plotH);}
   const last=b.values.reduce((at,v,i)=>v>0?i:at,-1);
   b.values.forEach((v,s)=>{
    if(!(v>0))return;const y0=Y(base),y1=Y(base+v);base+=v;
    const gap=s===last?0:2;const height=Math.max(1,y0-y1-gap);ctx.fillStyle=stroke[s];
    ctx.beginPath();if(s===last&&ctx.roundRect)ctx.roundRect(x,y1,bw,height,[Math.min(3,bw/2),Math.min(3,bw/2),0,0]);else ctx.rect(x,y1+gap,bw,height);ctx.fill();
    if(s===2){ctx.save();ctx.clip();ctx.strokeStyle=surface;ctx.lineWidth=1;for(let d=-height;d<bw;d+=4){ctx.beginPath();ctx.moveTo(x+d,y0);ctx.lineTo(x+d+height,y1);ctx.stroke();}ctx.restore();}
   });
  });
 }else{
  // Lines: 2 px, broken where there is no value; a value with no neighbours is a dot. The third series is dashed and
  // the second series' lone dots are rings, so identity never relies on colour alone.
  series.forEach((values,s)=>{
   if(!values)return;ctx.strokeStyle=stroke[s];ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash(s===2?[5,4]:[]);
   ctx.beginPath();let pen=false;const dots=[];
   values.forEach((v,i)=>{if(!finite(v)){pen=false;return;}const x=X(i),y=Y(v);if(pen)ctx.lineTo(x,y);else{ctx.moveTo(x,y);if(!finite(values[i+1]))dots.push([x,y]);pen=true;}});
   ctx.stroke();ctx.setLineDash([]);
   for(const [x,y] of dots){ctx.beginPath();ctx.arc(x,y,4,0,7);if(s===1){ctx.lineWidth=2;ctx.stroke();}else{ctx.fillStyle=stroke[s];ctx.fill();}}
  });
 }
 // Legend: the latest value of each line, or each series' total over the window for bars.
 series.forEach((values,s)=>{
  let text='—';
  if(values&&bars)text=fmt(buckets.reduce((sum,b)=>sum+b.values[s],0))+` in ${minutes} min`;
  else if(values){const last=[...values].reverse().find(finite);if(finite(last))text=num(last,def.unit);}
  setText(chart.values[s],text);
 });
 canvas.setAttribute('aria-label',`${def.title}, ${unit}, last ${minutes} minutes. `+(bars?'Totals: ':'Latest: ')+def.series.map((s,i)=>`${s.label} ${chart.values[i].textContent}`).join(', ')+'. Use the left and right arrow keys to read values.');
 // Crosshair (lines) or highlighted bucket (bars), and one readout listing every series.
 const tip=chart.tip;
 if(chart.hover<first||chart.hover>=n||!hasData){tip.hidden=true;return;}
 const i=chart.hover-first;let x=X(i),rows;
 if(bars){
  const b=buckets[hoverBucket];if(!b){tip.hidden=true;return;}x=PAD.l+(hoverBucket+0.5)*slot;
  const from=metricsData.times[Math.max(b.from,first)],to=metricsData.times[b.to];
  rows=[make('div','t',`${clock(from)} – ${clock(to)}`)];
  def.series.forEach((s,k)=>{const r=make('div','r');r.append(make('span','key '+SERIES_CLASS[k]),make('b','',fmt(b.values[k])),make('span','',s.label));rows.push(r);});
 }else{
  ctx.strokeStyle=color('--axis');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Math.round(x)+0.5,PAD.t);ctx.lineTo(Math.round(x)+0.5,PAD.t+plotH);ctx.stroke();
  series.forEach((values,s)=>{const v=values?.[i];if(!finite(v))return;ctx.fillStyle=surface;ctx.beginPath();ctx.arc(x,Y(v),6,0,7);ctx.fill();ctx.fillStyle=stroke[s];ctx.beginPath();ctx.arc(x,Y(v),4,0,7);ctx.fill();});
  rows=[make('div','t',clock(metricsData.times[chart.hover]))];
  def.series.forEach((s,k)=>{const r=make('div','r');r.append(make('span','key '+SERIES_CLASS[k]),make('b','',`${num(series[k]?.[i],def.unit)} ${def.unit}`),make('span','',s.label));rows.push(r);});
 }
 tip.replaceChildren(...rows);tip.hidden=false;
 const tw=tip.offsetWidth||160;tip.style.left=Math.max(0,Math.min(x+12+tw>w?x-12-tw:x+12,w-tw))+'px';
}
const TOTALS=[['tracking.packets','Tracking packets'],['tracking.bytes','Tracking data (bytes)'],['peer.sent','PC link requests sent'],['peer.received','PC link requests received'],['peer.errors','PC link errors'],
 ['api.ok','Stream Deck commands that worked'],['api.failed','Stream Deck commands that failed'],['api.refused','Stream Deck commands refused'],
 ['reactive.frames','Reactive frames sent'],['reactive.received','Reactive frames received'],['reactive.errors','Reactive frame failures'],['overlay.frames','Overlay frames served'],['overlay.empty','Overlay requests with no image']];
function renderMetrics(){
 buildMetrics();
 const d=metricsData,t=d.totals;
 setText(el('metricsUptime'),d.now?`Updated ${clock(d.now)}`:'');
 const rate=key=>{const arr=d.series[key];if(!arr)return NaN;const last=arr.slice(-5).filter(finite);return last.length?last.reduce((a,b)=>a+b,0)/last.length:NaN;};
 const tiles=[
  ['Uptime',d.uptime?duration(d.uptime).replace(/ \d+ s$/,''):'—','Since the app started'],
  ['Tracking packets',fmt(t['tracking.packets']),finite(rate('tracking.packets'))?`${num(rate('tracking.packets'),'packets/s')} packets/s now`:'No packets yet'],
  ['PC link requests',fmt((t['peer.sent']||0)+(t['peer.received']||0)),`${fmt(t['peer.errors'])} error${t['peer.errors']===1?'':'s'}`],
  ['Stream Deck commands',fmt((t['api.ok']||0)+(t['api.failed']||0)+(t['api.refused']||0)),`${fmt(t['api.failed'])} failed · ${fmt(t['api.refused'])} refused`],
  ['Reactive frames',fmt((t['reactive.frames']||0)+(t['reactive.received']||0)),`${fmt(t['reactive.errors'])} failed`]
 ];
 const box=el('metricTiles');
 if(box?.append&&box.children.length!==tiles.length){box.replaceChildren(...tiles.map(()=>{const c=make('div','card tile');c.append(make('div','k'),make('div','v'),make('div','d'));return c;}));}
 tiles.forEach(([k,v,detail],i)=>{const c=box?.children?.[i];if(!c)return;setText(c.children[0],k);setText(c.children[1],v);setText(c.children[2],detail);});
 for(const chart of charts)drawChart(chart);
 const rows=TOTALS.filter(([key])=>t[key]!==undefined).map(([key,label])=>[label,t[key]]);
 for(const [key,value] of Object.entries(t))if(key.startsWith('api.code.'))rows.push([`Stream Deck result “${key.slice(9)}”`,value]);
 const body=el('metricTotalRows');
 if(body?.replaceChildren){
  if(!rows.length){const tr=make('tr');const td=make('td','','No data yet');td.colSpan=2;tr.append(td);body.replaceChildren(tr);}
  else body.replaceChildren(...rows.map(([label,value])=>{const tr=make('tr');tr.append(make('th','',label),make('td','mono',fmt(value)));tr.firstChild.scope='row';return tr;}));
 }
}
async function pollMetrics(){
 metricsTimer=null;if(current!=='metrics')return;
 // The layout depends on this PC's role, known after the first refresh.
 if(role&&document.visibilityState!=='hidden'&&window.control.metrics){try{mergeMetrics(await window.control.metrics({since:metricsSince}));renderMetrics();}catch{}}
 if(current==='metrics'&&!metricsTimer)metricsTimer=setTimeout(pollMetrics,1000);
}
el('metricsRange').onchange=()=>{metricsRange=Number(el('metricsRange').value)||300;for(const c of charts)c.hover=-1;renderMetrics();};
window.addEventListener('resize',()=>{if(current==='metrics')for(const c of charts)drawChart(c);});

// ---------- Logs ----------
// A live tail of the main process's log, fetched once a second while this page is open (only entries that changed).
// Filters, search and "Clear view" act on this view only; the log file keeps everything.
const LEVEL_RANK={error:0,warn:1,info:2,debug:3};
const SOURCE_NAMES={app:'App',tracking:'Tracking',peer:'PC link',api:'Stream Deck',obs:'OBS',vts:'VTube Studio',meld:'Meld',spotify:'Spotify',reactive:'Reactives'};
const logState={entries:new Map(),since:0,clearedAt:0,paused:false,timer:null,sources:[],debug:false,debugSources:null,rows:new Map()};
const logTime=t=>{const d=new Date(t);return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});};
function logMatches(e){
 const level=el('logLevel').value||'info',source=el('logSource').value,query=el('logSearch').value.trim().toLowerCase();
 return e.id>logState.clearedAt&&LEVEL_RANK[e.level]<=LEVEL_RANK[level]&&(!source||e.source===source)&&(!query||`${e.msg} ${e.source} ${e.level}`.toLowerCase().includes(query));
}
function logRow(e){
 const row=make('div','log-row '+e.level);row.dataset.repeat=String(e.repeat);
 const time=make('span','lt',logTime(e.t));time.title=new Date(e.t).toLocaleString();
 const msg=make('span','lm',e.msg);if(e.repeat>1)msg.append(make('span','lr',`×${e.repeat}`));
 row.append(time,make('span','lv',e.level==='warn'?'Warn':e.level),make('span','ls',SOURCE_NAMES[e.source]||e.source),msg);
 return row;
}
function renderLogs(rebuild){
 const box=el('logRows'),view=el('logView');if(!box?.append)return;
const visible=[...logState.entries.values()].filter(logMatches);
 if(rebuild){logState.rows.clear();box.replaceChildren(...visible.map(e=>{const r=logRow(e);logState.rows.set(e.id,r);return r;}));}
 else for(const e of visible){
  const old=logState.rows.get(e.id);
  if(!old){const r=logRow(e);logState.rows.set(e.id,r);box.append(r);}
  else if(old.dataset.repeat!==String(e.repeat)){const r=logRow(e);old.replaceWith(r);logState.rows.set(e.id,r);}
 }
 for(const [id,row] of logState.rows)if(!logState.entries.has(id)||!logMatches(logState.entries.get(id))){row.remove();logState.rows.delete(id);}
 const total=[...logState.entries.values()].filter(e=>e.id>logState.clearedAt).length;
 setHidden(el('logEmpty'),visible.length>0);setText(el('logEmpty'),total?'No entries match the filters':'No log entries yet');
 setText(el('logCount'),visible.length===total?`${fmt(total)} entr${total===1?'y':'ies'}`:`${fmt(visible.length)} of ${fmt(total)} entries`);
 if(el('logFollow').checked)view.scrollTop=view.scrollHeight;
}
function renderLogSettings(){
 const debug=el('logDebug');if(debug.checked!==logState.debug)debug.checked=logState.debug;syncToggles();
 const chips=el('logSources');
 if(chips?.append&&chips.children.length!==logState.sources.length){
  chips.replaceChildren(...logState.sources.map(source=>{const label=make('label','chip');const box=make('input');box.type='checkbox';box.value=source;box.onchange=saveLogging;label.append(box,make('span','',SOURCE_NAMES[source]||source));return label;}));
  const select=el('logSource');select.replaceChildren(make('option','','All sources'),...logState.sources.map(source=>{const o=make('option','',SOURCE_NAMES[source]||source);o.value=source;return o;}));select.firstChild.value='';
 }
 for(const box of chips?.querySelectorAll?.('input')||[]){box.checked=!logState.debugSources||logState.debugSources.includes(box.value);box.disabled=!logState.debug;}
 el('logSourcesRow')?.classList?.toggle('disabled',!logState.debug);
}
function mergeLogs(d){
 if(!d)return false;let changed=false;
 for(const e of d.entries||[]){logState.entries.set(e.id,e);logState.since=Math.max(logState.since,e.seq);changed=true;}
 // The main process keeps 2000 entries; so does this view.
 if(logState.entries.size>2000){const ids=[...logState.entries.keys()].sort((a,b)=>a-b);for(const id of ids.slice(0,logState.entries.size-2000))logState.entries.delete(id);}
 const settings=JSON.stringify([d.debug,d.debugSources,d.sources]);
 if(settings!==logState.settingsKey){logState.settingsKey=settings;Object.assign(logState,{debug:!!d.debug,debugSources:d.debugSources??null,sources:d.sources||[]});renderLogSettings();}
 setHidden(el('logWriteError'),!d.writeError);setText(el('logWriteErrorText'),d.writeError?`The log file could not be written: ${d.writeError}. The entries below are still kept while the app runs.`:'');
 return changed;
}
async function pollLogs(){
 logState.timer=null;if(current!=='logs')return;
 if(!logState.paused&&document.visibilityState!=='hidden'&&window.control.logs){
  try{const first=!logState.settingsKey;if(mergeLogs(await window.control.logs({since:logState.since}))||first)renderLogs(first);}catch{}
 }
 if(current==='logs'&&!logState.timer)logState.timer=setTimeout(pollLogs,1000);
}
async function saveLogging(){
 const sources=[...(el('logSources')?.querySelectorAll?.('input')||[])].filter(b=>b.checked).map(b=>b.value);
 const value={debug:el('logDebug').checked,debugSources:sources.length===logState.sources.length?null:sources};
 try{const saved=await window.control.setLogging(value);Object.assign(logState,{debug:!!saved.debug,debugSources:saved.debugSources??null});}
 catch(e){toast(cleanError(e),'err');}
 renderLogSettings();
}
for(const id of ['logLevel','logSource'])el(id).onchange=()=>renderLogs(true);
el('logSearch').oninput=()=>renderLogs(true);
el('logDebug').onchange=()=>{syncToggles();saveLogging();};
el('logPause').onclick=()=>{
 logState.paused=!logState.paused;const b=el('logPause');b.setAttribute('aria-pressed',String(logState.paused));
 setText(el('logPauseText'),logState.paused?'Resume':'Pause');el('logPauseIcon')?.setAttribute('href',logState.paused?'#i-play':'#i-pause');
 if(!logState.paused)void pollLogs();
};
el('logView').addEventListener('scroll',()=>{const v=el('logView');const atBottom=v.scrollHeight-v.scrollTop-v.clientHeight<24;if(el('logFollow').checked!==atBottom&&v.scrollHeight>v.clientHeight)el('logFollow').checked=atBottom;});
el('logFollow').onchange=()=>{if(el('logFollow').checked)el('logView').scrollTop=el('logView').scrollHeight;};
el('logClear').onclick=()=>{logState.clearedAt=Math.max(0,...logState.entries.keys());renderLogs(true);};
const logLine=e=>`${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.source.padEnd(8)} ${e.msg}${e.repeat>1?` (×${e.repeat})`:''}`;
el('logCopy').onclick=()=>{const lines=[...logState.entries.values()].filter(logMatches).map(logLine);if(!lines.length)return toast('Nothing to copy.');copy(lines.join('\n'),`${fmt(lines.length)} log entr${lines.length===1?'y':'ies'} copied.`);};
el('logOpen').onclick=()=>busy(el('logOpen'),async()=>{await window.control.openLogFolder();});

// ---------- Pairing with a code ----------
// "Show a pairing code" waits for the other PC; "Enter a code" finds the PC showing one and pairs with it.
let pairMode=null,pairPoll=null;
function pairPanels(mode){
 pairMode=mode;setHidden(el('pairShowPanel'),mode!=='show');setHidden(el('pairEnterPanel'),mode!=='enter');setHidden(el('pairStartRow'),!!mode);
 if(mode!=='show'){clearInterval(pairPoll);pairPoll=null;}
 if(mode!=='enter'){setHidden(el('pairChoose'),true);el('pairChoose').replaceChildren();}
}
el('pairShow').onclick=()=>busy(el('pairShow'),async()=>{
 const {code,expiresAt}=await window.control.pairStart();setText(el('pairCode'),code);pairPanels('show');
 const n=names();const tick=async()=>{
  const left=Math.max(0,Math.round((expiresAt-Date.now())/1000));
  setText(el('pairShowHelp'),`On the ${n.other}, open PC link, choose Enter a code and type it. The code works for ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} more.`);
  let st;try{st=await window.control.pairStatus();}catch{return;}
  if(st.state==='paired'){pairPanels(null);toast(`Paired with ${st.peer}. Remote controls are on.`);await refresh();}
  else if(st.state==='failed'||st.state==='expired'){pairPanels(null);toast(st.message||'Pairing stopped. Start again.','err');}
 };
 pairPoll=setInterval(tick,1000);void tick();
});
el('pairShowCancel').onclick=()=>{pairPanels(null);void window.control.pairCancel().catch(()=>{});};
el('pairEnter').onclick=()=>{pairPanels('enter');el('pairInput').value='';el('pairInput').focus();};
el('pairEnterCancel').onclick=()=>pairPanels(null);
async function join(address){
 const result=await window.control.pairJoin({code:el('pairInput').value,address});
 if(result?.choose){
  // More than one PC is showing a code: let the streamer pick theirs by name.
  const box=el('pairChoose');box.replaceChildren(...result.choose.map(pc=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=pc.label;b.onclick=()=>busy(b,()=>join(pc.address));return b;}));
  setHidden(box,false);toast('More than one PC is showing a code. Choose yours.');return;
 }
 pairPanels(null);toast(result?.message||'Paired.');await refresh();
}
el('pairJoin').onclick=()=>busy(el('pairJoin'),()=>join());
el('pairInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();el('pairJoin').click();}};

// ---------- Updates ----------
function renderUpdate(u){
 if(!u)return;
 const ready=u.ready||u.available;const paired=!!latest?.config?.peer;
 setText(el('updateTitle'),u.busy?`${u.busy}…`:ready?`Version ${ready.version} is ready`:`Version ${u.current}`);
 setText(el('updateText'),u.error?sentence(u.error):ready?(paired?`This PC runs ${u.current}. Updating installs ${ready.version} on both PCs; each restarts by itself.`:`This PC runs ${u.current}. Updating installs ${ready.version} and restarts the app.`)
  :u.checkedAt?`Up to date (checked ${ago(u.checkedAt)}). Both PCs must run the same version; updating here also updates the other PC.`:'Both PCs must run the same version. Updating here also updates the other PC.');
 const install=el('updateInstall');setHidden(install,!ready);setHidden(el('updateCheck'),!!ready);setText(install,paired?'Update both PCs':'Update');
 for(const id of ['updateCheck','updateFile','updateInstall'])el(id).disabled=!!u.busy||u.checking&&id==='updateCheck';
}
el('updateCheck').onclick=()=>busy(el('updateCheck'),async()=>{const u=await window.control.updateCheck();renderUpdate(u);if(!u.error)toast(u.available?`Version ${u.available.version} is available.`:'You have the latest version.');});
el('updateFile').onclick=()=>busy(el('updateFile'),async()=>renderUpdate(await window.control.updateChooseFile()));
el('updateInstall').onclick=()=>busy(el('updateInstall'),async()=>{
 const paired=!!latest?.config?.peer;
 if(!confirm(paired?'Install the update on both PCs now? Each app restarts by itself; tracking pauses for about a minute.':'Install the update now? The app restarts by itself.'))return;
 const {message,update}=await window.control.updateInstall({both:true});renderUpdate(update);toast(message);
});

// ---------- First-run checklist ----------
// One-time setup steps on Home. A step stays ticked once it has worked (remembered on this PC), and the card goes
// away when everything is done or the streamer hides it.
const store={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};
function everDone(key,now){if(now)store.set('setup.'+key,'1');return now||store.get('setup.'+key)==='1';}
function renderSetup(r,{tv}){
 const s=r.setup||{};const n=names();const obsOk=!!r.status?.services?.obs?.ok;
 const steps=role==='canada'?[
  ['paired',`Pair with the ${n.other}`,'PC link › Show a pairing code, then type it on the Gaming PC.',s.paired,'link'],
  ['vts','Allow VTube Input Bridge in VTube Studio','Open VTube Studio, turn on its API, then press Test on the VTube Studio card and click Allow.',everDone('vts',s.vtsAllowed),'apps'],
  ['tracking',`Get tracking from the ${n.other}`,'Starts by itself once the PCs are paired and VTube Studio is open.',everDone('tracking',tv.level==='ok'),'tracking'],
  ['obs','Connect OBS','Turn on OBS’s WebSocket server, enter its password under Apps, and press Test.',everDone('obs',obsOk),'apps'],
  ['overlay','Show reactives in VTube Studio','Reactives › copy the Web Item URL and add it as a Web Item in VTube Studio.',everDone('overlay',s.overlaySeen),'reactives'],
 ]:[
  ['paired',`Pair with the ${n.other}`,'PC link › Enter a code, then type the code shown on the Streaming PC.',s.paired,'link'],
  ['tracking',`Send tracking to the ${n.other}`,'Starts by itself once the PCs are paired.',everDone('tracking',tv.level==='ok'),'tracking'],
  ['plugin','Install the Stream Deck plugin','The installer adds it. If it is missing, run the installer again with the Stream Deck app open.',everDone('plugin',s.streamDeckPlugin),'deck'],
  ['deck','Press a Stream Deck key','Drag a VTube Input Bridge action onto a key and press it.',everDone('deck',s.deckSeen),'deck'],
  ['fugi','Add your Fugi overlay (optional)','Paste your Fugi browser-source URL under Reactives.',everDone('fugi',s.fugiUrl),'reactives'],
 ];
 const left=steps.filter(x=>!x[3]).length;const hidden=store.get('setup.hidden')==='1';
 setHidden(el('setup'),!latest?.config||hidden||left===0);if(hidden||left===0)return;
 setText(el('setupText'),`${left} of ${steps.length} step${steps.length===1?'':'s'} left. Each one ticks itself off when it works.`);
 const key=JSON.stringify(steps.map(x=>[x[0],x[1],x[3]]));if(el('setupSteps').dataset.key===key)return;el('setupSteps').dataset.key=key;
 el('setupSteps').replaceChildren(...steps.map(([id,title,help,done,page])=>{
  const li=document.createElement('li');li.className=done?'done':'';
  const mark=document.createElement('span');mark.className='mark';mark.setAttribute('aria-hidden','true');if(done)mark.innerHTML='<svg class="i"><use href="#i-check"/></svg>';
  const text=document.createElement('span');const b=document.createElement('b');b.textContent=title;const h=document.createElement('span');h.className='step-help';h.textContent=done?'Done':help;text.append(b,h);
  const sr=document.createElement('span');sr.className='sr-only';sr.textContent=done?' (done)':' (to do)';b.append(sr);
  li.append(mark,text);
  if(!done){const go_=document.createElement('button');go_.type='button';go_.className='btn subtle';go_.textContent='Open';go_.setAttribute('aria-label',`Open ${title}`);go_.onclick=()=>go(page);li.append(go_);}
  return li;
 }));
}
el('setupHide').onclick=()=>{store.set('setup.hidden','1');setHidden(el('setup'),true);};

// ---------- Start ----------
go((globalThis.location?.hash||'').slice(1)||'home');
setInterval(()=>window.control.get().then(r=>{renderTracking(r.plugins.tracking);renderControls(r);void pollPeer();}).catch(()=>{}),1000);
refresh().catch(e=>toast(cleanError(e),'err'));
