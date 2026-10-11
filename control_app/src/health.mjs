// One glanceable verdict for the tray: its icon colour, the status line at the top of its menu and its tooltip.
// Levels, worst first: err (tracking or the PC link is down), warn (something needs attention), off (tracking paused
// on purpose), ok (live-ready). The settings window's Home page makes the same call with more detail.
const rank={ok:0,off:1,warn:2,err:3};
const apps={obs:'OBS',meld:'Meld Studio',spotify:'Spotify',vts:'VTube Studio'};

export function trackingHealth(t){
 if(!t||!t.role)return {level:'warn',line:'Tracking is starting',short:'Starting'};
 if(t.role==='sender'){
  if(t.legacy)return {level:'err',line:'The old tracking app is still running',short:'Blocked by the old app'};
  if(t.state==='Blocked')return {level:'err',line:'Tracking has stopped',short:'Stopped'};
  if(t.running)return t.receiverConnected?{level:'ok',line:'Tracking is reaching the Streaming PC',short:'Connected'}
   :{level:'warn',line:'Tracking is waiting for the Streaming PC',short:'Waiting for the Streaming PC'};
  if(t.state==='Stopped'&&!t.error)return {level:'off',line:'Tracking is paused',short:'Paused'};
  if(t.state==='Stopped')return {level:'err',line:'Tracking could not start',short:'Could not start'};
  return {level:'warn',line:'Tracking is starting',short:'Starting'};
 }
 if(t.state==='Receiving input')return {level:'ok',line:'Receiving tracking from the Gaming PC',short:'Receiving'};
 if(t.state==='Receiver stopped')return {level:'err',line:'The tracking receiver has stopped',short:'Stopped'};
 if(t.state==='Waiting for VTube Studio')return {level:'warn',line:'Tracking is waiting for VTube Studio',short:'Waiting for VTube Studio'};
 if(t.state==='Waiting for the Gaming PC')return {level:'warn',line:'Tracking is waiting for the Gaming PC',short:'Waiting for the Gaming PC'};
 return {level:'warn',line:'Tracking is starting',short:'Starting'};
}

export function linkHealth({linkError,bindError,config}){
 if(linkError)return {level:'err',line:'The PC link could not start',short:'Down'};
 if(!config)return {level:'warn',line:'The PC link is starting',short:'Starting'};
 if(!config.peer)return {level:'warn',line:'Pair this PC with the other PC',short:'Not paired'};
 if(!config.enabled)return {level:'warn',line:'Remote controls are paused',short:'Paused'};
 if(bindError)return {level:'warn',line:'The PC link is retrying',short:'Retrying'};
 return {level:'ok',line:'PCs paired',short:'Paired'};
}

export function trayHealth({tracking,linkError,bindError,config,services={}}){
 const parts=[trackingHealth(tracking),linkHealth({linkError,bindError,config})];
 // Only an app this PC is set to use counts: a failed press on an app that was since turned off is history.
 for(const [id,name] of Object.entries(apps))if(config?.[id]?.enabled&&services[id]&&services[id].ok===false)parts.push({level:'warn',line:`${name} isn't answering`});
 const worst=parts.reduce((a,b)=>rank[b.level]>rank[a.level]?b:a);
 const attention=parts.filter(p=>p.level==='warn'||p.level==='err').length;
 const line=worst.level==='ok'?'Live-ready':worst.line+(attention>1?` (+${attention-1} more)`:'');
 const tooltip=`VTube Input Bridge — ${line}\nTracking: ${parts[0].short} · PC link: ${parts[1].short}`.slice(0,127);
 return {level:worst.level,line,tooltip};
}
