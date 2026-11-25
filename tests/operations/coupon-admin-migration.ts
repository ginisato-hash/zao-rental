import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {flowFixture} from '../flow/fixture';
import {skiSet} from '../inventory/fixture';
import {migrationPlan} from '../../packages/db/src/index';

// 0063 coupon administration (Owner request 2026-11-25). Synthetic local PostgreSQL only; no provider, payment or network.
// Proves the database contract the application relies on: append-only enable/disable events, coupon_is_active (newest event wins, no event = active),
// coupon_booking_count (cancelled and expired-unpaid bookings do not count), least-privilege grants for the pricing and booking roles.
const x=await flowFixture('2035-01-01T10:00:00+09:00');
let stage='setup',count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const code=(c:string)=>(e:{code?:string})=>{assert.equal(e.code,c,JSON.stringify(e));return true;};
const actor=x.principal.subject;
/** Run `work` in a transaction that carries the audit actor, as the application does. */
async function asActor<T>(pool:Pool,work:(q:Pool['query'])=>Promise<T>):Promise<T>{
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor]);const r=await work(c.query.bind(c) as Pool['query']);await c.query('COMMIT');return r;}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
const terms=(c:string)=>({code:c,validFrom:'2034-12-01T00:00:00.000Z',validUntil:'2036-01-01T00:00:00.000Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:['SKI_SET_ADULT_REGULAR','SKI_SET_ADULT_PREMIUM'],kind:'FIXED_JPY',value:100,minimumJpy:0,minimumBasis:'ELIGIBLE_SUBTOTAL',maximumDiscountJpy:100,advanceCombination:'ALLOW',maxActiveReservations:null});
try{
 const owner=x.db.pool,pricing=x.roles.pricingPool,flow=x.flow.flowPool;
 const cid=randomUUID();
 await asActor(owner,q=>q('INSERT INTO coupon_versions(id,code,terms) VALUES($1,$2,$3)',[cid,'SYNTHETIC-A',JSON.stringify(terms('SYNTHETIC-A'))]));

 await check('0063 is the last registered migration and is applied exactly once',async()=>{
  assert.equal(migrationPlan.at(-1)!.id,'0063');
  assert.deepEqual((await owner.query("SELECT id FROM foundation_migrations WHERE id='0063'")).rows,[{id:'0063'}]);
 });
 await check('a coupon without events is active (every pre-0063 coupon keeps working)',async()=>{
  assert.equal((await owner.query('SELECT coupon_is_active($1) a',[cid])).rows[0].a,true);
  assert.equal((await owner.query('SELECT coupon_is_active($1) a',[randomUUID()])).rows[0].a,true,'unknown id: no event, treated as active; the caller already resolved the code');
 });
 await check('the pricing role appends events; the newest event decides; each event is audited with its actor',async()=>{
  await asActor(pricing,q=>q('INSERT INTO coupon_status_events(id,coupon_id,active,actor,reason) VALUES($1,$2,false,$3,$4)',[randomUUID(),cid,actor,'SYNTHETIC stop']));
  assert.equal((await pricing.query('SELECT coupon_is_active($1) a',[cid])).rows[0].a,false);
  await asActor(pricing,q=>q('INSERT INTO coupon_status_events(id,coupon_id,active,actor) VALUES($1,$2,true,$3)',[randomUUID(),cid,actor]));
  assert.equal((await pricing.query('SELECT coupon_is_active($1) a',[cid])).rows[0].a,true,'default reason is the empty string');
  assert.equal((await owner.query("SELECT count(*)::int n FROM pricing_history WHERE entity_id IN (SELECT id FROM coupon_status_events WHERE coupon_id=$1) AND event='coupon_status_events_INSERT' AND actor=$2",[cid,actor])).rows[0].n,2);
  assert.deepEqual((await owner.query('SELECT active,reason FROM coupon_status_events WHERE coupon_id=$1 ORDER BY created_at,id',[cid])).rows,[{active:false,reason:'SYNTHETIC stop'},{active:true,reason:''}]);
 });
 await check('events are append-only for every role, including the owner; an unknown actor or coupon is refused',async()=>{
  const e=(await owner.query('SELECT id FROM coupon_status_events WHERE coupon_id=$1 LIMIT 1',[cid])).rows[0].id;
  await assert.rejects(asActor(owner,q=>q('UPDATE coupon_status_events SET active=NOT active WHERE id=$1',[e])),code('23514'));
  await assert.rejects(asActor(owner,q=>q('DELETE FROM coupon_status_events WHERE id=$1',[e])),code('23514'));
  await assert.rejects(pricing.query('UPDATE coupon_status_events SET reason=$2 WHERE id=$1',[e,'x']),code('42501'));
  await assert.rejects(pricing.query('DELETE FROM coupon_status_events WHERE id=$1',[e]),code('42501'));
  await assert.rejects(asActor(owner,q=>q('INSERT INTO coupon_status_events(id,coupon_id,active,actor) VALUES($1,$2,false,$3)',[randomUUID(),cid,'nobody'])),code('23503'));
  await assert.rejects(asActor(owner,q=>q('INSERT INTO coupon_status_events(id,coupon_id,active,actor) VALUES($1,$2,false,$3)',[randomUUID(),randomUUID(),actor])),code('23503'));
  await assert.rejects(asActor(owner,q=>q('INSERT INTO coupon_status_events(id,coupon_id,active,actor,reason) VALUES($1,$2,false,$3,repeat(\'a\',161))',[randomUUID(),cid,actor])),code('23514'));
 });
 await check('grants are least-privilege: the booking role has no table access, PUBLIC and other roles cannot execute the functions',async()=>{
  await assert.rejects(flow.query('SELECT count(*) FROM coupon_status_events'),code('42501'));
  await assert.rejects(flow.query('INSERT INTO coupon_status_events(id,coupon_id,active,actor) VALUES($1,$2,false,$3)',[randomUUID(),cid,actor]),code('42501'));
  assert.equal((await flow.query('SELECT coupon_is_active($1) a',[cid])).rows[0].a,true,'booking role asks through the SECURITY DEFINER function');
  assert.equal((await flow.query('SELECT coupon_booking_count($1) n',[cid])).rows[0].n,0);
  await assert.rejects(x.roles.holdPool.query('SELECT coupon_is_active($1)',[cid]),code('42501'));
  await assert.rejects(x.roles.holdPool.query('SELECT coupon_booking_count($1)',[cid]),code('42501'));
  await assert.rejects(x.roles.recommendationPool.query('SELECT coupon_booking_count($1)',[cid]),code('42501'));
  for(const fn of ['coupon_is_active(uuid)','coupon_booking_count(uuid)']){
   assert.equal((await owner.query("SELECT has_function_privilege('public',$1,'EXECUTE') ok",[fn])).rows[0].ok,false);
   assert.equal((await owner.query("SELECT p.prosecdef sd,p.proconfig::text LIKE '%search_path=%' sp FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[fn])).rows[0].sd,true);
  }
  assert.equal((await owner.query("SELECT has_table_privilege('public','coupon_status_events','SELECT') ok")).rows[0].ok,false);
 });

 await check('coupon_booking_count counts bookings that used the coupon, not cancelled or expired-unpaid ones, and no other coupon',async()=>{
  const code2='SYNTHETIC-B',cid2=randomUUID();
  await asActor(owner,q=>q('INSERT INTO coupon_versions(id,code,terms) VALUES($1,$2,$3)',[cid2,code2,JSON.stringify(terms(code2))]));
  const reserve={reason:'SYNTHETIC coupon admin test'};
  async function booked(day:string,couponCode:string|null){
   const conditions=skiSet(day),h=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,reserve);assert.equal(h.result,'CREATED');
   const quote=(await x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode,wantAdvance:false})).quote;
   const b=await x.service.create(randomUUID(),quote.id,{displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true});
   return {bookingId:b.id as string,holdId:h.holdId as string,quoteId:quote.id as string};
  }
  const n=async(id:string)=>(await owner.query('SELECT coupon_booking_count($1) n',[id])).rows[0].n as number;
  const a=await booked('2035-03-05','SYNTHETIC-A'),b=await booked('2035-03-12','SYNTHETIC-A'),c=await booked('2035-03-19',code2),plain=await booked('2035-03-26',null);
  assert.equal((await owner.query('SELECT coupon_id FROM price_quotes WHERE id=$1',[a.quoteId])).rows[0].coupon_id,cid,'the quote recorded the coupon version');
  assert.deepEqual([await n(cid),await n(cid2)],[2,1],'DRAFT bookings with an active hold count; a booking without a coupon counts for nobody');
  // Expired unpaid hold: the booking row stays DRAFT, the hold is EXPIRED -> no longer counted.
  await owner.query("ALTER TABLE inventory_holds DISABLE TRIGGER USER");
  try{await owner.query("UPDATE inventory_holds SET state='EXPIRED' WHERE id=$1",[b.holdId]);}finally{await owner.query("ALTER TABLE inventory_holds ENABLE TRIGGER USER");}
  assert.equal(await n(cid),1,'DRAFT + EXPIRED hold is not counted');
  // Cancelled booking is not counted.
  await owner.query("ALTER TABLE rental_bookings DISABLE TRIGGER USER");
  try{await owner.query("UPDATE rental_bookings SET state='CANCELLED' WHERE id=$1",[a.bookingId]);}finally{await owner.query("ALTER TABLE rental_bookings ENABLE TRIGGER USER");}
  assert.equal(await n(cid),0,'CANCELLED is not counted');
  assert.equal(await n(cid2),1);
  // Unswept expiry: the hold is still ACTIVE but its expires_at has passed -> an unpaid booking no longer counts.
  const d=await booked('2035-04-02','SYNTHETIC-B');assert.equal(await n(cid2),2);
  await owner.query("ALTER TABLE inventory_holds DISABLE TRIGGER USER");
  try{await owner.query("UPDATE inventory_holds SET expires_at=inventory_clock()-interval '1 minute' WHERE id=$1 AND state='ACTIVE'",[d.holdId]);}finally{await owner.query("ALTER TABLE inventory_holds ENABLE TRIGGER USER");}
  assert.equal((await owner.query('SELECT state FROM inventory_holds WHERE id=$1',[d.holdId])).rows[0].state,'ACTIVE','not swept yet');
  assert.equal(await n(cid2),1,'DRAFT with an ACTIVE hold past expires_at is not counted');
  // COUPON-CAP-UNKNOWN-01: once payment has started, time alone never frees a slot (money may have moved or may still arrive).
  const setState=async(id:string,state:string)=>{await owner.query("ALTER TABLE rental_bookings DISABLE TRIGGER USER");try{await owner.query('UPDATE rental_bookings SET state=$2 WHERE id=$1',[id,state]);}finally{await owner.query("ALTER TABLE rental_bookings ENABLE TRIGGER USER");}};
  await setState(d.bookingId,'PAYMENT_PENDING');
  assert.equal(await n(cid2),2,'PAYMENT_PENDING with a hold past expires_at (response lost / UNKNOWN) still counts');
  await owner.query("ALTER TABLE inventory_holds DISABLE TRIGGER USER");
  try{await owner.query("UPDATE inventory_holds SET state='EXPIRED' WHERE id=$1",[d.holdId]);}finally{await owner.query("ALTER TABLE inventory_holds ENABLE TRIGGER USER");}
  assert.equal(await n(cid2),2,'PAYMENT_PENDING with an EXPIRED hold still counts');
  await setState(d.bookingId,'PAYMENT_REVIEW');assert.equal(await n(cid2),2,'PAYMENT_REVIEW counts whatever the hold says');
  await setState(d.bookingId,'CANCELLED');assert.equal(await n(cid2),1,'only a definitive cancellation (the existing terminalization) returns the slot');
  assert.equal(plain.bookingId.length>0&&c.bookingId.length>0,true);
 });
 console.log('PASS coupon-admin-migration '+count+' checks');
}catch(e){console.error('COUPON_ADMIN_MIGRATION_FAILED '+stage);throw e;}finally{await x.close();}
