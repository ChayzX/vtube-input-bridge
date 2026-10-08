// Runs `fn` until it succeeds, waiting delays[i] after the i-th failure (the last delay repeats). run() starts over and
// resolves after the first attempt; cancel() stops further attempts. `error` holds the latest failure, or null.
export class Retry {
 constructor(fn,{delays=[2000,5000,10000,30000],timers=globalThis,onChange=()=>{}}={}){Object.assign(this,{fn,delays,timers,onChange});this.timer=null;this.attempt=0;this.error=null;this.generation=0;}
 run(){this.cancel();this.attempt=0;return this.tick(this.generation);}
 async tick(generation){
  try{await this.fn();if(generation!==this.generation)return;this.error=null;}
  catch(e){if(generation!==this.generation)return;this.error=e?.message||String(e);
   this.timer=this.timers.setTimeout(()=>{this.timer=null;this.tick(generation);},this.delays[Math.min(this.attempt++,this.delays.length-1)]);}
  this.onChange(this.error);
 }
 cancel(){this.generation++;if(this.timer)this.timers.clearTimeout(this.timer);this.timer=null;this.error=null;}
}
