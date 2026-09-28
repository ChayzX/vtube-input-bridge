import http from 'node:http'; import https from 'node:https'; import {timingSafeEqual} from 'node:crypto';
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function read(req,max) {
 const chunks=[];let size=0; for await(const b of req) {size+=b.length;if(size>max){const e=new Error('too large');e.status=413;throw e;}chunks.push(b);}return Buffer.concat(chunks);
}
export function createApi({token,tls,source,dispatcher,status=()=>({}),frames}) {
 if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('API token must be 32 random bytes');
 const handler=async(req,res)=>{
  try {
   if(req.headers.origin||req.headers['sec-fetch-site']) return json(res,403,{ok:false,code:'forbidden'});
   const ip=req.socket.remoteAddress?.replace(/^::ffff:/,'');
   if(source&&ip!==source) return json(res,403,{ok:false,code:'forbidden'});
   if(!equal(req.headers.authorization,`Bearer ${token}`)) return json(res,401,{ok:false,code:'unauthorized'});
   if(req.method==='GET'&&req.url==='/status') return json(res,200,{ok:true,data:status()});
   if(req.method==='GET'&&req.url==='/frame'&&frames) {
    const png=frames.get(); res.writeHead(png?200:204,{'Content-Type':'image/png','Cache-Control':'no-store'});return res.end(png);
   }
   if(req.method==='PUT'&&req.url==='/frame'&&frames) {frames.put(await read(req,2*1024*1024));return json(res,200,{ok:true});}
   if(req.method==='DELETE'&&req.url==='/frame'&&frames){frames.clear();return json(res,200,{ok:true});}
   if(req.method==='POST'&&req.url==='/command') {
    const c=JSON.parse((await read(req,32768)).toString());
    if(tls&&c.target!=='local') return json(res,400,{ok:false,code:'invalid_target'});
    return json(res,200,await dispatcher.execute(c));
   }
   return json(res,404,{ok:false,code:'not_found'});
  }catch(e){if(!res.headersSent)json(res,e.status||400,{ok:false,code:e.status===413?'too_large':'invalid_request'});}
 };
 const s=tls?https.createServer({key:tls.private,cert:tls.cert,minVersion:'TLSv1.2'},handler):http.createServer(handler);
 s.requestTimeout=5000;s.headersTimeout=5000;s.timeout=7000;s.maxConnections=16;return s;
}
export function createOverlay(frames,capability) {
 const base=`/overlay/${capability}`;
 return http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(req.url===base){res.setHeader('Content-Type','text/html');return res.end(`<html><head><style>html,body{margin:0;background:transparent;overflow:hidden}img{width:100%;height:100%;object-fit:contain}</style></head><body><img id="avatar" hidden><script src="${base}/view.js"></script></body></html>`);}
  if(req.url===base+'/view.js'){res.setHeader('Content-Type','text/javascript');return res.end(`const img=document.getElementById('avatar');let old;async function tick(){try{const r=await fetch(location.pathname.replace('/view.js','')+'/frame');if(r.status!==200)throw Error();const next=URL.createObjectURL(await r.blob());img.src=next;img.hidden=false;if(old)URL.revokeObjectURL(old);old=next;}catch{img.hidden=true;}setTimeout(tick,100);}tick();`);}
  if(req.url===base+'/frame'){const b=frames.get();res.writeHead(b?200:204,{'Content-Type':'image/png'});return res.end(b);}
  res.writeHead(404);res.end();
 });
}
