import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {normalizePeriod,type HoldConditions} from '../../packages/contracts/src/hold';
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
