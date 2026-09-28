import test from 'node:test';import assert from 'node:assert/strict';import {SerialQueue} from '../src/serial.mjs';
test('configuration mutations are serialized and failure does not poison following save',async()=>{
 const q=new SerialQueue();const order=[];let release;
 const first=q.run(async()=>{order.push('save start');await new Promise(r=>release=r);order.push('save end');throw Error('disk');});
 const second=q.run(async()=>order.push('disable'));await new Promise(r=>setImmediate(r));assert.deepEqual(order,['save start']);release();await assert.rejects(first);await second;assert.deepEqual(order,['save start','save end','disable']);
});
