import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {writeAccount,listAccounts} from '../../packages/auth/src/accounts';
import {requestFor,variants} from '../inventory/fixture';
import type {PoolClient} from 'pg';
const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined;let stage='start',failed=false,count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 role=await provisionCustodyRole(x.db.pool,x.db.identity);const svc=new CustodyService(role.custodyPool,x.roles.authPool,x.signed.identity);
 async function context(c:PoolClient,who=x.signed.identity){await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.session',$2,true),set_config('zao.reason','Synthetic custody test',true)",[who.subject,who.sessionId]);}
 async function sqlDenied(pool:typeof x.db.pool,sql:string,values:unknown[]=[],codes=['42501','23514']){const c=await pool.connect();try{await c.query('BEGIN');await context(c);let e:unknown;try{await c.query(sql,values);}catch(error){e=error;}assert.ok(e,'SQL must fail');assert.ok(codes.includes(String((e as {code?:string}).code)));}finally{await c.query('ROLLBACK');c.release();}}
 await check('new functions deny PUBLIC; app has no owner membership, DDL, location/history/state writes',async()=>{
  for(const signature of ['rental_apply_receipt(uuid)','rental_apply_inspection(uuid)']){const row=(await x.db.pool.query("SELECT proconfig,proowner::regrole::text AS owner,proacl::text FROM pg_proc WHERE oid=$1::regprocedure",[signature])).rows[0];assert.ok(row.proconfig.includes('search_path=pg_catalog, public, pg_temp'));assert.equal(row.owner,x.db.identity.namespace+'_custody_executor');assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure AND a.grantee=0',[signature])).rows[0].n,0);await sqlDenied(x.roles.ledgerPool,'SELECT '+signature.split('(')[0]+'($1)',[randomUUID()]);}
  for(const target of [x.db.identity.namespace+'_custody_executor',(await x.db.pool.query('SELECT current_user u')).rows[0].u])await sqlDenied(role!.custodyPool,'SET ROLE '+target);
  for(const sql of ["UPDATE ledger_assets SET store_id='ONSEN_BASE'","UPDATE ledger_locations SET event='RETURN_RECEIPT'","UPDATE rental_loan_items SET state='RECEIVED'","DELETE FROM inventory_claims","UPDATE auth_session SET \"expiresAt\"=now()"] )await sqlDenied(role!.custodyPool,sql);
 });
 const d=await x.draft('2035-01-03');await x.service.startPayment(d.booking.id,randomUUID());await x.clock('2035-01-03T10:00:00+09:00');
 let futureHold='';
 let prepared:Awaited<ReturnType<typeof svc.prepare>>;let loans:{id:string;asset_id:string|null;pole_id:string|null;family:string;version:number}[]=[];
 await check('normal library session confirmed synthetic booking -> exact preparation -> serialized pair/boot/pole checkout; replay once',async()=>{
  const view=await svc.checkoutView(d.booking.id),input={bookingId:d.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC human fit note; no DIN certification'};
  const wrong=structuredClone(input);wrong.selections.find(i=>i.assetId)!.assetId=randomUUID();await assert.rejects(svc.prepare(randomUUID(),wrong),{code:'EXACT_FULL_PERIOD_ASSIGNMENT_REQUIRED'});
  prepared=await svc.prepare(randomUUID(),input);assert.equal(prepared.preparation.version,1);
  const key=randomUUID(),value={bookingId:d.booking.id,expectedPreparationVersion:1};const out=await svc.checkout(key,value);assert.deepEqual(JSON.parse(JSON.stringify((await svc.checkout(key,value)).loans)),JSON.parse(JSON.stringify(out.loans)));loans=out.loans;assert.equal(loans.length,3);assert.ok(loans.every(l=>l.version===1));assert.equal((await x.db.pool.query('SELECT allocation_stage FROM inventory_holds WHERE id=$1',[d.holdId])).rows[0].allocation_stage,'RENTAL_FIXED');
 });
 let a:Awaited<ReturnType<typeof svc.createBatch>>,b:Awaited<ReturnType<typeof svc.createBatch>>;
 const ski=()=>loans.find(l=>l.family==='SKI')!;
 await check('duplicate same-ID side labels persist one exact-cycle candidate; separate terminal retains pinned cycle',async()=>{
  a=await svc.createBatch(randomUUID(),'ONSEN_BASE');b=await svc.createBatch(randomUUID(),'ONSEN_BASE');const value={batchId:a.id,expectedVersion:a.version,assetId:ski().asset_id,poleLoanId:null};a=await svc.scan(randomUUID(),value);a=await svc.scan(randomUUID(),{...value,expectedVersion:a.version});assert.equal(a.candidates.length,1);assert.equal(a.candidates[0].cycle_id,d.booking.id);
  b=await svc.scan(randomUUID(),{...value,batchId:b.id,expectedVersion:b.version});assert.equal(b.candidates.length,1);
 });
 await check('future promise is created before physical return',async()=>{const future=await x.draft(undefined,requestFor('2035-01-10'));await x.service.startPayment(future.booking.id,randomUUID());futureHold=future.holdId;
 const v=await svc.checkoutView(future.booking.id);await svc.prepare(randomUUID(),{bookingId:v.bookingId,expectedBookingVersion:v.bookingVersion,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC future prepared promise'});});
 let receiptId='';
 await check('two terminals confirm once; partial cross-store changes actual location, preserves other OUT items and original price/TTL',async()=>{
  const before=(await x.db.pool.query('SELECT price_sha256 FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].price_sha256;
  await Promise.all([svc.confirm(randomUUID(),{batchId:a.id,expectedVersion:a.version}),svc.confirm(randomUUID(),{batchId:b.id,expectedVersion:b.version})]);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_receipts WHERE loan_item_id=$1',[ski().id])).rows[0].n,1);receiptId=(await x.db.pool.query('SELECT id FROM rental_receipts WHERE loan_item_id=$1',[ski().id])).rows[0].id;
  assert.equal((await x.db.pool.query('SELECT store_id FROM ledger_assets WHERE id=$1',[ski().asset_id])).rows[0].store_id,'ONSEN_BASE');assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ledger_locations WHERE asset_id=$1 AND event=\'RETURN_RECEIPT\'',[ski().asset_id])).rows[0].n,1);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM rental_loan_items WHERE booking_id=$1 AND state='OUT'",[d.booking.id])).rows[0].n,2);assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active',[d.holdId])).rows[0].n,2);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active',[futureHold])).rows[0].n,1);assert.equal((await x.db.pool.query('SELECT transfer_attention FROM inventory_holds WHERE id=$1',[futureHold])).rows[0].transfer_attention,'CUSTODY_RECONCILIATION_REQUIRED');
  assert.equal((await x.db.pool.query('SELECT allocation_stage FROM inventory_holds WHERE id=$1',[futureHold])).rows[0].allocation_stage,'PREPARATION_FIXED');
  assert.equal((await x.db.pool.query('SELECT price_sha256 FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].price_sha256,before);
  const c=await role!.custodyPool.connect();try{await c.query('BEGIN');await context(c);await c.query('SELECT rental_apply_receipt($1)',[receiptId]);await c.query('COMMIT');}finally{c.release();}
  const all=[await svc.getBatch(a.id),await svc.getBatch(b.id)];assert.equal(all.flatMap(x=>x.candidates).filter(c=>c.state==='RECEIVED').length,1);assert.equal(all.flatMap(x=>x.candidates).filter(c=>c.outcome==='STALE_LOAN_CYCLE').length,1);
 });
 await check('owner SQL/GUC cannot reuse receipt-specific location exception; other staff receipt is denied',async()=>{
  await sqlDenied(x.db.pool,"UPDATE ledger_assets SET store_id='MOUNTAIN_BASE' WHERE id=$1",[ski().asset_id]);
  await sqlDenied(role!.custodyPool,"SELECT set_config('zao.actor','forged',true); SELECT rental_apply_receipt('"+receiptId+"'::uuid)");
 });
 await check('temporary tables and writable-schema tables/functions/operators cannot hijack pinned receipt function',async()=>{
  // Deliberately hostile objects in this test-owned database only; grants are rolled back.
  const owner=await x.db.pool.connect();try{await owner.query('BEGIN');await owner.query('CREATE SCHEMA custody_shadow AUTHORIZATION '+role!.custodyDb.user);await owner.query('GRANT TEMP ON DATABASE '+x.db.identity.database+' TO '+role!.custodyDb.user);await owner.query('COMMIT');}finally{owner.release();}
  const c=await role!.custodyPool.connect();try{await c.query('BEGIN');await context(c);await c.query('SET LOCAL search_path=custody_shadow,pg_temp,public');
   await c.query('CREATE TEMP TABLE rental_receipts(id uuid); CREATE TABLE custody_shadow.rental_loan_items(id uuid); CREATE TABLE custody_shadow.auth_session(id text)');
   await c.query("CREATE FUNCTION custody_shadow.inventory_clock() RETURNS timestamptz LANGUAGE sql AS $$SELECT '1900-01-01'::timestamptz$$; CREATE FUNCTION custody_shadow.eq(text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$; CREATE OPERATOR custody_shadow.= (LEFTARG=text,RIGHTARG=text,FUNCTION=custody_shadow.eq)");
   await c.query('SELECT public.rental_apply_receipt($1)',[receiptId]);assert.equal((await c.query('SELECT count(*)::int n FROM pg_temp.rental_receipts')).rows[0].n,0);await c.query('ROLLBACK');
  }finally{c.release();await x.db.pool.query('DROP SCHEMA custody_shadow CASCADE');await x.db.pool.query('REVOKE TEMP ON DATABASE '+x.db.identity.database+' FROM '+role!.custodyDb.user);}
 });
 await check('receipt UUID cannot be used by a different real staff session or without the actual receiving scope',async()=>{
  const other=(await writeAccount(x.roles.authPool,x.bp,undefined,{email:'custody-other@example.invalid',password:x.password,displayName:'SYNTHETIC Other returner',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true,RENTAL_RETURN:true}})).id!;
  const signed=await x.login('custody-other@example.invalid');const c=await role!.custodyPool.connect();try{await c.query('BEGIN');await context(c,signed.identity);await assert.rejects(c.query('SELECT public.rental_apply_receipt($1)',[receiptId]),{code:'42501'});await c.query('ROLLBACK');}finally{c.release();}
  assert.ok(other);await assert.rejects(new CustodyService(role!.custodyPool,x.roles.authPool,signed.identity).createBatch(randomUUID(),'ONSEN_BASE'),{code:'FORBIDDEN'});
 });
 await check('stale loan candidate is rejected without changing the old loan or other candidates',async()=>{
  const boot=loans.find(l=>l.family==='SKI_BOOT')!;let p=await svc.createBatch(randomUUID(),'ONSEN_BASE');p=await svc.scan(randomUUID(),{batchId:p.id,expectedVersion:p.version,assetId:boot.asset_id,poleLoanId:null});
  // Corruption fixture deliberately represents a scan from an older revision; no production mutation helper.
  await x.db.pool.query("SELECT set_config('zao.actor',$1,false)",[x.actor]);await x.db.pool.query('UPDATE rental_return_candidates SET loan_version=99 WHERE id=$1',[p.candidates[0].id]);
  const c=await role!.custodyPool.connect();try{await c.query('BEGIN');await context(c);const id=randomUUID();await c.query('INSERT INTO rental_receipts VALUES($1,$2,$3,$4,$5,$6,$6,$6)',[id,boot.id,p.candidates[0].id,'ONSEN_BASE',x.actor,x.now()]);await assert.rejects(c.query('SELECT public.rental_apply_receipt($1)',[id]),{code:'23514'});await c.query('ROLLBACK');}finally{c.release();}
  const result=await svc.confirm(randomUUID(),{batchId:p.id,expectedVersion:p.version});assert.equal(result.candidates[0].outcome,'STALE_LOAN_CYCLE');assert.equal((await x.db.pool.query('SELECT state FROM rental_loan_items WHERE id=$1',[boot.id])).rows[0].state,'OUT');
 });
 await check('receive is not sellable; inspection does not remove same-day or original contract date block',async()=>{
  const c=requestFor('2035-01-03');c.pickupStore=c.returnStore='ONSEN_BASE';assert.notEqual((await x.holds.availability(c)).result,'FEASIBLE');
  const key=randomUUID(),input={loanItemId:ski().id,expectedVersion:2,store:'ONSEN_BASE',evidence:'SYNTHETIC actual inspection ready'};await svc.inspection(key,input);await svc.inspection(key,input);
  assert.notEqual((await x.holds.availability(c)).result,'FEASIBLE');await x.clock('2035-01-04T10:00:00+09:00');c.period.startDate=c.period.endDate='2035-01-04';assert.equal((await x.holds.availability(c)).result,'FEASIBLE');
 });
 await check('pole PAIR receipt moves one physical unit to actual destination pending inspection; repeat cannot inflate',async()=>{
  const pole=loans.find(l=>l.family==='POLE')!,total=(await x.db.pool.query('SELECT sum(quantity)::int n FROM ledger_poles')).rows[0].n;let p=await svc.createBatch(randomUUID(),'ONSEN_BASE');p=await svc.scan(randomUUID(),{batchId:p.id,expectedVersion:p.version,assetId:null,poleLoanId:pole.id});const key=randomUUID(),v={batchId:p.id,expectedVersion:p.version};await svc.confirm(key,v);await svc.confirm(key,v);
  assert.equal((await x.db.pool.query('SELECT sum(quantity)::int n FROM ledger_poles')).rows[0].n,total);assert.equal((await x.db.pool.query('SELECT quantity FROM ledger_poles WHERE id=$1',[pole.pole_id])).rows[0].quantity,2);assert.equal((await x.db.pool.query("SELECT quantity FROM ledger_poles WHERE store_id='ONSEN_BASE' AND status='MAINTENANCE' AND variant_id=$1",[variants.pole])).rows[0].quantity,1);
  await svc.inspection(randomUUID(),{loanItemId:pole.id,expectedVersion:2,store:'ONSEN_BASE',evidence:'SYNTHETIC ready pair'});assert.equal((await x.db.pool.query('SELECT sum(quantity)::int n FROM ledger_poles')).rows[0].n,total);
 });

 await check('custody role cannot unfix a rental or read/modify private effect rows',async()=>{
  await sqlDenied(role!.custodyPool,"UPDATE inventory_holds SET allocation_stage='PROVISIONAL',version=version+1 WHERE id=$1",[d.holdId]);
  await sqlDenied(role!.custodyPool,'SELECT * FROM rental_internal.effects');
  await sqlDenied(role!.custodyPool,"SELECT rental_internal.asset_effect($1,'MOUNTAIN_BASE')",[ski().asset_id]);
 });
 await check('same receipt actor with removed receiving-store scope is rejected inside UUID function',async()=>{
  const original=(await listAccounts(x.roles.authPool,x.bp)).find(u=>u.id===x.actor)!;
  await writeAccount(x.roles.authPool,x.bp,x.actor,{displayName:original.displayName,active:true,role:original.role,scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:original.permissions,expectedRevision:original.revision});
  await sqlDenied(role!.custodyPool,'SELECT public.rental_apply_receipt($1)',[receiptId],['42501']);
  const changed=(await listAccounts(x.roles.authPool,x.bp)).find(u=>u.id===x.actor)!;
  await writeAccount(x.roles.authPool,x.bp,x.actor,{displayName:original.displayName,active:true,role:original.role,scope:original.scope,storeIds:original.storeIds,permissions:original.permissions,expectedRevision:changed.revision});
 });
 await check('unapplied receipt ignores hostile temp/schema objects; unrelated owner function cannot move an OUT asset',async()=>{
  const boot=loans.find(l=>l.family==='SKI_BOOT')!;let batch=await svc.createBatch(randomUUID(),'ONSEN_BASE');batch=await svc.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:boot.asset_id,poleLoanId:null});
  const owner=await x.db.pool.connect();try{await owner.query('BEGIN');await context(owner);await owner.query("CREATE FUNCTION public.custody_test_other_owner(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$UPDATE ledger_assets SET store_id='ONSEN_BASE' WHERE id=$1$$");await owner.query('GRANT EXECUTE ON FUNCTION custody_test_other_owner(uuid) TO '+role!.custodyDb.user);await owner.query('COMMIT');}finally{owner.release();}
  await sqlDenied(role!.custodyPool,'SELECT custody_test_other_owner($1)',[boot.asset_id],['23514']);await x.db.pool.query('DROP FUNCTION custody_test_other_owner(uuid)');
  await x.db.pool.query('CREATE SCHEMA custody_shadow AUTHORIZATION '+role!.custodyDb.user);await x.db.pool.query('GRANT TEMP ON DATABASE '+x.db.identity.database+' TO '+role!.custodyDb.user);
  const c=await role!.custodyPool.connect();try{await c.query('BEGIN');await context(c);const rid=randomUUID();await c.query('INSERT INTO rental_receipts VALUES($1,$2,$3,$4,$5,$6,$6,$6)',[rid,boot.id,batch.candidates[0].id,'ONSEN_BASE',x.actor,x.now()]);
   await c.query('SET LOCAL search_path=custody_shadow,pg_temp,public');await c.query('CREATE TEMP TABLE rental_receipts(id uuid); CREATE TEMP TABLE rental_loan_items(id uuid); CREATE TABLE custody_shadow.rental_custody_events(receipt_id uuid)');
   await c.query("CREATE FUNCTION custody_shadow.inventory_clock() RETURNS timestamptz LANGUAGE sql AS $$SELECT '1900-01-01'::timestamptz$$; CREATE FUNCTION custody_shadow.eq(text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$; CREATE OPERATOR custody_shadow.= (LEFTARG=text,RIGHTARG=text,FUNCTION=custody_shadow.eq)");
   await c.query('SELECT public.rental_apply_receipt($1)',[rid]);assert.equal((await c.query('SELECT actual_store FROM public.rental_custody_events WHERE receipt_id=$1',[rid])).rows[0].actual_store,'ONSEN_BASE');assert.equal((await c.query('SELECT count(*)::int n FROM custody_shadow.rental_custody_events')).rows[0].n,0);await c.query('ROLLBACK');
  }finally{c.release();await x.db.pool.query('DROP SCHEMA custody_shadow CASCADE');await x.db.pool.query('REVOKE TEMP ON DATABASE '+x.db.identity.database+' FROM '+role!.custodyDb.user);}
  assert.equal((await x.db.pool.query('SELECT state FROM rental_loan_items WHERE id=$1',[boot.id])).rows[0].state,'OUT');
 });
 await check('session actor/store restriction and lock-wait permission removal reject before receipt mutation',async()=>{
  const boot=loans.find(l=>l.family==='SKI_BOOT')!;let p=await svc.createBatch(randomUUID(),'ONSEN_BASE');p=await svc.scan(randomUUID(),{batchId:p.id,expectedVersion:p.version,assetId:boot.asset_id,poleLoanId:null});
  const blocker=await x.db.pool.connect();let op:Promise<unknown>|undefined;
  try{await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(71820600)');op=svc.confirm(randomUUID(),{batchId:p.id,expectedVersion:p.version}).catch(e=>e);
   let observed=false;for(let n=0;n<150;n++){if((await x.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[role!.custodyDb.user])).rowCount){observed=true;break;}await new Promise(r=>setTimeout(r,3));}assert.ok(observed);
   const row=(await listAccounts(x.roles.authPool,x.bp)).find(u=>u.id===x.actor)!;await writeAccount(x.roles.authPool,x.bp,x.actor,{displayName:row.displayName,active:true,role:row.role,scope:row.scope,storeIds:row.storeIds,permissions:{...row.permissions,RENTAL_RETURN:false},expectedRevision:row.revision});
  }finally{await blocker.query('COMMIT');blocker.release();}
  assert.equal((await op as {code:string}).code,'FORBIDDEN');assert.equal((await x.db.pool.query('SELECT state FROM rental_loan_items WHERE id=$1',[boot.id])).rows[0].state,'OUT');
 });
 await check('lock-wait staff disable invalidates the session and leaves the OUT item untouched',async()=>{
  const row=(await listAccounts(x.roles.authPool,x.bp)).find(u=>u.id===x.actor)!;await writeAccount(x.roles.authPool,x.bp,x.actor,{displayName:row.displayName,active:true,role:row.role,scope:row.scope,storeIds:row.storeIds,permissions:{...row.permissions,RENTAL_RETURN:true},expectedRevision:row.revision});
  const boot=loans.find(l=>l.family==='SKI_BOOT')!;let p=await svc.createBatch(randomUUID(),'ONSEN_BASE');p=await svc.scan(randomUUID(),{batchId:p.id,expectedVersion:p.version,assetId:boot.asset_id,poleLoanId:null});
  const blocker=await x.db.pool.connect();let op:Promise<unknown>|undefined;try{await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(71820600)');op=svc.confirm(randomUUID(),{batchId:p.id,expectedVersion:p.version}).catch(e=>e);let observed=false;
   for(let n=0;n<150;n++){if((await x.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[role!.custodyDb.user])).rowCount){observed=true;break;}await new Promise(r=>setTimeout(r,3));}assert.ok(observed);
   const latest=(await listAccounts(x.roles.authPool,x.bp)).find(u=>u.id===x.actor)!;await writeAccount(x.roles.authPool,x.bp,x.actor,{displayName:latest.displayName,active:false,role:latest.role,scope:latest.scope,storeIds:latest.storeIds,permissions:latest.permissions,expectedRevision:latest.revision});
  }finally{await blocker.query('COMMIT');blocker.release();}
  assert.equal((await op as {code:string}).code,'UNAUTHENTICATED');assert.equal((await x.db.pool.query('SELECT state FROM rental_loan_items WHERE id=$1',[boot.id])).rows[0].state,'OUT');
 });
 console.log(`CUSTODY real PostgreSQL ${count} cases passed; no real people, inventory, Square or device.`);
}catch(e){failed=true;console.error('CUSTODY_PG_FAILED '+stage+' '+(e as Error).name+' '+String((e as {code?:string}).code??''));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/custody/')).join('\n'));}finally{await role?.close();await x.close();console.log('Owned custody PostgreSQL stopped.');}if(failed)process.exit(1);
