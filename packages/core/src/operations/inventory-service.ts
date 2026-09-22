import {randomUUID} from 'node:crypto';
import {FlowError,flowId,flowObject,flowHash,flowVersion,flowStore} from '../../../contracts/src/rental-flow';
import {ContentInputError} from '../content/bulk-plan';
import {stageStockImport,commitImportDryRun,importDryRunReport,type ImportStage} from '../content/import-staging';
import type {ImportVariant} from '../content/stock-import-plan';
import {OperationsContext,operationalReason,type OpsConnection} from './context';
// PROD-R5 (integration-corrected): the current real-data Owner scope. The generic
// importer/planStockImport still supports all 7 ImportVariant families for future
// architecture — this constant is what actually narrows the current Production real-import
// package. Widening it (e.g. to admit POLE/WEAR_JACKET/WEAR_PANTS) is a deliberate,
// separately-reviewed Owner-approved code change, never a runtime flag.
export const REAL_DATA_APPROVED_FAMILY_SCOPE=['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT'] as const satisfies readonly ImportVariant['family'][];
type Asset={id:string;store_id:string;status:string;version:number;present_expected:boolean};
type Quantity={id:string;kind:'POLES'|'WEAR';physical:number;version:number;protected_count:number};
type Snapshot={assets:Asset[];quantities:Quantity[]};
type Observations={assets:string[];quantities:Record<string,number>};
type Stocktake={id:string;store_id:string;revision:number;state:string;baseline:Snapshot;observations:Observations};
export class InventoryOperations{
 // PROD-R5 (integration-corrected): optional, defaults to unrestricted (every existing
 // caller/test — which exercises all 7 families for generic infrastructure testing — is
 // unaffected). The real-data production import entry point is the one expected to
 // construct this with REAL_DATA_APPROVED_FAMILY_SCOPE explicitly.
 constructor(private ctx:OperationsContext,private approvedFamilyScope?:readonly ImportVariant['family'][]){}
 private async snapshot(c:OpsConnection,store:string):Promise<Snapshot>{return {
  assets:(await c.query<Asset>(`SELECT a.id,a.store_id,a.status,a.version,NOT EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.asset_id=a.id AND l.state='OUT') AND NOT EXISTS(SELECT 1 FROM transfer_pieces p WHERE p.asset_id=a.id AND p.state IN ('IN_TRANSIT','RECEIVED')) AS present_expected FROM ledger_assets a WHERE a.store_id=$1 ORDER BY a.id`,[store])).rows,
  quantities:(await c.query<Quantity>(`SELECT p.id,'POLES'::text AS kind,(p.quantity-(SELECT count(*)::int FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT')) AS physical,p.version,(SELECT count(*)::int FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT') AS protected_count FROM ledger_poles p WHERE p.store_id=$1 UNION ALL SELECT id,'WEAR',total-on_loan-in_transit,revision,returned_pending+cleaning+today_blocked+unavailable FROM wear_pools WHERE store_id=$1 ORDER BY id`,[store])).rows
 };}
 private differences(s:Stocktake){return {missing:s.baseline.assets.filter(a=>a.present_expected&&!s.observations.assets.includes(a.id)).map(a=>a.id),unexpected:s.observations.assets.filter(id=>!s.baseline.assets.some(a=>a.id===id&&a.present_expected)),quantities:s.baseline.quantities.map(q=>({...q,counted:s.observations.quantities[q.id]??null,difference:s.observations.quantities[q.id]===undefined?null:s.observations.quantities[q.id]!-q.physical}))};}
 private async row(c:OpsConnection,id:string){flowId(id);const s=(await c.query<Stocktake>('SELECT * FROM ops_stocktakes WHERE id=$1',[id])).rows[0];if(!s)throw new FlowError('STOCKTAKE_NOT_FOUND',404);await this.ctx.authorize('INVENTORY_VIEW',[s.store_id]);return s;}
 async workspace(store:string){flowStore(store);await this.ctx.authorize('INVENTORY_VIEW',[store]);return {snapshot:await this.snapshot(this.ctx.pool,store),stocktakes:(await this.ctx.pool.query('SELECT id,store_id,revision,state,created_at FROM ops_stocktakes WHERE store_id=$1 ORDER BY created_at DESC LIMIT 50',[store])).rows};}
 async get(id:string){await this.ctx.authorize('INVENTORY_VIEW');const s=await this.row(this.ctx.pool,id);return {...s,differences:this.differences(s),scanWritesCanonicalInventory:false};}
 async create(key:string,store:string){flowId(key);flowStore(store);return this.ctx.transaction('INVENTORY_EDIT',[store],'STOCKTAKE_BEGIN',(c)=>this.ctx.idempotent(c,key,{op:'stocktakeCreate',store},async()=>{const id=randomUUID();await c.query('INSERT INTO ops_stocktakes(id,store_id,actor,request_key,baseline) VALUES($1,$2,$3,$4,$5)',[id,store,this.ctx.identity.subject,key,JSON.stringify(await this.snapshot(c,store))]);return {id};}));}
 async observe(key:string,value:unknown){const v=flowObject(value,['id','expectedRevision','assets','quantities']);flowId(v.id);flowVersion(v.expectedRevision);
  if(!Array.isArray(v.assets)||v.assets.length>3000||v.assets.some(a=>typeof a!=='string'))throw new FlowError('INVALID_SCANS',422);v.assets.forEach(flowId);
  if(!v.quantities||typeof v.quantities!=='object'||Array.isArray(v.quantities)||Object.entries(v.quantities).length>500)throw new FlowError('INVALID_COUNTS',422);
  for(const [id,n] of Object.entries(v.quantities)){flowId(id);if(!Number.isInteger(n)||Number(n)<0||Number(n)>1000000)throw new FlowError('INVALID_COUNTS',422);}
  await this.ctx.authorize('INVENTORY_EDIT');const before=await this.row(this.ctx.pool,v.id);
  return this.ctx.transaction('INVENTORY_EDIT',[before.store_id],'STOCKTAKE_OBSERVATION',(c)=>this.ctx.idempotent(c,key,{op:'observe',v},async()=>{
   const s=await this.row(c,v.id as string);if(s.revision!==v.expectedRevision||s.state==='RECONCILED')throw new FlowError('STALE_STOCKTAKE',409);
   if(Object.keys(v.quantities as object).some(id=>!s.baseline.quantities.some(q=>q.id===id)))throw new FlowError('UNKNOWN_QUANTITY_POOL',422);
   const observations={assets:[...new Set(v.assets as string[])].sort(),quantities:v.quantities};await c.query("UPDATE ops_stocktakes SET observations=$2,state='REVIEW_REQUIRED',revision=revision+1 WHERE id=$1",[s.id,JSON.stringify(observations)]);return {id:s.id,revision:s.revision+1,state:'REVIEW_REQUIRED',canonicalWrites:0};
  }));
 }
 async reconcile(key:string,value:unknown){const v=flowObject(value,['id','expectedRevision','reason']);flowId(v.id);flowVersion(v.expectedRevision);const reason=operationalReason(v.reason);await this.ctx.authorize('INVENTORY_RECONCILE');const before=await this.row(this.ctx.pool,v.id);
  return this.ctx.transaction('INVENTORY_RECONCILE',[before.store_id],reason,(c)=>this.ctx.idempotent(c,key,{op:'reconcileStocktake',v},async()=>{
   await c.query('SELECT ops_assert_actor($1,$2::text[],$3)',['INVENTORY_EDIT',[before.store_id],this.ctx.identity.subject]);
   const s=await this.row(c,v.id as string),current=await this.snapshot(c,s.store_id);if(s.revision!==v.expectedRevision||s.state!=='REVIEW_REQUIRED'||flowHash(current)!==flowHash(s.baseline))throw new FlowError('STOCKTAKE_BASELINE_CHANGED',409);
   const differences=this.differences(s);if(differences.unexpected.length)throw new FlowError('ACTUAL_TRANSFER_OR_RECEIPT_REQUIRED',409);if(differences.quantities.some(q=>q.counted===null))throw new FlowError('STOCKTAKE_COUNTS_INCOMPLETE',409);
   // Missing serials become unavailable, never silently relocated or deleted.
   // Canonical SQL stock guards reject changes that would break HOLD/custody promises.
   for(const id of differences.missing)await c.query("UPDATE ledger_assets SET status='MAINTENANCE' WHERE id=$1",[id]);
   for(const q of differences.quantities){if(q.difference===0)continue;if(q.kind==='POLES'){const target=q.counted!+q.protected_count;if((await c.query("SELECT 1 FROM rental_loan_items WHERE pole_id=$1 AND state='OUT' AND pole_slot>$2 UNION ALL SELECT 1 FROM inventory_claims WHERE pole_id=$1 AND active AND transfer_piece_id IS NULL AND pole_slot>$2 UNION ALL SELECT 1 FROM transfer_pieces WHERE (source_pole_id=$1 OR destination_pole_id=$1 OR receipt_pole_id=$1) AND state NOT IN ('CANCELLED','CLOSED') LIMIT 1",[q.id,target])).rowCount)throw new FlowError('POLE_PROMISE_RECONCILIATION_REQUIRED',409);await c.query('SELECT ops_reconcile_poles($1,$2,$3)',[s.id,q.id,s.revision]);}
    else{const ready=q.counted!-q.protected_count;if(ready<0)throw new FlowError('CARE_BUCKET_RECONCILIATION_REQUIRED',409);await c.query('UPDATE wear_pools SET ready=$2 WHERE id=$1',[q.id,ready]);}}
   const after=await this.snapshot(c,s.store_id),id=randomUUID();await c.query('INSERT INTO ops_stocktake_reconciliations(id,stocktake_id,actor,request_key,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,s.id,this.ctx.identity.subject,key,reason,JSON.stringify(current),JSON.stringify(after)]);
   await c.query("UPDATE ops_stocktakes SET state='RECONCILED',revision=revision+1 WHERE id=$1",[s.id]);return {id:s.id,revision:s.revision+1,state:'RECONCILED',reconciliationId:id};
  }));
 }
 private async catalog(c:OpsConnection){
  const variants=(await c.query<ImportVariant>(`SELECT v.id,v.model_id AS "modelId",m.catalog_season AS season,''::text AS "manufacturerSku",v.family,v.size,v.tier,m.brand,m.name AS "modelName" FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id ORDER BY v.id`)).rows;
  return {variants,revision:flowHash(variants),prior:Object.fromEntries((await c.query<{source_key:string;source_sha256:string}>('SELECT source_key,source_sha256 FROM ops_import_sources')).rows.map(r=>[r.source_key,r.source_sha256]))};
 }
 async importCatalog(){await this.ctx.authorize('INVENTORY_EDIT');const c=await this.catalog(this.ctx.pool);return {variants:c.variants,revision:c.revision,manufacturerSkuPolicy:'EMPTY_WHEN_NOT_IN_AUTHORITATIVE_CATALOG'};}
 async stageImport(key:string,value:unknown){const v=flowObject(value,['csv','sheet']);if(typeof v.csv!=='string'||Buffer.byteLength(v.csv)>2*1024*1024||typeof v.sheet!=='string')throw new FlowError('IMPORT_INPUT_INVALID',422);
  return this.ctx.transaction('INVENTORY_EDIT',[],'IMPORT_DRY_RUN',(c)=>this.ctx.idempotent(c,key,{op:'stageImport',v},async()=>{const catalog=await this.catalog(c),stage=stageStockImport(v.csv as string,v.sheet as string,catalog.variants,catalog.prior,catalog.revision,this.approvedFamilyScope);
   const stores=[...new Set(stage.staged.flatMap(r=>r.normalized.storeId?[r.normalized.storeId]:[]))];await c.query('SELECT ops_assert_actor($1,$2::text[],$3)',['INVENTORY_EDIT',stores,this.ctx.identity.subject]);
   const exists=new Set((await c.query<{id:string}>('SELECT id FROM ledger_assets WHERE id=ANY($1::uuid[])',[stage.staged.flatMap(r=>r.normalized.assetIds).filter(x=>/^[0-9a-f-]{36}$/.test(x))])).rows.map(r=>r.id));
   const conflicts=stage.plan?.entries.filter(e=>e.disposition!=='ALREADY_IMPORTED'&&e.source.assetIds.some(id=>exists.has(id))).map(e=>e.source.locator)??[];
   const id=randomUUID();await c.query('INSERT INTO ops_import_stages(id,actor,stage,stage_sha256) VALUES($1,$2,$3,$4)',[id,this.ctx.identity.subject,JSON.stringify(stage),stage.stageSha256]);
   return {id,stageSha256:stage.stageSha256,unresolved:stage.unresolved,conflicts,rows:stage.plan?.entries.map(e=>({sourceKey:e.sourceKey,disposition:e.disposition,issues:e.issues}))??[],report:importDryRunReport(stage,exists),ready:stage.schemaVersion>=2&&!stage.unresolved.length&&!conflicts.length};
  }));
 }
 /** Declares that a committed import was real stock. Counts are recomputed in SQL from
  * what the commit actually applied, so the receipt cannot overstate coverage, and the
  * declaration needs explicit ALL scope because it is a cross-store statement. */
 async acceptRealData(key:string,value:unknown){
  const v=flowObject(value,['commitId','expectedStores']);flowId(v.commitId);
  // The caller may state what coverage it expects; SQL derives the real coverage from the
  // committed rows and rejects a mismatch. Nothing here can assert that a source is real.
  if(v.expectedStores!==null&&(!Array.isArray(v.expectedStores)||!v.expectedStores.length||v.expectedStores.some(s=>!['MOUNTAIN_BASE','ONSEN_BASE'].includes(s as string))||new Set(v.expectedStores).size!==v.expectedStores.length))throw new FlowError('REAL_DATA_INPUT_INVALID',422);
  const p=await this.ctx.authorize('INVENTORY_EDIT');if(p.scope!=='ALL')throw new FlowError('FORBIDDEN',403);
  return this.ctx.transaction('INVENTORY_EDIT',[],'REAL_DATA_ACCEPTANCE',c=>this.ctx.idempotent(c,key,v,async()=>(await c.query('SELECT real_data_accept($1,$2::text[]) v',[v.commitId,v.expectedStores])).rows[0].v));
 }
 async realDataAcceptance(){
  await this.ctx.authorize('OPERATIONS_VIEW');
  return this.ctx.transaction('OPERATIONS_VIEW',[],'REAL_DATA_STATUS',async c=>(await c.query('SELECT real_data_acceptance_status() v')).rows[0].v as {commitId:string;acceptedAssets:number;stores:string[];commitPresent:boolean;sourceMatches:boolean;sourceApproved:boolean}[]);
 }
 async commitImport(key:string,value:unknown){const v=flowObject(value,['id','stageSha256','reason']);flowId(v.id);if(typeof v.stageSha256!=='string'||! /^[a-f0-9]{64}$/.test(v.stageSha256))throw new FlowError('INVALID_STAGE_HASH',422);const reason=operationalReason(v.reason);
  return this.ctx.transaction('INVENTORY_EDIT',[],reason,(c)=>this.ctx.idempotent(c,key,{op:'commitImport',v},async()=>{
   const saved=(await c.query<{actor:string;stage:ImportStage}>('SELECT actor,stage FROM ops_import_stages WHERE id=$1',[v.id])).rows[0];if(!saved||saved.actor!==this.ctx.identity.subject)throw new FlowError('FORBIDDEN',403);if(![2,3].includes(saved.stage.schemaVersion))throw new FlowError('IMPORT_V2_METADATA_REQUIRED',409);
   const stores=[...new Set(saved.stage.staged.flatMap(r=>r.normalized.storeId?[r.normalized.storeId]:[]))];await c.query('SELECT ops_assert_actor($1,$2::text[],$3)',['INVENTORY_EDIT',stores,this.ctx.identity.subject]);
   const prior=(await c.query('SELECT stage_sha256,result FROM ops_import_commits WHERE id=$1',[v.id])).rows[0];if(prior){if(prior.stage_sha256!==v.stageSha256)throw new FlowError('IDEMPOTENCY_MISMATCH',409);return prior.result;}
   const catalog=await this.catalog(c),existing=new Set((await c.query<{id:string}>('SELECT id FROM ledger_assets WHERE id=ANY($1::uuid[])',[saved.stage.staged.flatMap(r=>r.normalized.assetIds)])).rows.map(r=>r.id));let plan;
   try{plan=commitImportDryRun(saved.stage,v.stageSha256 as string,catalog.variants,catalog.prior,catalog.revision,existing);}catch(e){throw new FlowError(e instanceof ContentInputError?e.code:'IMPORT_UNRESOLVED',409);}
   for(const op of plan.operations){const r=op.source,m=r.metadata!,variant=catalog.variants.find(v=>v.id===r.variantId)!;
    if(op.kind==='ADD_ASSETS')for(const [n,id] of r.assetIds.entries())await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_mm,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$11,'UNVERIFIED',$9,$10)`,[id,r.variantId,variant.family,r.storeId,m.status,variant.family==='SKI_BOOT'?m.bslMm===null?'UNVERIFIED':'RECORDED':'NOT_APPLICABLE',m.bslMm,m.bslMm===null?'':'Receipt source '+m.sourceRow,m.sourceDocument,m.sourceRow+':'+(n+1),m.note??'']);
    else if(variant.family==='POLE'){const pool=(await c.query<{id:string}>('SELECT id FROM ledger_poles WHERE variant_id=$1 AND store_id=$2 AND status=$3',[r.variantId,r.storeId,m.status])).rows[0];if(pool)await c.query('UPDATE ledger_poles SET quantity=quantity+$2 WHERE id=$1',[pool.id,r.quantity]);else await c.query("INSERT INTO ledger_poles(id,variant_id,store_id,status,quantity,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,$4,$5,'','UNVERIFIED',$6,$7)",[randomUUID(),r.variantId,r.storeId,m.status,r.quantity,m.sourceDocument,m.sourceRow]);}
    else{let pool=(await c.query<{id:string}>('SELECT id FROM wear_pools WHERE variant_id=$1 AND store_id=$2',[r.variantId,r.storeId])).rows[0];if(!pool){pool={id:randomUUID()};await c.query('INSERT INTO wear_pools(id,variant_id,store_id) VALUES($1,$2,$3)',[pool.id,r.variantId,r.storeId]);}const column=m.status==='AVAILABLE'?'ready':'unavailable';await c.query(`UPDATE wear_pools SET ${column}=${column}+$2 WHERE id=$1`,[pool.id,r.quantity]);}
    await c.query('INSERT INTO ops_import_sources(source_key,source_sha256,stage_id,actor) VALUES($1,$2,$3,$4)',[op.sourceKey,op.sourceHash,v.id,this.ctx.identity.subject]);
   }
   const result={id:v.id,importedSources:plan.operations.length,assetsAdded:plan.operations.reduce((n,o)=>n+o.source.assetIds.length,0),alreadyImported:saved.stage.staged.length-plan.operations.length,deleted:0};
   await c.query('INSERT INTO ops_import_commits(id,actor,request_key,stage_sha256,result) VALUES($1,$2,$3,$4,$5)',[v.id,this.ctx.identity.subject,key,v.stageSha256,JSON.stringify(result)]);return result;
  }));
 }
}
