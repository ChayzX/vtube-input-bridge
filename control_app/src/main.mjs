import {app,BrowserWindow,Tray,Menu,ipcMain,dialog,safeStorage,nativeImage} from 'electron';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,randomUUID,createHash,X509Certificate} from 'node:crypto';import selfsigned from 'selfsigned';
import {SerialQueue} from './serial.mjs';import {checkDeadline} from './deadline.mjs';
import {defaults,validateConfig,validatePair} from './config.mjs';import {Dispatcher} from './commands.mjs';import {FrameStore} from './frames.mjs';import {createApi,createOverlay} from './server.mjs';import {requestPeer} from './client.mjs';import {obsAction} from './obs.mjs';import {vtsAction} from './vts.mjs';import {mediaAction} from './media.mjs';import {ReactiveRenderer,openFugiLogin} from './reactive.mjs';
const here=dirname(fileURLToPath(import.meta.url));const dir=join(app.getPath('appData'),'VTubeControl');app.setPath('userData',dir);
let config,identity,window,tray,quitting=false,servers=[],last={};const frames=new FrameStore();const hex=()=>randomBytes(32).toString('hex');
const renderer=new ReactiveRenderer(async png=>{if(!config.enabled||!config.peer)throw Error('Disabled');const r=await requestPeer(config.peer,'PUT','/frame',png);if(!r.ok)throw Error('Upload rejected');});
const transactions=new SerialQueue();
const settingsFile=join(dir,'settings.enc');const identityFile=join(dir,'identity.enc');
async function loadProtected(path,fallback){try{return JSON.parse(safeStorage.decryptString(await readFile(path)));}catch(e){if(e.code==='ENOENT')return fallback();throw new Error('Stored settings could not be decrypted; restore the backup or reset this companion’s configuration');}}
async function saveProtected(path,value){if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable');await mkdir(dir,{recursive:true});const temp=path+'.new';await writeFile(temp,safeStorage.encryptString(JSON.stringify(value)),{mode:0o600});try{await copyFile(path,path+'.previous');}catch(e){if(e.code!=='ENOENT')throw e;}await rename(temp,path);}
const status=()=>({enabled:config.enabled,role:config.role,peer:config.peer?.host||'Not paired',services:last,reactive:renderer.state,frameFresh:!!frames.get()});
async function run(c){
 if(!config.enabled)throw Error('Control companion is disabled');
 if(c.target==='peer'){const result=await requestPeer(config.peer,'POST','/command',{...c,target:'local'});if(!result.ok){const e=new Error(result.message);e.code=result.code;e.publicMessage=result.message;throw e;}return result.data;}
 if(c.action==='bridge.status')return status();
 const deadline={expiresAt:c.expiresAt,assertActive:()=>{if(!config.enabled)throw Error("Controls disabled");}};checkDeadline(deadline);let result;
 try{
  if(c.action.startsWith('obs.')&&config.obs.enabled)result=await obsAction({...config.obs,...deadline},c.action,c.args);
  else if(c.action.startsWith('spotify.')&&config.spotify.enabled)result=await mediaAction({exe:join(here,'..','media','SpotifyControl.exe'),...deadline},c.action);
  else if(c.action.startsWith('vts.')&&config.vts.enabled)result=await vtsAction({...config.vts,...deadline,saveToken:token=>transactions.run(async()=>{config.vts.token=token;await saveProtected(settingsFile,config);})},c.action,c.args);
  else if(c.action==='reactive.status')result={state:renderer.state,frameFresh:!!frames.get(),visible:config.reactive.visible};
  else if(c.action==='reactive.show'||c.action==='reactive.hide'){await transactions.runWithDeadline(deadline,async()=>{config.reactive.visible=c.action==='reactive.show';await saveProtected(settingsFile,config);});result={visible:config.reactive.visible};}
  else if(c.action==='reactive.start'&&config.role==='pantry'&&config.reactive.enabled){await renderer.start(config.reactive.url);result={state:renderer.state};}
  else if(c.action==='reactive.stop'&&config.role==='pantry'){renderer.stop();await requestPeer(config.peer,'DELETE','/frame').catch(()=>{});result={state:'Stopped'};}
  else throw Error('Action unsupported or disabled');
  last[c.action.split('.')[0]]={ok:true,at:Date.now()};return result;
 }catch(e){last[c.action.split('.')[0]]={ok:false,at:Date.now()};throw e;}
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
 try{for(const {server,port,host} of list){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});servers.push(server);}}
 catch{await closeServers();config.enabled=false;await saveProtected(settingsFile,config);throw new Error('Could not bind this PC’s IP or ports 5056–5058. Controls disabled; tracking is unaffected.');}
}
function createWindow(){if(window&&!window.isDestroyed()){window.show();return;}
 window=new BrowserWindow({width:750,height:850,title:'VTube Control',webPreferences:{preload:join(here,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());window.loadFile(join(here,'..','ui','index.html'));
 window.on('close',e=>{if(!quitting){e.preventDefault();window.hide();}});
}
function ipc(name,handler){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('Unauthorized UI');return handler(...args);});}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',createWindow);app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{
  if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure credential storage unavailable');
  config=validateConfig(await loadProtected(settingsFile,()=>defaults(process.argv.includes('--canada')?'canada':'pantry')));
  identity=await loadProtected(identityFile,async()=>({localToken:hex(),networkToken:hex(),overlayToken:hex(),cert:await selfsigned.generate([{name:'commonName',value:'VTube Control'}],{keySize:2048,days:3650,algorithm:'sha256'})}));
  await saveProtected(identityFile,identity);await startServers();
  ipc('control:get',()=>({config:{...config,peer:config.peer?{host:config.peer.host,port:config.peer.port,pin:config.peer.pin}:null,obs:{...config.obs,password:config.obs.password?'••••••••':''},vts:{...config.vts,token:undefined}},status:status(),overlayUrl:`http://127.0.0.1:5058/overlay/${identity.overlayToken}`}));
  ipc('control:save',value=>transactions.run(async()=>{const next={...value,peer:config.peer,obs:{...value.obs,password:value.obs.password==='••••••••'?config.obs.password:value.obs.password},vts:{...value.vts,token:config.vts.token}};validateConfig(next);config=next;await saveProtected(settingsFile,config);await startServers();return status();}));
  ipc('control:export',async()=>{const chosen=await dialog.showSaveDialog(window,{title:'Export pairing file — contains a connection credential',defaultPath:`${config.role}-pairing.json`});if(chosen.canceled)return;const pin=createHash('sha256').update(new X509Certificate(identity.cert.cert).raw).digest('hex');await writeFile(chosen.filePath,JSON.stringify({host:config.ownIp,port:5056,pin,token:identity.networkToken},null,2),{mode:0o600});return 'Exported. Transfer securely, import on the other PC, then delete the transfer copy.';});
  ipc('control:import',async()=>{const chosen=await dialog.showOpenDialog(window,{title:'Import the OTHER PC’s pairing file',properties:['openFile'],filters:[{name:'Pairing',extensions:['json']}]});if(chosen.canceled)return;const bytes=await readFile(chosen.filePaths[0]);if(bytes.length>8192)throw Error('Pairing file too large');const peer=validatePair(JSON.parse(bytes));return transactions.run(async()=>{validateConfig({...config,peer});config.peer=peer;await saveProtected(settingsFile,config);await startServers();return 'Paired';});});
  ipc('control:login',()=>{if(config.role!=='pantry')throw Error('Log in on Pantry');openFugiLogin();return 'Fugi login window opened';});
  ipc('control:reactive-start',async()=>dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.start',args:{}}));
  ipc('control:reactive-stop',async()=>dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:'local',action:'reactive.stop',args:{}}));
  ipc('control:command',c=>dispatcher.execute({id:randomUUID(),expiresAt:Date.now()+10000,target:c.target,action:c.action,args:c.args||{}}));
  tray=new Tray(nativeImage.createFromPath(join(here,'..','ui','icon.ico')));tray.setToolTip('VTube Control');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open VTube Control',click:createWindow},{label:'Disable controls',click:()=>transactions.run(async()=>{config.enabled=false;await saveProtected(settingsFile,config);await startServers();}).catch(()=>dialog.showErrorBox('Could not save','Exit VTube Control to stop controls immediately.'))},{label:'Exit VTube Control',click:()=>{quitting=true;renderer.stop();app.quit();}}]));tray.on('double-click',createWindow);createWindow();
 }).catch(async()=>{await dialog.showMessageBox({type:'error',title:'VTube Control could not start',message:'Check companion configuration, credential storage and ports. The tracking bridge was not changed.'});quitting=true;app.quit();});
 app.on('before-quit',()=>{quitting=true;renderer.stop();for(const s of servers)s.close();});
}
