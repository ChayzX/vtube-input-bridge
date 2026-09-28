import test from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher } from '../src/commands.mjs';
import { FrameStore, validateFugiUrl } from '../src/frames.mjs';
const command = (overrides={}) => ({id:'test-1',expiresAt:Date.now()+5000,target:'local',action:'spotify.next',args:{},...overrides});
test('concurrent duplicate next-track executes once and returns same result', async()=>{
 let n=0; const d=new Dispatcher(async()=>{n++; await new Promise(r=>setTimeout(r,20)); return {track:'two'};});
 const c=command(); const [a,b]=await Promise.all([d.execute(c),d.execute(c)]);
 assert.equal(n,1); assert.deepEqual(a,b); assert.equal(a.ok,true);
});
test('reuse of an ID for a different action is rejected', async()=>{
 const d=new Dispatcher(async()=>({})); const c=command(); await d.execute(c);
 assert.equal((await d.execute({...c,action:'spotify.pause'})).code,'id_conflict');
});
test('expired/far-future/unknown targets are rejected before dispatch', async()=>{
 let n=0; const d=new Dispatcher(async()=>{n++;});
 for(const overrides of [{expiresAt:Date.now()-1},{expiresAt:Date.now()+60000},{target:'someone'},{id:''}]) assert.equal((await d.execute(command(overrides))).ok,false);
 assert.equal(n,0);
});
test('bounded admission rejects additional work', async()=>{
 let release; const d=new Dispatcher(()=>new Promise(r=>release=r),{maxPending:1});
 const first=d.execute(command()); await new Promise(r=>setImmediate(r));
 assert.equal((await d.execute(command({id:'second'}))).code,'busy'); release({}); await first;
});
test('queued command expires before its side effect',async()=>{
 let release,n=0; const d=new Dispatcher(async()=>{n++; if(n===1) await new Promise(r=>release=r); return {};});
 const first=d.execute(command()); const second=d.execute(command({id:'second',expiresAt:Date.now()+10}));
 await new Promise(r=>setTimeout(r,25)); release(); await first;
 assert.equal((await second).code,'expired'); assert.equal(n,1);
});
test('unknown outcomes are not retried',async()=>{
 let n=0; const d=new Dispatcher(async()=>{n++; throw new Error('connection lost');}); const c=command();
 assert.equal((await d.execute(c)).code,'action_failed'); await d.execute(c); assert.equal(n,1);
});
// A valid transparent 1x1 PNG, derived independently.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('frame store accepts PNG and clears frozen output',()=>{
 let now=100; const store=new FrameStore({clock:()=>now,ttl:1000}); store.put(png);
 assert.deepEqual(store.get(),png); now=1101; assert.equal(store.get(),null);
 assert.throws(()=>store.put(Buffer.from('not png'))); assert.throws(()=>store.put(Buffer.alloc(3000000)));
});
test('Fugi URL validation rejects other origins, credentials, scripts and HTTP',()=>{
 assert.equal(validateFugiUrl('https://reactive.fugi.tech/').host,'reactive.fugi.tech');
 for(const u of ['http://reactive.fugi.tech/','https://evil.test/','https://reactive.fugi.tech.evil.test/','javascript:alert(1)','https://a:b@reactive.fugi.tech/']) assert.throws(()=>validateFugiUrl(u));
});
