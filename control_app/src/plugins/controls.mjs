import {obsAction} from '../obs.mjs';import {describing,userError} from '../errors.mjs';import {vtsAction} from '../vts.mjs';import {mediaAction} from '../media.mjs';

// Stream Deck controls for OBS scenes, Spotify and VTube Studio hotkeys on this PC. Each app is off until enabled in
// settings; commands arrive from this PC's Stream Deck or from the paired PC over the secure link.
export function createControlsPlugin({getConfig,linkError,mediaExe,saveVtsToken}){
 const names={obs:'OBS',spotify:'Spotify',vts:'VTube Studio'};
 const enabled=section=>{const config=getConfig();if(!config?.[section]?.enabled)throw userError(`${names[section]} controls are turned off on this PC. Turn them on under Apps on this PC and save.`,'disabled');return config;};
 return {id:'controls',name:'Stream Deck controls',
  start(){const error=linkError();if(error)throw new Error(error);},
  status(){const c=getConfig();return c?{obs:c.obs.enabled,spotify:c.spotify.enabled,vts:c.vts.enabled}:{};},
  actions:{
   'obs.*':(args,deadline,name)=>describing('OBS',()=>obsAction({...enabled('obs').obs,...deadline},name,args)),
   'spotify.*':(args,deadline,name)=>describing('Spotify',()=>{enabled('spotify');return mediaAction({exe:mediaExe,...deadline},name);}),
   'vts.*':(args,deadline,name)=>describing('VTube Studio',()=>vtsAction({...enabled('vts').vts,...deadline,saveToken:saveVtsToken},name,args))
  }};
}
