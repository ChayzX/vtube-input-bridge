import { createHash } from 'node:crypto';
export const failure=(code,message=code)=>({ok:false,code,message});
export class Dispatcher {
 constructor(run,{maxPending=16,maxCache=2048,clock=Date.now}={}) { this.run=run; this.maxPending=maxPending; this.maxCache=maxCache; this.clock=clock; this.entries=new Map(); this.pending=0; this.tail=Promise.resolve(); }
 execute(c) {
  const now=this.clock();
  if(!c||typeof c.id!=='string'||!c.id||c.id.length>128||typeof c.action!=='string'||c.action.length>80||!['local','peer'].includes(c.target)||!Number.isSafeInteger(c.expiresAt)||!c.args||typeof c.args!=='object'||Array.isArray(c.args)) return Promise.resolve(failure('invalid_command'));
  // Cache entries are retained longer than any accepted command can remain live.
  for(const [id,e] of this.entries) if(e.done&&e.until<now) this.entries.delete(id);
  const signature=createHash('sha256').update(JSON.stringify(c)).digest('hex'); const old=this.entries.get(c.id);
  if(old) return signature===old.signature?old.promise:Promise.resolve(failure('id_conflict'));
  if(c.expiresAt<=now) return Promise.resolve(failure('expired'));
  if(c.expiresAt>now+10000) return Promise.resolve(failure('invalid_expiry'));
  if(this.pending>=this.maxPending||this.entries.size>=this.maxCache) return Promise.resolve(failure('busy'));
  this.pending++;
  const entry={signature,until:now+60000,done:false};
  entry.promise=this.tail.then(async()=>{
   if(c.expiresAt<=this.clock()) return failure('expired');
   try {const data=await this.run(c); return {ok:true,data};} catch(e) {return failure(e.code||'action_failed',e.publicMessage||'Action failed; it may already have happened. Check the target app before pressing again.');}
  }).finally(()=>{this.pending--;entry.done=true;});
  this.tail=entry.promise.then(()=>{}); this.entries.set(c.id,entry); return entry.promise;
 }
}
