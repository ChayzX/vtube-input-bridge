import {deflateSync} from 'node:zlib';
// Draws the app mark (a violet rounded square with a white "V") with a status dot in the corner, as a PNG of any
// size, so the tray needs no bundled image per state and stays sharp at every display scale. Coordinates are on the
// mark's 24-unit grid; each pixel is supersampled 4×4 for smooth edges.
const colors={ok:[22,198,12],warn:[247,168,0],err:[232,17,35],off:[154,154,154]};
const VIOLET=[107,79,216],GREY=[118,118,118],WHITE=[255,255,255];

function segmentDistance(px,py,ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay;const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
 return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function insideRoundedSquare(x,y,min,max,r){
 const cx=Math.max(min+r,Math.min(max-r,x)),cy=Math.max(min+r,Math.min(max-r,y));
 return Math.hypot(x-cx,y-cy)<=r;
}
// The colour (or null for transparent) at one point of the 24-unit grid.
function sample(x,y,level){
 const dot=[18.5,18.5];const d=Math.hypot(x-dot[0],y-dot[1]);
 if(d<=4.6)return colors[level]||colors.off;
 if(d<=6.2)return null; // a clear ring keeps the dot readable on any taskbar colour
 if(!insideRoundedSquare(x,y,1,23,6))return null;
 const v=Math.min(segmentDistance(x,y,6,8.5,12,17),segmentDistance(x,y,12,17,18,8.5));
 return v<=1.3?WHITE:level==='off'?GREY:VIOLET;
}

export function trayIconRgba(size,level){
 const out=Buffer.alloc(size*size*4);const n=4;
 for(let py=0;py<size;py++)for(let px=0;px<size;px++){
  let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<n;sy++)for(let sx=0;sx<n;sx++){
   const c=sample((px+(sx+.5)/n)*24/size,(py+(sy+.5)/n)*24/size,level);
   if(c){r+=c[0];g+=c[1];b+=c[2];a++;}
  }
  const i=(py*size+px)*4;
  if(a){out[i]=Math.round(r/a);out[i+1]=Math.round(g/a);out[i+2]=Math.round(b/a);out[i+3]=Math.round(255*a/(n*n));}
 }
 return out;
}

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(buf){let c=0xffffffff;for(const byte of buf)c=crcTable[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){
 const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
 const body=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));
 return Buffer.concat([length,body,crc]);
}
export function encodePng(rgba,width,height){
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;// 8-bit RGBA
 const rows=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)rgba.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export const trayIconPng=(size,level)=>encodePng(trayIconRgba(size,level),size,size);
// The tray asks for 16 px at 100% scaling; larger sizes cover 125% to 200%.
export const TRAY_SIZES=[[16,1],[20,1.25],[24,1.5],[32,2]];
