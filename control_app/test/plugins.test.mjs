import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
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

function fakeRelay(){
 const calls=[];
 const spawn=(exe,args)=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
  const close=code=>{if(child.exitCode!==null)return;child.exitCode=code;child.emit('close',code,null);};
  child.kill=()=>close(1);child.stdin.on('finish',()=>close(0));
  calls.push({exe,args});return child;
 };
 return {spawn,calls};
}
function receiverWith({config,legacy=false,status}){
 const {spawn,calls}=fakeRelay();const now=1_000_000;
 const receiver=new TrackingReceiver({exe:'vts_input_relay.exe',configFile:'relay-config.json',statusFile:'status.json',
  tokenFile:join(tmpdir(),'vtube-relay-test','vts-token.txt'),legacyRelayPresent:async()=>legacy,spawn,removeFile:async()=>{},now:()=>now,
  readFile:async file=>{
   if(file==='relay-config.json'&&config!==undefined)return config;
   if(file==='status.json'&&status.current)return JSON.stringify(status.current);
   throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});
  },
  timers:{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{}}});
 return {receiver,calls,now};
}

test('stream PC relay reads settings written by Windows PowerShell (byte-order mark) and reports status', async()=>{
 const status={current:null};
 const {receiver,calls,now}=receiverWith({config:'﻿{"source":"10.0.0.112"}',status});
 await receiver.start();
 assert.equal(calls.length,1);assert.deepEqual(calls[0].args.slice(0,2),['--source','10.0.0.112']);
 await receiver.poll();assert.equal(receiver.status().state,'Starting receiver');
 status.current={source:'10.0.0.112',vts_connected:false,packets_received:0,last_packet_unix_ms:0};await receiver.poll();
 assert.equal(receiver.status().state,'Waiting for VTube Studio');
 status.current={...status.current,vts_connected:true,packets_received:42,last_packet_unix_ms:now-1000};await receiver.poll();
 assert.equal(receiver.status().state,'Receiving input');assert.equal(receiver.status().packets,42);
 status.current={...status.current,last_packet_unix_ms:now-5000};await receiver.poll();
 assert.equal(receiver.status().state,'Waiting for gaming PC');
 await receiver.stop();assert.equal(receiver.status().state,'Receiver stopped');
});

test('stream PC relay does not start without its settings or beside the old task', async()=>{
 const missing=receiverWith({status:{current:null}});
 await missing.receiver.start();
 assert.equal(missing.calls.length,0);assert.match(missing.receiver.status().detail,/setup is incomplete/);
 const legacy=receiverWith({config:'{"source":"10.0.0.112"}',legacy:true,status:{current:null}});
 await legacy.receiver.start();
 assert.equal(legacy.calls.length,0);assert.match(legacy.receiver.status().detail,/old VTube Input Relay/);
});

test('an unexpected relay exit is reported and restarted with backoff', async()=>{
 // The app runs the relay itself (vts_input_relay --managed) and reads the status file it writes.
 let file=null,spawned=0,child;const now=1_000_000;const timers=[];
 const fakeChild=()=>{const c=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,stderr:new EventEmitter()});c.stdin={end(){setImmediate(()=>{c.exitCode=0;c.emit('close',0,null);});}};return c;};
 const receiver=new TrackingReceiver({exe:'vts_input_relay.exe',configFile:'relay-config.json',tokenFile:join(tmpdir(),'vtc-relay-test','token'),statusFile:'status.json',
  legacyRelayPresent:async()=>false,spawn:(exe,args)=>{spawned++;assert.deepEqual(args.slice(0,2),['--source','10.0.0.112']);return child=fakeChild();},removeFile:async()=>{},
  readFile:async path=>{if(path==='relay-config.json')return JSON.stringify({source:'10.0.0.112'});if(!file)throw new Error('ENOENT');return JSON.stringify(file);},
  now:()=>now,timers:{setInterval:()=>1,clearInterval:()=>{},setTimeout:(fn,ms)=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}}});
 await receiver.start();assert.equal(spawned,1);assert.equal(receiver.status().state,'Starting receiver');
 file={source:'10.0.0.112',vts_connected:false,packets_received:0,last_packet_unix_ms:0};await receiver.poll();
 assert.equal(receiver.status().state,'Waiting for VTube Studio');
 file={...file,vts_connected:true,packets_received:42,last_packet_unix_ms:now-1000};await receiver.poll();
 assert.equal(receiver.status().state,'Receiving input');assert.equal(receiver.status().packets,42);
 file={...file,last_packet_unix_ms:now-5000};await receiver.poll();
 assert.equal(receiver.status().state,'Waiting for gaming PC');
 // An unexpected relay exit is reported and restarted with backoff.
 child.exitCode=1;child.emit('close',1,null);await receiver.poll();
 assert.equal(receiver.status().state,'Restarting receiver');assert.match(receiver.status().detail,/exited \(code 1\)/);
 timers.shift()();await until(()=>spawned===2,'relay restart');
 await receiver.stop();assert.equal(receiver.status().state,'Receiver stopped');
});

test('reactive refusals say why and never "it may already have happened"', async()=>{
 const {createReactivesPlugin}=await import('../src/plugins/reactives.mjs');const {Dispatcher}=await import('../src/commands.mjs');
 const run=async(config,action)=>{const host=new PluginHost();let started=0;
  host.add(createReactivesPlugin({getConfig:()=>config,linkError:()=>null,renderer:{state:'Stopped',stop(){},start:async()=>{started++;}},frames:{get:()=>null},setVisible:async v=>v,clearPeerFrame:async()=>{}}));await host.start('reactives');
  const r=await new Dispatcher(c=>host.action(c.action,c.args,{})).execute({id:'r',target:'local',action,args:{},expiresAt:Date.now()+5000});return {r,started};};
 const pantry={role:'pantry',reactive:{enabled:true,url:'https://reactive.fugi.tech/group',visible:true}};
 for(const [config,action,message] of [[{role:'canada',reactive:{enabled:false,visible:true}},'reactive.start',/runs on the gaming PC/],[pantry,'reactive.show',/stream PC \(Canada\)/],
  [{...pantry,reactive:{...pantry.reactive,enabled:false}},'reactive.start',/rendering is turned off/],[{...pantry,reactive:{...pantry.reactive,url:''}},'reactive.start',/Enter the Fugi/],
  [{...pantry,reactive:{...pantry.reactive,url:'https://reactive.fugi.tech/settings'}},'reactive.start',/group or individual/]]){
  const {r,started}=await run(config,action);assert.equal(r.ok,false);assert.match(r.message,message);assert.doesNotMatch(r.message,/may already have happened/);assert.equal(started,0);
 }
 assert.equal((await run(pantry,'reactive.start')).started,1);
 assert.equal((await run({...pantry,role:'canada'},'reactive.hide')).r.ok,true);
});

test('Start pressed before the tracking helper is ready sends the typed address once it reports', async()=>{
 const written=[];let child;
 const spawn=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.exitCode=null;child.signalCode=null;child.stdin.on('data',b=>written.push(...String(b).trim().split('\n')));child.stdin.on('finish',()=>setImmediate(()=>{child.exitCode=0;child.emit('exit',0);}));return child;};
 const s=new TrackingSender({exe:'x',settingsFile:join(tmpdir(),'vtc-missing','tracking.json'),spawn,sendRetryDelays:[20]});
 await s.start();s.settings.startSendingOnLaunch=false;s.wantSending=false;
 try{
  // The helper has not printed its first status yet.
  assert.equal((await s.ui.start({destination:'10.0.0.150'})).state,'Starting');
  await new Promise(r=>setTimeout(r,60));assert.deepEqual(written,[]);
  child.stdout.write(JSON.stringify({type:'status',running:false,destination:'10.0.0.77'})+'\n');
  await until(()=>written.length>0,'start command');assert.deepEqual(written,['start 10.0.0.150']);
 }finally{await s.stop();}
});
