import {app,BrowserWindow,Tray,Menu,ipcMain,dialog,safeStorage,nativeImage,nativeTheme,shell} from 'electron';
import {PairingHost,createPairingServer,joinPairing,readCode,showCode,PAIRING_PORT} from './pairing.mjs';import {Discovery,addressToward,onSubnet} from './discovery.mjs';
import * as updates from './updates.mjs';import {Notifier} from './notify.mjs';import {createReadStream,existsSync,readFileSync} from 'node:fs';import {stat} from 'node:fs/promises';
import {contextMenuTemplate} from './contextmenu.mjs';import {trayHealth} from './health.mjs';import {trayIconPng,TRAY_SIZES} from './trayicon.mjs';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,randomUUID,createHash,X509Certificate} from 'node:crypto';import selfsigned from 'selfsigned';
import {SerialQueue} from './serial.mjs';import {Retry} from './retry.mjs';import {checkDeadline} from './deadline.mjs';
import {defaults,upgradeConfig,validateConfig,validateSave,parsePairingFile,privateIp,validatePair} from './config.mjs';import {Dispatcher} from './commands.mjs';import {FrameStore} from './frames.mjs';import {createApi,createOverlay} from './server.mjs';import {requestPeer,forwardCommand,observePeer,pushUpdate} from './client.mjs';import {Metrics,outcomeKind} from './metrics.mjs';import {userError,unreachable} from './errors.mjs';import {ReactiveRenderer,openFugiLogin} from './reactive.mjs';
import {hostname as osHostname} from 'node:os';import {cleanHostname,pcLabel,peerHostname,roleLabel} from './names.mjs';import {Logger,SOURCES} from './logger.mjs';
import {PluginHost} from './plugins/host.mjs';import {TrackingSender,TrackingReceiver} from './plugins/tracking.mjs';import {createControlsPlugin} from './plugins/controls.mjs';import {createReactivesPlugin} from './plugins/reactives.mjs';

// One app per PC. Features are plugins (plugins/*.mjs): tracking, Stream Deck controls and reactives. The core here
// owns the window, tray, settings and the secure link between the two PCs. Tracking starts first and never depends on
// the link, so a companion failure cannot stop the input feed.
const APP_NAME='VTube Input Bridge';
// The version this app was built as (package.json), the same in development and in the packaged app.
const VERSION=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const here=dirname(fileURLToPath(import.meta.url));const dir=join(app.getPath('appData'),'VTubeControl');app.setPath('userData',dir);
let config=null,identity=null,linkError='Starting',window,tray,quitting=false,shutdownPromise=null,last={};
// When Stream Deck keys and the VTube Studio overlay were last seen working, for the setup checklist.
const seenAt={deck:0,overlay:0};
let discovery=null,ownPin='';
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
  // Not there any more: it may have a new address, so look for it (at most every 10 seconds).
  if(!ok&&error&&unreachable.test(`${error.code||''} ${error.message||''}`))void locatePeer();
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
 if(status===200)seenAt.deck=Date.now();
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
 noteChanges(t);watchHealth(t);
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
// This PC's address as the other PC sees it: found on the network each time, never typed (see discovery.mjs).
const ownIp=()=>addressToward(config?.peer?.host);
const status=()=>({hostname,version:VERSION,ownIp:ownIp(),enabled:!!config?.enabled,role:config?.role,peer:config?.peer?.host||'Not paired',services:last,reactive:renderer.state,frameFresh:!!frames.get(),linkError,bindError:bindError(),plugins:host.status()});
async function run(c){
 if(!config?.enabled)throw userError('Remote controls are paused on this PC. Turn on "Remote controls" under PC link and save.','disabled');
 if(c.target==='peer'){if(!config.peer)throw userError('This PC is not paired with the other PC yet. Pair them under PC link first.','not_paired');let result;
  // When the other PC is not where it was (the router gave it a new address), find it and send once more. Only a
  // request that never reached it is sent again, so nothing can happen twice.
  try{try{result=await forwardCommand(config.peer,c);}catch(e){if(!e?.unreachable||!await locatePeer())throw e;result=await forwardCommand(config.peer,c);}}
  catch(e){log.warn('peer',`${c.action} on the other PC failed: ${e?.publicMessage||e?.message||e}`);throw e;}
  if(c.action==='bridge.status')notePeer(result);return result;}
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
// Asked once the link is up and then every 15 seconds: the tray names the other PC with the window closed, and a PC that
// stopped answering is noticed (and looked for at a new address) before a key press needs it.
async function refreshPeerName(){
 if(linkError||!config?.enabled||!config.peer||bindError())return;
 try{notePeer(await forwardCommand(config.peer,{id:randomUUID(),expiresAt:Date.now()+5000,target:'local',action:'bridge.status',args:{}}));}catch{}
}
let localServers=[],peerServer=null;
async function closeServer(server){if(!server)return;server.closeAllConnections?.();await new Promise(r=>server.close(r));}
async function closeServers(){await closeServer(peerServer);peerServer=null;for(const server of localServers)await closeServer(server);localServers=[];}
const listen=(server,port,address)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,address,()=>{server.off('error',reject);resolve();});});
// The Stream Deck API (5057) and the overlay (5058) are loopback only, so they never depend on the network: a late,
// changed or missing address cannot stop local keys (they answer "paused" or "not paired" when that is the reason).
async function startLocal(){
 if(localServers.length)return;
 const connection=join(dir,'plugin-connection.json');await writeFile(connection,JSON.stringify({port:5057,token:identity.localToken}),{mode:0o600});
 const overlayFrames={get:()=>config.reactive.visible?frames.get():null};
 const list=[[createApi({token:identity.localToken,dispatcher,status,onRequest:localRequest}),5057],[createOverlay(overlayFrames,identity.overlayToken,served=>{metrics.count(served?'overlay.frames':'overlay.empty');if(served)seenAt.overlay=Date.now();}),5058]];
 try{for(const [server,port] of list){await listen(server,port,'127.0.0.1');localServers.push(server);}}
 catch{for(const server of localServers)await closeServer(server);localServers=[];throw new Error('Could not open ports 5057 and 5058 on this PC; another program may be using them. Retrying. Tracking is unaffected.');}
}
// The PC link (5056) listens on every adapter, so it keeps working when the router hands either PC a new address. Only
// private addresses are let in, every request needs the pairing token over pinned TLS, and the installer's firewall
// rule allows it on private networks only.
async function startPeer(){
 await closeServer(peerServer);peerServer=null;renderer.stop();frames.clear();last={};
 if(!config.peer)return;
 const server=createApi({token:identity.networkToken,tls:identity.cert,source:privateIp,dispatcher,status,frames,onRequest:peerRequest,onAuthenticated:peerSeenAt,update:receiveUpdate});
 try{await listen(server,5056,'0.0.0.0');peerServer=server;}
 catch{throw new Error('Could not open port 5056 for the PC link; another program may be using it. Retrying. Tracking is unaffected.');}
}
const bindError=()=>localBind.error||bind.error;
const localBind=new Retry(()=>startLocal(),{onChange:error=>{updateTray();if(error!==seen.local){if(error)log.warn('app',error);else log.info('app','Stream Deck connection open on this PC');seen.local=error;}}});
// At sign-in the network may not be up yet, so a failed bind is retried with backoff; it never turns controls off. Each
// later restart of the PC link (save, pairing, tray) goes through here too.
const bind=new Retry(()=>transactions.run(async()=>{await startPeer();autoStartRenderer();}),{onChange:error=>{updateTray();
 if(error!==seen.bind){if(error)log.warn('app',error);else if(config?.peer)log.info('app','PC link listening on port 5056');seen.bind=error;}
 if(!error)void refreshPeerName();}});

// The other PC's address follows it around the network. It is updated when the other PC connects from a new address
// (its token proves who it is), or when this PC cannot reach it and finds it with discovery.
const opposite=()=>config?.role==='canada'?'pantry':'canada';
function peerSeenAt(address){if(config?.peer&&address&&address!==config.peer.host)void movePeer(address,'it connected from there');}
async function movePeer(address,why){
 const moved=await transactions.run(async()=>{
  if(!config?.peer||config.peer.host===address||!privateIp(address))return false;
  const before=config.peer.host;config.peer={...config.peer,host:address};await saveProtected(settingsFile,config);
  log.info('peer',`The other PC's address changed from ${before} to ${address} (${why})`);return true;
 });
 if(moved){followPeer();updateTray();}
 return moved;
}
// Tracking follows the other PC: the Gaming PC sends to the Streaming PC's current address, and the Streaming PC's
// relay listens for the Gaming PC's.
function followPeer(){
 const tracking=host.get('tracking');const to=config?.peer?.host;if(!tracking||!to)return;
 if(config.role==='pantry'){const t=tracking.status();if(tracking.wantSending&&t.destination!==to)host.ui('tracking','start',{destination:to}).then(()=>log.info('tracking',`Sending to the Streaming PC at ${to}`),e=>log.warn('tracking',`Could not send to ${to}: ${e.message}`));}
 else void tracking.sourceChanged?.().catch(()=>{});
}
let locating=null,lastLocate=0;
function locatePeer(){
 if(!config?.peer||!discovery)return Promise.resolve(false);
 if(locating)return locating;if(Date.now()-lastLocate<10000)return Promise.resolve(false);lastLocate=Date.now();
 return locating=(async()=>{
  const found=(await discovery.find({want:'peer',pin:config.peer.pin})).filter(f=>f.role===opposite());
  if(!found.length){log.info('peer','Looked for the other PC on the network; it did not answer');return false;}
  if(found.some(f=>f.address===config.peer.host))return false;
  return movePeer((found.find(f=>onSubnet(f.address))||found[0]).address,'found on the network');
 })().catch(()=>false).finally(()=>{locating=null;});
}

// Loads settings and identity and opens the secure link. A failure here disables only controls and reactives.
async function startLink(role){
 if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure credential storage unavailable');
 config=validateConfig(upgradeConfig(await loadProtected(settingsFile,()=>defaults(role)),role));
 identity=await loadProtected(identityFile,async()=>({localToken:hex(),networkToken:hex(),overlayToken:hex(),cert:await selfsigned.generate([{name:'commonName',value:'VTube Control'}],{keySize:2048,days:3650,algorithm:'sha256'})}));
 await saveProtected(identityFile,identity);
 ownPin=createHash('sha256').update(new X509Certificate(identity.cert.cert).raw).digest('hex');
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

// Pairing with a code (pairing.mjs). Either PC can show the code; the other finds it on the network and types it.
let pairing=null,pairingServer=null,pairingTimer=null,discoveryTimer=null;
async function stopPairing(){clearTimeout(pairingTimer);pairingTimer=null;const server=pairingServer;pairingServer=null;await closeServer(server);}
const myDetails=()=>({role:config.role,port:5056,pin:ownPin,token:identity.networkToken,name:hostname,version:VERSION});
const peerLabel=peer=>pcLabel({hostname:peer.name,role:opposite(),ip:peer.host});
// Saves the other PC's details from either pairing route, turns remote controls on, and restarts the PC link.
async function savePairing(peer){
 const value=validatePair({host:peer.host,port:5056,pin:peer.pin,token:peer.token,name:peer.name});
 await transactions.run(async()=>{validateConfig({...config,peer:value});config.peer=value;config.enabled=true;peerName=value.name||'';updateSecrets();await saveProtected(settingsFile,config);log.info('app',`Paired with ${peerLabel(value)}`);});
 await bind.run();followPeer();updateTray();
 return value;
}

// Updates (updates.mjs). The installer is the update; the PC that updates first sends it to the other PC, so both run
// the same version.
const localData=join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeControl');
const updateDir=join(localData,'updates');
const update={checking:false,busy:'',available:null,ready:null,error:'',checkedAt:0};
const updateView=()=>({current:VERSION,checking:update.checking,busy:update.busy,available:update.available&&{version:update.available.version,page:update.available.page},ready:update.ready&&{version:update.ready.version},error:update.error,checkedAt:update.checkedAt,auto:!!config?.updates?.auto,fromPeer:!!config?.updates?.fromPeer});
async function checkUpdates(manual=false){
 if(update.checking)return updateView();update.checking=true;
 try{
  const release=await updates.latestRelease();update.checkedAt=Date.now();update.error='';
  if(release&&updates.isNewer(release.version,VERSION)){
   if(update.available?.version!==release.version){log.info('app',`Version ${release.version} is available`);notifier.notify({title:'Update available',body:`VTube Input Bridge ${release.version} is ready. Open the app to update both PCs.`});}
   update.available=release;
  }else{update.available=null;if(manual&&!release)update.error='No published release was found. While the project’s releases are private, download the installer yourself and choose Install from file.';}
 }catch(e){update.error=e.message;if(manual)log.warn('app','Checking for updates failed: '+e.message);}
 finally{update.checking=false;}
 return updateView();
}
// Installs the ready installer: first on the other PC (when asked and paired), then on this PC if it is newer here.
async function installUpdate({both=true}={}){
 if(update.busy)throw new Error('An update is already in progress.');
 try{
  if(!update.ready&&update.available){update.busy='Downloading';const path=await updates.download(update.available.url,updateDir);update.ready={path,version:await updates.installerVersion(path)};}
  if(!update.ready)throw new Error('There is no update to install. Check for updates, or choose an installer file.');
  const {path,version}=update.ready;const messages=[];
  if(both&&config?.peer){
   update.busy='Sending to the other PC';log.info('app',`Sending version ${version} to the other PC`);
   const size=(await stat(path)).size;const sha256=await updates.fileSha256(path);
   let answer;try{answer=await pushUpdate(config.peer,{stream:createReadStream(path),size,sha256,version});}catch(e){throw new Error('Could not send the update to the other PC: '+(e?.message||e)+'. Nothing was installed.');}
   if(answer?.ok){messages.push(`The other PC is installing ${version} and will restart by itself.`);log.info('app',`The other PC accepted version ${version}`);}
   else if(answer?.code==='not_newer')messages.push('The other PC already runs this version.');
   else throw new Error('The other PC did not take the update: '+(answer?.message||answer?.code||'no reason given')+' Nothing was installed.');
  }
  if(updates.isNewer(version,VERSION)){
   update.busy='Installing';log.info('app',`Installing version ${version} on this PC; the app restarts by itself`);
   updates.runInstaller(path);setTimeout(()=>void quit(),1500);messages.push(`This PC is installing ${version} and will restart by itself.`);
  }
  return messages.join(' ')||'Nothing to install on this PC.';
 }finally{if(update.busy!=='Installing')update.busy='';}
}
// An installer pushed by the other PC (PUT /update on the PC link).
async function receiveUpdate(req){
 if(!config?.updates?.fromPeer)return {ok:false,code:'refused',message:'This PC does not accept updates from the other PC. Turn on “Accept updates from the other PC” there, or run the installer on it.'};
 if(update.busy)return {ok:false,code:'busy',message:'This PC is already updating.'};
 try{
  update.busy='Receiving';const received=await updates.receive(req,{dir:updateDir,current:VERSION});
  update.busy='Installing';log.info('app',`The other PC sent version ${received.version}; installing it now. The app restarts by itself.`);
  setTimeout(()=>{try{updates.runInstaller(received.path);}catch(e){log.error('app','Could not start the update: '+e.message);update.busy='';return;}void quit();},1500);
  return {ok:true,version:received.version};
 }catch(e){update.busy='';log.warn('app','An update from the other PC was refused: '+e.message);return {ok:false,code:e.code||'invalid_request',message:e.message};}
}

// Notifications while the window is closed (notify.mjs). Problems only count once things had worked in this session,
// so a PC that is simply not streaming yet stays quiet.
const notifier=new Notifier({show:(title,content)=>tray?.displayBalloon({title,content,icon:trayIcon(trayLevel||'ok')}),enabled:()=>config?.notify?.enabled!==false});
let worked={tracking:false,peer:false};
function watchHealth(t){
 const trackingOk=t.role==='sender'?!!t.running&&!!t.receiverConnected:t.state==='Receiving input';
 if(trackingOk)worked.tracking=true;
 notifier.watch('tracking',worked.tracking&&!trackingOk,{after:15000,
  message:{title:'Tracking stopped',body:t.role==='sender'?'The Streaming PC stopped confirming tracking. Open VTube Input Bridge to see why.':'No input from the Gaming PC for 15 seconds. Open VTube Input Bridge to see why.'},
  fixed:{title:'Tracking is back',body:'Input is flowing again.'}});
 if(peerAnswering===true)worked.peer=true;
 notifier.watch('peer',!!config?.peer&&worked.peer&&peerAnswering===false,{after:30000,
  message:{title:'The other PC is not answering',body:'Stream Deck keys for the other PC and reactives will fail until it is back. Check that VTube Input Bridge is running there.'},
  fixed:{title:'The other PC is back',body:'Stream Deck keys reach it again.'}});
}

// The window paints the theme's background before the page loads (no white flash) and has no menu bar.
const windowBackground=()=>nativeTheme.shouldUseDarkColors?'#202020':'#f3f3f3';
// For the setup checklist on Home.
function setupState(){
 const plugin=join(app.getPath('appData'),'Elgato','StreamDeck','Plugins','com.chayzx.vtubecontrol.sdPlugin');
 return {paired:!!config?.peer,vtsAllowed:!!config?.vts?.token,streamDeckPlugin:config?.role==='pantry'&&existsSync(plugin),deckSeen:seenAt.deck>0,overlaySeen:seenAt.overlay>0,fugiUrl:!!config?.reactive?.url};
}
let toldAboutTray=false;
function createWindow(){if(window&&!window.isDestroyed()){window.show();window.focus();return;}
 window=new BrowserWindow({width:1040,height:720,minWidth:760,minHeight:560,title:APP_NAME,icon:join(here,'..','ui','icon.ico'),show:false,backgroundColor:windowBackground(),autoHideMenuBar:true,
  webPreferences:{preload:join(here,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 window.removeMenu();window.once('ready-to-show',()=>window.show());
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.on('context-menu',(_,params)=>{const items=contextMenuTemplate(params);if(items.length)Menu.buildFromTemplate(items).popup({window});});
 window.webContents.on('render-process-gone',(_,details)=>log.error('app',`The window's renderer stopped (${details.reason}); reopen the window from the tray`));
 window.on('unresponsive',()=>log.warn('app','The window is not responding'));
 window.loadFile(join(here,'..','ui','index.html'));
 window.on('close',e=>{if(!quitting){e.preventDefault();window.hide();
  // Once per run: closing the window keeps the app (and tracking) running in the tray.
  if(!toldAboutTray){toldAboutTray=true;notifier.notify({title:`${APP_NAME} is still running`,body:'Tracking and Stream Deck keys keep working. Open or exit it from the tray icon.'});}}});
}
// A request from the window that fails is logged as well as shown there.
function ipc(name,handler){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('Unauthorized UI');try{return await handler(...args);}catch(e){log.warn('app',`${name.replace(/^\w+:/,'')}: ${e?.message||e}`);throw e;}});}
async function quit(){
 if(shutdownPromise)return shutdownPromise;
 quitting=true;
 shutdownPromise=(async()=>{log.info('app','Exiting');bind.cancel();localBind.cancel();clearInterval(discoveryTimer);discovery?.stop();await stopPairing().catch(()=>{});rendering.cancel();renderer.stop();await host.stopAll();await closeServers();await log.flush();app.quit();})();
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
 const health=trayHealth({tracking:t,linkError,bindError:bindError(),config,services:last,self,peer:config?.peer?currentPeerName():''});
 if(health.level!==trayLevel){trayLevel=health.level;tray.setImage(trayIcon(health.level));}
 // Rebuild only on change: replacing the menu while it is open would close it under the streamer's cursor.
const key=JSON.stringify([self,health.line,health.tooltip,trackingSummary(),sender,t.running,!!linkError,!!config?.enabled,bindError()]);if(key===trayKey)return;trayKey=key;
 tray.setToolTip(health.tooltip);
 tray.setContextMenu(Menu.buildFromTemplate([
  {label:self,enabled:false},
  {label:health.line,enabled:false},
  {label:trackingSummary(),enabled:false},
  ...(sender?[{label:t.running?'Stop sending':'Start sending',click:()=>host.ui('tracking',t.running?'stop':'start',{}).catch(e=>dialog.showErrorBox('Tracking',e.message))}]:[]),
  {type:'separator'},
  {label:`Open ${APP_NAME}`,click:createWindow},
  config?.enabled===false
   ?{label:'Resume remote controls',enabled:!linkError,click:()=>transactions.run(async()=>{config.enabled=true;await saveProtected(settingsFile,config);}).then(()=>{log.info('app','Remote controls resumed from the tray');updateTray();},e=>dialog.showErrorBox('Could not save',e.message))}
   :{label:'Pause remote controls',enabled:!linkError&&!!config,click:()=>transactions.run(async()=>{config.enabled=false;await saveProtected(settingsFile,config);}).then(()=>{log.info('app','Remote controls paused from the tray');updateTray();},()=>dialog.showErrorBox('Could not save','Exit the app to stop controls immediately.'))},
  {label:`Exit ${APP_NAME}`,click:()=>{quit();}}
 ]));
}

Menu.setApplicationMenu(null);
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',createWindow);app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{
  const role=await resolveRole();ownRole=role;
  try{log.configure(JSON.parse((await readFile(loggingFile,'utf8')).replace(/^\uFEFF/,'')));}catch{}
  log.info('app',`Starting ${APP_NAME} ${VERSION} as the ${roleLabel(role)} on ${hostname||'this PC'}`);
  // 1. Tracking first: it needs nothing else from this app.
  host.add(role==='pantry'
   ?new TrackingSender({exe:join(here,'..','tracking','VTubeInputBridge.exe'),settingsFile:join(dir,'tracking.json')})
   :new TrackingReceiver({exe:join(here,'..','relay','vts_input_relay.exe'),configFile:join(dir,'relay-config.json'),pairedSource:()=>config?.peer?.host,tokenFile:join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeInputRelay','vts-token.txt'),statusFile:join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'VTubeInputRelay','status.json')}));
  await host.start('tracking');setInterval(sampleMetrics,1000);
  // 2. The secure link and the features that use it.
  try{await startLink(role);linkError=null;updateSecrets();}catch(e){linkError=e?.message||String(e);log.error('app','The PC link could not start: '+linkError);}
  host.add(createControlsPlugin({getConfig:()=>config,linkError:()=>linkError,mediaExe:join(here,'..','media','SpotifyControl.exe'),
   saveVtsToken:token=>transactions.run(async()=>{config.vts.token=token;updateSecrets();await saveProtected(settingsFile,config);log.info('vts','VTube Studio allowed VTube Input Bridge; its token was saved');})}));
  host.add(createReactivesPlugin({getConfig:()=>config,linkError:()=>linkError,renderer,frames,
   setVisible:(visible,deadline)=>transactions.runWithDeadline(deadline,async()=>{config.reactive.visible=visible;await saveProtected(settingsFile,config);return visible;}),
   clearPeerFrame:()=>requestPeer(config.peer,'DELETE','/frame'),stopped:()=>rendering.cancel()}));
  await host.start('controls');await host.start('reactives');
  if(!linkError){
   await localBind.run();await bind.run();followPeer();
   discovery=new Discovery({me:()=>config&&{role:config.role,name:hostname,version:VERSION,pin:ownPin,pairing:!!pairing?.open},onError:e=>log.warn('peer',e)});
   // Discovery is a convenience: if UDP 5059 is taken it is retried, and everything else works without it.
   await discovery.start();discoveryTimer=setInterval(()=>{if(discovery.error)void discovery.start();},30000);
   if(config.updates.auto){setTimeout(()=>void checkUpdates(),60000);setInterval(()=>{if(config?.updates?.auto)void checkUpdates();},6*3600000);}
  }

  ipc('control:get',()=>({role,hostname,peerName:config?.peer?currentPeerName():'',version:VERSION,linkError,bindError:bindError(),plugins:host.status(),status:status(),
   setup:setupState(),update:updateView(),
   config:config&&{...config,ownIp:ownIp(),peer:config.peer?{host:config.peer.host,port:config.peer.port,pin:config.peer.pin,name:config.peer.name}:null,obs:{...config.obs,password:config.obs.password?'••••••••':''},vts:{...config.vts,token:undefined}},
   overlayUrl:identity?`http://127.0.0.1:5058/overlay/${identity.overlayToken}`:''}));
  // The role is fixed at install, and show/hide belongs to the Stream Deck; a save changes neither.
  ipc('control:save',value=>{requireLink();return transactions.run(async()=>{const next={...value,role:config.role,peer:config.peer,ownIp:'',obs:{...value.obs,password:value.obs.password==='••••••••'?config.obs.password:value.obs.password},vts:{...value.vts,token:config.vts.token},reactive:{...value.reactive,visible:config.reactive.visible}};validateSave(next);config=next;updateSecrets();await saveProtected(settingsFile,config);log.info('app','Settings saved');}).then(async()=>{await bind.run();return status();});});
  ipc('control:export',async()=>{requireLink();const chosen=await dialog.showSaveDialog(window,{title:'Export pairing file — contains a connection credential',defaultPath:`${config.role==='canada'?'streaming':'gaming'}-pc-pairing.json`});if(chosen.canceled)return;const pin=createHash('sha256').update(new X509Certificate(identity.cert.cert).raw).digest('hex');await writeFile(chosen.filePath,JSON.stringify({host:ownIp(),port:5056,pin,token:identity.networkToken,name:hostname},null,2),{mode:0o600});log.info('app','Pairing file exported');return 'Exported. Transfer securely, import on the other PC, then delete the transfer copy.';});
  ipc('control:import',async()=>{requireLink();const chosen=await dialog.showOpenDialog(window,{title:'Import the OTHER PC’s pairing file',properties:['openFile'],filters:[{name:'Pairing',extensions:['json']}]});if(chosen.canceled)return;const peer=parsePairingFile(await readFile(chosen.filePaths[0]));return transactions.run(async()=>{const first=!config.peer;validateConfig({...config,peer});config.peer=peer;peerName='';if(first)config.enabled=true;updateSecrets();await saveProtected(settingsFile,config);log.info('app',`Paired with ${pcLabel({hostname:peer.name,role:config.role==='canada'?'pantry':'canada',ip:peer.host})}`);return first;}).then(async first=>{await bind.run();followPeer();return (first?'Paired. Remote controls are on.':'Paired')+(bindError()?' '+bindError():'');});});
  // Pairing with a code. pair:start shows a code on this PC; pair:join types the other PC's code here.
  ipc('pair:start',async()=>{
   requireLink();await stopPairing();
   const session=new PairingHost({role:config.role,details:myDetails,accept:async(peer,address)=>{await savePairing({...peer,host:address});setTimeout(()=>{if(pairing===session)void stopPairing();},3000);}});
   const server=createPairingServer(()=>pairing===session&&session.open?session:null);
   try{await listen(server,PAIRING_PORT,'0.0.0.0');}catch(e){throw new Error(`Could not wait for the other PC on port ${PAIRING_PORT} (${e.code||e.message}). Another program may be using it; restart this PC and try again.`);}
   pairing=session;pairingServer=server;pairingTimer=setTimeout(()=>void stopPairing(),session.expiresAt-Date.now()+1000);
   log.info('app','Waiting for the other PC to enter the pairing code');
   return {code:showCode(session.code),expiresAt:session.expiresAt};
  });
  ipc('pair:status',()=>pairing?{state:pairing.open?'waiting':pairing.state,message:pairing.message,peer:pairing.peer?peerLabel(pairing.peer):'',expiresAt:pairing.expiresAt}:{state:'idle'});
  ipc('pair:cancel',async()=>{await stopPairing();pairing=null;return true;});
  ipc('pair:find',async()=>{requireLink();if(!discovery)throw new Error('Pairing is unavailable.');return (await discovery.find({want:'pairing',role:config.role})).filter(f=>f.role===opposite()).map(f=>({address:f.address,name:f.name,version:f.version,label:pcLabel({hostname:f.name,role:f.role,ip:f.address})}));});
  ipc('pair:join',async({code,address}={})=>{
   requireLink();const digits=readCode(code);
   if(!address){
    const found=(await discovery.find({want:'pairing',role:config.role})).filter(f=>f.role===opposite());
    if(!found.length)throw new Error(`No ${roleLabel(opposite())} is waiting for a code. On the ${roleLabel(opposite())}, open PC link and choose Show a pairing code, then try again. If it is showing one, both PCs must be on the same home network, with the network set to Private in Windows.`);
    if(found.length>1&&new Set(found.map(f=>f.name)).size>1)return {choose:found.map(f=>({address:f.address,label:pcLabel({hostname:f.name,role:f.role,ip:f.address})}))};
    address=(found.find(f=>onSubnet(f.address))||found[0]).address;
   }
   const peer=await joinPairing({address,code:digits,role:config.role,details:myDetails()});
   await savePairing(peer);return {message:`Paired with ${peerLabel(peer)}. Remote controls are on.`};
  });
  // Updates.
  ipc('update:get',()=>updateView());
  ipc('update:check',()=>checkUpdates(true));
  ipc('update:choose-file',async()=>{
   const chosen=await dialog.showOpenDialog(window,{title:`Choose the new ${updates.INSTALLER}`,properties:['openFile'],filters:[{name:'VTube Input Bridge installer',extensions:['cmd']}]});if(chosen.canceled)return updateView();
   const path=chosen.filePaths[0];const version=await updates.installerVersion(path);
   if(updates.compareVersions(version,VERSION)<0)throw new Error(`That installer is version ${version}, older than the ${VERSION} this PC runs.`);
   update.ready={path,version};update.error='';log.info('app',`Installer for version ${version} chosen`);return updateView();
  });
  ipc('update:install',async({both=true}={})=>({message:await installUpdate({both}),update:updateView()}));
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

  tray=new Tray(trayIcon('warn'));trayLevel='warn';tray.on('double-click',createWindow);tray.on('balloon-click',createWindow);
  // The installer leaves a note when it updated this PC (scripts/Control-OneClick.ps1).
  void updates.lastUpdate(join(localData,'last-update.json')).then(result=>{if(!result)return;
   if(result.ok){log.info('app',`Updated to ${result.version||VERSION}`);notifier.notify({title:'Updated',body:`VTube Input Bridge ${VERSION} is running.`});}
   else{log.error('app',`The update to ${result.version} failed: ${result.message}`);notifier.notify({title:'Update failed',body:result.message||'The installer reported a problem. Open the app for details.'});}});
  updateTray();setInterval(updateTray,2000);setInterval(()=>void refreshPeerName(),15000);
  nativeTheme.on('updated',()=>{if(window&&!window.isDestroyed())window.setBackgroundColor(windowBackground());});
  // Sign-in launches pass --background so the app starts in the tray.
  if(!process.argv.includes('--background'))createWindow();
 }).catch(async e=>{await dialog.showMessageBox({type:'error',title:`${APP_NAME} could not start`,message:e?.message||String(e)});await quit();});
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();void quit();}});
}
