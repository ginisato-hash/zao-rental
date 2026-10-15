import type {PoolClient} from 'pg';
import {canonicalSize} from '../../../contracts/src/size';
type Conn=Pick<PoolClient,'query'>;

// R67 deterministic catalog bridge over accepted provisional capacity. Runs inside the caller's
// single owner transaction (zao.actor/zao.reason already set). Idempotent: every row is keyed by
// a fixed (source_document, source_locator), so a second run inserts nothing. It never creates
// ledger_assets/ledger_poles and never edits a source bucket.
export const BRIDGE_DOCUMENT='R67_PROVISIONAL_CATALOG_BRIDGE';
export const SOURCE_A_SHA256='5ff5ce67c8ec1afbfab6bc5beeab0a2a725b73db0e1958a02860a0db39fbe1f4';
export const SOURCE_B_SHA256='c85997f464e59c616c6afb18ce03a34f6a73371d1aebeba2a6b8229bfd9c2257';
/** Supplemental POLE source: docs/execution/r67/PROVISIONAL_SOURCE_A_POLE_CAPACITY.csv (adult rows
 * 40-44 of the committed Source A mapping). Junior "JR ALU" rows stay excluded: their age class is
 * not established by the source evidence. */
export const POLE_SOURCE={sha256:'9d219847237ee1414de4f2be161d7c735ba3fbbbf908a9e51cdb13248c55f603',filename:'R67 PROVISIONAL_SOURCE_A_POLE_CAPACITY.csv',
 buckets:[110,115,120,125,130].map((n,i)=>({family:'POLE',age:'ADULT',source_size:String(n),booking_size:n+' cm',size_mapping_status:'MAPPED',quantity:[30,30,30,20,10][i]!,provenance:`PROVISIONAL_CATALOG_MAPPING.csv rows ${40+i} (L39135100 POLES RENTAL ANODIZED ADULT ALU)`}))};
const GENERIC=[{family:'SKI',name:'Regular ski'},{family:'SNOWBOARD',name:'Regular snowboard'},{family:'SKI_BOOT',name:'Regular ski boots'},{family:'SNOWBOARD_BOOT',name:'Regular snowboard boots'},{family:'POLE',name:'Ski poles'}] as const;
/** Exact Source A model rows (PROVISIONAL_CATALOG_MAPPING.csv). Each length binds only to the Source A
 * bucket of that family/age/length, which in Source A holds exactly this model. */
export const PREMIUM_MODELS=[
 {code:'PREM-SB-WILD-CARD-2627',name:'WILD CARD',family:'SNOWBOARD',itemCode:'L47663400',rows:[[53,145,20],[54,150,30],[55,155,30],[56,160,20],[57,165,10]]},
 {code:'PREM-SB-LIBERTY-2627',name:'LIBERTY',family:'SNOWBOARD',itemCode:'L47663700',rows:[[58,135,10],[59,140,10]]},
 {code:'PREM-SKI-SMAX4-2627',name:'S/MAX 4 + M10 GW L80',family:'SKI',itemCode:'L479235001xx',rows:[[3,139,10],[4,146,20],[5,153,30],[6,160,30],[7,167,20],[8,174,10]]},
] as const;
const NOTE='Provisional booking selector over accepted provisional capacity. Not received physical stock; handoff requires materialization.';

export type BridgeReport={poleSourceRegistered:boolean;modelsCreated:number;variantsCreated:number;bindingsCreated:number;regularVariants:Record<string,number>;premiumVariants:Record<string,number>;bindings:{model:string;size:string;bucket:string;quantity:number}[]};

async function source(c:Conn,sha:string){return (await c.query<{id:string}>("SELECT id FROM provisional_capacity_sources WHERE source_sha256=$1 AND status='ACTIVE'",[sha])).rows[0]?.id??null;}
async function ensureModel(c:Conn,locator:string,values:{code:string;name:string;family:string;season:string|null}){
 const old=(await c.query<{id:string}>('SELECT id FROM ledger_models WHERE source_document=$1 AND source_locator=$2',[BRIDGE_DOCUMENT,locator])).rows[0];if(old)return {id:old.id,created:false};
 const id=(await c.query<{id:string}>(`INSERT INTO ledger_models(code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season,catalog_role) VALUES($1,$2,'SALOMON',$3,$4,'UNVERIFIED',$5,$6,$7,'PROVISIONAL_BOOKING_SELECTOR') RETURNING id`,[values.code,values.name,values.family,NOTE,BRIDGE_DOCUMENT,locator,values.season])).rows[0]!.id;
 return {id,created:true};
}
async function ensureVariant(c:Conn,model:string,v:{family:string;age:string;tier:string;size:string}){
 const locator=`variant:${v.tier}:${v.family}:${v.age}:${v.size}`;
 const old=(await c.query<{id:string}>('SELECT id FROM ledger_variants WHERE source_document=$1 AND source_locator=$2',[BRIDGE_DOCUMENT,locator])).rows[0];if(old)return {id:old.id,created:false};
 const id=(await c.query<{id:string}>(`INSERT INTO ledger_variants(model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,$4,$5,$6,'UNVERIFIED',$7,$8) RETURNING id`,[model,v.family,v.age,v.tier,v.size,NOTE,BRIDGE_DOCUMENT,locator])).rows[0]!.id;
 return {id,created:true};
}

export async function activateProvisionalCatalog(c:Conn):Promise<BridgeReport>{
 const actor=(await c.query<{a:string|null}>("SELECT current_setting('zao.actor',true) AS a")).rows[0]!.a;
 if(!actor)throw new Error('BRIDGE_ACTOR_REQUIRED');
 const sourceA=await source(c,SOURCE_A_SHA256);if(!sourceA)throw new Error('BRIDGE_SOURCE_A_NOT_ACTIVE');
 if(!await source(c,SOURCE_B_SHA256))throw new Error('BRIDGE_SOURCE_B_NOT_ACTIVE');
 let poleSourceRegistered=false;
 if(!(await c.query('SELECT 1 FROM provisional_capacity_sources WHERE source_sha256=$1',[POLE_SOURCE.sha256])).rowCount){
  await c.query('SELECT provisional_capacity_register_source($1,$2,$3::jsonb)',[POLE_SOURCE.sha256,POLE_SOURCE.filename,JSON.stringify(POLE_SOURCE.buckets)]);poleSourceRegistered=true;
 }
 let modelsCreated=0,variantsCreated=0,bindingsCreated=0;const regularVariants:Record<string,number>={},premiumVariants:Record<string,number>={},bindings:BridgeReport['bindings']=[];
 const buckets=(await c.query<{id:string;source_id:string;family:string;age:string;booking_size:string;quantity:number}>(`SELECT b.id,b.source_id,b.family,b.age,b.booking_size,b.quantity FROM provisional_capacity_buckets b JOIN provisional_capacity_sources s ON s.id=b.source_id
  WHERE b.active AND b.size_mapping_status='MAPPED' AND s.status='ACTIVE' AND b.family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE') ORDER BY b.family,b.age,b.booking_size`)).rows;
 for(const g of GENERIC){
  const keys=[...new Map(buckets.filter(b=>b.family===g.family).map(b=>{const size=canonicalSize(b.family,b.booking_size);return [b.age+'/'+size,{age:b.age,size}];})).values()];
  if(!keys.length)continue;
  const model=await ensureModel(c,'model:REGULAR:'+g.family,{code:'PROV-REG-'+g.family.replace('_','-'),name:g.name,family:g.family,season:null});if(model.created)modelsCreated++;
  for(const k of keys){
   // One Regular variant per canonical family/age/size across the whole catalog (no duplicates
   // beside an existing physical Regular variant of the same canonical size).
   const existing=(await c.query<{id:string;size:string;model_id:string}>("SELECT id,size,model_id FROM ledger_variants WHERE family=$1 AND age=$2 AND tier='REGULAR'",[g.family,k.age])).rows.find(v=>canonicalSize(g.family,v.size)===k.size&&v.model_id!==model.id);
   if(existing)continue;
   const v=await ensureVariant(c,model.id,{family:g.family,age:k.age,tier:'REGULAR',size:k.size});if(v.created)variantsCreated++;
   regularVariants[g.family]=(regularVariants[g.family]??0)+1;
  }
 }
 for(const p of PREMIUM_MODELS){
  const model=await ensureModel(c,'model:PREMIUM:'+p.code,{code:p.code,name:p.name,family:p.family,season:'2026/27'});if(model.created)modelsCreated++;
  for(const [row,length,quantity] of p.rows){
   const size=length+' cm',bucket=buckets.filter(b=>b.source_id===sourceA&&b.family===p.family&&b.age==='ADULT'&&canonicalSize(b.family,b.booking_size)===size);
   if(bucket.length!==1||bucket[0]!.quantity<quantity)throw new Error(`BRIDGE_PREMIUM_BUCKET_MISMATCH ${p.code} ${size}`);
   const v=await ensureVariant(c,model.id,{family:p.family,age:'ADULT',tier:'PREMIUM',size});if(v.created)variantsCreated++;
   premiumVariants[p.code]=(premiumVariants[p.code]??0)+1;
   if(!(await c.query('SELECT 1 FROM provisional_model_bindings WHERE variant_id=$1 AND bucket_id=$2',[v.id,bucket[0]!.id])).rowCount){
    await c.query('INSERT INTO provisional_model_bindings(variant_id,bucket_id,quantity,provenance,actor) VALUES($1,$2,$3,$4,$5)',[v.id,bucket[0]!.id,quantity,`PROVISIONAL_CATALOG_MAPPING.csv row ${row} (${p.itemCode} ${p.name} ${length})`,actor]);bindingsCreated++;
   }
   bindings.push({model:p.code,size,bucket:bucket[0]!.id,quantity});
  }
 }
 return {poleSourceRegistered,modelsCreated,variantsCreated,bindingsCreated,regularVariants,premiumVariants,bindings};
}
