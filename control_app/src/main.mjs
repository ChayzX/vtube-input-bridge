import {app,BrowserWindow,Tray,Menu,ipcMain,dialog,safeStorage,nativeImage,nativeTheme,shell} from 'electron';
import {contextMenuTemplate} from './contextmenu.mjs';import {trayHealth} from './health.mjs';import {trayIconPng,TRAY_SIZES} from './trayicon.mjs';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,randomUUID,createHash,X509Certificate} from 'node:crypto';import selfsigned from 'selfsigned';
import {SerialQueue} from './serial.mjs';import {Retry} from './retry.mjs';import {checkDeadline} from './deadline.mjs';
import {defaults,upgradeConfig,validateConfig,validateSave,parsePairingFile} from './config.mjs';import {Dispatcher} from './commands.mjs';import {FrameStore} from './frames.mjs';import {createApi,createOverlay} from './server.mjs';import {requestPeer,forwardCommand,observePeer} from './client.mjs';import {Metrics,outcomeKind} from './metrics.mjs';import {userError} from './errors.mjs';import {ReactiveRenderer,openFugiLogin} from './reactive.mjs';
import {hostname as osHostname} from 'node:os';import {cleanHostname,pcLabel,peerHostname,roleLabel} from './names.mjs';import {Logger,SOURCES} from './logger.mjs';
import {PluginHost} from './plugins/host.mjs';import {TrackingSender,TrackingReceiver} from './plugins/tracking.mjs';import {createControlsPlugin} from './plugins/controls.mjs';import {createReactivesPlugin} from './plugins/reactives.mjs';

// One app per PC. Features are plugins (plugins/*.mjs): tracking, Stream Deck controls and reactives. The core here
// owns the window, tray, settings and the secure link between the two PCs. Tracking starts first and never depends on
// the link, so a companion failure cannot stop the input feed.
const APP_NAME='VTube Input Bridge';
const here=dirname(fileURLToPath(import.meta.url));const dir=join(app.getPath('appData'),'VTubeControl');app.setPath('userData',dir);
let config=null,identity=null,linkError='Starting',window,tray,quitting=false,shutdownPromise=null,servers=[],last={};
// This PC's Windows computer name, and the other PC's as it last reported it over the link.
const hostname=cleanHostname(osHostname());let peerName='';
// The app's log: memory for the Logs page, and a rolling file (2 × 1 MB) in the data folder. Debug logging is a
// per-PC preference in logging.json, readable even when the encrypted settings are not.
const logDir=join(dir,'logs');const loggingFile=join(dir,'logging.json');
const log=new Logger({file:join(logDir,'vtube-input-bridge.log'),maxBytes:1024*1024,files:2,capacity:2000});
// Anything still written to the console (from this app or a library) is kept in the log too.
for(const [method,level] of [['error','error'],['warn','warn']]){const original=console[method].bind(console);console[method]=(...args)=>{original(...args);try{log.log(level,'app',args.map(a=>a instanceof Error?a.message:typeof a==='string'?a:JSON.stringify(a)).join(' '));}catch{}};}
process.on('unhandledRejection',e=>log.error('app','Unhandled error: '+(e?.message||String(e))));
// Known secret values are hidden from every log line, even where they have no recognisable shape (the OBS password).
function updateSecrets(){log.setSecrets([identity?.localToken,identity?.networkToken,identity?.overlayToken,config?.peer?.token,config?.peer?.pin,config?.obs?.password,config?.vts?.token]);}
const sourceOf=service=>SOURCES.includes(service)?service:'api';
const frames=new FrameStore();
// Per-second metrics for the Metrics page (15 minutes, memory only).
const metrics=new Metrics({seconds:900});
// Requests this PC makes to the other PC. Frame uploads are reactives, everything else is the PC link. Each request
// counts once: answered (sent or received) or an error, so the Metrics page can stack them.
let peerAnswering=null;
observePeer(({method,path,ms,ok,bytes,error})=>{
 // Frames go up ten times a second, so only a failed one is worth a debug line.
 if(method==='PUT'&&path==='/frame'){if(!ok&&log.enabled('debug','reactive'))log.debugLog('reactive',`Frame upload failed after ${Math.round(ms)} ms${error?`: ${error.message}`:''}`);}
 else if(log.enabled('debug','peer'))log.debugLog('peer',`${method} ${path} to the other PC: ${ok?'ok':'failed'} in ${Math.round(ms)} ms${error?` (${error.message})`:''}`);
 if(path!=='/frame'||method!=='PUT'){
  // A failed command is logged with its action by run(); other requests are logged here.
  if(!ok&&error&&path!=='/command')log.warn('peer',`${method} ${path} to the other PC failed: ${error.message}`);
  if(!ok&&peerAnswering!==false&&error)log.warn('peer','The other PC stopped answering: '+error.message);
  if(ok&&peerAnswering===false)log.info('peer','The other PC is answering again');
  if(error||ok)peerAnswering=ok;
 }
 if(method==='PUT'&&path==='/frame'){if(ok){metrics.count('reactive.frames');metrics.observe('reactive.uploadMs',ms);metrics.observe('reactive.frameBytes',bytes);}else metrics.count('reactive.errors');return;}
 metrics.count(ok?'peer.sent':'peer.errors');metrics.observe('peer.latency',ms);
});
// Requests to this PC: from the other PC on 5056 (frames received are reactives) and from the Stream Deck on 5057.
function peerRequest({method,path,status,ms,result,bytes}){
 if(log.enabled('debug','peer'))log.debugLog('peer',`${method} ${path} from the other PC: ${status}${result&&!result.ok?` ${result.code}`:''} in ${Math.round(ms)} ms`);
 if(status===401||status===403)log.warn('peer',`Refused a request from the other PC (${status===401?'its pairing is out of date':'it came from an unexpected address'})`);
 if(method==='PUT'&&path==='/frame'){if(status===200){metrics.count('reactive.received');metrics.observe('reactive.frameBytes',bytes);}else metrics.count('reactive.errors');return;}
 metrics.count(status>=400||result?.ok===false?'peer.errors':'peer.received');
}
function localRequest({path,status,ms,result}){
 if(path!=='/command'){metrics.tally('api.other');return;}
 const kind=status===200?outcomeKind(result):'refused';metrics.count('api.'+kind);metrics.observe('api.ms',ms);
 if(kind==='refused')log.info('api',`Stream Deck command refused: ${result?.code||'HTTP '+status}`);
 else if(log.enabled('debug','api'))log.debugLog('api',`Stream Deck command ${kind} in ${Math.round(ms)} ms`);
 metrics.tally('api.code.'+(result?.ok?'ok':result?.code||'http_'+status));
}
// Once a second: close the metrics second, reading the tracking counters (they live in the helper or relay).
function sampleMetrics(){
 const t=host.status().tracking||{};const now=Date.now();
 if(Number.isFinite(t.packets))metrics.cumulative('tracking.packets',t.packets);
 if(Number.isFinite(t.bytes))metrics.cumulative('tracking.bytes',t.bytes);
 if(t.role==='sender')metrics.gauge('tracking.ackAge',t.running&&t.lastAckUnixMs>0?Math.min(Math.max(now-t.lastAckUnixMs,0),30000):NaN);
 else if(t.role==='receiver')metrics.gauge('tracking.packetAge',t.lastPacketUnixMs>0?Math.min(Math.max(now-t.lastPacketUnixMs,0),30000):NaN);
 metrics.tick();
 noteChanges(t);
}
// Tracking, reactive renderer and PC link changes go to the log as they happen (checked once a second).
let seen={};
function noteChanges(t){
 const tracking=[...new Set(t.role==='sender'?[t.state,t.connectionState,t.error]:[t.state,t.detail])].filter(Boolean).join(' · ');
 if(tracking&&tracking!==seen.tracking){const bad=!!t.error||/Waiting|Restart|Blocked|Receiver stopped/i.test(tracking);seen.tracking=tracking;log.log(bad?'warn':'info','tracking',tracking);}
 const state=renderer.state;
 if(state!==seen.renderer){const first=seen.renderer===undefined;seen.renderer=state;if(!first||state!=='Stopped')log.log(/unavailable|needed|unresponsive|stopped;|not showing|too large/i.test(state)?'warn':'info','reactive','Renderer: '+state);}
}const hex=()=>randomBytes(32).toString('hex');
const renderer=new ReactiveRenderer(async png=>{if(!config?.enabled||!config.peer)throw Error('Disabled');const r=await requestPeer(config.peer,'PUT','/frame',png);if(!r.ok)throw Error('Upload rejected');});
const transactions=new SerialQueue();
const settingsFile=join(dir,'settings.enc');const identityFile=join(dir,'identity.enc');const roleFile=join(dir,'role.txt');
async function loadProtected(path,fallback){try{return JSON.parse(safeStorage.decryptString(await readFile(path)));}catch(e){if(e.code==='ENOENT')return fallback();throw new Error('Stored settings could not be decrypted; restore the backup or reset this companion’s configuration');}}
async function saveProtected(path,value){if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable');await mkdir(dir,{recursive:true});const temp=path+'.new';await writeFile(temp,safeStorage.encryptString(JSON.stringify(value)),{mode:0o600});try{await copyFile(path,path+'.previous');}catch(e){if(e.code!=='ENOENT')throw e;}await rename(temp,path);}

// The role comes from the launch flag (--pantry or --canada, set by the installer) and is remembered for plain launches.
async function resolveRole(){
 const flag=process.argv.includes('--canada')?'canada':process.argv.includes('--pantry')?'pantry':null;
 if(flag){await mkdir(dir,{recursive:true});await writeFile(roleFile,flag).catch(()=>{});return flag;}
 try{const saved=(await readFile(roleFile,'utf8')).trim();if(saved==='pantry'||saved==='canada')return saved;}catch{}
 return 'pantry';
}

const host=new PluginHost();
const status=()=>({hostname,enabled:!!config?.enabled,role:config?.role,peer:config?.peer?.host||'Not paired',services:last,reactive:renderer.state,frameFresh:!!frames.get(),linkError,bindError:bind.error,plugins:host.status()});
async function run(c){
 if(!config?.enabled)throw userError('Remote controls are paused on this PC. Turn on "Remote controls" under PC link and save.','disabled');
 if(c.target==='peer'){if(!config.peer)throw userError('This PC is not paired with the other PC yet. Pair them under PC link first.','not_paired');let result;try{result=await forwardCommand(config.peer,c);}catch(e){log.warn('peer',`${c.action} on the other PC failed: ${e?.publicMessage||e?.message||e}`);throw e;}if(c.action==='bridge.status')notePeer(result);return result;}
 if(c.action==='bridge.status')return status();
 const deadline={expiresAt:c.expiresAt,assertActive:()=>{if(!config.enabled)throw userError("Remote controls were paused while this action was waiting.","disabled");}};checkDeadline(deadline);
 const service=c.action.split('.')[0];
 const started=performance.now();
 try{const result=await host.action(c.action,c.args,deadline);last[service]={ok:true,at:Date.now()};if(log.enabled('debug',sourceOf(service)))log.debugLog(sourceOf(service),`${c.action}: ok in ${Math.round(performance.now()-started)} ms`);return result;}
 catch(e){last[service]={ok:false,at:Date.now()};log.warn(sourceOf(service),`${c.action} failed: ${e?.publicMessage||e?.message||e}`);throw e;}
}
const dispatcher=new Dispatcher(run);
// The other PC's computer name comes with its status. An older version does not send one; the name from its pairing
// file (if any) is shown then, else just its role and address.
function notePeer(data){const next=peerHostname(data,peerName,'');if(next!==peerName){peerName=next;updateTray();}}
const currentPeerName=()=>peerHostname(null,peerName,config?.peer?.name);
// Asked once the link is up and then every 5 minutes, so the tray can name the other PC with the window closed.
async function refreshPeerName(){
 if(linkError||!config?.enabled||!config.peer||bind.error)return;
 try{notePeer(await forwardCommand(config.peer,{id:randomUUID(),expiresAt:Date.now()+5000,target:'local',action:'bridge.status',args:{}}));}catch{}
}
async function closeServers(){for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}servers=[];}
async function startServers(){
 await closeServers();renderer.stop();frames.clear();last={};
 const connection=join(dir,'plugin-connection.json');await writeFile(connection,JSON.stringify({port:5057,token:identity.localToken}),{mode:0o600});
 if(!config.enabled)return;
 const overlayFrames={get:()=>config.reactive.visible?frames.get():null};
 const list=[{server:createApi({token:identity.localToken,dispatcher,status,onRequest:localRequest}),port:5057,host:'127.0.0.1'},
  {server:createApi({token:identity.networkToken,tls:identity.cert,source:config.peer.host,dispatcher,status,frames,onRequest:peerRequest}),port:5056,host:config.ownIp},
  {server:createOverlay(overlayFrames,identity.overlayToken,served=>metrics.count(served?'overlay.frames':'overlay.empty')),port:5058,host:'127.0.0.1'}];
 try{for(const {server,port,host:address} of list){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,address,resolve);});servers.push(server);}}
 catch{await closeServers();throw new Error(`Could not open ${config.ownIp} or ports 5056–5058 on this PC. Retrying; if this lasts, check “This PC’s address” under PC link and that no other program uses those ports. Tracking is unaffected.`);}
}
// At sign-in the network may not have given this PC its address yet, so a failed bind is retried with backoff; it never
// turns controls off. Each later restart of the servers (save, pairing, tray) goes through here too.
const bind=new Retry(()=>transactions.run(async()=>{await startServers();autoStartRenderer();}),{onChange:error=>{updateTray();
 if(error!==seen.bind){if(error)log.warn('app',error);else if(config?.enabled)log.info('app',`Remote controls are listening on ${config.ownIp}:5056`);seen.bind=error;}
 if(!error)void refreshPeerName();}});
// Loads settings and identity and opens the secure link. A failure here disables only controls and reactives.
async function startLink(role){
 if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure credential storage unavailable');
 config=validateConfig(upgradeConfig(await loadProtected(settingsFile,()=>defaults(role)),role));
 identity=await loadProtected(identityFile,async()=>({localToken:hex(),networkToken:hex(),overlayToken:hex(),cert:await selfsigned.generate([{name:'commonName',value:'VTube Control'}],{keySize:2048,days:3650,algorithm:'sha256'})}));
 await saveProtected(identityFile,identity);
}
// The gaming PC starts rendering reactives by itself: at launch, and again after saving settings or pairing (both
// restart the link, which stops the renderer). A failure is shown in the renderer state and retried (Fugi or the
// network may not be up yet at sign-in) until it works or the renderer is stopped; it never blocks the app.
const rendering=new Retry(async()=>{
 const r=await dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.start',args:{}});
 if(!r.ok&&['unavailable','action_failed','busy','expired'].includes(r.code))throw new Error(r.message);
},{delays:[5000,10000,30000,60000]});
function autoStartRenderer(){
 if(linkError||config?.role!=='pantry'||!config.enabled||!config.peer||!config.reactive.enabled||!config.reactive.url)return rendering.cancel();
 void rendering.run();
}
const requireLink=()=>{if(linkError)throw new Error('Remote controls and reactives are unavailable: '+linkError);};

// The window paints the theme's background before the page loads (no white flash) and has no menu bar.
const windowBackground=()=>nativeTheme.shouldUseDarkColors?'#202020':'#f3f3f3';
function createWindow(){if(window&&!window.isDestroyed()){window.show();window.focus();return;}
 window=new BrowserWindow({width:1040,height:720,minWidth:760,minHeight:560,title:APP_NAME,icon:join(here,'..','ui','icon.ico'),show:false,backgroundColor:windowBackground(),autoHideMenuBar:true,
  webPreferences:{preload:join(here,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 window.removeMenu();window.once('ready-to-show',()=>window.show());
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.on('context-menu',(_,params)=>{const items=contextMenuTemplate(params);if(items.length)Menu.buildFromTemplate(items).popup({window});});
 window.webContents.on('render-process-gone',(_,details)=>log.error('app',`The window's renderer stopped (${details.reason}); reopen the window from the tray`));
 window.on('unresponsive',()=>log.warn('app','The window is not responding'));
 window.loadFile(join(here,'..','ui','index.html'));
 window.on('close',e=>{if(!quitting){e.preventDefault();window.hide();}});
}
// A request from the window that fails is logged as well as shown there.
function ipc(name,handler){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('Unauthorized UI');try{return await handler(...args);}catch(e){log.warn('app',`${name.replace(/^\w+:/,'')}: ${e?.message||e}`);throw e;}});}
async function quit(){
 if(shutdownPromise)return shutdownPromise;
 quitting=true;
 shutdownPromise=(async()=>{log.info('app','Exiting');bind.cancel();rendering.cancel();renderer.stop();await host.stopAll();await closeServers();await log.flush();app.quit();})();
 return shutdownPromise;
}

function trackingSummary(){
 const t=host.status().tracking||{};
 const state=t.role==='sender'?(t.connectionState||t.state):t.state;
 return t.role==='sender'?`Tracking: ${state||'Starting'}`+(t.running?` to ${t.destination}`:''):`Tracking: ${state||'Starting'}`;
}
// The tray icon's colour follows the same verdict as its status line: green live-ready, amber needs attention, red
// tracking or the PC link down, grey tracking paused.
const trayIcons={};
function trayIcon(level){
 if(trayIcons[level])return trayIcons[level];
 const image=nativeImage.createEmpty();
 for(const [size,scaleFactor] of TRAY_SIZES)image.addRepresentation({scaleFactor,dataURL:'data:image/png;base64,'+trayIconPng(size,level).toString('base64')});
 return trayIcons[level]=image;
}
let trayKey='',trayLevel='',ownRole='pantry';
function updateTray(){
 if(!tray)return;const t=host.status().tracking||{};const sender=t.role==='sender';
 const self=pcLabel({hostname,role:config?.role??ownRole,ip:config?.ownIp});
 const health=trayHealth({tracking:t,linkError,bindError:bind.error,config,services:last,self,peer:config?.peer?currentPeerName():''});
 if(health.level!==trayLevel){trayLevel=health.level;tray.setImage(trayIcon(health.level));}
 // Rebuild only on change: replacing the menu while it is open would close it under the streamer's cursor.
const key=JSON.stringify([self,health.line,health.tooltip,trackingSummary(),sender,t.running,!!linkError,!!config?.enabled,bind.error]);if(key===trayKey)return;trayKey=key;
 tray.setToolTip(health.tooltip);
 tray.setContextMenu(Menu.buildFromTemplate([
  {label:self,enabled:false},
  {label:health.line,enabled:false},
  {label:trackingSummary(),enabled:false},
  ...(sender?[{label:t.running?'Stop sending':'Start sending',click:()=>host.ui('tracking',t.running?'stop':'start',{}).catch(e=>dialog.showErrorBox('Tracking',e.message))}]:[]),
  {type:'separator'},
  {label:`Open ${APP_NAME}`,click:createWindow},
  {label:'Pause remote controls',enabled:!linkError&&!!config?.enabled,click:()=>transactions.run(async()=>{config.enabled=false;await saveProtected(settingsFile,config);}).then(()=>{log.info('app','Remote controls paused from the tray');return bind.run();},()=>dialog.showErrorBox('Could not save','Exit the app to stop controls immediately.'))},
  {label:`Exit ${APP_NAME}`,click:()=>{quit();}}
 ]));
}

Menu.setApplicationMenu(null);
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',createWindow);app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{
  const role=await resolveRole();ownRole=role;
  try{log.configure(JSON.parse((await readFile(loggingFile,'utf8')).replace(/^\uFEFF/,'')));}catch{}
  log.info('app',`Starting ${APP_NAME} ${app.getVersion()} as the ${roleLabel(role)} on ${hostname||'this PC'}`);
  // 1. Tracking first: it needs nothing else from this app.
  host.add(role==='pantry'
   ?new TrackingSender({exe:join(here,'..','tracking','VTubeInputBridge.exe'),settingsFile:join(dir,'tracking.json')})
   :new TrackingReceiver({exe:join(here,'..','relay','vts_input_relay.exe'),configFile:join(dir,'relay-config.json'),pairedSource:()=>config?.peer?.host,tokenFile:join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeInputRelay','vts-token.txt'),statusFile:join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeInputRelay','status.json')}));
  await host.start('tracking');setInterval(sampleMetrics,1000);
  // 2. The secure link and the features that use it.
  try{await startLink(role);linkError=null;updateSecrets();}catch(e){linkError=e?.message||String(e);log.error('app','The PC link could not start: '+linkError);}
  host.add(createControlsPlugin({getConfig:()=>config,linkError:()=>linkError,mediaExe:join(here,'..','media','SpotifyControl.exe'),
   saveVtsToken:token=>transactions.run(async()=>{config.vts.token=token;updateSecrets();await saveProtected(settingsFile,config);log.info('vts','VTube Studio allowed VTube Control; its token was saved');})}));
  host.add(createReactivesPlugin({getConfig:()=>config,linkError:()=>linkError,renderer,frames,
   setVisible:(visible,deadline)=>transactions.runWithDeadline(deadline,async()=>{config.reactive.visible=visible;await saveProtected(settingsFile,config);return visible;}),
   clearPeerFrame:()=>requestPeer(config.peer,'DELETE','/frame'),stopped:()=>rendering.cancel()}));
  await host.start('controls');await host.start('reactives');if(!linkError)await bind.run();

  ipc('control:get',()=>({role,hostname,peerName:config?.peer?currentPeerName():'',version:app.getVersion(),linkError,bindError:bind.error,plugins:host.status(),status:status(),
   config:config&&{...config,peer:config.peer?{host:config.peer.host,port:config.peer.port,pin:config.peer.pin,name:config.peer.name}:null,obs:{...config.obs,password:config.obs.password?'••••••••':''},vts:{...config.vts,token:undefined}},
   overlayUrl:identity?`http://127.0.0.1:5058/overlay/${identity.overlayToken}`:''}));
  // The role is fixed at install, and show/hide belongs to the Stream Deck; a save changes neither.
  ipc('control:save',value=>{requireLink();return transactions.run(async()=>{const next={...value,role:config.role,peer:config.peer,obs:{...value.obs,password:value.obs.password==='••••••••'?config.obs.password:value.obs.password},vts:{...value.vts,token:config.vts.token},reactive:{...value.reactive,visible:config.reactive.visible}};validateSave(next);config=next;updateSecrets();await saveProtected(settingsFile,config);log.info('app','Settings saved');}).then(async()=>{await bind.run();return status();});});
  ipc('control:export',async()=>{requireLink();const chosen=await dialog.showSaveDialog(window,{title:'Export pairing file — contains a connection credential',defaultPath:`${config.role==='canada'?'streaming':'gaming'}-pc-pairing.json`});if(chosen.canceled)return;const pin=createHash('sha256').update(new X509Certificate(identity.cert.cert).raw).digest('hex');await writeFile(chosen.filePath,JSON.stringify({host:config.ownIp,port:5056,pin,token:identity.networkToken,name:hostname},null,2),{mode:0o600});log.info('app','Pairing file exported');return 'Exported. Transfer securely, import on the other PC, then delete the transfer copy.';});
  ipc('control:import',async()=>{requireLink();const chosen=await dialog.showOpenDialog(window,{title:'Import the OTHER PC’s pairing file',properties:['openFile'],filters:[{name:'Pairing',extensions:['json']}]});if(chosen.canceled)return;const peer=parsePairingFile(await readFile(chosen.filePaths[0]));return transactions.run(async()=>{const first=!config.peer;validateConfig({...config,peer});config.peer=peer;peerName='';if(first)config.enabled=true;updateSecrets();await saveProtected(settingsFile,config);log.info('app',`Paired with ${pcLabel({hostname:peer.name,role:config.role==='canada'?'pantry':'canada',ip:peer.host})}`);return first;}).then(async first=>{await bind.run();return (first?'Paired. Remote controls are on.':'Paired')+(bind.error?' '+bind.error:'');});});
  ipc('control:login',()=>{requireLink();if(config.role!=='pantry')throw Error('Sign in to Fugi on the Gaming PC, where reactives are rendered');openFugiLogin();return 'Fugi sign-in window opened';});
  ipc('control:reactive-start',async()=>{requireLink();return dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.start',args:{}});});
  ipc('control:reactive-stop',async()=>{requireLink();rendering.cancel();return dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.stop',args:{}});});
  ipc('control:command',c=>{requireLink();return dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:c.target,action:c.action,args:c.args||{}});});
  // The Metrics page asks once a second while it is open, for the points after the last one it has.
  ipc('control:metrics',({since=0}={})=>metrics.snapshot(Number(since)||0));
  // The Logs page: entries changed since the last poll, and the debug logging preference.
  ipc('control:logs',({since=0,levels,limit}={})=>({entries:log.entries({since:Number(since)||0,levels:Array.isArray(levels)?levels:undefined,limit:Number(limit)||undefined}),debug:log.debug,debugSources:log.debugSources,sources:SOURCES,folder:logDir,writeError:log.writeError}));
  ipc('control:set-logging',async({debug,debugSources}={})=>{
   log.configure({debug,debugSources});const value={debug:log.debug,debugSources:log.debugSources};
   await mkdir(dir,{recursive:true});await writeFile(loggingFile,JSON.stringify(value));
   log.info('app',value.debug?`Debug logging on${value.debugSources?' for '+(value.debugSources.join(', ')||'no sources'):''}`:'Debug logging off');return value;
  });
  ipc('control:open-log-folder',async()=>{await mkdir(logDir,{recursive:true});await log.flush();const error=await shell.openPath(logDir);if(error)throw new Error(error);return logDir;});
  ipc('tracking:call',async(name,args)=>{if(name!=='status')log.info('tracking',`From the window: ${name}`+(name==='start'&&args?.destination?` to ${args.destination}`:''));const result=await host.ui('tracking',name,args);updateTray();return result;});

  tray=new Tray(trayIcon('warn'));trayLevel='warn';tray.on('double-click',createWindow);
  updateTray();setInterval(updateTray,2000);setInterval(()=>void refreshPeerName(),300000);
  nativeTheme.on('updated',()=>{if(window&&!window.isDestroyed())window.setBackgroundColor(windowBackground());});
  // Sign-in launches pass --background so the app starts in the tray.
  if(!process.argv.includes('--background'))createWindow();
 }).catch(async e=>{await dialog.showMessageBox({type:'error',title:`${APP_NAME} could not start`,message:e?.message||String(e)});await quit();});
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();void quit();}});
}
