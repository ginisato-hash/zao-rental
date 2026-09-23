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
import {legacyBooking,legacyConfirmBooking} from '../fixtures/legacy-prefix';
import {normalizePeriod,type HoldConditions} from '../../packages/contracts/src/hold';
// Narrowly-scoped old-schema fixture for this exact checkpoint (avatar-phase6, migrations 1-32):
// mirrors legacyHold() in tests/fixtures/legacy-prefix.ts (same direct inventory_reservations/
// inventory_holds/inventory_claims inserts, no buffer_override column), but without that helper's
// own guard against rental_loan_items already existing — that guard targets an earlier checkpoint
// than this one (rental_loan_items predates migration 32), so it would always fail here.
async function legacyHoldAtPhase6(pool:import('pg').Pool,actor:string,conditions:HoldConditions,now:Date){
 const c=await pool.connect(),id=randomUUID(),p=normalizePeriod(conditions.period),expiry=new Date(now.getTime()+600000).toISOString();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Historical synthetic prefix fixture',true)",[actor]);await c.query('INSERT INTO inventory_reservations VALUES($1,$2)',[conditions.reservationId,actor]);
 await c.query('INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'ACTIVE\')',[id,conditions.reservationId,actor,conditions.pickupStore,conditions.returnStore,conditions,p.startsAt,p.dueAt,conditions.period.startDate,conditions.period.endDate,expiry]);
 for(const m of conditions.members)for(const item of m.items){const pole=item.family==='POLE';const stock=(await c.query(`SELECT id FROM ${pole?'ledger_poles':'ledger_assets'} WHERE variant_id=$1 AND store_id=$2 AND status='AVAILABLE' ORDER BY id LIMIT 1`,[item.variantIds[0],conditions.pickupStore])).rows[0];assert.ok(stock);for(const day of p.dates)await c.query('INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,pole_id,pole_slot,day) VALUES($1,$2,$3,$4,$5,$6)',[id,m.key+':'+item.family,pole?null:stock.id,pole?stock.id:null,pole?1:null,day]);}
 await c.query('COMMIT');return {holdId:id,hold:{conditions,expiresAt:expiry}};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
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
 // Current HoldService.command() unconditionally references inventory_holds.buffer_override
 // (migration 0042), which does not exist yet at this frozen 32-migration checkpoint — matching
 // legacy-prefix.ts's own documented contract ("current operational services require the current
 // schema"), the prefix HOLD is populated directly via the existing legacyHold() old-schema
 // fixture instead of the current HoldService.
 const conditions=requestFor('2035-02-05'),legacy=await legacyHoldAtPhase6(db.pool,actor,conditions,now),h={holdId:legacy.holdId},q=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote,b=await legacyBooking(db.pool,actor,q.id,{displayName:'SYNTHETIC Upgrade',email:'synthetic-upgrade@example.invalid',termsAccepted:true});await legacyConfirmBooking(db.pool,actor,b.id,now);
 // The historical prefix row must reach real confirmation before the upgrade is meaningful.
 assert.deepEqual((await db.pool.query("SELECT b.state,a.state pay FROM rental_bookings b JOIN rental_payment_attempts a ON a.booking_id=b.id")).rows,[{state:'CONFIRMED_DEV',pay:'COMPLETED'}]);
 const tables=['ledger_assets','ledger_history','inventory_holds','inventory_claims','price_books','price_quotes','pricing_history','rental_bookings','rental_payment_attempts','rental_history'];
 // Columns 0033/0034/0042 add to fingerprinted tables are absent before the upgrade, so compare without them.
 const added:Record<string,string>={pricing_history:"-'reason'",rental_bookings:"-'notification_locale'",inventory_holds:"-'buffer_override'"};
 const fingerprint=async()=>{const r:Record<string,unknown>={};for(const t of tables)r[t]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)${added[t]??''} ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};
 const before=await fingerprint(),sql=await readFile(migrationsDirectory+'/0033_launch_operations.sql','utf8');
 stage='rollback';const c=await db.pool.connect();try{await c.query('BEGIN');await c.query(sql);await assert.rejects(c.query('SELECT synthetic_intentional_failure()'));await c.query('ROLLBACK');}finally{c.release();}
 assert.equal((await db.pool.query("SELECT to_regclass('ops_amendments') v")).rows[0].v,null);assert.deepEqual(await fingerprint(),before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,32);console.log('PASS complete0033 DDL rollback preserves populated0032 and registry');
 stage='upgrade';await migrate(db.pool);assert.deepEqual(await fingerprint(),before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,migrationPlan.length);await migrate(db.pool);assert.deepEqual(await fingerprint(),before);assert.equal((await db.pool.query("SELECT count(*)::int n FROM staff_role_permissions WHERE permission IN ('REFUND_OVERRIDE','RENTAL_AMEND','INVENTORY_RECONCILE')")).rows[0].n,0);
 // 0042's additive buffer_override column defaults every pre-existing (historical) hold to the
 // safe PUBLIC/non-override classification — never retroactively granted staff reserve access it
 // never explicitly requested — and the current HoldService reads that upgraded row normally.
 assert.equal((await db.pool.query('SELECT buffer_override FROM inventory_holds WHERE id=$1',[h.holdId])).rows[0].buffer_override,false);assert.equal((await holds.get(h.holdId)).state,'ACTIVE');
 const latest=migrationPlan.at(-1)!.id;
 console.log('PASS populated0032 to'+latest+' preserves confirmed booking/payment/quote/HOLD/inventory/audit; replay unchanged; new permissions default deny');
 console.log(JSON.stringify({status:'PASS',oldMigrationsUnchanged:32,upgrade:'0032→'+latest,rollback:'transactional DDL before commit',hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));}finally{await flow?.close();await roles?.close();await db.stop();}if(failed)process.exit(1);
