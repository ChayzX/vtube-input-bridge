import {packager} from '../control_app/node_modules/@electron/packager/dist/index.js';import {mkdir,copyFile,readFile,writeFile,readdir,stat,cp,rm} from 'node:fs/promises';import {join,relative} from 'node:path';import {createHash} from 'node:crypto';import {createWriteStream} from 'node:fs';import {createRequire} from 'node:module';const require=createRequire(new URL('../control_app/package.json',import.meta.url));const {ZipFile}=require('yazl');
const root=process.cwd();const version=JSON.parse(await readFile('control_app/package.json')).version;await mkdir('build',{recursive:true});
const [app]=await packager({dir:join(root,'control_app'),name:'VTubeControl',platform:'win32',arch:'x64',out:join(root,'build'),overwrite:true,asar:false,icon:join(root,'control_app/ui/icon.ico'),appVersion:version,buildVersion:'0.2.0.1',ignore:[/^\/test($|\/)/,/^\/dist($|\/)/],prune:true});
async function files(dir){let result=[];for(const name of await readdir(dir)){const path=join(dir,name);if((await stat(path)).isDirectory())result.push(...await files(path));else result.push({path:relative(app,path).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}return result;}
const manifest=await files(app);const scripts=['Install-Control.ps1','Rollback-Control.ps1'];
for(const role of ['pantry','canada']){
 const packageDir=join(root,'build',`VTubeControl-${role}-${version}`);await rm(packageDir,{recursive:true,force:true});await mkdir(packageDir,{recursive:false});
 // The same binaries serve both roles; launch argument and package manifest select the PC.
 await cp(app,join(packageDir,'app'),{recursive:true});
 for(const file of scripts)await copyFile(join(root,'scripts',file),join(packageDir,file));
 await copyFile(join(root,'docs/Control-Setup.md'),join(packageDir,'SETUP.md'));await copyFile(join(root,'docs/Control-Build-Status.md'),join(packageDir,'BUILD-STATUS.md'));
 await writeFile(join(packageDir,'bundle.json'),JSON.stringify({version,role,files:manifest},null,2));
 const zip=new ZipFile();async function add(dir){for(const name of await readdir(dir)){const path=join(dir,name);if((await stat(path)).isDirectory())await add(path);else zip.addFile(path,relative(packageDir,path).replaceAll('\\','/'));}}await add(packageDir);await new Promise((resolve,reject)=>{const out=createWriteStream(packageDir+'.zip');out.on('close',resolve);out.on('error',reject);zip.outputStream.on('error',reject);zip.outputStream.pipe(out);zip.end();});
 console.log(packageDir+'.zip');
}
