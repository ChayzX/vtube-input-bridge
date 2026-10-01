// Reactive avatars: the gaming PC renders the Fugi browser source and relays frames over the secure link; the stream
// PC serves them to a VTube Studio Web Item. Show/hide is remembered in settings.
export function createReactivesPlugin({getConfig,linkError,renderer,frames,setVisible,clearPeerFrame}){
 const pantryOnly=()=>{if(getConfig()?.role!=='pantry')throw new Error('Action unsupported or disabled');};
 return {id:'reactives',name:'Reactives',
  start(){const error=linkError();if(error)throw new Error(error);},
  stop(){renderer.stop();},
  status(){return {state:renderer.state,frameFresh:!!frames.get(),visible:!!getConfig()?.reactive.visible};},
  actions:{
   'reactive.status':()=>({state:renderer.state,frameFresh:!!frames.get(),visible:getConfig().reactive.visible}),
   'reactive.show':async(args,deadline)=>({visible:await setVisible(true,deadline)}),
   'reactive.hide':async(args,deadline)=>({visible:await setVisible(false,deadline)}),
   'reactive.start':async()=>{pantryOnly();if(!getConfig().reactive.enabled)throw new Error('Action unsupported or disabled');await renderer.start(getConfig().reactive.url);return {state:renderer.state};},
   'reactive.stop':async()=>{pantryOnly();renderer.stop();await clearPeerFrame().catch(()=>{});return {state:'Stopped'};}
  }};
}
