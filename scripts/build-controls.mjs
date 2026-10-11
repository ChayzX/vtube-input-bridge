import {packager} from '../control_app/node_modules/@electron/packager/dist/index.js';import {mkdir,copyFile,readFile,writeFile,readdir,stat,cp,rm} from 'node:fs/promises';import {join,relative} from 'node:path';import {createHash} from 'node:crypto';import {createWriteStream} from 'node:fs';import {createRequire} from 'node:module';const require=createRequire(new URL('../control_app/package.json',import.meta.url));const {ZipFile}=require('yazl');
const root=process.cwd();const version=JSON.parse(await readFile('control_app/package.json')).version;await mkdir('build',{recursive:true});
const [app]=await packager({dir:join(root,'control_app'),name:'VTubeControl',platform:'win32',arch:'x64',out:join(root,'build'),overwrite:true,asar:false,icon:join(root,'control_app/ui/icon.ico'),appVersion:version,buildVersion:'1.0.0.0',win32metadata:{CompanyName:'ChayzX',ProductName:'VTube Input Bridge',FileDescription:'VTube Input Bridge',OriginalFilename:'VTubeControl.exe'},ignore:[/^\/test($|\/)/,/^\/dist($|\/)/],prune:true});
async function files(dir){let result=[];for(const name of await readdir(dir)){const path=join(dir,name);if((await stat(path)).isDirectory())result.push(...await files(path));else result.push({path:relative(app,path).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}return result;}
const manifest=await files(app);
// One role-neutral package for both PCs: the installer asks which PC it is on and runs the Streaming PC scripts there only.
const scripts=['Install-Control.ps1','Rollback-Control.ps1','Control-RollbackCore.ps1','Set-BridgeFirewall.ps1','Uninstall-VTubeInputBridge.ps1','Migrate-StreamPCRelay.ps1','Restore-StreamPCRelay.ps1'];
// Older builds left per-role packages (and other versions) here; New-ControlInstaller.ps1 expects exactly one.
for(const name of await readdir(join(root,'build')))if(/^VTubeControl-(pantry-|canada-|\d)/.test(name))await rm(join(root,'build',name),{recursive:true,force:true});
const packageDir=join(root,'build',`VTubeControl-${version}`);await mkdir(packageDir,{recursive:false});
await cp(app,join(packageDir,'app'),{recursive:true});
for(const file of scripts)await copyFile(join(root,'scripts',file),join(packageDir,file));
await copyFile(join(root,'docs/Control-Setup.md'),join(packageDir,'SETUP.md'));await copyFile(join(root,'docs/Control-Build-Status.md'),join(packageDir,'BUILD-STATUS.md'));
await writeFile(join(packageDir,'bundle.json'),JSON.stringify({version,roles:['pantry','canada'],files:manifest},null,2));
const zip=new ZipFile();async function add(dir){for(const name of await readdir(dir)){const path=join(dir,name);if((await stat(path)).isDirectory())await add(path);else zip.addFile(path,relative(packageDir,path).replaceAll('\\','/'));}}await add(packageDir);await new Promise((resolve,reject)=>{const out=createWriteStream(packageDir+'.zip');out.on('close',resolve);out.on('error',reject);zip.outputStream.on('error',reject);zip.outputStream.pipe(out);zip.end();});
console.log(packageDir+'.zip');
