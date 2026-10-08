import {BrowserWindow} from 'electron';import {validateSourceUrl,fugiPermission} from './frames.mjs';import {userError} from './errors.mjs';
// The login window and the renderer share one browser session (and so its permission handlers, which only ever allow a
// Fugi embed page to reach local Discord), so a Fugi login is what the renderer uses.
const partition='persist:fugi-renderer';
function harden(contents,allowRpc=false){
 contents.session.setPermissionRequestHandler((wc,permission,callback,details)=>{let origin;try{origin=new URL(details.requestingUrl).origin;}catch{}callback(allowRpc&&fugiPermission(permission,origin,wc.getURL()));});
 contents.session.setPermissionCheckHandler((wc,permission,origin)=>allowRpc&&!!wc&&fugiPermission(permission,origin,wc.getURL()));
 contents.on('will-attach-webview',e=>e.preventDefault());
}
export function openFugiLogin(){
 const win=new BrowserWindow({width:800,height:650,title:'Fugi login — no images are relayed from this window',webPreferences:{partition,sandbox:true,nodeIntegration:false,contextIsolation:true}});harden(win.webContents,true);
 const allowed=u=>{try{const p=new URL(u);return p.protocol==='https:'&&['reactive.fugi.tech','discord.com'].includes(p.hostname);}catch{return false;}};
 win.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
 win.webContents.setWindowOpenHandler(({url})=>allowed(url)?{action:'allow',overrideBrowserWindowOptions:{webPreferences:{partition,sandbox:true,nodeIntegration:false,contextIsolation:true}}}:{action:'deny'});
 win.loadURL('https://reactive.fugi.tech/');return win;
}
export class ReactiveRenderer {
 constructor(send){this.send=send;this.state='Stopped';this.problem=null;this.window=null;this.busy=false;this.timer=null;this.lastSent=0;}
 async start(value){
  const url=validateSourceUrl(value);this.stop();
  const win=new BrowserWindow({show:false,width:1024,height:512,transparent:true,backgroundColor:'#00000000',webPreferences:{partition,offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  this.window=win;this.state='Starting experimental renderer';this.problem=null;harden(win.webContents,true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const sameSource=u=>u===url.href;
  // A specific cause stays shown until a frame gets through, rather than the generic one from the next capture.
  const fail=problem=>{this.problem=problem;this.state=problem;};
  const login='Fugi login required: use “Log in to Fugi on Pantry”, then start the renderer again';
  win.webContents.on('will-navigate',(event,u)=>{if(!sameSource(u)){event.preventDefault();fail(login);}});
  win.webContents.on('will-redirect',(event,u)=>{if(!sameSource(u)){event.preventDefault();fail(login);}});
  win.webContents.on('render-process-gone',()=>fail('Fugi renderer stopped; start it again'));
  win.on('unresponsive',()=>fail('Fugi renderer unresponsive'));
  win.webContents.setFrameRate(10);
  win.webContents.on('did-fail-load',()=>fail('Fugi source unavailable: check the URL and the network'));
  try{await win.loadURL(url.href);}
  catch{const problem=this.problem;this.stop();if(problem===login){this.state=login;throw userError(login+'.','login_required');}
   throw userError('Could not load the Fugi browser source. Check the URL in settings and that Pantry is online.','unavailable');}
  this.state='Rendering — Discord response needs verification';
  this.timer=setInterval(async()=>{
   if(this.busy||win.isDestroyed())return;this.busy=true;let timeout,stage='source';
   try{
    const isEmbed=await Promise.race([win.webContents.executeJavaScript(`(()=>{const e=document.getElementById('embed');try{const c=JSON.parse(e?.dataset.config||'{}');return ['group','individual'].includes(c.embed);}catch{return false;}})()`),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Renderer unresponsive')),750))]);
    clearTimeout(timeout);if(!isEmbed||win.webContents.getURL()!==url.href)throw Error('Not a Fugi embed');
    const image=await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Capture timeout')),750))]);
    clearTimeout(timeout);if(this.window!==win)return;const png=image.toPNG();if(png.length>2*1024*1024)throw Error('Frame too large');
    stage='upload';await this.send(png);this.lastSent=Date.now();this.problem=null;this.state='Sending images — verify speaking states';
   }catch{this.state=this.problem||(stage==='upload'?'Canada unavailable: frames are not getting through':'Fugi page is not showing a group or individual embed');}finally{clearTimeout(timeout);this.busy=false;}
  },100);
 }
 stop(){clearInterval(this.timer);this.timer=null;this.problem=null;this.window?.destroy();this.window=null;this.state='Stopped';}
}
