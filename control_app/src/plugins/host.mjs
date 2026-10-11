// Every feature is a plugin: { id, name, start?(), stop?(), status?(), actions?, ui? }.
// `actions` maps command names (e.g. 'reactive.show', or 'obs.*' for a whole family) to async handlers for Stream Deck and peer commands; `ui` maps
// names to handlers the settings window may call. Each plugin starts, stops and fails on its own, so one broken
// feature never takes another down. Tracking above all must keep running when a companion feature fails.
// Only a plugin's own handlers count, never inherited names such as 'constructor'.
const own=(table,name)=>table&&Object.hasOwn(table,name)&&typeof table[name]==='function'?table[name]:null;
export class PluginHost {
 constructor(){this.entries=new Map();}
 add(plugin){
  if(!plugin||typeof plugin.id!=='string'||!/^[a-z]+$/.test(plugin.id))throw new Error('Plugin needs a lowercase id');
  if(this.entries.has(plugin.id))throw new Error(`Duplicate plugin: ${plugin.id}`);
  this.entries.set(plugin.id,{plugin,started:false,error:null});return plugin;
 }
 get(id){return this.entries.get(id)?.plugin;}
 async start(id){
  const entry=this.entries.get(id);if(!entry)throw new Error(`Unknown plugin: ${id}`);
  try{await entry.plugin.start?.();entry.started=true;entry.error=null;}
  catch(e){entry.started=false;entry.error=e?.message||String(e);}
  return entry.error===null;
 }
 async startAll(){for(const id of this.entries.keys())await this.start(id);}
 async stopAll(){
  for(const entry of [...this.entries.values()].reverse()){
   try{await entry.plugin.stop?.();}catch{}
   entry.started=false;
  }
 }
 status(){
  const result={};
  for(const [id,{plugin,started,error}] of this.entries){
   let detail={};
   try{detail=plugin.status?.()??{};}catch(e){detail={statusError:e?.message||String(e)};}
   result[id]={name:plugin.name||id,started,error,...detail};
  }
  return result;
 }
 // Runs a Stream Deck or peer command on the plugin that owns it.
 async action(name,args,deadline){
  for(const {plugin,started,error} of this.entries.values()){
   const handler=own(plugin.actions,name)||own(plugin.actions,name.split('.')[0]+'.*');
   if(handler){if(!started){const e=new Error(`Feature unavailable: ${plugin.name||plugin.id} is not running on this PC${error?` (${String(error).replace(/\.$/,'')})`:''}.`);e.publicMessage=e.message;e.code='unavailable';throw e;}return handler(args,deadline,name);}
  }
  {const e=new Error('That action is unsupported by VTube Input Bridge on this PC. Update the app on both PCs.');e.publicMessage=e.message;e.code='unsupported';throw e;}
 }
 // Runs a settings-window request on one plugin.
 async ui(id,name,args){
  const handler=own(this.get(id)?.ui,name);
  if(!handler)throw new Error('Unknown request');
  return handler(args??{});
 }
}
