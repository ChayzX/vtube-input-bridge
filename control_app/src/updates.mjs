import {open,mkdir,rm,rename,readFile} from 'node:fs/promises';import {createWriteStream} from 'node:fs';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {spawn as nodeSpawn} from 'node:child_process';

// Updates. The installer (Install-VTubeInputBridge.cmd) is the update: run with VTC_UPDATE=1 it installs without asking,
// keeps this PC's role and settings, and starts the app again (scripts/Control-OneClick.ps1). This file finds a newer
// installer (GitHub releases, a file the streamer picks, or one the other PC pushes over the PC link), checks it, and
// runs it. Both PCs must run the same version, so the PC that updates first sends the installer to the other PC.
export const INSTALLER='Install-VTubeInputBridge.cmd';
export const REPOSITORY='ChayzX/vtube-input-bridge';
const MAX_BYTES=1024*1024*1024;

// "1.2.3" or "1.2.3-rc.1". Returns null for anything else.
export function parseVersion(text){
 const m=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.]+))?$/i.exec(String(text??'').trim());
 return m?{core:[+m[1],+m[2],+m[3]],pre:m[4]?m[4].split('.'):[]}:null;
}
// Semantic version order: a release sorts after its prereleases; numeric prerelease parts compare as numbers.
export function compareVersions(a,b){
 const x=parseVersion(a),y=parseVersion(b);if(!x||!y)throw new Error('Unreadable version');
 for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return Math.sign(x.core[i]-y.core[i]);
 if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const p=x.pre[i],q=y.pre[i];if(p===undefined)return -1;if(q===undefined)return 1;
  const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
  if(pn&&qn&&+p!==+q)return Math.sign(+p-+q);if(pn!==qn)return pn?-1:1;if(p!==q)return p<q?-1:1;
 }
 return 0;
}
export const isNewer=(candidate,current)=>{try{return compareVersions(candidate,current)>0;}catch{return false;}};

// Reads the version an installer file carries, from its script header. Throws if the file is not our installer.
export async function installerVersion(path){
 const file=await open(path,'r');let text;
 try{const buffer=Buffer.alloc(65536);const {bytesRead}=await file.read(buffer,0,buffer.length,0);text=buffer.subarray(0,bytesRead).toString('latin1');}finally{await file.close();}
 const version=/^\$Version = '([^']+)'\r?$/m.exec(text)?.[1];
 if(!text.startsWith('@echo off')||!text.includes('#VTC-SCRIPT#')||!text.includes('#VTC-PAYLOAD#')||!parseVersion(version))throw new Error(`That file is not a VTube Input Bridge installer. Choose ${INSTALLER}.`);
 return version;
}

// The newest published release on GitHub: {version, url, size, page} or null when there is none. A private repository
// answers 404 to a request without a token, which reads as "none".
export async function latestRelease({repository=REPOSITORY,fetchFn=fetch}={}){
 const response=await fetchFn(`https://api.github.com/repos/${repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'VTube-Input-Bridge'},signal:AbortSignal.timeout(15000)});
 if(response.status===404)return null;
 if(!response.ok)throw new Error(`GitHub answered ${response.status} when checking for updates.`);
 const release=await response.json();const asset=(release.assets||[]).find(a=>a.name===INSTALLER);
 const version=String(release.tag_name||'').replace(/^v/,'');
 if(!asset||!parseVersion(version))return null;
 return {version,url:asset.browser_download_url,size:asset.size,page:release.html_url};
}

// Saves a body stream into `dir` as the installer, checking size (and the SHA-256 when given). Returns the path.
async function save(stream,dir,{sha256,length}={}){
 await mkdir(dir,{recursive:true});const temp=join(dir,`${randomUUID()}.part`);const hash=createHash('sha256');let size=0;
 try{
  await new Promise((resolve,reject)=>{
   const out=createWriteStream(temp,{mode:0o600});out.on('error',reject);out.on('finish',resolve);
   stream.on('error',reject);stream.on('aborted',()=>reject(new Error('The transfer was cut off.')));
   stream.on('data',b=>{size+=b.length;if(size>MAX_BYTES){reject(new Error('The installer is too large.'));stream.destroy?.();return;}hash.update(b);if(!out.write(b))stream.pause?.(),out.once('drain',()=>stream.resume?.());});
   stream.on('end',()=>out.end());
  });
  if(Number.isFinite(length)&&size!==length)throw new Error('The installer arrived incomplete.');
  if(sha256&&hash.digest('hex')!==sha256)throw new Error('The installer failed its checksum.');
  const path=join(dir,INSTALLER);await rm(path,{force:true});await rename(temp,path);return path;
 }catch(e){await rm(temp,{force:true}).catch(()=>{});throw e;}
}

export async function download(url,dir,{fetchFn=fetch}={}){
 if(!/^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(url))throw new Error('Updates only download from GitHub.');
 const response=await fetchFn(url,{redirect:'follow',headers:{'User-Agent':'VTube-Input-Bridge'},signal:AbortSignal.timeout(600000)});
 if(!response.ok||!response.body)throw new Error(`The download failed (${response.status}).`);
 const {Readable}=await import('node:stream');const length=Number(response.headers.get('content-length'));
 return save(Readable.fromWeb(response.body),dir,{length:Number.isFinite(length)&&length>0?length:undefined});
}

// An installer pushed by the other PC (PUT /update): its SHA-256 and version come in headers and must match the file.
// Refuses anything not newer than `current`, so a push can never downgrade this PC.
export async function receive(req,{dir,current}){
 const sha256=String(req.headers['x-update-sha256']||'');const version=String(req.headers['x-update-version']||'');const length=Number(req.headers['content-length']);
 if(!/^[a-f0-9]{64}$/.test(sha256)||!parseVersion(version)||!(length>0&&length<=MAX_BYTES))throw Object.assign(new Error('The update request was incomplete.'),{code:'invalid_request'});
 if(!isNewer(version,current))throw Object.assign(new Error(`This PC already runs ${current}.`),{code:'not_newer'});
 const path=await save(req,join(dir,'from-peer'),{sha256,length});
 if(await installerVersion(path)!==version)throw Object.assign(new Error('The installer does not carry the version it was sent as.'),{code:'invalid_request'});
 return {path,version};
}

export async function fileSha256(path){const hash=createHash('sha256');const file=await open(path,'r');try{for await(const chunk of file.createReadStream())hash.update(chunk);}finally{await file.close().catch(()=>{});}return hash.digest('hex');}

// Starts the installer in update mode, detached so it outlives this app (the installer waits for the app to exit).
export function runInstaller(path,{spawn=nodeSpawn,env=process.env}={}){
 const child=spawn(env.ComSpec||'cmd.exe',['/d','/c',path],{detached:true,stdio:'ignore',windowsHide:true,env:{...env,VTC_UPDATE:'1',VTC_QUIET:'1'}});
 child.unref?.();return child;
}

// What the installer wrote about the last update run (scripts/Control-OneClick.ps1): {version, ok, message, at}.
export async function lastUpdate(file){
 try{const value=JSON.parse((await readFile(file,'utf8')).replace(/^﻿/,''));await rm(file,{force:true});
  return value&&typeof value==='object'?{version:String(value.version||''),ok:!!value.ok,message:String(value.message||'').slice(0,500),at:String(value.at||'')}:null;}
 catch{return null;}
}
