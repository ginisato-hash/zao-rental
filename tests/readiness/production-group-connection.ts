import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {normalProductionFixture} from './normal-production-fixture';
import {composeProductionRuntime,type ProductionRuntime,type ProductionRuntimeInput} from '../../packages/core/src/guest/production-runtime';
import {groupHandler,type GroupBoundary} from '../../apps/web/src/lib/group-http';
import type {StaffActor} from '../../packages/core/src/group/group-service';

// Production connection of the group application role (`<db>_group`), through the REAL composeProductionRuntime on an isolated PostgreSQL (synthetic data only).
// The group APIs are connected only when the Owner-supplied credential works AND the database is ready; every other state leaves them closed (503) without
// touching the rest of the runtime. The entrance stays closed until an administrator enables it.
const x=await normalProductionFixture();
const runtimes:ProductionRuntime[]=[];let stage='startup',count=0;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
const compose=async(input:ProductionRuntimeInput)=>{const r=await composeProductionRuntime(input);runtimes.push(r);return r;};
const withoutGroup=(input:ProductionRuntimeInput):ProductionRuntimeInput=>{const {group:_g,...database}=input.secrets.database;void _g;return {...input,secrets:{...input.secrets,database}};};
const boundaryOf=(r:ProductionRuntime):GroupBoundary|null=>r.group?{customer:r.group.customer,origin:r.group.origin,serverKey:r.group.serverKey,guard:r.group.guard}:null;
try{
 await check('with the credential and a ready database the runtime offers the group boundary and the staff runtime carries the group pool',async()=>{
  const r=await compose(x.input());
  assert.ok(r.group,'customer group boundary');assert.ok(r.staff?.groupPool,'staff group pool');
  assert.equal(r.staff!.groupPool,r.group!.pool,'one pool, owned by the runtime');
  assert.equal(r.groupNotifications,null,'no mail binding was supplied: group delivery is UNCONNECTED, nothing can be sent');
  assert.equal((await r.group!.pool.query('SELECT current_user u')).rows[0].u,x.groupRole.groupDb.user,'the dedicated group role, never owner/migration');
 });
 await check('without the credential the runtime composes exactly as before and the group APIs answer 503 GROUP_UNCONNECTED / GROUP_NOT_CONNECTED',async()=>{
  const r=await compose(withoutGroup(x.input()));
  assert.equal(r.group,null);assert.equal(r.staff!.groupPool,null);assert.equal(r.safeStatus().DB,'READY');assert.ok(r.guest&&r.staff);
  const res=await groupHandler(()=>boundaryOf(r))(new Request('https://production-fixture.invalid/api/group/catalog'));
  assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'GROUP_UNCONNECTED'});
 });
 await check('a credential that cannot connect (wrong password) or a role that fails the identity check never stops the runtime: the group stays unconnected',async()=>{
  const input=x.input();
  const bad=await compose({...input,connect:async(c,s,v)=>{if(s==='group')throw Error('SYNTHETIC_AUTH_FAILED');return input.connect!(c,s,v);}});
  assert.equal(bad.group,null);assert.equal(bad.staff!.groupPool,null);assert.ok(bad.guest);
  // a pool that authenticates as a different role is refused by verifyProductionDatabase and its connections are closed
  const ended:Pool[]=[];
  const wrongRole=await compose({...input,connect:async(c,s,v)=>{const p=await input.connect!(c,s==='group'?'hold':s,{...v,...(s==='group'?{user:x.roles.holdDb.user,password:x.roles.holdDb.password}:{})} as never);if(s==='group')ended.push(p);return p;}});
  assert.equal(wrongRole.group,null);assert.equal(ended.length,1);assert.equal((ended[0] as unknown as {ended:boolean}).ended,true,'the refused pool is closed');
 });
 await check('a ready check protects the database side: a group role missing its grant (or on a database without 0064) is not connected',async()=>{
  const role=x.groupRole.groupDb.user;
  await x.db.pool.query(`REVOKE EXECUTE ON FUNCTION group_register_actor(uuid) FROM ${role}`);
  try{const r=await compose(x.input());assert.equal(r.group,null,'no actor-registration grant => not ready');assert.equal(r.staff!.groupPool,null);}
  finally{await x.db.pool.query(`GRANT EXECUTE ON FUNCTION group_register_actor(uuid) TO ${role}`);}
  await x.db.pool.query(`REVOKE UPDATE(status) ON group_notification_outbox FROM ${role}`);
  try{assert.equal((await compose(x.input())).group,null,'no notification delivery grant => not ready');}
  finally{await x.db.pool.query(`GRANT UPDATE(status) ON group_notification_outbox TO ${role}`);}
  assert.ok((await compose(x.input())).group,'restored grants => ready again');
 });
 await check('the entrance stays CLOSED until an administrator enables it: no entrance row, no catalog, no application; after enabling it opens, and a wrong token still does not',async()=>{
  const r=await compose(x.input());const handle=groupHandler(()=>boundaryOf(r));const url='https://production-fixture.invalid/api/group';
  const get=(path:string,token:string)=>handle(new Request(url+path,{headers:{'x-group-entrance':token}}));
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM group_entrance')).rows[0].n,0,'0064 creates no entrance row');
  const some=randomUUID().replace(/-/g,'')+randomUUID().replace(/-/g,'');
  const closed=await get('/catalog',some);assert.equal(closed.status,404);assert.deepEqual(await closed.json(),{error:'ENTRANCE_UNAVAILABLE'});
  const start=await handle(new Request(url+'/start',{method:'POST',headers:{origin:r.group!.origin,'content-type':'application/json','x-group-entrance':some},body:JSON.stringify({requestKey:randomUUID(),groupLabel:'SYNTHETIC',contactName:'SYNTHETIC',contactEmail:'synthetic@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-10',endDate:'2035-02-10',slot:'DAY'}})}));
  assert.equal(start.status,404,'an application cannot be started through a closed entrance');assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM group_orders')).rows[0].n,0);
  // The administrator (GROUP_ENTRANCE_MANAGE) enables it through the staff service on the same runtime pool.
  const admin:StaffActor={kind:'STAFF',subject:x.principal.subject,revision:x.principal.revision};
  const opened=await r.group!.svc.rotateEntrance(admin,'SYNTHETIC enable in the production-connection test');
  assert.equal((await get('/catalog',opened.token)).status,200,'the enabled entrance opens');
  assert.equal((await get('/catalog',some)).status,404,'any other token stays closed');
 });
 console.log('PASS production-group-connection '+count+' checks');
}catch(e){console.error('PRODUCTION_GROUP_CONNECTION_FAILED '+stage);throw e;}finally{await Promise.all(runtimes.map(r=>r.close().catch(()=>{})));await x.close();}
