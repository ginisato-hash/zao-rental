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
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';
import {normalizePeriod,type HoldConditions} from '../../packages/contracts/src/hold';
// Always exercises the newest migration in the plan, whichever one this branch adds.
const NEW=migrationPlan.at(-1)!.file,PRIOR=migrationPlan.length-1;
// Current HoldService.command() requires the current schema (matching tests/fixtures/legacy-
// prefix.ts's own documented contract), so it cannot be used to populate the PRIOR-migrations
// HOLD below whenever the newest migration (here, 0042) adds a column HoldService's own SQL
// unconditionally references. Mirrors legacyHold() in tests/fixtures/legacy-prefix.ts exactly
// (same direct inventory_reservations/inventory_holds/inventory_claims inserts), scoped locally
// since what the newest migration adds — and thus needs omitting — varies migration to migration.
async function legacyHoldBeforeNewMigration(pool:import('pg').Pool,actor:string,conditions:HoldConditions,now:Date){
 const c=await pool.connect(),id=randomUUID(),p=normalizePeriod(conditions.period),expiry=new Date(now.getTime()+600000).toISOString();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Synthetic pre-upgrade fixture',true)",[actor]);await c.query('INSERT INTO inventory_reservations VALUES($1,$2)',[conditions.reservationId,actor]);
 await c.query('INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'ACTIVE\')',[id,conditions.reservationId,actor,conditions.pickupStore,conditions.returnStore,conditions,p.startsAt,p.dueAt,conditions.period.startDate,conditions.period.endDate,expiry]);
 for(const m of conditions.members)for(const item of m.items){const pole=item.family==='POLE';const stock=(await c.query(`SELECT id FROM ${pole?'ledger_poles':'ledger_assets'} WHERE variant_id=$1 AND store_id=$2 AND status='AVAILABLE' ORDER BY id LIMIT 1`,[item.variantIds[0],conditions.pickupStore])).rows[0];assert.ok(stock);for(const day of p.dates)await c.query('INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,pole_id,pole_slot,day) VALUES($1,$2,$3,$4,$5,$6)',[id,m.key+':'+item.family,pole?null:stock.id,pole?stock.id:null,pole?1:null,day]);}
 await c.query('COMMIT');return {holdId:id};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const TABLES=['ledger_assets','inventory_holds','inventory_claims','price_quotes','rental_bookings','rental_payment_attempts','rental_history','booking_notification_outbox'];
const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='prefix',count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 assert.ok(/^00\d\d_/.test(NEW));
 await db.pool.query('CREATE TABLE foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');
 for(const m of migrationPlan.slice(0,PRIOR)){const sql=await readFile(migrationsDirectory+'/'+m.file,'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',[m.id,sha(sql)]);}
 await seedRecommendation(db.pool);roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);
 const now=new Date('2035-01-01T10:00:00+09:00');await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const actor=await bootstrapDevelopmentAdmin(db.pool,{email:'m17-migration@example.invalid',displayName:'SYNTHETIC Migration',password:randomBytes(24).toString('base64url')}),sessionId=randomUUID();
 // Synthetic maintained-session fixture. No session token is printed or exported.
 await db.pool.query('INSERT INTO auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',now(),now())',[sessionId,actor,randomBytes(32).toString('hex')]);
 await db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['HOLD_VIEW','HOLD_EDIT','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE']) p",[actor]);
 const principal=(await loadStaff(db.pool,actor))!,quotes=new QuoteService(roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const conditions=requestFor('2035-02-05'),h=await legacyHoldBeforeNewMigration(db.pool,actor,conditions,now);
 const q=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote;
 const bookings=new BookingService(flow.flowPool,roles.authPool,{subject:actor,sessionId},new FakeGateway(()=>now),simulation);
 const b=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC Migration',email:'synthetic-m17@example.invalid',termsAccepted:true});await bookings.startPayment(b.id,randomUUID());
 assert.deepEqual((await db.pool.query("SELECT b.state,a.state pay FROM rental_bookings b JOIN rental_payment_attempts a ON a.booking_id=b.id")).rows,[{state:'CONFIRMED_DEV',pay:'COMPLETED'}]);
 // Columns the newest migration adds to an already-fingerprinted table are absent before the
 // upgrade, so compare without them (matching tests/operations/upgrade.ts's own established
 // pattern for the same situation). 0042 adds inventory_holds.buffer_override.
 const added:Record<string,string>={inventory_holds:"-'buffer_override'"};
 const fingerprint=async()=>{const r:Record<string,unknown>={};for(const t of TABLES)r[t]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)${added[t]??''} ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};
 const before=await fingerprint(),sql=await readFile(migrationsDirectory+'/'+NEW,'utf8');
 // The objects this migration introduces, read from the migration itself. A migration may
 // legitimately add no relation at all and only replace a function, so count both.
 const created=[...sql.matchAll(/CREATE (?:TABLE|VIEW) ([A-Za-z_][A-Za-z0-9_.]*)/g)].map(m=>m[1]!);
 const addedFunctions=[...sql.matchAll(/CREATE FUNCTION ([A-Za-z_][A-Za-z0-9_.]*)/g)].map(m=>m[1]!);
 const replacedFunctions=[...sql.matchAll(/CREATE OR REPLACE FUNCTION ([A-Za-z_][A-Za-z0-9_.]*)/g)].map(m=>m[1]!);
 assert.ok(created.length+addedFunctions.length+replacedFunctions.length>0,'migration introduces nothing');
 const grantedBefore=(await db.pool.query('SELECT count(*)::int n FROM staff_role_permissions')).rows[0].n;

 await check('complete new DDL rolls back without touching populated state or the registry',async()=>{
  stage='rollback';const c=await db.pool.connect();
  try{await c.query('BEGIN');await c.query(sql);await assert.rejects(c.query('SELECT synthetic_intentional_failure()'));await c.query('ROLLBACK');}finally{c.release();}
  for(const name of created)assert.equal((await db.pool.query(`SELECT to_regclass('${name}') v`)).rows[0].v,null,name);
  for(const name of addedFunctions)assert.equal((await db.pool.query('SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||\'.\'||p.proname=$1 OR (s.nspname=\'public\' AND p.proname=$1)',[name])).rows[0].n,0,name);
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
  for(const name of created){
   assert.ok((await db.pool.query(`SELECT to_regclass('${name}') v`)).rows[0].v,name);
   assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${name}`)).rows[0].n,0,name);
  }
  for(const name of [...addedFunctions,...replacedFunctions])
   assert.ok((await db.pool.query('SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||\'.\'||p.proname=$1 OR (s.nspname=\'public\' AND p.proname=$1)',[name])).rows[0].n>0,name);
  // A migration may widen the permission vocabulary but must never grant a permission.
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM staff_role_permissions')).rows[0].n,grantedBefore);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ops[_]%' AND has_function_privilege('public',p.oid,'EXECUTE')")).rows[0].n,0);
 });

 await check('replayed upgrade is inert',async()=>{
  await migrate(db.pool);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,migrationPlan.length);
  assert.deepEqual(await fingerprint(),before);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,migration:migrationPlan.at(-1)!.id,relationsAdded:created.length,functionsAdded:addedFunctions.length,functionsReplaced:replacedFunctions.length,upgrade:migrationPlan.at(-2)!.id+'→'+migrationPlan.at(-1)!.id,historicalChecksumsPreserved:PRIOR,rollback:'transactional DDL before commit',hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',detail:e instanceof assert.AssertionError?e.message.slice(0,400):'SAFE_DETAILS_ONLY'}));}
finally{await flow?.close();await roles?.close();await db.stop();}
if(failed)process.exit(1);
