import {BrowserWindow} from 'electron';import {validateSourceUrl,fugiPermission} from './frames.mjs';
const partition='persist:fugi-reactives';
function harden(contents,allowRpc=false){
 contents.session.setPermissionRequestHandler((wc,permission,callback,details)=>{let origin;try{origin=new URL(details.requestingUrl).origin;}catch{}callback(allowRpc&&fugiPermission(permission,origin,wc.getURL()));});
 contents.session.setPermissionCheckHandler((wc,permission,origin)=>allowRpc&&!!wc&&fugiPermission(permission,origin,wc.getURL()));
 contents.on('will-attach-webview',e=>e.preventDefault());
}
export function openFugiLogin(){
 const win=new BrowserWindow({width:800,height:650,title:'Fugi login — no images are relayed from this window',webPreferences:{partition,sandbox:true,nodeIntegration:false,contextIsolation:true}});harden(win.webContents);
 const allowed=u=>{try{const p=new URL(u);return p.protocol==='https:'&&['reactive.fugi.tech','discord.com'].includes(p.hostname);}catch{return false;}};
 win.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
 win.webContents.setWindowOpenHandler(({url})=>allowed(url)?{action:'allow',overrideBrowserWindowOptions:{webPreferences:{partition,sandbox:true,nodeIntegration:false,contextIsolation:true}}}:{action:'deny'});
 win.loadURL('https://reactive.fugi.tech/');return win;
}
export class ReactiveRenderer {
 constructor(send){this.send=send;this.state='Stopped';this.window=null;this.latest=null;this.busy=false;this.timer=null;this.lastSent=0;}
 async start(value){
  const url=validateSourceUrl(value);this.stop();
  const win=new BrowserWindow({show:false,width:1024,height:512,transparent:true,backgroundColor:'#00000000',webPreferences:{partition:'persist:fugi-renderer',offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  this.window=win;this.state='Starting experimental renderer';harden(win.webContents,true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const sameSource=u=>u===url.href;
  win.webContents.on('will-navigate',(event,u)=>{if(!sameSource(u)){event.preventDefault();this.latest=null;this.state='Fugi login or navigation required';}});
  win.webContents.on('will-redirect',(event,u)=>{if(!sameSource(u)){event.preventDefault();this.latest=null;this.state='Fugi login required';}});
  win.webContents.on('render-process-gone',()=>{this.latest=null;this.state='Fugi renderer stopped';});
  win.on('unresponsive',()=>{this.latest=null;this.state='Fugi renderer unresponsive';});
  win.webContents.on('paint',(_event,_dirty,image)=>{if(win.webContents.getURL()===url.href){this.latest=image.toPNG();}});
  win.webContents.setFrameRate(10);
  win.webContents.on('did-fail-load',()=>{this.latest=null;this.state='Fugi source unavailable';});
  try{await win.loadURL(url.href);}catch{this.stop();throw new Error('Could not load Fugi source');}
  this.state='Rendering — Discord response needs verification';
  this.timer=setInterval(async()=>{
   if(this.busy||win.isDestroyed())return;this.busy=true;let timeout;
   try{
    const isEmbed=await Promise.race([win.webContents.executeJavaScript(`(()=>{const e=document.getElementById('embed');try{const c=JSON.parse(e?.dataset.config||'{}');return ['group','individual'].includes(c.embed);}catch{return false;}})()`),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Renderer unresponsive')),750))]);
    clearTimeout(timeout);if(!isEmbed||win.webContents.getURL()!==url.href)throw Error('Not a Fugi embed');
    const image=await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Capture timeout')),750))]);
    clearTimeout(timeout);if(this.window!==win)return;const png=image.toPNG();if(png.length>2*1024*1024)throw Error('Frame too large');
    await this.send(png);this.lastSent=Date.now();this.state='Sending images — verify speaking states';
   }catch{this.latest=null;this.state='Source or Canada unavailable';}finally{clearTimeout(timeout);this.busy=false;}
  },100);
 }
 stop(){clearInterval(this.timer);this.timer=null;this.latest=null;this.window?.destroy();this.window=null;this.state='Stopped';}
}
