import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {normalizePeriod,type HoldConditions} from '../../packages/contracts/src/hold';
import {flowHash,syntheticContact} from '../../packages/contracts/src/rental-flow';
// Historical migration fixtures only: current operational services require the current schema.
// Populate real old-schema rows before additive upgrade without disabling new custody checks.
export async function legacyHold(pool:Pool,actor:string,conditions:HoldConditions,now:Date){
 assert.equal((await pool.query("SELECT to_regclass('public.rental_loan_items') AS table_name")).rows[0].table_name,null);
 const c=await pool.connect(),id=randomUUID(),p=normalizePeriod(conditions.period),expiry=new Date(now.getTime()+600000).toISOString();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Historical synthetic prefix fixture',true)",[actor]);await c.query('INSERT INTO inventory_reservations VALUES($1,$2)',[conditions.reservationId,actor]);
 await c.query('INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'ACTIVE\')',[id,conditions.reservationId,actor,conditions.pickupStore,conditions.returnStore,conditions,p.startsAt,p.dueAt,conditions.period.startDate,conditions.period.endDate,expiry]);
 for(const m of conditions.members)for(const item of m.items){const pole=item.family==='POLE';const stock=(await c.query(`SELECT id FROM ${pole?'ledger_poles':'ledger_assets'} WHERE variant_id=$1 AND store_id=$2 AND status='AVAILABLE' ORDER BY id LIMIT 1`,[item.variantIds[0],conditions.pickupStore])).rows[0];assert.ok(stock);for(const day of p.dates)await c.query('INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,pole_id,pole_slot,day) VALUES($1,$2,$3,$4,$5,$6)',[id,m.key+':'+item.family,pole?null:stock.id,pole?stock.id:null,pole?1:null,day]);}
 await c.query('COMMIT');return {holdId:id,hold:{conditions,expiresAt:expiry}};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function legacyTransfer(pool:Pool,actor:string,asset:string){
 assert.equal((await pool.query("SELECT to_regclass('public.rental_loan_items') AS table_name")).rows[0].table_name,null);
 const c=await pool.connect(),id=randomUUID();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor]);await c.query("INSERT INTO transfer_batches(id,source_store,destination_store,scheduled_date,planned_ready_at,needed_by,basis) VALUES($1,'MOUNTAIN_BASE','ONSEN_BASE','2035-01-03','2035-01-03T19:00:00+09:00','2035-01-04T08:30:00+09:00','SYNTHETIC historical E08 upgrade transfer')",[id]);await c.query('INSERT INTO transfer_pieces(id,batch_id,line_key,ordinal,asset_id) VALUES($1,$2,$3,1,$4)',[randomUUID(),id,randomUUID(),asset]);await c.query('COMMIT');return {id};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
// The current BookingService always writes the M1.6 notification locale column, so an upgrade
// prefix that stops before 0034 must insert the historical booking shape directly.
export async function legacyBooking(pool:Pool,actor:string,quoteId:string,contact:unknown){
 assert.equal((await pool.query("SELECT to_regclass('public.booking_notification_outbox') AS table_name")).rows[0].table_name,null);
 const c=await pool.connect(),normalized=syntheticContact(contact);
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Historical synthetic prefix fixture',true)",[actor]);
 const q=(await c.query('SELECT id,hold_id,conditions,snapshot,snapshot_sha256 FROM price_quotes WHERE id=$1',[quoteId])).rows[0];assert.ok(q);const id=q.conditions.reservationId as string;
 await c.query("INSERT INTO rental_bookings(id,owner_id,request_key,fingerprint,hold_id,quote_id,conditions,price_snapshot,price_sha256,contact,mode,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SIMULATED_DEV','DRAFT')",[id,actor,randomUUID(),flowHash({quoteId,contact:normalized}),q.hold_id,q.id,q.conditions,q.snapshot,q.snapshot_sha256,normalized]);
 await c.query('COMMIT');return {id};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

// Populate the historical payment/confirmation shape without invoking a current service
// against a deliberately incomplete schema (in particular before provisional claims).
export async function legacyConfirmBooking(pool:Pool,actor:string,bookingId:string,now:Date){
 assert.equal((await pool.query("SELECT to_regclass('public.provisional_capacity_claims') v")).rows[0].v,null);
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Historical synthetic confirmation fixture',true)",[actor]);
 const b=(await c.query('SELECT * FROM rental_bookings WHERE id=$1 FOR UPDATE',[bookingId])).rows[0];assert.equal(b.state,'DRAFT');const id=randomUUID();
 await c.query("INSERT INTO rental_payment_attempts(id,booking_id,actor,idempotency_key,merchant_id,location_id,amount_jpy,currency,state,provider_id,provider_state,provider_updated_at,completed_at) VALUES($1,$2,$3,$4,'SYNTHETIC-MERCHANT','SYNTHETIC-MOUNTAIN',$5,'JPY','COMPLETED',$6,'COMPLETED',$7,$7)",[id,bookingId,actor,randomUUID(),b.price_snapshot.totalJpy,'sim_'+id,now]);
 await c.query("UPDATE rental_bookings SET state='CONFIRMED_DEV',confirmed_at=$2,version=version+1 WHERE id=$1",[bookingId,now]);
 await c.query("UPDATE inventory_holds SET payment_state='SUCCESS',confirmed_at=$2,version=version+1 WHERE id=$1",[b.hold_id,now]);
 await c.query("INSERT INTO rental_notifications(id,booking_id,destination,state) VALUES($1,$2,$3,'CAPTURED_TEST_ONLY')",[randomUUID(),bookingId,b.contact.email]);
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
