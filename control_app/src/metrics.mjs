// In-memory metrics for the Metrics page: one value per second per series in fixed-size ring buffers (15 minutes by
// default), plus running totals since the app started. Nothing is saved. Recording is a counter increment or an array
// push, so a Stream Deck press pays nothing measurable; the per-second work happens in tick().

export class Ring{
 constructor(capacity){this.capacity=capacity;this.data=new Float64Array(capacity);this.start=0;this.length=0;}
 push(value){
  const i=(this.start+this.length)%this.capacity;this.data[i]=value;
  if(this.length<this.capacity)this.length++;else this.start=(this.start+1)%this.capacity;
 }
 at(i){return this.data[(this.start+i)%this.capacity];}
 // Oldest first, from position `from`.
 toArray(from=0){const out=[];for(let i=Math.max(0,from);i<this.length;i++)out.push(this.at(i));return out;}
}

// The p-th percentile (0–100) with linear interpolation between the closest ranks; NaN when there are no values.
export function percentile(values,p){
 const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return NaN;
 const rank=Math.min(Math.max(p,0),100)/100*(v.length-1);const lo=Math.floor(rank),hi=Math.ceil(rank);
 return v[lo]+(v[hi]-v[lo])*(rank-lo);
}

// Kinds: 'count' (events per second, 0 when none), 'observe' (per-second p50 and p95 of the values seen, a gap when
// none), 'gauge' (the latest value set during the second, a gap when none) and 'cumulative' (a total kept elsewhere,
// such as the tracking helper's packet counter, turned into a per-second rate).
export class Metrics{
 constructor({seconds=900,clock=Date.now,recent=500}={}){
  Object.assign(this,{seconds,clock,recentSize:recent});
  this.startedAt=clock();this.times=new Ring(seconds);this.series=new Map();
  this.counts=new Map();this.observed=new Map();this.gauges=new Map();this.last=new Map();this.totals={};this.recent=new Map();
 }
 // A series first seen after some ticks is filled back to the start: zero for counts, gaps for the rest.
 ensure(name,fill){let ring=this.series.get(name);if(!ring){ring=new Ring(this.seconds);for(let i=0;i<this.times.length;i++)ring.push(fill);this.series.set(name,ring);}return ring;}
 count(name,n=1){
  if(!this.counts.has(name)){this.ensure(name,0);this.counts.set(name,0);}
  this.counts.set(name,this.counts.get(name)+n);this.totals[name]=(this.totals[name]||0)+n;
 }
 // Adds to a total without a graph, e.g. Stream Deck results by exact code.
 tally(name,n=1){this.totals[name]=(this.totals[name]||0)+n;}
 observe(name,value){
  if(!Number.isFinite(value))return;
  if(!this.observed.has(name)){this.ensure(name+'.p50',NaN);this.ensure(name+'.p95',NaN);this.observed.set(name,[]);this.recent.set(name,new Ring(this.recentSize));}
  this.observed.get(name).push(value);this.recent.get(name).push(value);
 }
 gauge(name,value){this.ensure(name,NaN);this.gauges.set(name,Number.isFinite(value)?value:NaN);}
 cumulative(name,total){
  if(!Number.isFinite(total))return;
  const previous=this.last.get(name);this.last.set(name,total);
  if(previous===undefined)return;// the first reading only sets the baseline
  this.count(name,total>=previous?total-previous:total);// smaller: the counter restarted from zero
 }
 // Closes the current second.
 tick(){
  this.times.push(this.clock());
  for(const [name,ring] of this.series){
   if(this.counts.has(name)){ring.push(this.counts.get(name));this.counts.set(name,0);continue;}
   if(this.gauges.has(name)){ring.push(this.gauges.get(name));this.gauges.delete(name);continue;}
   const base=name.replace(/\.p(50|95)$/,'');const values=this.observed.get(base);
   if(values)ring.push(percentile(values,name.endsWith('.p50')?50:95));
   else ring.push(NaN);
  }
  for(const values of this.observed.values())values.length=0;
 }
 // Points newer than `since` (a tick time), so a page that polls every second gets only what is new.
 snapshot(since=0){
  let from=0;while(from<this.times.length&&this.times.at(from)<=since)from++;
  const series={};for(const [name,ring] of this.series)series[name]=ring.toArray(from);
  const recent={};for(const [name,ring] of this.recent){const values=ring.toArray();recent[name]={p50:percentile(values,50),p95:percentile(values,95),samples:values.length};}
  const now=this.clock();
  return {now,startedAt:this.startedAt,uptime:now-this.startedAt,interval:1000,capacity:this.seconds,times:this.times.toArray(from),series,totals:{...this.totals},recent};
 }
}

// Stream Deck results by kind: refused before anything ran (a stale press, a turned-off app, a bad request), failed
// while running, or worked.
const refusedCodes=new Set(['expired','busy','invalid_command','invalid_expiry','id_conflict','disabled','not_paired','unauthorized','forbidden','invalid_request','invalid_target','too_large','not_found','unsupported','wrong_pc','not_configured']);
export const outcomeKind=result=>result?.ok?'ok':refusedCodes.has(result?.code)?'refused':'failed';
