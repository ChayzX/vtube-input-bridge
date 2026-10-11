import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Logger,redact,redactText} from '../src/logger.mjs';
const hex='0123456789abcdef'.repeat(4);
test('redaction hides tokens, pins, passwords, bearer credentials and the overlay address',()=>{
 assert.equal(redactText(`token ${hex} ok`),'token [redacted] ok');
 assert.equal(redactText('Authorization: Bearer abc.def-123'),'Authorization: [redacted]');
 assert.equal(redactText('GET Bearer abc.def-123'),'GET Bearer [redacted]');
 assert.equal(redactText('http://127.0.0.1:5058/overlay/3f9c1d0b8e2a/frame'),'http://127.0.0.1:5058/overlay/[redacted]/frame');
 assert.equal(redactText('{"password":"hunter2","url":"ws://x"}'),'{"password":[redacted],"url":"ws://x"}');
 assert.equal(redactText('pin=abcd&host=10.0.0.1'),'pin=[redacted]&host=10.0.0.1');
 assert.equal(redactText('authenticationToken: zzz'),'authenticationToken: [redacted]');
 assert.equal(redactText('OBS said hunter2 was wrong',['hunter2']),'OBS said [redacted] was wrong','a known secret is hidden even without a pattern');
 assert.equal(redactText('Paired with the Streaming PC (10.0.0.119). OBS rejected the password.'),'Paired with the Streaming PC (10.0.0.119). OBS rejected the password.','ordinary sentences are untouched');
 const data=redact({host:'10.0.0.119',port:5056,pin:hex,token:'short',obs:{password:'hunter2',url:'ws://127.0.0.1:4455'},vts:{token:''},list:[`Bearer ${hex}`]});
 assert.deepEqual(data,{host:'10.0.0.119',port:5056,pin:'[redacted]',token:'[redacted]',obs:{password:'[redacted]',url:'ws://127.0.0.1:4455'},vts:{token:''},list:['Bearer [redacted]']});
});
test('levels: debug entries only while debug logging is on, for the chosen sources',()=>{
 const log=new Logger();
 log.info('app','started');log.debugLog('peer','GET /status ok');assert.equal(log.entries().length,1);
 log.configure({debug:true,debugSources:['api']});
 log.debugLog('peer','hidden');log.debugLog('api','shown');assert.deepEqual(log.entries().map(e=>e.msg),['started','shown']);
 log.configure({debug:true});log.debugLog('peer','now shown');assert.equal(log.entries().length,3);
 log.configure({debug:false});log.debugLog('api','gone');assert.equal(log.entries().length,3);
 log.warn('nonsense','x');assert.equal(log.entries().at(-1).source,'app','an unknown source is filed under app');
 assert.deepEqual(log.entries({levels:['warn']}).map(e=>e.msg),['x']);
});
test('messages and data are redacted before they are kept or written',()=>{
 const log=new Logger();log.setSecrets(['hunter2',hex]);log.configure({debug:true});
 log.debugLog('obs','connecting with hunter2',{url:'ws://127.0.0.1:4455',password:'hunter2',token:hex});
 const [e]=log.entries();assert.doesNotMatch(e.msg,/hunter2|0123456789abcdef/);assert.match(e.msg,/ws:\/\/127\.0\.0\.1:4455/);
});
test('the ring keeps the newest entries, collapses repeats and serves only what changed',()=>{
 let now=0;const log=new Logger({capacity:3,clock:()=>now});
 for(const m of ['a','b','c','d'])log.info('app',m);
 assert.deepEqual(log.entries().map(e=>e.msg),['b','c','d']);
 const seq=log.entries().at(-1).seq;
 now+=1000;log.info('app','d');log.info('app','d');
 const changed=log.entries({since:seq});assert.equal(changed.length,1);assert.equal(changed[0].msg,'d');assert.equal(changed[0].repeat,3);
 now+=120000;log.info('app','d');assert.equal(log.entries().at(-1).repeat,1,'a repeat after a minute is a new entry');
 assert.equal(log.entries({limit:2}).length,2);
});
test('the log file rolls over at its size cap and keeps a set number of files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vib-log-'));const file=join(dir,'logs','app.log');
 try{
  const log=new Logger({file,maxBytes:300,files:2,flushDelay:1});
  for(let i=0;i<12;i++){log.info('app',`line ${i} `+'x'.repeat(40));await log.flush();}
  const names=(await readdir(join(dir,'logs'))).sort();assert.deepEqual(names,['app.log','app.log.1']);
  const current=await readFile(file,'utf8'),previous=await readFile(file+'.1','utf8');
  assert.ok(Buffer.byteLength(current)<=300&&Buffer.byteLength(previous)<=300);
  assert.match(current,/line 11 /);assert.doesNotMatch(current+previous,/line 0 /,'the oldest lines rolled off');
  assert.match(current,/^\d{4}-\d\d-\d\dT[\d:.]+Z INFO  app      line/m);
  log.info('app','same');log.info('app','same');log.info('app','other');await log.flush();
  assert.match(await readFile(file,'utf8'),/repeated 1 more time\)\n.*other/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('an existing large log is rotated on the first write after a restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vib-log-'));const file=join(dir,'app.log');
 try{
  await writeFile(file,'old\n'.repeat(100));
  const log=new Logger({file,maxBytes:200,files:3});log.info('app','new start');await log.flush();
  assert.equal(await readFile(file+'.1','utf8'),'old\n'.repeat(100));assert.match(await readFile(file,'utf8'),/new start/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
