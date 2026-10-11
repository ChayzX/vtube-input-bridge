import {app,BrowserWindow,Tray,Menu,ipcMain,dialog,safeStorage,nativeImage} from 'electron';
import {contextMenuTemplate} from './contextmenu.mjs';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,randomUUID,createHash,X509Certificate} from 'node:crypto';import selfsigned from 'selfsigned';
import {SerialQueue} from './serial.mjs';import {Retry} from './retry.mjs';import {checkDeadline} from './deadline.mjs';
import {defaults,upgradeConfig,validateConfig,validateSave,parsePairingFile} from './config.mjs';import {Dispatcher} from './commands.mjs';import {FrameStore} from './frames.mjs';import {createApi,createOverlay} from './server.mjs';import {requestPeer,forwardCommand} from './client.mjs';import {userError} from './errors.mjs';import {ReactiveRenderer,openFugiLogin} from './reactive.mjs';
import {PluginHost} from './plugins/host.mjs';import {TrackingSender,TrackingReceiver} from './plugins/tracking.mjs';import {createControlsPlugin} from './plugins/controls.mjs';import {createReactivesPlugin} from './plugins/reactives.mjs';

// One app per PC. Features are plugins (plugins/*.mjs): tracking, Stream Deck controls and reactives. The core here
// owns the window, tray, settings and the secure link between the two PCs. Tracking starts first and never depends on
// the link, so a companion failure cannot stop the input feed.
const APP_NAME='VTube Input Bridge';
const here=dirname(fileURLToPath(import.meta.url));const dir=join(app.getPath('appData'),'VTubeControl');app.setPath('userData',dir);
let config=null,identity=null,linkError='Starting',window,tray,quitting=false,shutdownPromise=null,servers=[],last={};
const frames=new FrameStore();const hex=()=>randomBytes(32).toString('hex');
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
const status=()=>({enabled:!!config?.enabled,role:config?.role,peer:config?.peer?.host||'Not paired',services:last,reactive:renderer.state,frameFresh:!!frames.get(),linkError,bindError:bind.error,plugins:host.status()});
async function run(c){
 if(!config?.enabled)throw userError('Stream Deck controls are turned off on this PC. Tick "Enable Stream Deck controls and reactives" in settings and save.','disabled');
 if(c.target==='peer'){if(!config.peer)throw userError('This PC is not paired with the other PC yet. Export and import the pairing files first.','not_paired');return forwardCommand(config.peer,c);}
 if(c.action==='bridge.status')return status();
 const deadline={expiresAt:c.expiresAt,assertActive:()=>{if(!config.enabled)throw userError("Stream Deck controls were turned off while this action was waiting.","disabled");}};checkDeadline(deadline);
 const service=c.action.split('.')[0];
 try{const result=await host.action(c.action,c.args,deadline);last[service]={ok:true,at:Date.now()};return result;}
 catch(e){last[service]={ok:false,at:Date.now()};throw e;}
}
const dispatcher=new Dispatcher(run);
async function closeServers(){for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}servers=[];}
async function startServers(){
 await closeServers();renderer.stop();frames.clear();last={};
 const connection=join(dir,'plugin-connection.json');await writeFile(connection,JSON.stringify({port:5057,token:identity.localToken}),{mode:0o600});
 if(!config.enabled)return;
 const overlayFrames={get:()=>config.reactive.visible?frames.get():null};
 const list=[{server:createApi({token:identity.localToken,dispatcher,status}),port:5057,host:'127.0.0.1'},
  {server:createApi({token:identity.networkToken,tls:identity.cert,source:config.peer.host,dispatcher,status,frames}),port:5056,host:config.ownIp},
  {server:createOverlay(overlayFrames,identity.overlayToken),port:5058,host:'127.0.0.1'}];
 try{for(const {server,port,host:address} of list){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,address,resolve);});servers.push(server);}}
 catch{await closeServers();throw new Error(`Could not open ${config.ownIp} or ports 5056–5058 on this PC. Retrying; if this lasts, check “This PC’s LAN IPv4” and that no other program uses those ports. Tracking is unaffected.`);}
}
// At sign-in the network may not have given this PC its address yet, so a failed bind is retried with backoff; it never
// turns controls off. Each later restart of the servers (save, pairing, tray) goes through here too.
const bind=new Retry(()=>transactions.run(async()=>{await startServers();autoStartRenderer();}),{onChange:()=>updateTray()});
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
const requireLink=()=>{if(linkError)throw new Error('Stream Deck controls and reactives are unavailable: '+linkError);};

function createWindow(){if(window&&!window.isDestroyed()){window.show();return;}
 window=new BrowserWindow({width:760,height:900,title:APP_NAME,webPreferences:{preload:join(here,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.on('context-menu',(_,params)=>{const items=contextMenuTemplate(params);if(items.length)Menu.buildFromTemplate(items).popup({window});});
 window.loadFile(join(here,'..','ui','index.html'));
 window.on('close',e=>{if(!quitting){e.preventDefault();window.hide();}});
}
function ipc(name,handler){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('Unauthorized UI');return handler(...args);});}
async function quit(){
 if(shutdownPromise)return shutdownPromise;
 quitting=true;
 shutdownPromise=(async()=>{bind.cancel();rendering.cancel();renderer.stop();await host.stopAll();await closeServers();app.quit();})();
 return shutdownPromise;
}

function trackingSummary(){
 const t=host.status().tracking||{};
 const state=t.role==='sender'?(t.connectionState||t.state):t.state;
 return t.role==='sender'?`Tracking: ${state||'Starting'}`+(t.running?` to ${t.destination}`:''):`Tracking: ${state||'Starting'}`;
}
let trayKey='';
function updateTray(){
 if(!tray)return;const t=host.status().tracking||{};const sender=t.role==='sender';
 // Rebuild only on change: replacing the menu while it is open would close it under the streamer's cursor.
 const key=JSON.stringify([trackingSummary(),sender,t.running,!!linkError,!!config?.enabled,bind.error]);if(key===trayKey)return;trayKey=key;
 tray.setToolTip(`${APP_NAME} — ${trackingSummary().replace('Tracking: ','')}`.slice(0,127));
 tray.setContextMenu(Menu.buildFromTemplate([
  {label:trackingSummary(),enabled:false},
  ...(sender?[{label:t.running?'Stop sending':'Start sending',click:()=>host.ui('tracking',t.running?'stop':'start',{}).catch(e=>dialog.showErrorBox('Tracking',e.message))}]:[]),
  {type:'separator'},
  {label:`Open ${APP_NAME}`,click:createWindow},
  {label:'Disable Stream Deck controls and reactives',enabled:!linkError&&!!config?.enabled,click:()=>transactions.run(async()=>{config.enabled=false;await saveProtected(settingsFile,config);}).then(()=>bind.run(),()=>dialog.showErrorBox('Could not save','Exit the app to stop controls immediately.'))},
  {label:`Exit ${APP_NAME}`,click:()=>{quit();}}
 ]));
}

if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',createWindow);app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{
  const role=await resolveRole();
  // 1. Tracking first: it needs nothing else from this app.
  host.add(role==='pantry'
   ?new TrackingSender({exe:join(here,'..','tracking','VTubeInputBridge.exe'),settingsFile:join(dir,'tracking.json')})
   :new TrackingReceiver({exe:join(here,'..','relay','vts_input_relay.exe'),configFile:join(dir,'relay-config.json'),tokenFile:join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeInputRelay','vts-token.txt'),statusFile:join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeInputRelay','status.json')}));
  await host.start('tracking');
  // 2. The secure link and the features that use it.
  try{await startLink(role);linkError=null;}catch(e){linkError=e?.message||String(e);}
  host.add(createControlsPlugin({getConfig:()=>config,linkError:()=>linkError,mediaExe:join(here,'..','media','SpotifyControl.exe'),
   saveVtsToken:token=>transactions.run(async()=>{config.vts.token=token;await saveProtected(settingsFile,config);})}));
  host.add(createReactivesPlugin({getConfig:()=>config,linkError:()=>linkError,renderer,frames,
   setVisible:(visible,deadline)=>transactions.runWithDeadline(deadline,async()=>{config.reactive.visible=visible;await saveProtected(settingsFile,config);return visible;}),
   clearPeerFrame:()=>requestPeer(config.peer,'DELETE','/frame'),stopped:()=>rendering.cancel()}));
  await host.start('controls');await host.start('reactives');if(!linkError)await bind.run();

  ipc('control:get',()=>({role,linkError,bindError:bind.error,plugins:host.status(),status:status(),
   config:config&&{...config,peer:config.peer?{host:config.peer.host,port:config.peer.port,pin:config.peer.pin}:null,obs:{...config.obs,password:config.obs.password?'••••••••':''},vts:{...config.vts,token:undefined}},
   overlayUrl:identity?`http://127.0.0.1:5058/overlay/${identity.overlayToken}`:''}));
  // The role is fixed at install, and show/hide belongs to the Stream Deck; a save changes neither.
  ipc('control:save',value=>{requireLink();return transactions.run(async()=>{const next={...value,role:config.role,peer:config.peer,obs:{...value.obs,password:value.obs.password==='••••••••'?config.obs.password:value.obs.password},vts:{...value.vts,token:config.vts.token},reactive:{...value.reactive,visible:config.reactive.visible}};validateSave(next);config=next;await saveProtected(settingsFile,config);}).then(async()=>{await bind.run();return status();});});
  ipc('control:export',async()=>{requireLink();const chosen=await dialog.showSaveDialog(window,{title:'Export pairing file — contains a connection credential',defaultPath:`${config.role}-pairing.json`});if(chosen.canceled)return;const pin=createHash('sha256').update(new X509Certificate(identity.cert.cert).raw).digest('hex');await writeFile(chosen.filePath,JSON.stringify({host:config.ownIp,port:5056,pin,token:identity.networkToken},null,2),{mode:0o600});return 'Exported. Transfer securely, import on the other PC, then delete the transfer copy.';});
  ipc('control:import',async()=>{requireLink();const chosen=await dialog.showOpenDialog(window,{title:'Import the OTHER PC’s pairing file',properties:['openFile'],filters:[{name:'Pairing',extensions:['json']}]});if(chosen.canceled)return;const peer=parsePairingFile(await readFile(chosen.filePaths[0]));return transactions.run(async()=>{const first=!config.peer;validateConfig({...config,peer});config.peer=peer;if(first)config.enabled=true;await saveProtected(settingsFile,config);return first;}).then(async first=>{await bind.run();return (first?'Paired. Stream Deck controls are on.':'Paired')+(bind.error?' '+bind.error:'');});});
  ipc('control:login',()=>{requireLink();if(config.role!=='pantry')throw Error('Log in on Pantry');openFugiLogin();return 'Fugi login window opened';});
  ipc('control:reactive-start',async()=>{requireLink();return dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.start',args:{}});});
  ipc('control:reactive-stop',async()=>{requireLink();rendering.cancel();return dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.stop',args:{}});});
  ipc('control:command',c=>{requireLink();return dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:c.target,action:c.action,args:c.args||{}});});
  ipc('tracking:call',async(name,args)=>{const result=await host.ui('tracking',name,args);updateTray();return result;});

  tray=new Tray(nativeImage.createFromPath(join(here,'..','ui','icon.ico')));tray.on('double-click',createWindow);
  updateTray();setInterval(updateTray,2000);
  // Sign-in launches pass --background so the app starts in the tray.
  if(!process.argv.includes('--background'))createWindow();
 }).catch(async e=>{await dialog.showMessageBox({type:'error',title:`${APP_NAME} could not start`,message:e?.message||String(e)});await quit();});
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();void quit();}});
}
