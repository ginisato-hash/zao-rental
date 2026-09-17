import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrate,migrationPlan,migrationsDirectory} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {seedRecommendation} from '../recommendation/fixture';
import {requestFor} from '../inventory/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';
const NEW='0035_operations_console.sql',PRIOR=migrationPlan.length-1;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const TABLES=['ledger_assets','inventory_holds','inventory_claims','price_quotes','rental_bookings','rental_payment_attempts','rental_history','booking_notification_outbox'];
const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='prefix',count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 assert.equal(migrationPlan.at(-1)!.file,NEW);
 await db.pool.query('CREATE TABLE foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');
 for(const m of migrationPlan.slice(0,PRIOR)){const sql=await readFile(migrationsDirectory+'/'+m.file,'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',[m.id,sha(sql)]);}
 await seedRecommendation(db.pool);roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);
 const now=new Date('2035-01-01T10:00:00+09:00');await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const actor=await bootstrapDevelopmentAdmin(db.pool,{email:'m17-migration@example.invalid',displayName:'SYNTHETIC Migration',password:randomBytes(24).toString('base64url')}),sessionId=randomUUID();
 // Synthetic maintained-session fixture. No session token is printed or exported.
 await db.pool.query('INSERT INTO auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',now(),now())',[sessionId,actor,randomBytes(32).toString('hex')]);
 await db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['HOLD_VIEW','HOLD_EDIT','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE']) p",[actor]);
 const principal=(await loadStaff(db.pool,actor))!,holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const conditions=requestFor('2035-02-05'),h=await holds.command('create',randomUUID(),conditions);
 const q=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote;
 const bookings=new BookingService(flow.flowPool,roles.authPool,{subject:actor,sessionId},new FakeGateway(()=>now),simulation);
 const b=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC Migration',email:'synthetic-m17@example.invalid',termsAccepted:true});await bookings.startPayment(b.id,randomUUID());
 assert.deepEqual((await db.pool.query("SELECT b.state,a.state pay FROM rental_bookings b JOIN rental_payment_attempts a ON a.booking_id=b.id")).rows,[{state:'CONFIRMED_DEV',pay:'COMPLETED'}]);
 const fingerprint=async()=>{const r:Record<string,unknown>={};for(const t of TABLES)r[t]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};
 const before=await fingerprint(),sql=await readFile(migrationsDirectory+'/'+NEW,'utf8');

 await check('complete new DDL rolls back without touching populated state or the registry',async()=>{
  stage='rollback';const c=await db.pool.connect();
  try{await c.query('BEGIN');await c.query(sql);await assert.rejects(c.query('SELECT synthetic_intentional_failure()'));await c.query('ROLLBACK');}finally{c.release();}
  assert.equal((await db.pool.query("SELECT to_regclass('ops_exceptions') v")).rows[0].v,null);
  assert.equal((await db.pool.query("SELECT to_regclass('ops_exception_sources') v")).rows[0].v,null);
  assert.deepEqual(await fingerprint(),before);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,PRIOR);
 });

 await check('concurrent upgrade applies once and preserves every historical checksum',async()=>{
  stage='upgrade';const prior=(await db.pool.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  await Promise.all([migrate(db.pool),migrate(db.pool)]);
  const registry=(await db.pool.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  assert.equal(registry.length,migrationPlan.length);
  assert.deepEqual(registry.slice(0,PRIOR),prior);
  assert.equal(registry.at(-1)!.checksum,sha(sql));
  assert.deepEqual(await fingerprint(),before);
 });

 await check('the upgraded database exposes the console with new permissions denied by default',async()=>{
  assert.equal((await db.pool.query("SELECT to_regclass('ops_exceptions') v")).rows[0].v,'ops_exceptions');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM staff_role_permissions WHERE permission IN ('OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE')")).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM ops_exceptions')).rows[0].n,0);
  for(const fn of ['ops_collect_exceptions(text)','ops_list_exceptions(text,text,text,integer,text,timestamptz,uuid)','ops_acknowledge_exception(uuid,text,text)','ops_observe_signal(text,uuid,text)'])
   assert.ok((await db.pool.query(`SELECT to_regprocedure('${fn}') v`)).rows[0].v,fn);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ops[_]%' AND has_function_privilege('public',p.oid,'EXECUTE')")).rows[0].n,0);
 });

 await check('replayed upgrade is inert',async()=>{
  await migrate(db.pool);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,migrationPlan.length);
  assert.deepEqual(await fingerprint(),before);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,migration:migrationPlan.at(-1)!.id,upgrade:'0034→0035',historicalChecksumsPreserved:PRIOR,rollback:'transactional DDL before commit',hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',detail:e instanceof assert.AssertionError?e.message.slice(0,400):'SAFE_DETAILS_ONLY'}));}
finally{await flow?.close();await roles?.close();await db.stop();}
if(failed)process.exit(1);
