import test from 'node:test';import assert from 'node:assert/strict';import {SerialQueue} from '../src/serial.mjs';
test('configuration mutations are serialized and failure does not poison following save',async()=>{
 const q=new SerialQueue();const order=[];let release;
 const first=q.run(async()=>{order.push('save start');await new Promise(r=>release=r);order.push('save end');throw Error('disk');});
 const second=q.run(async()=>order.push('disable'));await new Promise(r=>setImmediate(r));assert.deepEqual(order,['save start']);release();await assert.rejects(first);await second;assert.deepEqual(order,['save start','save end','disable']);
});
test('visibility change expires while waiting for another configuration transaction',async()=>{
 const q=new SerialQueue();let release,changed=false;
 const first=q.run(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
 const queued=q.runWithDeadline({expiresAt:Date.now()+10},()=>{changed=true;});await new Promise(r=>setTimeout(r,20));release();await first;await assert.rejects(queued,/expired/);assert.equal(changed,false);
});
