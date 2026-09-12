import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import type {HoldConditions} from '../../packages/contracts/src/hold';
import {fixtureId} from '../fixtures/ledger-sample';
export const fid=fixtureId;
export const variants={ski:fid(1101),skiAlt:fid(1102),boot:fid(1103),pole:fid(1104),board:fid(1105),boardBoot:fid(1106),kids:fid(1107),premium:fid(1108)};
export function requestFor(date:string,ids=[variants.ski]):HoldConditions{return {reservationId:randomUUID(),pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:date,endDate:date,slot:'DAY'},members:[{key:'person-a',product:'SINGLE',age:'ADULT',tier:'REGULAR',items:[{family:'SKI',variantIds:ids}]}]};}
export function skiSet(date:string):HoldConditions{const c=requestFor(date);c.members[0]!.product='SKI_SET';c.members[0]!.items.push({family:'SKI_BOOT',variantIds:[variants.boot]},{family:'POLE',variantIds:[variants.pole]});return c;}
export async function seedInventory(pool:Pool,load=false){
 const svc=new LedgerService(pool,{subject:'synthetic-inventory-seed',role:'ADMIN',storeIds:['MOUNTAIN_BASE','ONSEN_BASE']},async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */});
 const provenance=(locator:string)=>({notes:'SYNTHETIC E06, not observed inventory',sourceKind:'SYNTHETIC',sourceDocument:'tests/inventory/fixture.ts',sourceLocator:locator});
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-inventory-seed',true),set_config('zao.reason','E06 SYNTHETIC seed',true)");
 const families=['SKI','SKI_BOOT','POLE','SNOWBOARD','SNOWBOARD_BOOT'];
 for(let i=0;i<families.length;i++)await c.query(`INSERT INTO ledger_models(id,code,name,brand,family,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'SYNTHETIC',$4,'','SYNTHETIC','tests/inventory/fixture.ts',$2) ON CONFLICT DO NOTHING`,[fid(1001+i),'E06-'+families[i],'合成 '+families[i],families[i]]);
 for(const [n,family,size,age,tier] of [[1101,'SKI','150 cm','ADULT','REGULAR'],[1102,'SKI','155 cm','ADULT','REGULAR'],[1103,'SKI_BOOT','26.5 cm','ADULT','REGULAR'],[1104,'POLE','110 cm','ADULT','REGULAR'],[1105,'SNOWBOARD','150 cm','ADULT','REGULAR'],[1106,'SNOWBOARD_BOOT','26.5 cm','ADULT','REGULAR'],[1107,'SKI','150 cm','KIDS','REGULAR'],[1108,'SKI','150 cm','ADULT','PREMIUM']] as const)await c.query(`INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,$4,$5,$6,'','SYNTHETIC','tests/inventory/fixture.ts',$7) ON CONFLICT DO NOTHING`,[fid(n),fid(1001+families.indexOf(family)),family,age,tier,size,'variant-'+n]);
 const specifications=[[1201,variants.ski,'SKI'],[1202,variants.skiAlt,'SKI'],[1203,variants.boot,'SKI_BOOT'],[1204,variants.board,'SNOWBOARD'],[1205,variants.boardBoot,'SNOWBOARD_BOOT']] as const;
 for(const [n,v,f]of specifications)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_mm,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,NULL,'','','SYNTHETIC','tests/inventory/fixture.ts',$5) ON CONFLICT DO NOTHING`,[fid(n),v,f,f==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','asset-'+n]);
 await c.query(`INSERT INTO ledger_poles(id,variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES($1,$2,'MOUNTAIN_BASE',1,'AVAILABLE','','SYNTHETIC','tests/inventory/fixture.ts','pole-1301') ON CONFLICT DO NOTHING`,[fid(1301),variants.pole]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 if(load){
  // Exactly 150 ski pairs + 150 boards, not 300 of each. Components are additional inventory.
  for(const [family,variantId,count]of [['SKI',variants.ski,148],['SNOWBOARD',variants.board,149],['SKI_BOOT',variants.boot,149],['SNOWBOARD_BOOT',variants.boardBoot,149]] as const)for(let i=0;i<count;i++)await svc.create('assets',{...provenance(`load-${family}-${i}`),family,variantId,storeId:'MOUNTAIN_BASE',status:'AVAILABLE',bslStatus:family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE',bslMm:null,bslEvidence:''});
  const pole=await svc.get('poles',fid(1301));await svc.update('poles',pole.id,{version:pole.version,reason:'Synthetic load quantity',quantity:150});
 }
}
