import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {assertFirstAdminDatabaseOwner,assertFirstAdminTls,firstAdminSafeError,firstAdminTransaction} from '../../scripts/lib/first-admin-bootstrap';
import {createStaffAuth,resolveStaff} from '../../packages/auth/src/staff-auth';
import {hashStaffPassword} from '../../packages/auth/src/password';
import {authHandler} from '../../apps/web/src/lib/auth-http';
import {OperationsContext} from '../../packages/core/src/operations/context';

const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined;
const input={email:'SYNTHETIC-FIRST-OWNER@example.invalid',displayName:'Synthetic Owner',password:randomBytes(24).toString('base64url')};
let stage='migrations',passed=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed++;console.log('PASS '+name);}
async function bootstrap(){const client=await db.pool.connect();try{return await firstAdminTransaction(client,input);}finally{client.release();}}
const counts=async()=>(await db.pool.query(`SELECT (SELECT count(*)::int FROM auth_user) users,(SELECT count(*)::int FROM auth_account) accounts,(SELECT count(*)::int FROM staff_members) staff,(SELECT count(*)::int FROM staff_audit) audit,(SELECT count(*)::int FROM booking_actors WHERE kind='STAFF') actors`)).rows[0];
try{
 await migrate(db.pool);
 await check('owner admission rejects local identity and plaintext sockets; development bootstrap rejects neondb',async()=>{
  const client=await db.pool.connect();try{await assert.rejects(assertFirstAdminDatabaseOwner(client),/DATABASE_OWNER_REJECTED/);assert.throws(()=>assertFirstAdminTls(client,'127.0.0.1'),/TLS_REJECTED/);}finally{client.release();}
  await db.pool.query('CREATE DATABASE neondb');
  const pool=new Pool({...db.pool.options,password:db.pool.options.password,database:'neondb'});
  try{
   await assert.rejects(bootstrapDevelopmentAdmin(pool,input),/NOT_OWNED_DEVELOPMENT_DATABASE/);
   const c=await pool.connect();try{await assert.rejects(assertFirstAdminDatabaseOwner(c),/DATABASE_OWNER_REJECTED/);}finally{c.release();}
   const ownerPassword=randomBytes(24).toString('hex');
   await db.pool.query(`CREATE ROLE neondb_owner LOGIN PASSWORD '${ownerPassword}'`);await db.pool.query('ALTER DATABASE neondb OWNER TO neondb_owner');
   const owner=new Pool({...db.pool.options,database:'neondb',user:'neondb_owner',password:ownerPassword});
   // This local synthetic identity can satisfy only the DB facts, never fixed host/TLS admission.
   try{const c=await owner.connect();try{await assertFirstAdminDatabaseOwner(c);assert.throws(()=>assertFirstAdminTls(c,'127.0.0.1'),/TLS_REJECTED/);}finally{c.release();}}finally{await owner.end();}
  }finally{await pool.end();}
 });
 await check('orphan user and credential rows stop reconciliation without overwrite or reuse',async()=>{
  await db.pool.query(`INSERT INTO auth_user(id,name,email,"createdAt","updatedAt") VALUES('orphan','Synthetic orphan','orphan@example.invalid',now(),now())`);
  await assert.rejects(bootstrap(),/RECONCILIATION_REQUIRED/);assert.equal((await counts()).users,1);assert.equal((await counts()).staff,0);
  await db.pool.query(`INSERT INTO auth_account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES('orphan','orphan','credential','orphan',$1,now(),now())`,[await hashStaffPassword(input.password)]);
  await assert.rejects(bootstrap(),/RECONCILIATION_REQUIRED/);assert.equal((await counts()).accounts,1);assert.equal((await counts()).staff,0);
  await db.pool.query("DELETE FROM auth_account WHERE id='orphan'; DELETE FROM auth_user WHERE id='orphan'");
 });
 await check('mid-account failure rolls back user, credential, staff, access, actor and audit together',async()=>{
  await db.pool.query(`CREATE FUNCTION reject_bootstrap_override() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_FAIL'; END $$; CREATE TRIGGER reject_bootstrap_override BEFORE INSERT ON staff_permission_overrides FOR EACH ROW EXECUTE FUNCTION reject_bootstrap_override()`);
  await assert.rejects(bootstrap(),/SYNTHETIC_FAIL/);assert.deepEqual(await counts(),{users:0,accounts:0,staff:0,audit:0,actors:0});
  await db.pool.query('DROP TRIGGER reject_bootstrap_override ON staff_permission_overrides; DROP FUNCTION reject_bootstrap_override()');
 });
 await check('concurrent bootstrap commits exactly one canonical account and one loser is already completed',async()=>{
  const results=await Promise.allSettled([bootstrap(),bootstrap()]);
  const accepted=results.filter(r=>r.status==='fulfilled'),rejected=results.filter(r=>r.status==='rejected');assert.equal(accepted.length,1);assert.equal(rejected.length,1);
  assert.equal(firstAdminSafeError((rejected[0] as PromiseRejectedResult).reason),'PRODUCTION_STAFF_BOOTSTRAP_ALREADY_COMPLETED');
  const facts=(accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof bootstrap>>>).value;
  assert.deepEqual(facts,{staff_members:1,auth_user:1,auth_account:1,credential_account:1,email_unique:true,active:true,role:'ADMIN',scope:'ALL',PRICE_EDIT:true,argon2id:true,plaintext_password_absent:true,ACCOUNT_CREATED:1,auth_session:0});
  for(const secret of Object.values(input))assert.ok(!JSON.stringify(facts).includes(secret));
  assert.deepEqual((await db.pool.query('SELECT permission,allowed FROM staff_permission_overrides')).rows,[{permission:'PRICE_EDIT',allowed:true}]);
  await assert.rejects(bootstrap(),/ALREADY_COMPLETED/);
 });
 await check('normal Better Auth login produces one session that authorizes real OperationsContext permissions',async()=>{
  roles=await provisionApplicationRoles(db.pool,db.identity);
  const origin='http://127.0.0.1:34567',auth=createStaffAuth(roles.authPool,{origin,secret:randomBytes(32).toString('hex')}),handler=authHandler(auth,roles.authPool,origin,roles.authPool);
  const response=await handler(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:input.email,password:input.password})}));assert.equal(response.status,200);
  const cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),state=await resolveStaff(auth,roles.authPool,new Headers({cookie}));assert.equal(state.status,'authorized');
  if(state.status!=='authorized')throw Error('SYNTHETIC_LOGIN_FAILED');
  assert.equal(state.principal.role,'ADMIN');assert.equal(state.principal.scope,'ALL');assert.deepEqual(state.principal.permissions,['INVENTORY_EDIT','INVENTORY_VIEW','PRICE_EDIT','STAFF_MANAGE']);
  const sessions=(await db.pool.query('SELECT id,"userId" FROM auth_session')).rows;assert.equal(sessions.length,1);assert.equal(sessions[0].userId,state.principal.subject);
  const ctx=new OperationsContext(roles.ledgerPool,roles.authPool,{subject:state.principal.subject,sessionId:sessions[0].id});
  for(const permission of ['INVENTORY_EDIT','PRICE_EDIT'] as const)assert.equal((await ctx.authorize(permission)).subject,state.principal.subject);
  await assert.rejects(ctx.authorize('REFUND_OVERRIDE'),/FORBIDDEN/);
  await assert.rejects(new OperationsContext(roles.ledgerPool,roles.authPool,{subject:state.principal.subject,sessionId:'fabricated'}).authorize('PRICE_EDIT'),/UNAUTHENTICATED/);
 });
 console.log(JSON.stringify({suite:'first-admin-bootstrap',passed,production_writes:0}));
}catch(error){failed=true;console.error(JSON.stringify({stage,code:firstAdminSafeError(error)}));}
finally{await roles?.close();await db.stop();if(failed)process.exitCode=1;}
