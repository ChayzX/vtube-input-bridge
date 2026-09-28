import {checkDeadline} from './deadline.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';const exec=promisify(execFile);
export async function mediaAction(options,action) {
 const {exe,prefix=[]}=options;const name=action.replace(/^spotify\./,'');if(!['play','pause','next','previous','status'].includes(name)||!action.startsWith('spotify.'))throw new Error('Unsupported Spotify action');
 checkDeadline(options);const {stdout}=await exec(exe,[...prefix,name],{timeout:4000,maxBuffer:32768,windowsHide:true});const result=JSON.parse(stdout);
 if(!result.ok){const e=new Error(result.code||'spotify_unavailable');e.code=result.code||'spotify_unavailable';e.publicMessage='Spotify is unavailable or does not support this action';throw e;}return result.data;
}
