import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import type {PoolClient,QueryResult} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {createStaffAuth,resolveStaff} from '../../packages/auth/src/staff-auth';
import {authHandler} from '../../apps/web/src/lib/auth-http';
import {insertAccount} from '../../packages/auth/src/accounts';
import {FIRST_ADMIN_OWNER_EMAIL_FINGERPRINT} from '../../scripts/lib/first-admin-bootstrap';
import {completeFirstAdminCommercial,firstAdminCommercialSafeError} from '../../scripts/lib/first-admin-commercial';
const db=await startIsolatedPostgres();let passed=0,failed=false,stage='setup';
const email='synthetic-commercial-owner@example.invalid',fingerprint=createHash('sha256').update(email).digest('hex');
const input={email,password:randomBytes(24).toString('base64url'),displayName:'Synthetic Commercial Owner',active:true,role:'ADMIN' as const,scope:'ALL' as const,storeIds:[],permissions:{PRICE_EDIT:true}};
// Synthetic DB fact adapter only: map this one fixture's computed email fingerprint to
// the pinned public fingerprint. Every SQL read/write/trigger is real local PostgreSQL.
// The actual operator has no fingerprint/target override; wrong fingerprints also run
// through the unadapted client below. No real profile, hostname or credential is needed.
function fixtureClient(c:PoolClient){return new Proxy(c,{get(target,key){if(key!=='query')return Reflect.get(target,key);return async(...args:unknown[])=>{const r=await Reflect.apply(c.query,c,args) as QueryResult;for(const result of Array.isArray(r)?r:[r])for(const row of result.rows??[])if(row.email_fingerprint===fingerprint)row.email_fingerprint=FIRST_ADMIN_OWNER_EMAIL_FINGERPRINT;return r;};}});}
async function run(adapt=true){const c=await db.pool.connect();try{return await completeFirstAdminCommercial(adapt?fixtureClient(c):c);}finally{c.release();}}
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed++;console.log('PASS '+name);}
try{
 await migrate(db.pool);let id:string;const c=await db.pool.connect();try{await c.query('BEGIN');id=await insertAccount(c,input,'production-first-admin-bootstrap');await c.query('COMMIT');}finally{c.release();}
 const snapshot=async()=>(await db.pool.query(`SELECT to_jsonb(u) u,to_jsonb(a) a,m.active,m.role,m.scope,m.revision FROM staff_members m JOIN auth_user u ON u.id=m.id JOIN auth_account a ON a."userId"=m.id WHERE m.id=$1`,[id])).rows[0];
 await check('actual synthetic owner fingerprint is rejected without writes',async()=>{const before=await snapshot();await assert.rejects(run(false),/RECONCILIATION_REQUIRED/);assert.deepEqual(await snapshot(),before);});
 await check('orphan auth state and second staff account refuse without permission mutation',async()=>{
  await db.pool.query(`INSERT INTO auth_user(id,name,email,"createdAt","updatedAt") VALUES('orphan','Synthetic orphan','orphan@example.invalid',now(),now())`);
  await assert.rejects(run(),/RECONCILIATION_REQUIRED/);await db.pool.query("DELETE FROM auth_user WHERE id='orphan'");
  const c=await db.pool.connect();let second:string;try{await c.query('BEGIN');second=await insertAccount(c,{...input,email:'second@example.invalid'},'synthetic');await c.query('COMMIT');}finally{c.release();}
  await assert.rejects(run(),/RECONCILIATION_REQUIRED/);
  await db.pool.query('DELETE FROM staff_permission_overrides WHERE staff_id=$1;',[second]);await db.pool.query('DELETE FROM staff_members WHERE id=$1',[second]);await db.pool.query('DELETE FROM auth_account WHERE "userId"=$1',[second]);await db.pool.query('DELETE FROM auth_user WHERE id=$1',[second]);
 });
 await check('explicit deny and unrelated overrides cannot be overwritten or expanded',async()=>{
  for(const permission of ['QUOTE_VIEW','REFUND_OVERRIDE']){await db.pool.query('INSERT INTO staff_permission_overrides VALUES($1,$2,false)',[id,permission]);await assert.rejects(run(),/RECONCILIATION_REQUIRED/);assert.equal((await db.pool.query('SELECT allowed FROM staff_permission_overrides WHERE staff_id=$1 AND permission=$2',[id,permission])).rows[0].allowed,false);await db.pool.query('DELETE FROM staff_permission_overrides WHERE staff_id=$1 AND permission=$2',[id,permission]);}
 });
 await check('wrong active role scope and credential association refuse',async()=>{
  for(const [column,value] of [['active',false],['role','STAFF'],['scope','ASSIGNED']] as const){const before=await snapshot();await db.pool.query(`UPDATE staff_members SET ${column}=$2 WHERE id=$1`,[id,value]);await assert.rejects(run(),/RECONCILIATION_REQUIRED/);await db.pool.query(`UPDATE staff_members SET ${column}=$2 WHERE id=$1`,[id,before[column]]);}
  await assert.rejects(db.pool.query('UPDATE auth_account SET "providerId"=$1 WHERE "userId"=$2',['synthetic-other',id]),{code:'23514'});
  await db.pool.query('UPDATE auth_account SET "accountId"=$1 WHERE "userId"=$2',['synthetic-other',id]);await assert.rejects(run(),/RECONCILIATION_REQUIRED/);await db.pool.query('UPDATE auth_account SET "accountId"=$1 WHERE "userId"=$2',[id,id]);
 });
 let cookie='',stamp='';const origin='http://127.0.0.1:34567',auth=createStaffAuth(db.pool,{origin,secret:randomBytes(32).toString('hex')});
 await check('normal existing session survives completion and refresh gets current revision',async()=>{const login=await authHandler(auth,db.pool,origin,db.pool)(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password:input.password})}));assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const state=await resolveStaff(auth,db.pool,new Headers({cookie}));assert.equal(state.status,'authorized');stamp=state.stamp!;});
 await check('one exact permission commits with revision and attributable audit; profile/password preserved',async()=>{
  const before=await snapshot(),results=await Promise.all([run(),run()]);assert.deepEqual(results.map(r=>r.status).sort(),['ALREADY_READY','FIRST_ADMIN_COMMERCIAL_READY']);const result=results.find(r=>r.status==='FIRST_ADMIN_COMMERCIAL_READY')!;assert.equal(result.writes,1);
  const fresh=await resolveStaff(auth,db.pool,new Headers({cookie}));assert.equal(fresh.status,'authorized');assert.ok(fresh.stamp!==stamp);if(fresh.status==='authorized')assert.ok(fresh.principal.permissions.includes('QUOTE_VIEW'));assert.equal((await db.pool.query('SELECT count(*)::int n FROM auth_session')).rows[0].n,1);
  const after=await snapshot();assert.deepEqual({...after,revision:before.revision},before);assert.equal(after.revision,before.revision+1);
  assert.deepEqual((await db.pool.query('SELECT permission,allowed FROM staff_permission_overrides WHERE staff_id=$1 ORDER BY permission',[id])).rows,[{permission:'PRICE_EDIT',allowed:true},{permission:'QUOTE_VIEW',allowed:true}]);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM staff_audit WHERE target_staff_id=$1 AND actor_staff_id='production-first-admin-commercial-permissions' AND event='PERMISSION_CHANGED'",[id])).rows[0].n,1);
  const evidence=JSON.stringify(result);for(const value of [input.email,input.displayName,input.password])assert.ok(!evidence.includes(value));
 });
 await check('already-ready invocation is read-only and preserves all rows',async()=>{const before=await snapshot(),audits=(await db.pool.query('SELECT count(*)::int n FROM staff_audit')).rows[0].n;assert.deepEqual(await run(),{status:'ALREADY_READY',staff_members:1,PRICE_EDIT:true,QUOTE_VIEW:true,writes:0});assert.deepEqual(await snapshot(),before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM staff_audit')).rows[0].n,audits);});
 console.log(JSON.stringify({suite:'first-admin-commercial',passed,productionWrites:0}));
}catch(error){failed=true;console.error(JSON.stringify({stage,code:firstAdminCommercialSafeError(error),sqlstate:(error as {code?:string}).code}));console.error((error as Error).stack?.split('\n').filter(l=>l.includes('/tests/auth/first-admin-commercial')).join('\n'));if(error instanceof assert.AssertionError)console.error(error.message);}
finally{await db.stop();if(failed)process.exitCode=1;}
