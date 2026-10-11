import {spawn as nodeSpawn,execFile} from 'node:child_process';import {createInterface} from 'node:readline';
import {readFile as fsReadFile,writeFile as fsWriteFile,mkdir,rm} from 'node:fs/promises';import {dirname} from 'node:path';import {isIP} from 'node:net';

// Gaming PC: runs the tested C# sender (VTubeInputBridge.exe --headless) as a hidden helper and supervises it.
// The helper takes one command per line on stdin and reports JSON status lines on stdout; closing stdin stops it.
export class TrackingSender {
 constructor({exe,settingsFile,spawn=nodeSpawn,readFile=fsReadFile,writeFile=fsWriteFile,restartDelays=[1000,2000,5000,10000,30000],sendRetryDelays=[1000,2000,5000,10000,30000],timers=globalThis}){
  Object.assign(this,{exe,settingsFile,spawnFn:spawn,readFile,writeFile,restartDelays,sendRetryDelays,timers});
  this.id='tracking';this.name='Tracking';
  this.settings={startSendingOnLaunch:true};this.wantSending=false;this.requested=null;this.helper=null;this.child=null;
  this.state='Starting';this.lastError='';this.fatal='';this.restarts=0;this.restartTimer=null;this.sendRetryTimer=null;this.sendRetries=0;this.stopping=false;
  this.ui={
   start:async({destination})=>{const address=ipv4(destination??this.helper?.destination);this.requested=address;this.wantSending=true;this.clearSendRetry();
    // Before the helper's first status line, the start goes out when it reports (handle below).
    if(!this.child||!this.helper){this.sentStart=false;return this.status();}
    this.sentStart=true;try{const result=await this.send(`start ${address}`);this.scheduleSendRetry();return result;}catch(e){this.sentStart=false;this.scheduleSendRetry();throw e;}},
   stop:async()=>{this.wantSending=false;this.sentStart=false;this.clearSendRetry();return this.send('stop');},
   mouse:async({gameMode,sensitivity})=>{
    const value=Number(sensitivity);if(!(value>=0.1&&value<=5))throw new Error('Sensitivity must be between 0.1 and 5.');
    return this.send(`mouse ${gameMode?'game':'desktop'} ${value}`);
   },
   startOnLaunch:async({enabled})=>{this.settings.startSendingOnLaunch=!!enabled;await this.saveSettings();return this.status();}
  };
 }
 async start(){
  try{this.settings={...this.settings,...JSON.parse(stripBom(await this.readFile(this.settingsFile,'utf8')))};}catch{}
  this.wantSending=!!this.settings.startSendingOnLaunch;this.stopping=false;this.launch();
 }
 async saveSettings(){await mkdir(dirname(this.settingsFile),{recursive:true});await this.writeFile(this.settingsFile,JSON.stringify(this.settings));}
 launch(){
  this.clearSendRetry();
  this.restartTimer=null;this.helper=null;this.fatal='';this.state='Starting';this.sentStart=false;this.launchedAt=Date.now();
  let child;
  try{child=this.spawnFn(this.exe,['--headless'],{stdio:['pipe','pipe','pipe'],windowsHide:true});}
  catch(e){this.lastError=e.message;this.scheduleRestart();return;}
  this.child=child;
  child.on('error',e=>{this.lastError=e.code==='ENOENT'?'The tracking helper is missing; reinstall the app.':e.message;});
  child.stdin.on('error',()=>{});
  createInterface({input:child.stdout}).on('line',line=>this.handle(line));
  child.on('exit',()=>{
   if(this.child!==child)return;this.child=null;this.helper=null;
   // Back off on repeated crashes; a helper that ran for a minute starts the backoff over.
   if(Date.now()-this.launchedAt>60000)this.restarts=0;
   if(!this.stopping)this.scheduleRestart();
  });
 }
 handle(line){
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.type==='status'){
   this.helper=message;
   if(message.running){this.state='Sending';this.sentStart=false;this.sendRetries=0;this.clearSendRetry();if(message.error)this.lastError=String(message.error);else this.lastError='';}
   else{this.state='Stopped';if(message.error)this.lastError=String(message.error);}
   // Keep retrying local sender start failures while the user still wants tracking enabled.
   const to=this.requested||message.destination;
   if(this.wantSending&&!message.running&&!this.sentStart&&!message.legacy&&to){this.sentStart=true;this.send(`start ${to}`).catch(e=>{this.lastError=e.message;}).finally(()=>this.scheduleSendRetry());}
  }else if(message.type==='error'){this.lastError=String(message.message);if(this.wantSending&&!this.helper?.running)this.scheduleSendRetry();}
  else if(message.type==='fatal'){this.fatal=String(message.message);this.lastError=this.fatal;}
 }
 clearSendRetry(){if(this.sendRetryTimer){this.timers.clearTimeout(this.sendRetryTimer);this.sendRetryTimer=null;}}
 scheduleSendRetry(){
  if(this.stopping||!this.wantSending||this.sendRetryTimer||this.helper?.running||this.helper?.legacy)return;
  const delay=this.sendRetryDelays[Math.min(this.sendRetries,this.sendRetryDelays.length-1)];this.sendRetries++;
  this.sendRetryTimer=this.timers.setTimeout(()=>{this.sendRetryTimer=null;if(!this.wantSending||!this.helper||this.helper.running||this.helper.legacy)return;this.sentStart=false;this.handle(JSON.stringify({type:'status',...this.helper,running:false}));},delay);
 }
 scheduleRestart(){
  if(this.stopping||this.restartTimer)return;
  const delay=this.restartDelays[Math.min(this.restarts,this.restartDelays.length-1)];this.restarts++;
  this.state=this.fatal?'Blocked':'Restarting';
  this.restartTimer=this.timers.setTimeout(()=>this.launch(),delay);
 }
 async send(command){
  if(!this.child||!this.helper)throw new Error('Tracking is starting; try again in a moment.');
  this.lastError='';this.child.stdin.write(command+'\n');return this.status();
 }
 async stop(){
  this.stopping=true;if(this.restartTimer){this.timers.clearTimeout(this.restartTimer);this.restartTimer=null;}this.clearSendRetry();
  const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null){this.child=null;return;}
  const exited=new Promise(resolve=>child.once('exit',resolve));
  child.stdin.end();
  const timer=this.timers.setTimeout(()=>{try{child.kill();}catch{}},3000);
  await exited;this.timers.clearTimeout(timer);this.child=null;
 }
 status(){
  const h=this.helper||{};
  return {role:'sender',state:this.state,connectionState:h.running?(h.receiverConnected?'Connected':'Waiting for the Streaming PC'):this.state,running:!!h.running,receiverConnected:!!h.receiverConnected,lastAckSequence:h.lastAckSequence??-1,lastAckUnixMs:h.lastAckUnixMs??0,packets:h.packets??0,bytes:Number.isFinite(h.bytesSent)?h.bytesSent:null,destination:h.destination??'',
   gameMode:!!h.gameMode,sensitivity:h.sensitivity??1,rawEvents:h.rawEvents??0,rawError:h.rawError??'',
   legacy:!!h.legacy,error:this.lastError||h.error||'',startSendingOnLaunch:!!this.settings.startSendingOnLaunch};
 }
}

const stripBom=text=>String(text).replace(/^\uFEFF/,'');

// The address goes onto the helper's command line, so accept nothing but a bare IPv4 address.
function ipv4(value){const text=String(value??'').trim();if(isIP(text)!==4)throw new Error("Enter the Streaming PC's IPv4 address.");return text;}

// Stream PC: this app owns the relay child for the signed-in user. The legacy SYSTEM task
// must be migrated before launch; keeping both would contend for UDP port 5055 and VTS authorization.
export class TrackingReceiver {
 constructor({exe,configFile,tokenFile,statusFile,pairedSource=()=>null,legacyRelayPresent=windowsLegacyRelayPresent,spawn=nodeSpawn,readFile=fsReadFile,removeFile=rm,now=Date.now,timers=globalThis,interval=1000,restartDelays=[1000,2000,5000,10000,30000]}){
  Object.assign(this,{exe,configFile,tokenFile,statusFile,pairedSource,legacyRelayPresent,spawnFn:spawn,readFile,removeFile,now,timers,interval,restartDelays});
  this.id='tracking';this.name='Tracking';this.process=false;this.data=null;this.timer=null;this.child=null;this.restartTimer=null;this.stopping=false;this.restarts=0;this.lastError='';this.source='';this.state='Starting receiver';this.waitTimer=null;
 }
 async start(){
  this.stopping=false;
  const found=await this.findSource();
  // A new Streaming PC has no migrated relay settings: it learns the Gaming PC's address from pairing, so it waits.
  if(found===false){this.waitTimer=this.timers.setTimeout(()=>{this.waitTimer=null;if(!this.stopping)this.start().catch(e=>{this.lastError=e.message;});},this.interval);return;}
  if(!found)return;
  if(await this.legacyRelayPresent().catch(()=>true)){this.state='Receiver stopped';this.lastError='The old VTube Input Relay scheduled task or process is still present. Complete the one-time Streaming PC migration, then launch this app again.';return;}
  await this.launch();this.timer=this.timers.setInterval(()=>this.poll().catch(()=>{}),this.interval);
 }
 // The Gaming PC's address: from the relay settings migrated off the old task, else from pairing. true when found,
 // false while waiting for pairing, null when the settings exist but are unusable.
 async findSource(){
  let text;
  try{text=await this.readFile(this.configFile,'utf8');}
  catch(e){
   if(e.code!=='ENOENT'){this.state='Receiver stopped';this.lastError=`Could not read the Streaming PC relay settings: ${e.message}.`;return null;}
   try{const paired=this.pairedSource();if(paired){this.source=ipv4(paired);return true;}}catch{}
   this.state='Waiting for pairing';this.lastError='';return false;
  }
  // Windows PowerShell writes UTF-8 with a byte-order mark, which JSON.parse rejects.
  try{this.source=ipv4(JSON.parse(stripBom(text)).source);return true;}
  catch(e){this.state='Receiver stopped';this.lastError=`Streaming PC relay setup is incomplete: ${e.message}. Run Fix-StreamPC, or delete relay-config.json to take the Gaming PC address from pairing.`;return null;}
 }
 async launch(){
  if(this.stopping)return;
  this.state='Starting receiver';this.data=null;this.lastError='';this.process=false;
  await this.removeFile(this.statusFile).catch(e=>{if(e.code!=='ENOENT')throw e;});
  await mkdir(dirname(this.tokenFile),{recursive:true});
  let child;
  try{child=this.spawnFn(this.exe,['--source',this.source,'--token-file',this.tokenFile,'--status-file',this.statusFile,'--managed'],{stdio:['pipe','ignore','pipe'],windowsHide:true});}
  catch(e){this.lastError=e.message;this.scheduleRestart();return;}
  this.child=child;this.process=true;this.launchedAt=this.now();
  child.stderr?.on('data',buf=>{const line=String(buf).trim();if(line)this.lastError=line.slice(-500);});
  child.once('error',e=>{if(this.child===child)this.lastError=e.code==='ENOENT'?'The VTube Input Relay executable is missing.':e.message;});
  child.once('close',(code,signal)=>{
   if(this.child!==child)return;this.child=null;this.process=false;
   if(this.now()-this.launchedAt>60000)this.restarts=0;
   if(!this.stopping){this.lastError=this.lastError||`VTube Input Relay exited (code ${code??'none'}${signal?`, ${signal}`:''}).`;this.scheduleRestart();}
  });
 }
 scheduleRestart(){
  if(this.stopping||this.restartTimer)return;
  const delay=this.restartDelays[Math.min(this.restarts,this.restartDelays.length-1)];this.restarts++;
  this.state='Restarting receiver';this.restartTimer=this.timers.setTimeout(()=>{this.restartTimer=null;this.launch().catch(e=>{this.lastError=e.message;this.scheduleRestart();});},delay);
 }
 async stop(){
  this.stopping=true;if(this.timer)this.timers.clearInterval(this.timer);this.timer=null;
  if(this.waitTimer)this.timers.clearTimeout(this.waitTimer);this.waitTimer=null;
  if(this.restartTimer)this.timers.clearTimeout(this.restartTimer);this.restartTimer=null;
  const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null){this.child=null;this.process=false;return;}
  const exited=new Promise(resolve=>child.once('close',resolve));child.stdin.end();
  const timer=this.timers.setTimeout(()=>{try{child.kill();}catch{}},5000);
  await exited;this.timers.clearTimeout(timer);this.child=null;this.process=false;
 }
 async poll(){this.process=!!this.child&&this.child.exitCode===null&&this.child.signalCode===null;try{this.data=JSON.parse(await this.readFile(this.statusFile,'utf8'));}catch{this.data=null;}}
 status(){
  // bytes is null from a relay built before it reported bytes.
  const d=this.data;const base={role:'receiver',packets:Number(d?.packets_received)||0,bytes:Number.isFinite(d?.bytes_received)?d.bytes_received:null,lastPacketUnixMs:Number(d?.last_packet_unix_ms)||0,source:d?.source??this.source};
  if(!this.process&&this.state==='Waiting for pairing')return {...base,state:'Waiting for pairing',detail:'Tracking starts once this PC is paired with the Gaming PC (PC link).'};
  if(!this.process)return {...base,state:this.state==='Restarting receiver'?'Restarting receiver':'Receiver stopped',detail:this.lastError||'The VTube Input Relay is not running.'};
  if(!d)return {...base,state:'Starting receiver',detail:this.lastError||'Waiting for status from the receiver.'};
  if(!d.vts_connected)return {...base,state:'Waiting for VTube Studio',detail:'Open VTube Studio and enable its API.'};
  const age=this.now()-Number(d.last_packet_unix_ms);
  if(base.packets>0&&age>=0&&age<=2500)return {...base,state:'Receiving input',detail:`Connected to VTube Studio; recent input from ${base.source}.`};
  return {...base,state:'Waiting for the Gaming PC',detail:`VTube Studio is connected. No recent input from ${base.source}.`};
 }
}

async function windowsLegacyRelayPresent(){
 const task=await new Promise(resolve=>execFile('schtasks',['/Query','/TN','VTube Input Relay'],{windowsHide:true},error=>resolve(!error)));
 if(task)return true;
 return new Promise(resolve=>execFile('tasklist',['/FI','IMAGENAME eq vts_input_relay.exe','/NH','/FO','CSV'],{windowsHide:true},
  (error,stdout)=>resolve(!error&&/"vts_input_relay\.exe"/i.test(stdout))));
}
