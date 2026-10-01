import {spawn as nodeSpawn,execFile} from 'node:child_process';import {createInterface} from 'node:readline';
import {readFile as fsReadFile,writeFile as fsWriteFile,mkdir} from 'node:fs/promises';import {dirname} from 'node:path';import {isIP} from 'node:net';

// Gaming PC: runs the tested C# sender (VTubeInputBridge.exe --headless) as a hidden helper and supervises it.
// The helper takes one command per line on stdin and reports JSON status lines on stdout; closing stdin stops it.
export class TrackingSender {
 constructor({exe,settingsFile,spawn=nodeSpawn,readFile=fsReadFile,writeFile=fsWriteFile,restartDelays=[1000,2000,5000,10000,30000],timers=globalThis}){
  Object.assign(this,{exe,settingsFile,spawnFn:spawn,readFile,writeFile,restartDelays,timers});
  this.id='tracking';this.name='Tracking';
  this.settings={startSendingOnLaunch:true};this.wantSending=false;this.helper=null;this.child=null;
  this.state='Starting';this.lastError='';this.fatal='';this.restarts=0;this.restartTimer=null;this.stopping=false;
  this.ui={
   start:async({destination})=>{const address=ipv4(destination??this.helper?.destination);this.wantSending=true;return this.send(`start ${address}`);},
   stop:async()=>{this.wantSending=false;return this.send('stop');},
   mouse:async({gameMode,sensitivity})=>{
    const value=Number(sensitivity);if(!(value>=0.1&&value<=5))throw new Error('Sensitivity must be between 0.1 and 5.');
    return this.send(`mouse ${gameMode?'game':'desktop'} ${value}`);
   },
   startOnLaunch:async({enabled})=>{this.settings.startSendingOnLaunch=!!enabled;await this.saveSettings();return this.status();}
  };
 }
 async start(){
  try{this.settings={...this.settings,...JSON.parse(await this.readFile(this.settingsFile,'utf8'))};}catch{}
  this.wantSending=!!this.settings.startSendingOnLaunch;this.stopping=false;this.launch();
 }
 async saveSettings(){await mkdir(dirname(this.settingsFile),{recursive:true});await this.writeFile(this.settingsFile,JSON.stringify(this.settings));}
 launch(){
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
   this.helper=message;this.state=message.running?'Sending':'Stopped';
   // Resume sending after launch or a helper restart, unless the user stopped it.
   if(this.wantSending&&!message.running&&!this.sentStart&&!message.legacy){this.sentStart=true;this.send(`start ${message.destination}`).catch(()=>{});}
  }else if(message.type==='error')this.lastError=String(message.message);
  else if(message.type==='fatal'){this.fatal=String(message.message);this.lastError=this.fatal;}
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
  this.stopping=true;if(this.restartTimer){this.timers.clearTimeout(this.restartTimer);this.restartTimer=null;}
  const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null){this.child=null;return;}
  const exited=new Promise(resolve=>child.once('exit',resolve));
  child.stdin.end();
  const timer=this.timers.setTimeout(()=>{try{child.kill();}catch{}},3000);
  await exited;this.timers.clearTimeout(timer);this.child=null;
 }
 status(){
  const h=this.helper||{};
  return {role:'sender',state:this.state,running:!!h.running,packets:h.packets??0,destination:h.destination??'',
   gameMode:!!h.gameMode,sensitivity:h.sensitivity??1,rawEvents:h.rawEvents??0,rawError:h.rawError??'',
   legacy:!!h.legacy,error:this.lastError||h.error||'',startSendingOnLaunch:!!this.settings.startSendingOnLaunch};
 }
}

// The address goes onto the helper's command line, so accept nothing but a bare IPv4 address.
function ipv4(value){const text=String(value??'').trim();if(isIP(text)!==4)throw new Error("Enter the stream PC's IPv4 address.");return text;}

// Stream PC: the receiver itself is the vts_input_relay background service; this reports its status file the way
// the old receiver window did.
export class TrackingReceiver {
 constructor({statusFile,relayRunning=windowsRelayRunning,readFile=fsReadFile,now=Date.now,timers=globalThis,interval=1000}){
  Object.assign(this,{statusFile,relayRunning,readFile,now,timers,interval});
  this.id='tracking';this.name='Tracking';this.process=false;this.data=null;this.timer=null;
 }
 async start(){await this.poll();this.timer=this.timers.setInterval(()=>this.poll().catch(()=>{}),this.interval);}
 async stop(){if(this.timer)this.timers.clearInterval(this.timer);this.timer=null;}
 async poll(){
  this.process=await this.relayRunning().catch(()=>false);
  try{this.data=JSON.parse(await this.readFile(this.statusFile,'utf8'));}catch{this.data=null;}
 }
 status(){
  const d=this.data;const base={role:'receiver',packets:Number(d?.packets_received)||0,source:d?.source??''};
  if(!this.process)return {...base,state:'Receiver stopped',detail:'The VTube Input Relay background service is not running.'};
  if(!d)return {...base,state:'Receiver running',detail:'Waiting for status from the background receiver.'};
  if(!d.vts_connected)return {...base,state:'Waiting for VTube Studio',detail:'Open VTube Studio and enable its API.'};
  const age=this.now()-Number(d.last_packet_unix_ms);
  if(base.packets>0&&age>=0&&age<=2500)return {...base,state:'Receiving input',detail:`Connected to VTube Studio; recent input from ${base.source}.`};
  return {...base,state:'Waiting for gaming PC',detail:`VTube Studio is connected. No recent input from ${base.source}.`};
 }
}

function windowsRelayRunning(){
 return new Promise(resolve=>execFile('tasklist',['/FI','IMAGENAME eq vts_input_relay.exe','/NH','/FO','CSV'],{windowsHide:true},
  (error,stdout)=>resolve(!error&&/"vts_input_relay\.exe"/i.test(stdout))));
}
