export class FrameStore {
 constructor({clock=Date.now,ttl=2000}={}) {this.clock=clock;this.ttl=ttl;this.frame=null;this.at=0;}
 put(png) {
  if(!Buffer.isBuffer(png)||png.length<33||png.length>2*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)>1024||png.readUInt32BE(20)>1024||png.readUInt32BE(16)<1||png.readUInt32BE(20)<1) throw new Error('Invalid or oversized PNG');
  this.frame=Buffer.from(png); this.at=this.clock();
 }
 get(){return this.clock()-this.at<=this.ttl?this.frame:null;}
 clear(){this.frame=null;}
}
export function validateFugiUrl(value) {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.hostname!=='reactive.fugi.tech'||u.port||u.username||u.password) throw new Error('Use an HTTPS reactive.fugi.tech browser-source URL');
 return u;
}
export function validateSourceUrl(value){const u=validateFugiUrl(value);if(!/^\/group\/?$/.test(u.pathname)&&!/^\/individual\/\d{17,20}\/?$/.test(u.pathname))throw Error('Use Fugi’s group or individual browser-source URL; account pages cannot be relayed');return u;}
export function fugiPermission(permission,origin,page){if(permission!=='loopback-network'||origin!=='https://reactive.fugi.tech')return false;try{validateSourceUrl(page);return true;}catch{return false;}}
