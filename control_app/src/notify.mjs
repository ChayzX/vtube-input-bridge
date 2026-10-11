// Windows notifications (tray balloons) for things the streamer should know while the window is closed: tracking or
// the other PC dropping out mid-stream, an update waiting, an update finished. Each watched condition must hold for a
// while before it notifies (a reconnect blip is not news), notifies once, says once when it is fixed, and stays quiet
// for ten minutes after that so a flapping connection cannot spam the screen.
export class Notifier {
 constructor({show,enabled=()=>true,now=Date.now,quiet=600000}){Object.assign(this,{show,enabled,now,quiet});this.watched=new Map();}
 // Called on every check with the condition's current state. `message` is {title, body}, `fixed` is shown on recovery.
 watch(key,bad,{after=15000,message,fixed}={}){
  const now=this.now();const w=this.watched.get(key)||{since:null,shown:false,lastShown:-Infinity};this.watched.set(key,w);
  if(bad){
   if(w.since===null)w.since=now;
   if(!w.shown&&now-w.since>=after&&now-w.lastShown>=this.quiet&&message){w.shown=true;w.lastShown=now;this.notify(message);}
  }else{
   if(w.shown&&fixed)this.notify(fixed);
   w.since=null;w.shown=false;
  }
 }
 // A one-off notification (an update result, pairing finished on the other PC).
 notify({title,body}){if(!this.enabled())return false;try{this.show(title,body);return true;}catch{return false;}}
}
