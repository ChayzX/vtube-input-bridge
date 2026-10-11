import test from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher } from '../src/commands.mjs';
import { FrameStore, validateFugiUrl } from '../src/frames.mjs';
const command = (overrides={}) => ({id:'test-1',expiresAt:Date.now()+5000,target:'local',action:'spotify.next',args:{},...overrides});
test('concurrent duplicate next-track executes once and returns same result', async()=>{
 let n=0; const d=new Dispatcher(async()=>{n++; await new Promise(r=>setTimeout(r,20)); return {track:'two'};});
 const c=command(); const [a,b]=await Promise.all([d.execute(c),d.execute(c)]);
 assert.equal(n,1); assert.deepEqual(a,b); assert.equal(a.ok,true);
});
test('reuse of an ID for a different action is rejected', async()=>{
 const d=new Dispatcher(async()=>({})); const c=command(); await d.execute(c);
 assert.equal((await d.execute({...c,action:'spotify.pause'})).code,'id_conflict');
});
test('expired/far-future/unknown targets are rejected before dispatch', async()=>{
 let n=0; const d=new Dispatcher(async()=>{n++;});
 for(const overrides of [{expiresAt:Date.now()-1},{expiresAt:Date.now()+60000},{target:'someone'},{id:''}]) assert.equal((await d.execute(command(overrides))).ok,false);
 assert.equal(n,0);
});
test('a command from the other PC is anchored to this PC\'s clock, and its repeat is the same command',async()=>{
 let n=0,now=1_000_000;const d=new Dispatcher(async c=>{n++;return c.expiresAt;},{clock:()=>now});
 const {expiresAt,...c}=command({id:'ttl-1'});
 assert.equal((await d.execute({...c,ttl:4000})).data,1_004_000);
 now+=50;assert.equal((await d.execute({...c,ttl:3950})).data,1_004_000);assert.equal(n,1);
 assert.equal((await d.execute({...c,id:'ttl-2',ttl:60000})).data,now+10000,'clamped to 10 s');
 for(const ttl of [0,-5])assert.equal((await d.execute({...c,id:'ttl'+ttl,ttl})).code,'expired');
 assert.equal((await d.execute({...c,id:'ttl-bad',ttl:'5000'})).code,'invalid_command');
});
test('bounded admission rejects additional work', async()=>{
 let release; const d=new Dispatcher(()=>new Promise(r=>release=r),{maxPending:1});
 const first=d.execute(command()); await new Promise(r=>setImmediate(r));
 assert.equal((await d.execute(command({id:'second'}))).code,'busy'); release({}); await first;
});
test('queued command expires before its side effect',async()=>{
 let release,n=0; const d=new Dispatcher(async()=>{n++; if(n===1) await new Promise(r=>release=r); return {};});
 const first=d.execute(command()); const second=d.execute(command({id:'second',expiresAt:Date.now()+10}));
 await new Promise(r=>setTimeout(r,25)); release(); await first;
 assert.equal((await second).code,'expired'); assert.equal(n,1);
});
test('a slow command for one app or the other PC does not hold up the others',async()=>{
 const held=[];const order=[];const d=new Dispatcher(async c=>{if(c.target==='peer'||c.action==='obs.scene')await new Promise(r=>held.push(r));order.push(c.action);return c.action;});
 const slow=d.execute(command({id:'poll',target:'peer',action:'bridge.status'}));
 const started=Date.now();assert.equal((await d.execute(command({id:'press'}))).data,'spotify.next');assert.ok(Date.now()-started<500);
 // Commands for the same app still run one after another.
 const a=d.execute(command({id:'s1',action:'obs.scene'}));const b=d.execute(command({id:'s2',action:'obs.scenes'}));await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(order,['spotify.next']);assert.equal(held.length,2);held.forEach(r=>r());await Promise.all([slow,a,b]);assert.deepEqual(order.slice(1).sort(),['bridge.status','obs.scene','obs.scenes']);
 assert.equal(d.tails.size,0);
});
test('unknown outcomes are not retried',async()=>{
 let n=0; const d=new Dispatcher(async()=>{n++; throw new Error('connection lost');}); const c=command();
 assert.equal((await d.execute(c)).code,'action_failed'); await d.execute(c); assert.equal(n,1);
});
// A valid transparent 1x1 PNG, derived independently.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('frame store accepts PNG and clears frozen output',()=>{
 let now=100; const store=new FrameStore({clock:()=>now,ttl:1000}); store.put(png);
 assert.deepEqual(store.get(),png); now=1101; assert.equal(store.get(),null);
 assert.throws(()=>store.put(Buffer.from('not png'))); assert.throws(()=>store.put(Buffer.alloc(3000000)));
});
test('Fugi URL validation rejects other origins, credentials, scripts and HTTP',()=>{
 assert.equal(validateFugiUrl('https://reactive.fugi.tech/').host,'reactive.fugi.tech');
 for(const u of ['http://reactive.fugi.tech/','https://evil.test/','https://reactive.fugi.tech.evil.test/','javascript:alert(1)','https://a:b@reactive.fugi.tech/']) assert.throws(()=>validateFugiUrl(u));
});
test('only verified Fugi embed routes can be captured',async()=>{
 const {validateSourceUrl}=await import('../src/frames.mjs');
 assert.equal(validateSourceUrl('https://reactive.fugi.tech/group?size=100').pathname,'/group');
 assert.equal(validateSourceUrl('https://reactive.fugi.tech/individual/123456789012345678').pathname,'/individual/123456789012345678');
 for(const s of ['https://reactive.fugi.tech/','https://reactive.fugi.tech/login','https://reactive.fugi.tech/settings'])assert.throws(()=>validateSourceUrl(s));
});
test('only Fugi embed pages may access local Discord; mic/camera and LAN remain denied',async()=>{
 const {fugiPermission}=await import('../src/frames.mjs');
 assert.equal(fugiPermission('loopback-network','https://reactive.fugi.tech','https://reactive.fugi.tech/group'),true);
 for(const [p,o,u] of [['media','https://reactive.fugi.tech','https://reactive.fugi.tech/group'],['local-network','https://reactive.fugi.tech','https://reactive.fugi.tech/group'],['loopback-network','https://evil.test','https://reactive.fugi.tech/group'],['loopback-network','https://reactive.fugi.tech','https://reactive.fugi.tech/settings']])assert.equal(fugiPermission(p,o,u),false);
});
test('failed actions say why instead of a bare "Action failed"', async()=>{
 const {explain,describing}=await import('../src/errors.mjs');
 const refused=Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4455'),{code:-1});
 assert.match(explain(refused,'OBS'),/Could not connect to OBS\. Make sure OBS is open/);
 assert.match(explain(Object.assign(new Error('connect EHOSTUNREACH 10.0.0.119:5056'),{code:'EHOSTUNREACH'}),'the other PC'),/Could not reach the other PC/);
 assert.match(explain(new Error('Peer certificate mismatch'),'the other PC'),/Pair the PCs again under PC link/);
 assert.match(explain(new Error('Peer connection timeout'),'the other PC'),/Could not reach the other PC.*Windows Firewall.*private networks/);
 assert.match(explain(Object.assign(new Error('Authentication failed.'),{code:4009}),'OBS'),/OBS rejected the password/);
 assert.equal(explain(new Error('No source was found by the name of Gaming.'),'OBS'),'OBS: No source was found by the name of Gaming.');
 assert.match(explain(new Error('VTS timeout; outcome unknown'),'VTube Studio'),/^VTube Studio: VTS timeout; outcome unknown\. It may already have happened/);
 await assert.rejects(describing('OBS',async()=>{throw refused;}),e=>e.code==='action_failed'&&/Could not connect to OBS/.test(e.publicMessage));
 const d=new Dispatcher(async()=>describing('Spotify',async()=>{throw new Error('Spotify is not running');}));
 const r=await d.execute(command({id:'why-1'}));
 assert.deepEqual(r,{ok:false,code:'action_failed',message:'Spotify: Spotify is not running.'});
 const bare=await new Dispatcher(async()=>{throw new Error('socket hang up');}).execute(command({id:'why-2'}));
 assert.match(bare.message,/^Action failed: socket hang up\. It may already have happened/);
});
test('right-click menu offers cut, copy and paste in text boxes and copy on selected text', async()=>{
 const {contextMenuTemplate}=await import('../src/contextmenu.mjs');
 const roles=items=>items.filter(i=>i.role).map(i=>i.role);
 const field=contextMenuTemplate({isEditable:true,selectionText:'',editFlags:{canCut:false,canCopy:false,canPaste:true,canSelectAll:true}});
 assert.deepEqual(roles(field),['undo','redo','cut','copy','paste','selectAll']);
 assert.equal(field.find(i=>i.role==='paste').enabled,true);assert.equal(field.find(i=>i.role==='cut').enabled,false);
 assert.deepEqual(roles(contextMenuTemplate({isEditable:false,selectionText:'10.0.0.112',editFlags:{canCopy:true}})),['copy','selectAll']);
 assert.deepEqual(contextMenuTemplate({isEditable:false,selectionText:'',editFlags:{}}),[]);
});
