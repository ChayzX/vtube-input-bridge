// Draws each key type's icons (no dependencies): key images (72 px, @2x 144 px) on the dark key background, and
// action-list icons (20 px, @2x 40 px) as a light glyph on transparent. Run: node scripts/icons.mjs
import {writeFileSync,mkdirSync} from 'node:fs';import {deflateSync} from 'node:zlib';
const out=new URL('../com.chayzx.vtubecontrol.sdPlugin/imgs/',import.meta.url);
// Shapes are inside-tests in a 144-unit square.
const rrect=(x,y,w,h,r)=>(px,py)=>{const dx=Math.max(x+r-px,0,px-(x+w-r)),dy=Math.max(y+r-py,0,py-(y+h-r));return px>=x&&px<=x+w&&py>=y&&py<=y+h&&dx*dx+dy*dy<=r*r;};
const circle=(cx,cy,r)=>(px,py)=>(px-cx)**2+(py-cy)**2<=r*r;
const ring=(cx,cy,r,w)=>(px,py)=>{const d=Math.hypot(px-cx,py-cy);return d<=r+w/2&&d>=r-w/2;};
const seg=(x1,y1,x2,y2,w)=>(px,py)=>{const vx=x2-x1,vy=y2-y1,t=Math.max(0,Math.min(1,((px-x1)*vx+(py-y1)*vy)/(vx*vx+vy*vy)));return Math.hypot(px-x1-t*vx,py-y1-t*vy)<=w/2;};
const poly=pts=>(px,py)=>{let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const [xi,yi]=pts[i],[xj,yj]=pts[j];if(yi>py!==yj>py&&px<(xj-xi)*(py-yi)/(yj-yi)+xi)inside=!inside;}return inside;};
const and=(...s)=>(x,y)=>s.every(f=>f(x,y)),minus=(a,b)=>(x,y)=>a(x,y)&&!b(x,y),or=(...s)=>(x,y)=>s.some(f=>f(x,y));
const box=(x,y,w,h,r,t)=>minus(rrect(x,y,w,h,r),rrect(x+t,y+t,w-2*t,h-2*t,Math.max(r-t,0)));
// Each glyph: its accent colour and its layers ([shape] in the accent, or [shape,'cut'] to clear what is under it).
const icons={
 obs:['#8ccaff',[[box(20,28,104,68,8,8)],[seg(72,96,72,112,8)],[seg(46,114,98,114,8)],[poly([[62,46],[62,80],[90,63]])]]],
 meld:['#b4a2ff',[[box(40,22,86,58,8,8)],[rrect(14,52,90,64,9),'cut'],[rrect(20,58,78,52,6)],[poly([[50,70],[50,98],[72,84]]),'cut']]],
 vts:['#ff9ecb',[[ring(72,72,50,9)],[circle(55,62,8)],[circle(89,62,8)],[and(ring(72,74,24,8),(x,y)=>y>80)]]],
 spotify:['#6ccb5f',[[circle(48,104,16)],[circle(100,94,16)],[seg(60,104,60,42,9)],[seg(112,94,112,32,9)],[poly([[56,32],[116,20],[116,40],[56,52]])]]],
 reactives:['#fce100',[[and(circle(72,112,67),circle(72,32,67))],[circle(72,72,21),'cut'],[circle(72,72,11)]]],
 renderer:['#ffb366',[[ring(72,72,52,8)],[poly([[42,50],[42,94],[72,72]])],[rrect(82,52,24,40,3)]]]};
function draw(size,[accent,layers],key){
 const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),px=new Float64Array(size*size*4),n=4,bg=[0x17,0x21,0x2d];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<n;sy++)for(let sx=0;sx<n;sx++){
   // Key images keep the glyph small and high, clear of the title at the bottom; list icons use the full square.
   const ux=(x+(sx+.5)/n)/size*144,uy=(y+(sy+.5)/n)/size*144,gx=key?(ux-72)/.72+72:(ux-72)/1.2+72,gy=key?(uy-54)/.72+72:(uy-72)/1.2+72;
   let c=key&&rrect(0,0,144,144,20)(ux,uy)?bg:null;
   for(const [shape,mode] of layers)if(shape(gx,gy))c=mode==='cut'?(key?bg:null):(key?rgb(accent):[0xef,0xef,0xef]);
   if(c){r+=c[0];g+=c[1];b+=c[2];a++;}}
  const i=(y*size+x)*4;px.set(a?[r/a,g/a,b/a,255*a/(n*n)]:[0,0,0,0],i);}
 return png(size,px);
}
function png(size,px){
 const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const crc=buf=>{let c=~0;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (~c)>>>0;};
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc(body));return Buffer.concat([len,body,sum]);};
 const raw=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;for(let x=0;x<size*4;x++)raw[y*(size*4+1)+1+x]=Math.round(px[y*size*4+x]);}
 const head=Buffer.alloc(13);head.writeUInt32BE(size,0);head.writeUInt32BE(size,4);head.set([8,6,0,0,0],8);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
for(const dir of ['keys','actions'])mkdirSync(new URL(dir+'/',out),{recursive:true});
for(const [name,icon] of Object.entries(icons)){
 writeFileSync(new URL(`keys/${name}.png`,out),draw(72,icon,true));writeFileSync(new URL(`keys/${name}@2x.png`,out),draw(144,icon,true));
 writeFileSync(new URL(`actions/${name}.png`,out),draw(20,icon,false));writeFileSync(new URL(`actions/${name}@2x.png`,out),draw(40,icon,false));
}
