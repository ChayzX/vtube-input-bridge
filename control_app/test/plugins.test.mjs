import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PluginHost} from '../src/plugins/host.mjs';
import {TrackingSender,TrackingReceiver} from '../src/plugins/tracking.mjs';

const fakeHelper=fileURLToPath(new URL('./fake-helper.mjs',import.meta.url));
const until=async(check,what,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for '+what);};
async function sender(env={},settings){
 const dir=await mkdtemp(join(tmpdir(),'tracking-test-'));const settingsFile=join(dir,'tracking.json');
 if(settings)await writeFile(settingsFile,JSON.stringify(settings));
 const plugin=new TrackingSender({exe:'VTubeInputBridge.exe',settingsFile,restartDelays:[10],
  spawn:(exe,args,options)=>spawn(process.execPath,[fakeHelper,...args],{...options,env:{...process.env,...env}})});
 return {plugin,dir,settingsFile};
}

test('a failing plugin does not stop the others, and its commands are refused', async()=>{
 const host=new PluginHost();let trackingStarted=false;
 host.add({id:'controls',start:()=>{throw new Error('Secure credential storage unavailable');},actions:{'obs.*':async()=>'scene'}});
 host.add({id:'tracking',start:()=>{trackingStarted=true;},status:()=>({state:'Sending'}),actions:{'tracking.ping':async()=>'pong'}});
 await host.startAll();
 assert.equal(trackingStarted,true);
 const status=host.status();
 assert.equal(status.controls.started,false);assert.match(status.controls.error,/credential storage/);
 assert.equal(status.tracking.started,true);assert.equal(status.tracking.state,'Sending');
 await assert.rejects(host.action('obs.scenes',{}),/Feature unavailable.*credential storage/);
 assert.equal(await host.action('tracking.ping',{}),'pong');
 await assert.rejects(host.action('unknown.thing',{}),/unsupported/);
 await assert.rejects(host.ui('tracking','constructor',{}),/Unknown request/);
 assert.throws(()=>host.add({id:'tracking'}),/Duplicate/);
});

test('status from a broken plugin is contained', async()=>{
 const host=new PluginHost();host.add({id:'bad',status:()=>{throw new Error('boom');}});host.add({id:'good',status:()=>({ok:true})});
 await host.startAll();const status=host.status();
 assert.equal(status.bad.statusError,'boom');assert.equal(status.good.ok,true);
});

test('tracking starts the helper and resumes sending to the saved address', async()=>{
 const {plugin,dir}=await sender({FAKE_DESTINATION:'10.0.0.77'});
 try{
  await plugin.start();
  await until(()=>plugin.status().running,'sending');
  assert.equal(plugin.status().state,'Sending');assert.equal(plugin.status().destination,'10.0.0.77');
  await plugin.ui.stop();await until(()=>!plugin.status().running,'stop');
  await plugin.ui.mouse({gameMode:true,sensitivity:2.5});await until(()=>plugin.status().gameMode,'game mode');
  assert.equal(plugin.status().sensitivity,2.5);
  await plugin.ui.start({destination:'10.0.0.88'});await until(()=>plugin.status().destination==='10.0.0.88','new address');
 }finally{await plugin.stop();await rm(dir,{recursive:true,force:true});}
 assert.equal(plugin.child,null);
});

test('tracking rejects unsafe input before it reaches the helper', async()=>{
 const {plugin,dir}=await sender();
 try{
  await plugin.start();await until(()=>plugin.status().running,'sending');
  await assert.rejects(plugin.ui.start({destination:'10.0.0.5\nstop'}),/IPv4/);
  await assert.rejects(plugin.ui.start({destination:'stream-pc'}),/IPv4/);
  await assert.rejects(plugin.ui.mouse({gameMode:false,sensitivity:'1\nstop'}),/between 0.1 and 5/);
  await assert.rejects(plugin.ui.mouse({gameMode:false,sensitivity:9}),/between 0.1 and 5/);
  assert.equal(plugin.status().running,true);
 }finally{await plugin.stop();await rm(dir,{recursive:true,force:true});}
});

test('tracking honours "do not start sending on launch" and saves the choice', async()=>{
 const {plugin,dir,settingsFile}=await sender({},{startSendingOnLaunch:false});
 try{
  await plugin.start();await until(()=>plugin.status().state==='Stopped','helper status');
  await new Promise(r=>setTimeout(r,100));assert.equal(plugin.status().running,false);
  await plugin.ui.startOnLaunch({enabled:true});
  assert.deepEqual(JSON.parse(await readFile(settingsFile,'utf8')),{startSendingOnLaunch:true});
 }finally{await plugin.stop();await rm(dir,{recursive:true,force:true});}
});

test('a crashed helper is restarted and sending resumes', async()=>{
 const {plugin,dir}=await sender({FAKE_HELPER:'crash'});
 try{
  await plugin.start();
  await until(()=>plugin.restarts>=2,'two restarts');
  assert.ok(['Starting','Restarting','Sending','Stopped'].includes(plugin.status().state));
 }finally{await plugin.stop();await rm(dir,{recursive:true,force:true});}
 const before=plugin.restarts;await new Promise(r=>setTimeout(r,80));assert.equal(plugin.restarts,before,'no restarts after stop');
});

test('the old window holding the sender lock is reported, not hidden', async()=>{
 const {plugin,dir}=await sender({FAKE_HELPER:'fatal'});
 try{await plugin.start();await until(()=>plugin.status().state==='Blocked','blocked state');assert.match(plugin.status().error,/already sending/);}
 finally{await plugin.stop();await rm(dir,{recursive:true,force:true});}
});

test('stream PC tracking reports the relay status like the old receiver window', async()=>{
 let running=true,file=null;const now=1_000_000;
 const receiver=new TrackingReceiver({statusFile:'status.json',relayRunning:async()=>running,
  readFile:async()=>{if(!file)throw new Error('ENOENT');return JSON.stringify(file);},now:()=>now,timers:{setInterval:()=>1,clearInterval:()=>{}}});
 await receiver.start();assert.equal(receiver.status().state,'Receiver running');
 file={source:'10.0.0.112',vts_connected:false,packets_received:0,last_packet_unix_ms:0};await receiver.poll();
 assert.equal(receiver.status().state,'Waiting for VTube Studio');
 file={...file,vts_connected:true,packets_received:42,last_packet_unix_ms:now-1000};await receiver.poll();
 assert.equal(receiver.status().state,'Receiving input');assert.equal(receiver.status().packets,42);
 file={...file,last_packet_unix_ms:now-5000};await receiver.poll();
 assert.equal(receiver.status().state,'Waiting for gaming PC');
 running=false;await receiver.poll();assert.equal(receiver.status().state,'Receiver stopped');
 await receiver.stop();
});
