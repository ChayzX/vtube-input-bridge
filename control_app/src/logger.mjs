import {appendFile,rename,stat,mkdir,rm} from 'node:fs/promises';import {dirname} from 'node:path';

// The app's log: entries with a level and a source, kept in memory for the Logs page (a ring of `capacity` entries)
// and appended to a rolling file in the app's data folder (`files` files of at most `maxBytes` each). Writing to the
// file is batched off the caller's path, so logging never holds up a Stream Deck press. Every message passes through
// redact() first: tokens, passwords, pairing pins and the overlay address never reach the log.
export const LEVELS=['error','warn','info','debug'];
export const SOURCES=['app','tracking','peer','api','obs','vts','meld','spotify','reactive'];

const REDACTED='[redacted]';
// Keys whose values are always secret, wherever they appear in logged data.
const secretKey=/pass(word)?|token|secret|authori[sz]ation|^pin$|cookie|credential/i;
// Text patterns: long hex strings (the API tokens, certificate pins and overlay capability are 64 hex characters),
// bearer credentials, the overlay path, and key=value or "key":"value" pairs with a secret-looking key.
const patterns=[
 [/(["']?\b(?:[a-z]*pass(?:word)?|[a-z]*token|secret|pin|authori[sz]ation)\b["']?\s*[:=]\s*)((?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&}]+))/gi,`$1${REDACTED}`],
 [/(bearer\s+)[^\s"',;]+/gi,`$1${REDACTED}`],
 [/(\/overlay\/)[^\s/"'?#]+/gi,`$1${REDACTED}`],
 [/\b[a-f0-9]{32,}\b/gi,REDACTED]
];
// Replaces known secret values (`secrets`, e.g. the OBS password, which has no recognisable shape) and anything that
// looks like a credential.
export function redactText(text,secrets=[]){
 let out=String(text);
 for(const secret of secrets)if(typeof secret==='string'&&secret.length>=4)out=out.split(secret).join(REDACTED);
 for(const [pattern,replacement] of patterns)out=out.replace(pattern,replacement);
 return out;
}
export function redact(value,secrets=[],depth=0){
 if(typeof value==='string')return redactText(value,secrets);
 if(value instanceof Error)return redactText(value.message,secrets);
 if(!value||typeof value!=='object')return value;
 if(depth>4)return '…';
 if(Array.isArray(value))return value.slice(0,50).map(v=>redact(v,secrets,depth+1));
 const out={};
 for(const [key,v] of Object.entries(value))out[key]=secretKey.test(key)&&v!==undefined&&v!==null&&v!==''?REDACTED:redact(v,secrets,depth+1);
 return out;
}

export class Logger{
 constructor({file=null,maxBytes=1024*1024,files=2,capacity=2000,clock=Date.now,flushDelay=250,repeatWindow=60000}={}){
  Object.assign(this,{file,maxBytes,files:Math.max(1,files),capacity,clock,flushDelay,repeatWindow});
  this.ring=[];this.nextId=1;this.seq=0;this.secrets=[];this.debug=false;this.debugSources=null;
  this.pending=[];this.timer=null;this.writing=Promise.resolve();this.size=null;this.last=null;this.writeError=null;
 }
 setSecrets(list){this.secrets=[...new Set(list.filter(s=>typeof s==='string'&&s.length>=4))].sort((a,b)=>b.length-a.length);}
 // Debug entries are kept only while debug logging is on, for every source (debugSources null) or the ones listed.
 configure({debug=false,debugSources=null}={}){this.debug=!!debug;this.debugSources=Array.isArray(debugSources)?debugSources.filter(s=>SOURCES.includes(s)):null;}
 enabled(level,source){return level!=='debug'||this.debug&&(!this.debugSources||this.debugSources.includes(source));}
 log(level,source,message,data){
  if(!LEVELS.includes(level))level='info';if(!SOURCES.includes(source))source='app';
  if(!this.enabled(level,source))return null;
  let text=message instanceof Error?message.message:String(message??'');
  if(data!==undefined){try{text+=' '+JSON.stringify(redact(data,this.secrets));}catch{}}
  text=redactText(text,this.secrets).replace(/\s+/g,' ').trim().slice(0,2000);
  const t=this.clock();const last=this.last;
  // The same message again within a minute updates the last entry ("×3") instead of flooding the log.
  if(last&&last.level===level&&last.source===source&&last.msg===text&&t-last.t<this.repeatWindow){last.repeat++;last.t=t;last.seq=++this.seq;return last;}
  this.noteRepeats();
  const entry={id:this.nextId++,seq:++this.seq,t,level,source,msg:text,repeat:1,written:1};
  this.ring.push(entry);if(this.ring.length>this.capacity)this.ring.splice(0,this.ring.length-this.capacity);
  this.last=entry;this.queue(`${new Date(t).toISOString()} ${level.toUpperCase().padEnd(5)} ${source.padEnd(8)} ${text}\n`);
  return entry;
 }
 error(source,message,data){return this.log('error',source,message,data);}
 warn(source,message,data){return this.log('warn',source,message,data);}
 info(source,message,data){return this.log('info',source,message,data);}
 debugLog(source,message,data){return this.log('debug',source,message,data);}
 noteRepeats(){const last=this.last;if(last&&last.repeat>last.written){this.queue(`${new Date(last.t).toISOString()} ${last.level.toUpperCase().padEnd(5)} ${last.source.padEnd(8)} (the message above repeated ${last.repeat-last.written} more time${last.repeat-last.written===1?'':'s'})\n`);last.written=last.repeat;}}
 // Entries changed after `since` (a seq), oldest first; optionally only some levels or sources, at most `limit`.
 entries({since=0,levels,sources,limit}={}){
  let list=this.ring.filter(e=>e.seq>since&&(!levels||levels.includes(e.level))&&(!sources||sources.includes(e.source)));
  list.sort((a,b)=>a.id-b.id);if(limit)list=list.slice(-limit);
  return list.map(({written,...e})=>({...e}));
 }
 queue(line){
  if(!this.file)return;this.pending.push(line);
  if(!this.timer){this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.flushDelay);this.timer.unref?.();}
 }
 // Writes what is queued; rotates first when the file would pass maxBytes (vtube.log -> vtube.log.1 -> ...).
 flush(){
  if(this.timer){clearTimeout(this.timer);this.timer=null;}
  this.noteRepeats();
  const lines=this.pending.splice(0);if(!this.file||!lines.length)return this.writing;
  this.writing=this.writing.then(async()=>{
   try{
    const data=lines.join('');const bytes=Buffer.byteLength(data);
    if(this.size===null){await mkdir(dirname(this.file),{recursive:true});this.size=await stat(this.file).then(s=>s.size,()=>0);}
    if(this.size>0&&this.size+bytes>this.maxBytes){await this.rotate();this.size=0;}
    await appendFile(this.file,data);this.size+=bytes;this.writeError=null;
   }catch(e){this.writeError=e?.message||String(e);}
  });
  return this.writing;
 }
 async rotate(){
  if(this.files<2){await rm(this.file,{force:true});return;}
  await rm(`${this.file}.${this.files-1}`,{force:true});
  for(let i=this.files-2;i>=1;i--)await rename(`${this.file}.${i}`,`${this.file}.${i+1}`).catch(()=>{});
  await rename(this.file,`${this.file}.1`).catch(()=>{});
 }
}
