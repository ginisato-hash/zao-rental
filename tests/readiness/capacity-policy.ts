import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {requestFor,variants} from '../inventory/fixture';
import {TransferService} from '../../packages/core/src/transfer/transfer-service';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import type {HoldConditions} from '../../packages/contracts/src/hold';
const x=await flowFixture();
async function stock(tag:string,mountain:number,onsen:number,maintenance=0){
 const v=randomUUID(),c=await x.db.pool.connect(),assets:string[]=[];
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC capacity policy',true)",[x.actor]);
  await c.query("INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) SELECT $1,model_id,'SKI','ADULT','REGULAR',$2,'','SYNTHETIC','capacity-policy.ts',$2 FROM ledger_variants WHERE id=$3",[v,tag,variants.ski]);
  for(let n=0;n<mountain+onsen+maintenance;n++){const id=randomUUID();assets.push(id);const store=n<mountain?'MOUNTAIN_BASE':'ONSEN_BASE';await c.query("INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI',$3,$3,$4,'NOT_APPLICABLE','','','SYNTHETIC','capacity-policy.ts',$5)",[id,v,store,n<mountain+onsen?'AVAILABLE':'MAINTENANCE',tag+'-'+n]);}
  await c.query('COMMIT');return {v,assets};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
function group(v:string,n:number,day:string,store:'MOUNTAIN_BASE'|'ONSEN_BASE'='MOUNTAIN_BASE'):HoldConditions{const c=requestFor(day,[v]);c.pickupStore=c.returnStore=store;c.members=Array.from({length:n},(_,i)=>({...c.members[0]!,key:'p'+i}));return c;}
async function create(c:HoldConditions,reserve=false){return x.holds.command('create',randomUUID(),c,undefined,undefined,reserve?{reason:'SYNTHETIC explicit reserve'}:undefined);}
try{
 const a=await stock('property-wide',10,10),c=group(a.v,1,'2035-04-01');
 assert.deepEqual((await x.holds.managementCapacity(c))[0],{kind:'PHYSICAL',supply:a.v,day:'2035-04-01',operationalCapacity:20,publicCapacity:19,publicClaimed:0,staffOverrideClaimed:0,publicRemaining:19,operationalRemaining:20});
 const transfer=new TransferService(x.roles.transferPool,x.principal,()=>x.now());
 const batch=(await transfer.command('create',randomUUID(),{sourceStore:'MOUNTAIN_BASE',destinationStore:'ONSEN_BASE',scheduledDate:'2035-01-02',plannedReadyAt:'2035-01-02T19:00:00+09:00',neededBy:'2035-01-03T08:30:00+09:00',basis:'SYNTHETIC movement proof',lines:a.assets.slice(0,5).map(assetId=>({assetId}))})).batch;
 await x.clock('2035-01-02T17:00:00+09:00');await transfer.command('dispatch',randomUUID(),{},batch.id);await transfer.command('receive',randomUUID(),{pieceIds:batch.pieces.map(p=>p.id)},batch.id);await transfer.command('ready',randomUUID(),{pieceIds:batch.pieces.map(p=>p.id)},batch.id);
 assert.equal((await x.holds.managementCapacity(c))[0]!.publicCapacity,19);
 assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE variant_id=$1 AND store_id='MOUNTAIN_BASE'",[a.v])).rows[0].n,5);
 assert.equal((await create(group(a.v,5,'2035-04-01'))).result,'CREATED');assert.equal((await create(group(a.v,14,'2035-04-01','ONSEN_BASE'))).result,'CREATED');
 assert.equal((await create(group(a.v,1,'2035-04-01','ONSEN_BASE'))).result,'INSUFFICIENT');assert.equal((await create(group(a.v,1,'2035-04-01','ONSEN_BASE'),true)).result,'CREATED');assert.equal((await create(group(a.v,1,'2035-04-01','ONSEN_BASE'),true)).result,'INSUFFICIENT');
 const atCapacity=(await x.holds.managementCapacity(c))[0]!;assert.equal(atCapacity.publicClaimed,19);assert.equal(atCapacity.staffOverrideClaimed,1);assert.equal(atCapacity.operationalRemaining,0);
 const b=await stock('non-lendable',10,0,10);assert.equal((await x.holds.managementCapacity(group(b.v,1,'2035-04-02')))[0]!.operationalCapacity,10);assert.equal((await create(group(b.v,9,'2035-04-02'))).result,'CREATED');assert.equal((await create(group(b.v,1,'2035-04-02'))).result,'INSUFFICIENT');assert.equal((await create(group(b.v,1,'2035-04-02'),true)).result,'CREATED');assert.equal((await create(group(b.v,1,'2035-04-02'),true)).result,'INSUFFICIENT');
 // Compatible immutable Source A/B quantities are rounded together; claims remain bucket-bound.
 const provisional=await stock('compatible-sources',0,0);const db=await x.db.pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('zao.actor',$1,true)",[x.actor]);for(const tag of ['A','B']){const id=(await db.query('INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES($1,$2,$3) RETURNING id',[createHash('sha256').update(tag).digest('hex'),'SYNTHETIC-'+tag+'.xlsx',x.actor])).rows[0].id;await db.query("INSERT INTO provisional_capacity_buckets(source_id,family,age,source_size,booking_size,size_mapping_status,quantity,provenance) VALUES($1,'SKI','ADULT','compatible-sources','compatible-sources','MAPPED',10,$2)",[id,'SYNTHETIC source '+tag]);}await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 const before=(await x.db.pool.query('SELECT to_jsonb(s) v FROM provisional_capacity_sources s ORDER BY id')).rows;
 const publicHold=await create(group(provisional.v,19,'2035-04-03'));assert.equal(publicHold.result,'CREATED');assert.equal((await create(group(provisional.v,1,'2035-04-03'))).result,'INSUFFICIENT');const last=await create(group(provisional.v,1,'2035-04-03'),true);assert.equal(last.result,'CREATED');assert.equal((await create(group(provisional.v,1,'2035-04-03'),true)).result,'INSUFFICIENT');
 const totals=(await x.db.pool.query("SELECT bucket_id,sum(quantity)::int n FROM provisional_capacity_claims WHERE state='ACTIVE' GROUP BY bucket_id")).rows;assert.equal(totals.length,2);assert.deepEqual(totals.map(x=>x.n).sort(),[10,10]);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(s) v FROM provisional_capacity_sources s ORDER BY id')).rows,before);
 // Omission preserves classification; explicit removal must fit the public ceiling.
 assert.equal((await x.holds.command('amend',randomUUID(),last.hold!.conditions,last.holdId,last.hold!.version)).hold!.bufferOverride,true);
 assert.equal((await x.holds.command('amend',randomUUID(),last.hold!.conditions,last.holdId,undefined,{useReserve:false,reason:'SYNTHETIC removal request'})).result,'INSUFFICIENT');
 const own=await create(group(a.v,1,'2035-04-04'),true),pub=await create(group(a.v,1,'2035-04-04'));
 assert.equal(pub.hold!.bufferOverride,false);const assigned=(await x.db.pool.query('SELECT asset_id FROM inventory_claims WHERE hold_id=$1 AND active',[own.holdId])).rows[0].asset_id;
 assert.equal((await x.holds.command('reassign',randomUUID(),{requirementKey:'p0:SKI',assetId:assigned},own.holdId)).hold!.bufferOverride,true);
 await create(group(a.v,1,'2035-04-04'),true);assert.equal((await x.holds.get(pub.holdId!)).bufferOverride,false);assert.equal((await x.holds.get(own.holdId!)).bufferOverride,true);
 await x.db.pool.query("UPDATE staff_permission_overrides SET allowed=false WHERE staff_id=$1 AND permission='INVENTORY_BUFFER_OVERRIDE'",[x.actor]);
 const revoked=new HoldService(x.roles.holdPool,(await loadStaff(x.roles.authPool,x.actor))!,()=>x.now());await assert.rejects(revoked.command('amend',randomUUID(),own.hold!.conditions,own.holdId),{code:'FORBIDDEN'});
 assert.ok((await x.db.pool.query('SELECT count(*)::int n FROM inventory_buffer_override_log WHERE hold_id=$1',[own.holdId])).rows[0].n>=2);
 console.log('PASS capacity policy: property 10+10=19; real move 5 keeps 19; maintenance excluded; public19+staff1 hard20; A10+B10=19 and provenance intact; override persists amend/reassign/replan; no public leakage; permission revoked denies.');
}finally{await x.close();}
