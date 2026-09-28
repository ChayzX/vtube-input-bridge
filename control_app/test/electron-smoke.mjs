import {app,BrowserWindow} from 'electron';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
app.whenReady().then(async()=>{
const w=new BrowserWindow({show:false,width:64,height:64,transparent:true,backgroundColor:'#00000000',webPreferences:{offscreen:true,sandbox:true,nodeIntegration:false,contextIsolation:true}});
try{
 const painted=new Promise(r=>w.webContents.once('paint',(_e,_d,img)=>r(img)));
 await w.loadURL('data:text/html,<html style="background:transparent"><body style="margin:0"><div style="width:16px;height:16px;background:red"></div></body></html>');
 const img=await Promise.race([painted,new Promise((_,rej)=>setTimeout(()=>rej(Error('No paint')),8000))]);const bitmap=img.toBitmap();
 assert.equal(bitmap[(63*64+63)*4+3],0,'Background must remain transparent');assert.equal(bitmap[(4*64+4)*4+3],255,'Avatar must remain visible');
 console.log('Offscreen transparent PNG: PASS');
 const ui=new BrowserWindow({show:false,width:750,height:850,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
 await ui.loadFile(fileURLToPath(new URL('../ui/index.html',import.meta.url)));await new Promise(r=>setTimeout(r,200));
 await writeFile(fileURLToPath(new URL('../../../Control-UI-Preview.png',import.meta.url)),(await ui.webContents.capturePage()).toPNG());ui.destroy();
 const icon=new BrowserWindow({show:false,width:144,height:144,transparent:true,webPreferences:{offscreen:true,sandbox:true}});await icon.loadFile(fileURLToPath(new URL('../../streamdeck_plugin/assets/control.svg',import.meta.url)));await new Promise(r=>setTimeout(r,200));await writeFile(fileURLToPath(new URL('../../streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin/imgs/control.png',import.meta.url)),(await icon.webContents.capturePage()).toPNG());icon.destroy();
 const high=new BrowserWindow({show:false,width:288,height:288,transparent:true,webPreferences:{offscreen:true,sandbox:true}});high.webContents.setZoomFactor(2);await high.loadFile(fileURLToPath(new URL('../../streamdeck_plugin/assets/control.svg',import.meta.url)));await new Promise(r=>setTimeout(r,200));await writeFile(fileURLToPath(new URL('../../streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin/imgs/control@2x.png',import.meta.url)),(await high.webContents.capturePage()).toPNG());high.destroy();
 console.log('Local settings UI rendered: PASS');
}catch(e){console.error(e);process.exitCode=1;}finally{w.destroy();app.quit();}
});
