import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Readable} from 'node:stream';import {createHash} from 'node:crypto';
import {compareVersions,isNewer,installerVersion,latestRelease,receive,lastUpdate,runInstaller,INSTALLER} from '../src/updates.mjs';
import {Notifier} from '../src/notify.mjs';

const installer=version=>Buffer.from(['@echo off','setlocal','exit /b 0','','#VTC-SCRIPT#',`$Version = '${version}'`,'#VTC-PAYLOAD#','payload'].join('\r\n'));
const temp=()=>mkdtemp(join(tmpdir(),'vtib-update-'));

test('versions sort the way releases do: prereleases before the release, numbers as numbers',()=>{
 assert.equal(compareVersions('1.0.0','1.0.0-rc.1'),1);assert.equal(compareVersions('1.0.0-rc.2','1.0.0-rc.10'),-1);
 assert.equal(compareVersions('0.3.0-preview.5','1.0.0-rc.1'),-1);assert.equal(compareVersions('v1.2.3','1.2.3'),0);
 assert.equal(isNewer('1.0.1','1.0.0'),true);assert.equal(isNewer('1.0.0','1.0.0'),false);assert.equal(isNewer('nonsense','1.0.0'),false);
});

test('only a real installer is accepted, and its version is read from its header',async()=>{
 const dir=await temp();
 try{
  await writeFile(join(dir,'a.cmd'),installer('1.0.0-rc.2'));assert.equal(await installerVersion(join(dir,'a.cmd')),'1.0.0-rc.2');
  await writeFile(join(dir,'b.cmd'),'@echo off\r\nformat c:\r\n');await assert.rejects(installerVersion(join(dir,'b.cmd')),/not a VTube Input Bridge installer/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('an installer pushed by the other PC is checked: checksum, version and never a downgrade',async()=>{
 const dir=await temp();const body=installer('1.0.0');const sha=createHash('sha256').update(body).digest('hex');
 const req=(headers,bytes=body)=>Object.assign(Readable.from([bytes]),{headers:{'content-length':String(bytes.length),...headers}});
 try{
  const ok=await receive(req({'x-update-sha256':sha,'x-update-version':'1.0.0'}),{dir,current:'1.0.0-rc.1'});
  assert.equal(ok.version,'1.0.0');assert.deepEqual(await readFile(ok.path),body);assert.equal(ok.path.endsWith(INSTALLER),true);
  await assert.rejects(receive(req({'x-update-sha256':sha,'x-update-version':'1.0.0'}),{dir,current:'1.0.0'}),e=>e.code==='not_newer');
  await assert.rejects(receive(req({'x-update-sha256':'0'.repeat(64),'x-update-version':'1.0.0'}),{dir,current:'0.9.0'}),/checksum/);
  await assert.rejects(receive(req({'x-update-sha256':sha,'x-update-version':'2.0.0'}),{dir,current:'0.9.0'}),/does not carry the version/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('the update check reads the latest GitHub release, and a private repository reads as none',async()=>{
 const answer=(status,body)=>async()=>({status,ok:status===200,json:async()=>body});
 assert.equal(await latestRelease({fetchFn:answer(404,{})}),null);
 const r=await latestRelease({fetchFn:answer(200,{tag_name:'v1.0.0',html_url:'https://github.com/x',assets:[{name:INSTALLER,browser_download_url:'https://github.com/a',size:5}]})});
 assert.deepEqual(r,{version:'1.0.0',url:'https://github.com/a',size:5,page:'https://github.com/x'});
 assert.equal(await latestRelease({fetchFn:answer(200,{tag_name:'v1.0.0',assets:[]})}),null);
 await assert.rejects(latestRelease({fetchFn:answer(500,{})}),/GitHub answered 500/);
});

test('the installer runs detached in update mode, and its result note is read once',async()=>{
 const calls=[];runInstaller('C:\\x\\Install.cmd',{spawn:(cmd,args,o)=>{calls.push({cmd,args,o});return {unref(){}};},env:{ComSpec:'cmd.exe'}});
 assert.deepEqual(calls[0].args,['/d','/c','C:\\x\\Install.cmd']);assert.equal(calls[0].o.detached,true);assert.equal(calls[0].o.env.VTC_UPDATE,'1');
 const dir=await temp();const file=join(dir,'last-update.json');
 try{await writeFile(file,'\uFEFF{"version":"1.0.0","ok":false,"message":"Firewall rule missing","at":"2026-10-11T12:00:00.000Z"}');
  assert.deepEqual(await lastUpdate(file),{version:'1.0.0',ok:false,message:'Firewall rule missing',at:'2026-10-11T12:00:00.000Z'});assert.equal(await lastUpdate(file),null);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('notifications wait out a blip, say once when fixed, and stay quiet if it keeps flapping',()=>{
 let now=0;const shown=[];const n=new Notifier({show:(t,b)=>shown.push(t),now:()=>now});const opts={after:15000,message:{title:'down'},fixed:{title:'back'}};
 n.watch('peer',true,opts);now=10000;n.watch('peer',true,opts);n.watch('peer',false,opts);assert.deepEqual(shown,[],'a 10-second blip is not news');
 now=20000;n.watch('peer',true,opts);now=36000;n.watch('peer',true,opts);n.watch('peer',true,opts);assert.deepEqual(shown,['down']);
 now=40000;n.watch('peer',false,opts);assert.deepEqual(shown,['down','back']);
 now=41000;n.watch('peer',true,opts);now=60000;n.watch('peer',true,opts);assert.deepEqual(shown,['down','back'],'quiet for ten minutes after');
 now=700000;n.watch('peer',true,opts);assert.deepEqual(shown,['down','back','down']);
 const off=new Notifier({show:()=>shown.push('x'),enabled:()=>false});assert.equal(off.notify({title:'t'}),false);
});
