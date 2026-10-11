import test from 'node:test';import assert from 'node:assert/strict';import {inflateSync} from 'node:zlib';
import {trayHealth} from '../src/health.mjs';import {trayIconPng,trayIconRgba} from '../src/trayicon.mjs';
const paired={enabled:true,peer:{host:'10.0.0.119'},obs:{enabled:true},vts:{enabled:true},meld:{enabled:false},spotify:{enabled:true}};
const sending={role:'sender',state:'Sending',running:true,receiverConnected:true};
test('tray is green only when tracking and the PC link are both healthy',()=>{
 const h=trayHealth({tracking:sending,config:paired});
 assert.equal(h.level,'ok');assert.equal(h.line,'Live-ready');assert.match(h.tooltip,/Tracking: Connected · PC link: Paired/);assert.ok(h.tooltip.length<=127);
});
test('tray is red when the link is down or tracking failed, whatever else is fine',()=>{
 assert.equal(trayHealth({tracking:sending,linkError:'Secure credential storage unavailable',config:paired}).level,'err');
 assert.equal(trayHealth({tracking:{role:'receiver',state:'Receiver stopped'},config:paired}).level,'err');
 assert.equal(trayHealth({tracking:{role:'sender',state:'Sending',legacy:true},config:paired}).level,'err');
});
test('tray is amber when something needs attention and says what',()=>{
 const waiting=trayHealth({tracking:{...sending,receiverConnected:false},config:paired});
 assert.equal(waiting.level,'warn');assert.equal(waiting.line,'Tracking is waiting for the Streaming PC');
 assert.equal(trayHealth({tracking:sending,config:{...paired,peer:null,enabled:false}}).line,'Pair this PC with the other PC');
 assert.equal(trayHealth({tracking:sending,config:paired,services:{obs:{ok:false}}}).line,"OBS isn't answering");
 // A failure from an app that has since been turned off on this PC no longer counts.
 assert.equal(trayHealth({tracking:sending,config:paired,services:{meld:{ok:false}}}).level,'ok');
 assert.match(trayHealth({tracking:{...sending,receiverConnected:false},config:paired,services:{obs:{ok:false}}}).line,/\(\+1 more\)/);
});
test('tray is grey when tracking was paused on purpose',()=>{
 assert.equal(trayHealth({tracking:{role:'sender',state:'Stopped',running:false},config:paired}).level,'off');
 assert.equal(trayHealth({tracking:{role:'sender',state:'Stopped',running:false,error:'Socket failed'},config:paired}).level,'err');
});
test('tray icons are valid PNGs with a distinct status colour',()=>{
 for(const level of ['ok','warn','err','off']){
  const png=trayIconPng(16,level);assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),16);assert.equal(png.readUInt32BE(20),16);
  const idat=png.indexOf('IDAT');assert.equal(inflateSync(png.subarray(idat+4,idat+4+png.readUInt32BE(idat-4))).length,(16*4+1)*16);
 }
 // The dot's centre pixel differs between states; the corner stays transparent.
 const centre=level=>[...trayIconRgba(24,level).subarray((18*24+18)*4,(18*24+18)*4+3)].join();
 assert.equal(new Set(['ok','warn','err','off'].map(centre)).size,4);assert.equal(trayIconRgba(24,'ok')[3],0);
});
