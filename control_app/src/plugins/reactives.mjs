import {userError} from '../errors.mjs';import {validateSourceUrl} from '../frames.mjs';
// Reactive avatars: the gaming PC renders the Fugi browser source and relays frames over the secure link; the stream
// PC serves them to a VTube Studio Web Item. Show/hide is remembered in settings.
export function createReactivesPlugin({getConfig,linkError,renderer,frames,setVisible,clearPeerFrame}){
 // Refusals here are certain to have changed nothing, so they say exactly why.
 const only=role=>{if(getConfig()?.role!==role)throw userError(role==='pantry'?'The reactive renderer runs on the gaming PC (Pantry). Point this button at Pantry.':'Reactives are shown and hidden on the stream PC (Canada). Point this button at Canada.','wrong_pc');};
 return {id:'reactives',name:'Reactives',
  start(){const error=linkError();if(error)throw new Error(error);},
  stop(){renderer.stop();},
  status(){return {state:renderer.state,frameFresh:!!frames.get(),visible:!!getConfig()?.reactive.visible};},
  actions:{
   'reactive.status':()=>({state:renderer.state,frameFresh:!!frames.get(),visible:getConfig().reactive.visible}),
   'reactive.show':async(args,deadline)=>(only('canada'),{visible:await setVisible(true,deadline)}),
   'reactive.hide':async(args,deadline)=>(only('canada'),{visible:await setVisible(false,deadline)}),
   'reactive.start':async()=>{only('pantry');const {enabled,url}=getConfig().reactive;
    if(!enabled)throw userError('Fugi rendering is turned off on this PC. Tick "Allow experimental rendering on Pantry" in settings and save.','disabled');
    if(!url)throw userError('Enter the Fugi group browser-source URL in settings on Pantry and save.','not_configured');
    try{validateSourceUrl(url);}catch(e){throw userError(String(e.message).replace(/\.?$/,'.'),'not_configured');}
    await renderer.start(url);return {state:renderer.state};},
   'reactive.stop':async()=>{only('pantry');renderer.stop();await clearPeerFrame().catch(()=>{});return {state:'Stopped'};}
  }};
}
