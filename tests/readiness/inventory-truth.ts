import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {skiSet} from '../inventory/fixture';
import {loadProtectionClaims} from '../../packages/core/src/inventory/claim-truth';
import {projectionClaims} from '../../packages/core/src/payment/payment-projection';
import {type HoldConditions} from '../../packages/contracts/src/hold';
const x=await flowFixture();
try{
 const c=await x.db.pool.connect(),ids:Record<string,string>={};
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC exact witness fixture',true)",[x.actor]);
  const source=(await c.query("INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES(repeat('b',64),'SYNTHETIC-witness.xlsx',$1) RETURNING id",[x.actor])).rows[0].id;
  for(const family of ['POLE','WEAR_JACKET','WEAR_PANTS']){
   const model=randomUUID(),variant=randomUUID();ids[family]=variant;
   await c.query("INSERT INTO ledger_models(id,code,name,brand,family,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SYNTHETIC witness','SYNTHETIC',$2,'','SYNTHETIC','inventory-truth.ts',$2)",[model,family]);
   await c.query("INSERT INTO ledger_variants(id,model_id,family,age,tier,size,compatible_sports,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'ADULT',$4,'M',CASE WHEN $3='POLE' THEN NULL ELSE ARRAY['SKI','SNOWBOARD'] END,'','SYNTHETIC','inventory-truth.ts',$3)",[variant,model,family,family==='POLE'?'REGULAR':'STANDARD']);
   if(family!=='POLE')await c.query("INSERT INTO provisional_capacity_buckets(source_id,family,age,source_size,booking_size,size_mapping_status,quantity,provenance) VALUES($1,$2,'ADULT','M','M','MAPPED',20,'SYNTHETIC witness')",[source,family]);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const conditions:HoldConditions={...skiSet('2035-03-01'),contractVersion:'INTEGRATED_V1_2'};
 conditions.members[0]!.wear=true;conditions.members[0]!.items.find(i=>i.family==='POLE')!.variantIds=[ids.POLE!];
 conditions.members[0]!.items.push({family:'WEAR_JACKET',variantIds:[ids.WEAR_JACKET!]},{family:'WEAR_PANTS',variantIds:[ids.WEAR_PANTS!]});
 const d=await x.draft(undefined,conditions,{reason:'SYNTHETIC single physical unit fixture'});
 const claims=await loadProtectionClaims(x.flow.flowPool,d.holdId,conditions);
 assert.equal(claims.filter(c=>c.kind==='POLE_EXEMPT').length,1);assert.equal(claims.filter(c=>c.kind==='PROVISIONAL').length,2);
 assert.deepEqual(projectionClaims(conditions,claims),{gear:true,wear:true});
 assert.equal(projectionClaims(conditions,claims.filter(c=>c.kind!=='POLE_EXEMPT')).gear,false);
 assert.equal(projectionClaims(conditions,[...claims,claims.find(c=>c.kind==='PROVISIONAL')!]).wear,false);
 assert.equal((await x.service.startPayment(d.booking.id,randomUUID())).state,'CONFIRMED_DEV');
 await assert.rejects(x.db.pool.query('DELETE FROM inventory_pole_exemptions WHERE hold_id=$1',[d.holdId]),/IMMUTABLE_POLE_EXEMPTION/);
 // A registered, zero-quantity pool must prevent exemption rather than turn sold-out into stock.
 const db=await x.db.pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC tracked pole capacity',true)",[x.actor]);await db.query("INSERT INTO ledger_poles(id,variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES($1,$2,'MOUNTAIN_BASE',0,'AVAILABLE','','SYNTHETIC','inventory-truth.ts','empty')",[randomUUID(),ids.POLE]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 const next=structuredClone(conditions);next.reservationId=randomUUID();next.period={...next.period,startDate:'2035-03-02',endDate:'2035-03-02'};
 assert.equal((await x.holds.command('create',randomUUID(),next,undefined,undefined,{reason:'SYNTHETIC fixture'})).result,'INSUFFICIENT');
 // Existing paid promise retains its recorded exemption; later inventory registration cannot erase it.
 assert.deepEqual(projectionClaims(conditions,await loadProtectionClaims(x.db.pool,d.holdId,conditions)),{gear:true,wear:true});
 console.log('PASS local PG: provisional wear + physical gear + durable POLE exemption -> paid booking; missing/duplicate witness rejected; immutable exemption; zero tracked stock never exempted.');
}finally{await x.close();}
