import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
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
const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='prefix';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
try{
 const hashes=JSON.parse(await readFile('docs/execution/avatar-phase6/migration-hashes.json','utf8')) as {file:string;sha256:string}[];assert.equal(hashes.length,32);for(const h of hashes)assert.equal(sha(await readFile(h.file,'utf8')),h.sha256);
 await db.pool.query('CREATE TABLE foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');
 for(const m of migrationPlan.slice(0,32)){const sql=await readFile(migrationsDirectory+'/'+m.file,'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',[m.id,sha(sql)]);}
 await seedRecommendation(db.pool);roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);
 const now=new Date('2035-01-01T10:00:00+09:00');await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const actor=await bootstrapDevelopmentAdmin(db.pool,{email:'m1-upgrade@example.invalid',displayName:'SYNTHETIC Upgrade',password:randomBytes(24).toString('base64url')}),sessionId=randomUUID();
 // Synthetic maintained-session fixture. No session token is printed or exported.
 await db.pool.query('INSERT INTO auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',now(),now())',[sessionId,actor,randomBytes(32).toString('hex')]);
 await db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['HOLD_VIEW','HOLD_EDIT','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE']) p",[actor]);
 const principal=(await loadStaff(db.pool,actor))!,holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now);await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const conditions=requestFor('2035-02-05'),h=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote,bookings=new BookingService(flow.flowPool,roles.authPool,{subject:actor,sessionId},new FakeGateway(()=>now),simulation),b=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC Upgrade',email:'synthetic-upgrade@example.invalid',termsAccepted:true});await bookings.startPayment(b.id,randomUUID());
 const tables=['ledger_assets','ledger_history','inventory_holds','inventory_claims','price_books','price_quotes','pricing_history','rental_bookings','rental_payment_attempts','rental_history'];
 const fingerprint=async()=>{const r:Record<string,unknown>={};for(const t of tables)r[t]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)${t==='pricing_history'?"-'reason'":''} ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};
 const before=await fingerprint(),sql=await readFile(migrationsDirectory+'/0033_launch_operations.sql','utf8');
 stage='rollback';const c=await db.pool.connect();try{await c.query('BEGIN');await c.query(sql);await assert.rejects(c.query('SELECT synthetic_intentional_failure()'));await c.query('ROLLBACK');}finally{c.release();}
 assert.equal((await db.pool.query("SELECT to_regclass('ops_amendments') v")).rows[0].v,null);assert.deepEqual(await fingerprint(),before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,32);console.log('PASS complete0033 DDL rollback preserves populated0032 and registry');
 stage='upgrade';await migrate(db.pool);assert.deepEqual(await fingerprint(),before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,migrationPlan.length);await migrate(db.pool);assert.deepEqual(await fingerprint(),before);assert.equal((await db.pool.query("SELECT count(*)::int n FROM staff_role_permissions WHERE permission IN ('REFUND_OVERRIDE','RENTAL_AMEND','INVENTORY_RECONCILE')")).rows[0].n,0);
 console.log('PASS populated0032 to0033 preserves confirmed booking/payment/quote/HOLD/inventory/audit; replay unchanged; new permissions default deny');
 console.log(JSON.stringify({status:'PASS',oldMigrationsUnchanged:32,upgrade:'0032→0033',rollback:'transactional DDL before commit',hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));}finally{await flow?.close();await roles?.close();await db.stop();}if(failed)process.exit(1);
