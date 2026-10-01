import test from 'node:test';import assert from 'node:assert/strict';import {defaults,validateConfig,validatePair} from '../src/config.mjs';
test('fresh companion is inert and requires explicit LAN pairing',()=>{const c=defaults('pantry');assert.equal(c.enabled,false);assert.equal(c.reactive.enabled,false);assert.equal(c.obs.enabled,false);assert.throws(()=>validateConfig({...c,enabled:true}));});
test('peer imports require private IPv4, fixed service port and certificate pin',()=>{
 const good={host:'10.0.0.119',port:5056,pin:'a'.repeat(64),token:'b'.repeat(64)};assert.equal(validatePair(good).host,'10.0.0.119');
 for(const override of [{host:'8.8.8.8'},{host:'10.0.0.999'},{port:80},{pin:'anything'},{token:'short'}])assert.throws(()=>validatePair({...good,...override}));
});
test('configuration cannot point OBS or VTS at arbitrary hosts',()=>{const c=defaults('canada');assert.throws(()=>validateConfig({...c,obs:{...c.obs,url:'ws://evil.test'}}));assert.throws(()=>validateConfig({...c,vts:{...c.vts,url:'file:///tmp/a'}}));});
