import test from 'node:test';import assert from 'node:assert/strict';import {Ring,percentile,Metrics,outcomeKind} from '../src/metrics.mjs';
test('the ring buffer keeps the newest values, oldest first',()=>{
 const r=new Ring(3);assert.deepEqual(r.toArray(),[]);
 for(const v of [1,2,3,4,5])r.push(v);
 assert.equal(r.length,3);assert.deepEqual(r.toArray(),[3,4,5]);assert.deepEqual(r.toArray(1),[4,5]);assert.equal(r.at(0),3);
});
test('percentiles interpolate between ranks and ignore gaps',()=>{
 assert.ok(Number.isNaN(percentile([],50)));assert.ok(Number.isNaN(percentile([NaN],95)));
 assert.equal(percentile([5],95),5);
 assert.equal(percentile([1,2,3,4],50),2.5);
 assert.equal(percentile([10,1,NaN,7,3],0),1);assert.equal(percentile([10,1,7,3],100),10);
 const hundred=Array.from({length:100},(_,i)=>i+1);
 assert.equal(percentile(hundred,50),50.5);assert.ok(Math.abs(percentile(hundred,95)-95.05)<1e-9);
});
test('counts, observations and gauges close once a second into aligned series',()=>{
 let now=1000;const m=new Metrics({seconds:4,clock:()=>now});
 m.tick();now+=1000;
 m.count('api.ok');m.count('api.ok');m.observe('api.ms',10);m.observe('api.ms',30);m.gauge('tracking.ackAge',25);
 m.tick();now+=1000;
 m.tick();now+=1000;
 const s=m.snapshot();
 assert.deepEqual(s.times,[1000,2000,3000]);
 assert.deepEqual(s.series['api.ok'],[0,2,0],'a count series started later is back-filled with zeros');
 assert.deepEqual(s.series['api.ms.p50'].map(v=>Number.isNaN(v)?null:v),[null,20,null]);
 assert.equal(s.series['api.ms.p95'][1],29);
 assert.deepEqual(s.series['tracking.ackAge'].map(v=>Number.isNaN(v)?null:v),[null,25,null],'a gauge is a gap when not set');
 assert.equal(s.totals['api.ok'],2);assert.equal(s.recent['api.ms'].samples,2);assert.equal(s.uptime,3000);
});
test('only points newer than the last one the page has are sent, and the window is bounded',()=>{
 let now=0;const m=new Metrics({seconds:5,clock:()=>now});
 for(let i=0;i<8;i++){now+=1000;m.count('peer.sent',i);m.tick();}
 const full=m.snapshot();assert.equal(full.times.length,5);assert.deepEqual(full.series['peer.sent'],[3,4,5,6,7]);
 const since=m.snapshot(7000);assert.deepEqual(since.times,[8000]);assert.deepEqual(since.series['peer.sent'],[7]);
 assert.deepEqual(m.snapshot(8000).times,[]);
 assert.equal(full.totals['peer.sent'],28,'totals cover everything since start');
});
test('a counter kept elsewhere becomes a rate, and a restarted counter starts over',()=>{
 let now=0;const m=new Metrics({seconds:10,clock:()=>now});
 for(const total of [100,160,222,10,70]){now+=1000;m.cumulative('tracking.packets',total);m.tick();}
 assert.deepEqual(m.snapshot().series['tracking.packets'],[0,60,62,10,60]);
 m.cumulative('tracking.packets',undefined);// a helper that does not report it changes nothing
 assert.equal(m.snapshot().totals['tracking.packets'],192);
});
test('Stream Deck results are grouped by what happened',()=>{
 assert.equal(outcomeKind({ok:true}),'ok');assert.equal(outcomeKind({ok:false,code:'expired'}),'refused');
 assert.equal(outcomeKind({ok:false,code:'disabled'}),'refused');assert.equal(outcomeKind({ok:false,code:'action_failed'}),'failed');assert.equal(outcomeKind(undefined),'failed');
});
test('recording a press costs microseconds',()=>{
 const m=new Metrics();const start=performance.now();
 for(let i=0;i<100000;i++){m.count('api.ok');m.observe('api.ms',i%50);if(i%1000===0)m.tick();}
 assert.ok((performance.now()-start)/100000<0.02,'under 20 µs per press including the per-second work');
});
