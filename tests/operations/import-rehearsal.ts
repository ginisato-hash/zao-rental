import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {InventoryOperations} from '../../packages/core/src/operations/inventory-service';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {STOCK_IMPORT_HEADER_V3} from '../../packages/contracts/src/stock-import';
import {LaunchGate} from '../../packages/core/src/operations/launch-gate';
const SEASON='2026/27',STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const,PER_STORE=125;
// 500 equipment sets: 125 ski + 125 board per store, each with matching boots, plus pole
// pairs and wear pieces. Synthetic only; this is never observed inventory.
const KINDS=[
 {family:'SKI',unit:'ASSET_PAIR',size:'160 cm',tier:'REGULAR',bsl:''},
 {family:'SNOWBOARD',unit:'ASSET_BOARD',size:'152 cm',tier:'REGULAR',bsl:''},
 {family:'SKI_BOOT',unit:'ASSET_PAIR',size:'26.5 cm',tier:'REGULAR',bsl:'285'},
 {family:'SNOWBOARD_BOOT',unit:'ASSET_PAIR',size:'26.5 cm',tier:'REGULAR',bsl:''},
 {family:'POLE',unit:'PAIR_QUANTITY',size:'115 cm',tier:'REGULAR',bsl:''},
 {family:'WEAR_JACKET',unit:'PIECE_QUANTITY',size:'M',tier:'STANDARD',bsl:''},
 {family:'WEAR_PANTS',unit:'PIECE_QUANTITY',size:'M',tier:'STANDARD',bsl:''},
] as const;
let failed=false,stage='fixture',count=0;const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 role=await provisionOperationsRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(role.operationsPool,x.roles.authPool,x.signed.identity),svc=new InventoryOperations(ctx);
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'OPERATIONS_VIEW',true)",[x.actor]);
 Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
 const ledger=new LedgerService(x.db.pool,{subject:x.actor,role:'ADMIN',storeIds:[...STORES]},async()=>{},async()=>{});
 const source={notes:'',sourceKind:'SYNTHETIC',sourceDocument:'SYNTHETIC M2A catalog',sourceLocator:'m2a'};

 stage='catalog';
 const catalog=new Map<string,{modelId:string;variantId:string;brand:string;modelName:string}>();
 for(const k of KINDS){
  const brand='SYNTHETIC',modelName='M2A '+k.family;
  const model=await ledger.create('models',{...source,sourceLocator:'model-'+k.family,code:'M2A-'+k.family,name:modelName,brand,family:k.family,catalogSeason:SEASON});
  const wear=k.family==='WEAR_JACKET'||k.family==='WEAR_PANTS';
  const variant=await ledger.create('variants',{...source,sourceLocator:'variant-'+k.family,modelId:model.id,family:k.family,age:'ADULT',tier:k.tier,size:k.size,...(wear?{compatibleSports:['SKI','SNOWBOARD']}:{})});
  catalog.set(k.family,{modelId:model.id,variantId:variant.id,brand,modelName});
 }
 const assetIds=new Map<string,string[]>();
 const row=(k:typeof KINDS[number],store:string,note:string,tag='')=>{
  const c=catalog.get(k.family)!,asset=k.unit.startsWith('ASSET_');
  const ids=asset?Array.from({length:PER_STORE},()=>randomUUID()):[];
  if(asset)assetIds.set(k.family+':'+store,ids);
  return ['SHOP_RECEIPT','ADD',c.modelId,SEASON,c.variantId,'',PER_STORE,k.unit,ids.join('|'),store,'SYNTHETIC M2A receipt'+tag,'row-'+k.family+'-'+store+tag,k.family,k.size,k.tier,k.bsl,'AVAILABLE',c.brand,c.modelName,note].join(',');
 };
 const lines=STORES.flatMap(store=>KINDS.map(k=>row(k,store,'M2A rehearsal '+k.family)));
 const csv=STOCK_IMPORT_HEADER_V3.join(',')+'\n'+lines.join('\n')+'\n';
 let stageId='',stageHash='';

 await check('dry-run reports every category and writes no inventory',async()=>{
  const before=(await x.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n;
  const plan=await svc.stageImport(randomUUID(),{csv,sheet:'m2a-receipt'});
  stageId=plan.id;stageHash=plan.stageSha256;
  const r=plan.report;
  assert.equal(r.schemaVersion,3);
  assert.equal(r.totalRows,KINDS.length*STORES.length);
  assert.equal(r.valid,r.totalRows);assert.equal(r.blockingError,0);assert.equal(r.warning,0);
  for(const k of ['duplicateAssetId','duplicateSource','existingConflict','unknownStore','unknownCategory','invalidQuantity','unresolvedModel','unresolvedBsl'] as const)assert.equal(r[k],0,k);
  assert.equal(r.wouldCreate,8);assert.equal(r.wouldUpdate,6);assert.equal(r.ignoredNoop,0);assert.equal(r.committable,true);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n,before);
 });

 await check('a stale or mismatched plan cannot commit',async()=>{
  await assert.rejects(svc.commitImport(randomUUID(),{id:stageId,stageSha256:'0'.repeat(64),reason:'SYNTHETIC stale'}),{code:'IMPORT_STAGE_STALE'});
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE source_document='SYNTHETIC M2A receipt'")).rows[0].n,0);
 });

 await check('explicit commit creates 500 sets across two stores with traceable provenance',async()=>{
  const result=await svc.commitImport(randomUUID(),{id:stageId,stageSha256:stageHash,reason:'SYNTHETIC M2A stock receipt'});
  assert.equal(result.importedSources,KINDS.length*STORES.length);
  assert.equal(result.assetsAdded,PER_STORE*4*STORES.length);
  for(const store of STORES)for(const k of KINDS.filter(k=>k.unit.startsWith('ASSET_')))
   assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ledger_assets WHERE variant_id=$1 AND store_id=$2',[catalog.get(k.family)!.variantId,store])).rows[0].n,PER_STORE,k.family+'@'+store);
  // A ski pair and a board are each exactly one Asset, so 500 sets means 500 primary Assets.
  const sets=(await x.db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE family IN ('SKI','SNOWBOARD') AND source_document='SYNTHETIC M2A receipt'")).rows[0].n;
  assert.equal(sets,PER_STORE*2*STORES.length);
  for(const store of STORES){
   assert.equal((await x.db.pool.query('SELECT quantity FROM ledger_poles WHERE variant_id=$1 AND store_id=$2',[catalog.get('POLE')!.variantId,store])).rows[0].quantity,PER_STORE);
   for(const wear of ['WEAR_JACKET','WEAR_PANTS'] as const)assert.equal((await x.db.pool.query('SELECT ready FROM wear_pools WHERE variant_id=$1 AND store_id=$2',[catalog.get(wear)!.variantId,store])).rows[0].ready,PER_STORE);
  }
  const traced=(await x.db.pool.query("SELECT source_kind,source_document,source_locator,notes,bsl_mm,bsl_status FROM ledger_assets WHERE variant_id=$1 LIMIT 1",[catalog.get('SKI_BOOT')!.variantId])).rows[0];
  assert.equal(traced.source_document,'SYNTHETIC M2A receipt');assert.ok(traced.source_locator.startsWith('row-SKI_BOOT-'));
  assert.equal(traced.notes,'M2A rehearsal SKI_BOOT');assert.equal(traced.bsl_mm,285);assert.equal(traced.bsl_status,'RECORDED');
 });

 await check('re-importing the same file creates nothing and reports every row as noop',async()=>{
  const before=(await x.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n;
  const replay=await svc.stageImport(randomUUID(),{csv,sheet:'m2a-receipt'});
  const r=replay.report;
  assert.equal(r.totalRows,KINDS.length*STORES.length);assert.equal(r.blockingError,0);
  assert.equal(r.ignoredNoop,r.totalRows);assert.equal(r.warning,r.totalRows);
  assert.equal(r.wouldCreate,0);assert.equal(r.wouldUpdate,0);assert.equal(r.committable,false);
  // Committing the replay is allowed and is a no-op: the source rows are already imported.
  const again=await svc.commitImport(randomUUID(),{id:replay.id,stageSha256:replay.stageSha256,reason:'SYNTHETIC replay'});
  assert.equal(again.importedSources,0);assert.equal(again.assetsAdded,0);assert.equal(again.alreadyImported,r.totalRows);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n,before);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM ops_import_sources")).rows[0].n,r.totalRows);
 });

 await check('a damaged file is reported by category and never guessed',async()=>{
  const c=catalog.get('SKI')!,ids=[randomUUID(),randomUUID()].join('|');
  const bad=[
   ['SHOP_RECEIPT','ADD',c.modelId,SEASON,c.variantId,'',2,'ASSET_PAIR',ids,'','d','r1','SKI','160 cm','REGULAR','','AVAILABLE',c.brand,c.modelName,''],
   ['SHOP_RECEIPT','ADD',c.modelId,SEASON,c.variantId,'',2,'ASSET_PAIR',ids,'MOUNTAIN_BASE','d','r2','NOT_A_CATEGORY','160 cm','REGULAR','','AVAILABLE',c.brand,c.modelName,''],
   ['SHOP_RECEIPT','ADD',c.modelId,SEASON,c.variantId,'',-1,'ASSET_PAIR',ids,'MOUNTAIN_BASE','d','r3','SKI','160 cm','REGULAR','','AVAILABLE',c.brand,c.modelName,''],
   ['SHOP_RECEIPT','ADD',c.modelId,SEASON,randomUUID(),'',2,'ASSET_PAIR',ids,'MOUNTAIN_BASE','d','r4','SKI','160 cm','REGULAR','','AVAILABLE',c.brand,c.modelName,''],
   ['SHOP_RECEIPT','ADD',c.modelId,SEASON,c.variantId,'',1,'ASSET_PAIR',randomUUID(),'MOUNTAIN_BASE','d','r5','SKI','160 cm','REGULAR','9999','AVAILABLE',c.brand,c.modelName,''],
   ['SHOP_RECEIPT','ADD',c.modelId,SEASON,c.variantId,'',1,'ASSET_PAIR',randomUUID(),'MOUNTAIN_BASE','d','r6','SKI','160 cm','REGULAR','','AVAILABLE','WRONG BRAND',c.modelName,''],
  ].map(r=>r.join(','));
  const plan=await svc.stageImport(randomUUID(),{csv:STOCK_IMPORT_HEADER_V3.join(',')+'\n'+bad.join('\n')+'\n',sheet:'damaged'});
  const r=plan.report;
  assert.equal(plan.ready,false);assert.equal(r.committable,false);assert.equal(r.valid,0);
  assert.equal(r.totalRows,bad.length);assert.equal(r.blockingError,bad.length);
  assert.ok(r.unknownStore>=1&&r.unknownCategory>=1&&r.invalidQuantity>=1&&r.unresolvedModel>=2&&r.unresolvedBsl>=1&&r.duplicateAssetId>=1);
  const serialized=JSON.stringify(r);
  for(const cell of ['WRONG BRAND','160 cm','NOT_A_CATEGORY'])assert.ok(!serialized.includes(cell),cell);
 });

 // A second, deliberately separate source file. Its content is synthetic, but its digest
 // stands in for a file the owner has approved at the deployment-owned boundary.
 const poleKind=KINDS.find(k=>k.unit==='PAIR_QUANTITY')!;
 const approvedLines=STORES.flatMap(store=>[row(KINDS[0]!,store,'M2A approved source',' approved'),row(poleKind,store,'M2A approved poles',' approved')]);
 const approvedCsv=STOCK_IMPORT_HEADER_V3.join(',')+'\n'+approvedLines.join('\n')+'\n';
 const oneStoreCsv=STOCK_IMPORT_HEADER_V3.join(',')+'\n'+row(KINDS[1]!,'MOUNTAIN_BASE','M2A one store source',' one-store')+'\n';
 const gate=new LaunchGate(ctx);
 const components={APP:'READY',DB:'READY',GUEST:'READY',PAYMENT_ADAPTER:'UNCONNECTED',WEBHOOK:'UNCONNECTED',MEDIA:'OFF',NOTIFICATION:'UNCONNECTED'};
 const realData=async()=>(await gate.status({runId:null,components,backup:null})).rows.find(r=>r.row==='REAL_DATA')!.state;
 const commit=async(text:string,sheet:string)=>{const plan=await svc.stageImport(randomUUID(),{csv:text,sheet});await svc.commitImport(randomUUID(),{id:plan.id,stageSha256:plan.stageSha256,reason:'SYNTHETIC '+sheet});return plan.id;};
 // Only the database owner may approve a source; no application role is granted INSERT.
 const approve=async(text:string,label:string)=>{const digest=createHash('sha256').update(text).digest('hex');await x.db.pool.query('INSERT INTO real_inventory_sources(source_sha256,label) VALUES($1,$2)',[digest,label]);return digest;};

 await check('an unapproved synthetic rehearsal can never be declared real stock',async()=>{
  assert.equal(await realData(),'NOT_RUN');
  await assert.rejects(svc.acceptRealData(randomUUID(),{commitId:stageId,expectedStores:null}),{status:409});
  await assert.rejects(svc.acceptRealData(randomUUID(),{commitId:stageId,expectedStores:[...STORES]}),{status:409});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM real_data_acceptance')).rows[0].n,0);
  assert.equal(await realData(),'NOT_RUN');
 });

 await check('an application role cannot approve a source, and an unknown digest stays unapproved',async()=>{
  await assert.rejects(role!.operationsPool.query("INSERT INTO real_inventory_sources(source_sha256,label) VALUES($1,'forged')",['b'.repeat(64)]),{code:'42501'});
  await x.db.pool.query('INSERT INTO real_inventory_sources(source_sha256,label) VALUES($1,$2)',['c'.repeat(64),'unrelated approved file']);
  // Approving some other file does not make this commit real.
  await assert.rejects(svc.acceptRealData(randomUUID(),{commitId:stageId,expectedStores:null}),{status:409});
  assert.equal(await realData(),'NOT_RUN');
 });

 let oneStoreCommit='';
 await check('store coverage is derived from the commit, not from the caller',async()=>{
  oneStoreCommit=await commit(oneStoreCsv,'one-store');
  await approve(oneStoreCsv,'M2A one store approved');
  // The caller claims both stores; the commit only covers one.
  await assert.rejects(svc.acceptRealData(randomUUID(),{commitId:oneStoreCommit,expectedStores:[...STORES]}),{status:409});
  const receipt=await svc.acceptRealData(randomUUID(),{commitId:oneStoreCommit,expectedStores:null});
  assert.deepEqual((receipt as {stores:string[]}).stores,['MOUNTAIN_BASE']);
  // One store is coverage in progress, not readiness.
  assert.equal(await realData(),'PENDING');
 });

 let approvedCommit='';
 await check('an owner-approved source covering both stores reaches READY',async()=>{
  approvedCommit=await commit(approvedCsv,'approved-source');
  const digest=await approve(approvedCsv,'M2A approved two store source');
  const key=randomUUID(),input={commitId:approvedCommit,expectedStores:[...STORES]};
  const receipt=await svc.acceptRealData(key,input),again=await svc.acceptRealData(key,input);
  assert.deepEqual(receipt,again);
  assert.deepEqual((receipt as {stores:string[]}).stores.slice().sort(),[...STORES].sort());
  assert.equal((receipt as {sourceClass:string}).sourceClass,'REAL');
  assert.equal((receipt as {synthetic:boolean}).synthetic,false);
  assert.equal((receipt as {approvedSource:boolean}).approvedSource,true);
  assert.equal((await x.db.pool.query('SELECT approved_source_sha256 FROM real_data_acceptance WHERE commit_id=$1',[approvedCommit])).rows[0].approved_source_sha256,digest);
  // accepted_assets counts immutable Assets; accepted_quantity sums the physical quantity
  // the quantity-backed rows actually carried, not how many lines mentioned them.
  assert.equal((receipt as {acceptedRows:number}).acceptedRows,STORES.length*2);
  assert.equal((receipt as {acceptedAssets:number}).acceptedAssets,PER_STORE*STORES.length);
  assert.equal((receipt as {acceptedQuantity:number}).acceptedQuantity,PER_STORE*STORES.length);
  assert.equal(await realData(),'READY');
  const serialized=JSON.stringify(receipt);
  for(const leak of ['@','password','token','://'])assert.ok(!serialized.includes(leak),leak);
 });

 await check('the committed source is immutable and a withdrawn approval retires the receipt',async()=>{
  assert.equal(await realData(),'READY');
  // The receipt is bound to a stage that cannot be rewritten, so its digest cannot drift.
  await assert.rejects(x.db.pool.query("UPDATE ops_import_stages SET stage=jsonb_set(stage,'{sourceSha256}',to_jsonb($2::text)) WHERE id=$1",[approvedCommit,'d'.repeat(64)]),{code:'23514'});
  assert.equal((await x.db.pool.query('SELECT stage->>$2 v FROM ops_import_stages WHERE id=$1',[approvedCommit,'sourceSha256'])).rows[0].v,createHash('sha256').update(approvedCsv).digest('hex'));
  assert.equal(await realData(),'READY');
  // Withdrawing the approval retires the receipt without deleting the record of what happened.
  await x.db.pool.query('DELETE FROM real_inventory_sources WHERE source_sha256=$1',[createHash('sha256').update(approvedCsv).digest('hex')]);
  await x.db.pool.query('DELETE FROM real_inventory_sources WHERE source_sha256=$1',[createHash('sha256').update(oneStoreCsv).digest('hex')]);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM real_data_acceptance')).rows[0].n,2);
  assert.equal(await realData(),'NOT_RUN');
 });

 await check('imported stock is visible to reconciliation and search without extra queries',async()=>{
  const workspace=await svc.workspace('MOUNTAIN_BASE');
  assert.ok(workspace);
  const listed=(await x.db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE store_id='MOUNTAIN_BASE' AND status='AVAILABLE' AND source_document='SYNTHETIC M2A receipt'")).rows[0].n;
  assert.equal(listed,PER_STORE*4);
  const labelled=(await x.db.pool.query("SELECT id,family FROM ledger_assets WHERE source_document='SYNTHETIC M2A receipt' AND family='SKI' LIMIT 1")).rows[0];
  assert.ok(/^[a-f0-9-]{36}$/.test(labelled.id));
 });

 await check('PROD-R5: the real-data production entry point (constructed with the approved family scope) refuses POLE, even though the generic service above admitted it freely',async()=>{
  const {REAL_DATA_APPROVED_FAMILY_SCOPE}=await import('../../packages/core/src/operations/inventory-service');
  const scopedSvc=new InventoryOperations(ctx,REAL_DATA_APPROVED_FAMILY_SCOPE);
  const poleKindForProbe=KINDS.find(k=>k.family==='POLE')!;
  const csv=STOCK_IMPORT_HEADER_V3.join(',')+'\n'+row(poleKindForProbe,'MOUNTAIN_BASE','r5 scope probe','-r5probe')+'\n';
  const plan=await scopedSvc.stageImport(randomUUID(),{csv,sheet:'r5-scope-probe'});
  assert.ok(plan.rows[0]!.issues.includes('FAMILY_NOT_IN_APPROVED_SCOPE'));
  assert.equal(plan.report.committable,false);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,syntheticSets:PER_STORE*2*STORES.length,stores:STORES.length,assetsCreated:PER_STORE*4*STORES.length,realInventoryImports:0,productionGuarantee:false,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await role?.close();await x.close();}
if(failed)process.exit(1);
