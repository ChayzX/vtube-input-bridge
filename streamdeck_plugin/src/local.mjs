import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {homedir} from 'node:os';
export async function localRequest(method,path,body){
 const base=process.env.APPDATA||join(homedir(),'.config');const file=join(base,'VTubeControl','plugin-connection.json');const bytes=await readFile(file);if(bytes.length>8192)throw Error('Invalid companion connection');const c=JSON.parse(bytes);
 if(c.port!==5057||!/^[a-f0-9]{64}$/.test(c.token))throw Error('Invalid companion connection');
 const response=await fetch(`http://127.0.0.1:5057${path}`,{method,headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Companion unavailable');return response.json();
}
