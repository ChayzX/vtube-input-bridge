import test from 'node:test';import assert from 'node:assert/strict';import {defaults,validateConfig,validatePair} from '../src/config.mjs';
test('fresh companion has every feature on, but controls wait for LAN pairing',()=>{const c=defaults('pantry');assert.equal(c.enabled,false);for(const f of ['obs','vts','meld','spotify','reactive'])assert.equal(c[f].enabled,true,f);assert.equal(defaults('canada').reactive.enabled,false);validateConfig(defaults('canada'));assert.throws(()=>validateConfig({...c,enabled:true}));});
test('peer imports require private IPv4, fixed service port and certificate pin',()=>{
 const good={host:'10.0.0.119',port:5056,pin:'a'.repeat(64),token:'b'.repeat(64)};assert.equal(validatePair(good).host,'10.0.0.119');
 for(const override of [{host:'8.8.8.8'},{host:'10.0.0.999'},{port:80},{pin:'anything'},{token:'short'}])assert.throws(()=>validatePair({...good,...override}));
});
test('configuration cannot point OBS or VTS at arbitrary hosts',()=>{const c=defaults('canada');assert.throws(()=>validateConfig({...c,obs:{...c.obs,url:'ws://evil.test'}}));assert.throws(()=>validateConfig({...c,vts:{...c.vts,url:'file:///tmp/a'}}));});
test('settings saved before Meld Studio support load with Meld turned off, and Meld stays on loopback',async()=>{
 const {upgradeConfig}=await import('../src/config.mjs');const c=defaults('canada');delete c.meld;
 assert.throws(()=>validateConfig(c));const up=validateConfig(upgradeConfig(c));assert.deepEqual(up.meld,{enabled:true,url:'ws://127.0.0.1:13376'});
 assert.throws(()=>validateConfig({...up,meld:{enabled:true,url:'ws://10.0.0.5:13376'}}));
});
test('the stored role follows the role the PC was installed as',async()=>{const {upgradeConfig}=await import('../src/config.mjs');
 const switched={...defaults('pantry'),role:'canada',ownIp:'10.0.0.119'};const pantry=upgradeConfig({...switched,role:'pantry',reactive:{enabled:true,url:'',visible:true}},'canada');
 assert.equal(pantry.role,'canada');assert.equal(pantry.reactive.enabled,false);validateConfig(pantry);
 assert.equal(upgradeConfig(defaults('pantry'),'pantry').reactive.enabled,true);assert.equal(upgradeConfig({...defaults('canada'),meld:undefined},'canada').meld.enabled,true);});
