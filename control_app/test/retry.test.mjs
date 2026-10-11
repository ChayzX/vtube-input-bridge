import test from 'node:test';import assert from 'node:assert/strict';import {Retry} from '../src/retry.mjs';
const fakeTimers=()=>{const queue=[];return {queue,setTimeout:(fn,ms)=>{queue.push({fn,ms});return queue.length;},clearTimeout:id=>{if(queue[id-1])queue[id-1].fn=null;}};};
test('a failed bind at sign-in is retried with backoff until the address is up',async()=>{
 const timers=fakeTimers();let up=false,tries=0;const changes=[];
 const r=new Retry(async()=>{tries++;if(!up)throw Object.assign(new Error('listen EADDRNOTAVAIL 10.0.0.119:5056'),{code:'EADDRNOTAVAIL'});},{delays:[10,20],timers,onChange:e=>changes.push(e)});
 await r.run();assert.match(r.error,/EADDRNOTAVAIL/);assert.deepEqual(timers.queue.map(t=>t.ms),[10]);
 await timers.queue[0].fn();await timers.queue[1].fn();assert.deepEqual(timers.queue.map(t=>t.ms),[10,20,20],'the last delay repeats');
 up=true;await timers.queue[2].fn();assert.equal(r.error,null);assert.equal(tries,4);assert.equal(timers.queue.length,3,'no retry after success');
 assert.equal(changes.at(-1),null);
});
test('cancel and run start over, and a stale attempt cannot reschedule',async()=>{
 const timers=fakeTimers();let release;const r=new Retry(()=>new Promise((_,reject)=>release=reject),{delays:[10],timers});
 const first=r.run();r.cancel();release(new Error('late'));await first;
 assert.equal(timers.queue.length,0);assert.equal(r.error,null);
 const second=r.run();release(new Error('now'));await second;assert.equal(r.error,'now');assert.equal(timers.queue.length,1);
 r.cancel();assert.equal(timers.queue[0].fn,null);
});
