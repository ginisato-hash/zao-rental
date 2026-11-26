import {createHash,createHmac,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {boundarySlot,canonical,HoldError,normalizePeriod,type Feasibility,type HoldConditions,type HoldMember,type Period} from '../../../contracts/src/hold';
import {GroupError,MAX_MEMBERS,memberKey,type GroupMemberInput} from '../../../contracts/src/group-order';
import {GROUP_CSV_MAX_LABEL_CHARS,buildGroupCsvTemplates,catalogSizesFromVariants,groupCsvRowToProfileDraft,parseGroupCsv,serializeGroupCsvRows,type CsvLang,type GroupCsvCatalog,type GroupCsvMemberValues,type GroupCsvRow} from '../../../contracts/src/group-csv';
import {DIRECTIONS,RECOMMENDATION_RULE,buildMembers,memberItems,parseRecommendation,rankCandidates,sizing,type Candidate,type Direction,type Profile,type Variant} from '../../../contracts/src/recommendation';
import type {FitMeta} from '../../../contracts/src/size-edge';
import {planAllocation,planMixedAllocation} from '../inventory/allocation';
import {wearCapacityDetailed} from '../inventory/wear-capacity';
import {heldIntake} from '../inventory/intake-context';
import {assertNotSalesStopped} from '../inventory/sales-stop';
import {guestCatalog,guestVariants} from '../content/public-catalog';
import type {GroupOrderService,OwnerActor} from './group-service';

/** Customer side of the group application (spec B1 steps 1-5). Pure orchestration over the existing pieces: the service layer
 * (GroupOrderService), the CSV contract, the shared recommendation selector (buildMembers/rankCandidates with the SIZE-EDGE route) and
 * the allocator's read-only planner. Nothing here reserves stock; only GroupOrderService.submit does, atomically. */

export const GROUP_ROW_VERSION='GROUP_ROW_V1' as const;
/** Row ids exposed to the customer (and used in the CSV `member_id` column, max 24 chars): derived from the stable member uuid. */
export const shortMemberId=(uuid:string)=>'m'+uuid.replace(/-/g,'').slice(0,16);
const GROUP_PLAN_LIMIT=520;
/** Per-request bound on distinct single-member availability probes (resource guard; identical candidates are cached). */
const PROBE_LIMIT=400;

export type WorkRow=GroupCsvMemberValues&{memberId:string|null};
export type CandidateView={lengthCm:number;sizeLabel?:string;fit?:FitMeta};
export type RowState='READY'|'EDGE'|'MANUAL_FIT_REQUIRED'|'SHORT'|'INVALID'|'UNAVAILABLE';
export type RowAdvice={index:number;state:RowState;reason:string|null;candidates:Record<Direction,CandidateView|null>;defaultDirection:Direction|null;manualFit?:{fit:FitMeta;lengthCm:number;sizeLabel?:string}};
export type Issue={index:number|null;code:string;column:string|null};
export type CustomerCatalog={csv:GroupCsvCatalog;models:{code:string;name:string;sport:'SKI'|'SNOWBOARD';modelId:string;season:string}[];variants:Variant[]};

const EMPTY:Record<Direction,null>={RECOMMENDED:null,SHORTER:null,LONGER:null};
const nk=(s:string)=>s.normalize('NFKC').trim().toLowerCase();
const view=(c:Candidate|null):CandidateView|null=>c?{lengthCm:c.lengthCm,...(c.sizeLabel?{sizeLabel:c.sizeLabel}:{}),...(c.fit?{fit:c.fit}:{})}:null;
const stripKey=(m:HoldMember):Omit<HoldMember,'key'>=>{const {key:_k,...rest}=m;void _k;return rest;};

/** Step 1 form -> period. Mirrors the guest booking period contract (V1.4 start/return boundaries; the slot is derived, never chosen). */
export function groupPeriod(value:unknown):Period{
 const p=value as Record<string,unknown>|null;
 if(!p||typeof p!=='object'||typeof p.startDate!=='string'||typeof p.endDate!=='string'||!['08:30','13:00'].includes(p.startAt as string)||!['12:00','17:00'].includes(p.returnBy as string))throw new GroupError('INVALID_PERIOD');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(p.endDate))throw new GroupError('INVALID_PERIOD');
 try{const startAt=p.startAt as '08:30'|'13:00',returnBy=p.returnBy as '12:00'|'17:00';const period:Period={startDate:p.startDate,endDate:p.endDate,slot:boundarySlot(p.startDate,p.endDate,startAt,returnBy),startAt,returnBy};normalizePeriod(period);return period;}
 catch{throw new GroupError('INVALID_PERIOD');}
}
/** The owner secret is derived from the client's start request key, so a lost response can be replayed with the same key and gets
 * the same secret (startApplication fingerprints the owner hash). Without the server key the secret cannot be computed from the key. */
export function deriveOwnerSecret(serverKey:string,entranceToken:string,requestKey:string){
 if(serverKey.length<32)throw new GroupError('GROUP_KEY_REQUIRED',503);
 return createHmac('sha256',serverKey).update('group-owner-v1\0').update(createHash('sha256').update(entranceToken).digest('hex')).update('\0').update(requestKey).digest('base64url');
}

export class GroupCustomerService {
 constructor(readonly svc:GroupOrderService,private pool:Pool,private readPool:Pool,private clock?:()=>Date){}

 // ------------------------------------------------------------------ catalog / templates (no group data, no writes)
 async catalog():Promise<CustomerCatalog>{
  const variants=(await this.pool.query<Variant>(`SELECT v.id,v.family,v.age,v.tier,v.size,v.model_id,v.compatible_sports,m.catalog_season,m.name AS model_name,ARRAY(SELECT DISTINCT p.store_id FROM ledger_poles p WHERE p.variant_id=v.id AND p.status='AVAILABLE' AND p.quantity>0 ORDER BY p.store_id) AS "poleStores" FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id ORDER BY v.id LIMIT 2001`)).rows;
  const gc=await guestCatalog(this.readPool,variants),usable=await guestVariants(gc,variants);
  const models=gc.models.map(m=>({code:m.key,name:m.name,sport:m.sport,modelId:m.modelId,season:m.season}));
  const sizes=(family:string)=>[...new Set(usable.filter(v=>v.family===family).map(v=>v.size.trim()))];
  const csv:GroupCsvCatalog={season:models[0]?.season??'-',premiumModels:models.map(m=>({code:m.code,sport:m.sport,label:m.name})),jacketSizes:sizes('WEAR_JACKET'),pantsSizes:sizes('WEAR_PANTS'),equipmentSizes:catalogSizesFromVariants(usable)};
  return {csv,models,variants:usable};
 }
 async templates(lang:CsvLang){return buildGroupCsvTemplates((await this.catalog()).csv,lang);}

 // ------------------------------------------------------------------ row validation (the server never trusts client-derived row structure)
 /** Round-trips the rows through the CSV contract: serialize (formula-safe) then parse against the live catalog. The parsed rows are
  * the only values used afterwards; errors map back to row indexes. Client-supplied member ids are kept only if they are known. */
 normalizeRows(raw:unknown,cat:GroupCsvCatalog,knownShortIds:ReadonlySet<string>):{rows:WorkRow[];issues:Issue[]}{
  if(!Array.isArray(raw)||raw.length<1)throw new GroupError('GROUP_EMPTY');if(raw.length>MAX_MEMBERS)throw new GroupError('GROUP_TOO_LARGE');
  const shaped:WorkRow[]=[];
  for(const r of raw){
   const o=r as Record<string,unknown>|null;
   if(!o||typeof o!=='object'||Array.isArray(o)||typeof o.sport!=='string'||!o.equipment||typeof o.equipment!=='object'||typeof o.tier!=='string')throw new GroupError('INVALID_INPUT');
   const eq=o.equipment as {kind?:unknown;items?:unknown};
   if(!['SET','ITEMS','NONE'].includes(eq.kind as string)||(eq.kind==='ITEMS'&&(!Array.isArray(eq.items)||eq.items.some(i=>typeof i!=='string'))))throw new GroupError('INVALID_INPUT');
   for(const k of ['label','premiumModelCode','jacketSize','pantsSize','wearSport','skierType'] as const)if(o[k]!=null&&typeof o[k]!=='string')throw new GroupError('INVALID_INPUT');
   for(const k of ['ageAtStart','heightCm','weightKg','footCm'] as const)if(o[k]!=null&&(typeof o[k]!=='number'||!Number.isFinite(o[k] as number)))throw new GroupError('INVALID_INPUT');
   if(o.memberId!=null&&typeof o.memberId!=='string')throw new GroupError('INVALID_INPUT');
   shaped.push({label:(o.label as string|null)??null,sport:o.sport as WorkRow['sport'],equipment:o.equipment as WorkRow['equipment'],tier:o.tier as WorkRow['tier'],ageAtStart:(o.ageAtStart as number|null)??null,adultAtStart:null,heightCm:(o.heightCm as number|null)??null,weightKg:(o.weightKg as number|null)??null,footCm:(o.footCm as number|null)??null,skierType:(o.skierType as WorkRow['skierType'])??null,premiumModelCode:(o.premiumModelCode as string|null)??null,jacketSize:(o.jacketSize as string|null)??null,pantsSize:(o.pantsSize as string|null)??null,wearSport:(o.wearSport as WorkRow['wearSport'])??null,wearAddon:o.wearAddon===true,memberId:typeof o.memberId==='string'&&knownShortIds.has(o.memberId)?o.memberId:null});
  }
  // The label is free text kept verbatim (formula-looking text stays inert text; only CSV *export* prefixes it). It is checked here and left out of
  // the validation round trip, so the export-time apostrophe can neither enter the stored label nor push a 40-character label over the limit.
  for(const r of shaped)if(r.label!==null&&([...r.label].length>GROUP_CSV_MAX_LABEL_CHARS||/[\u0000-\u001f\u007f]/.test(r.label)))throw new GroupError('INVALID_INPUT');
  const text=serializeGroupCsvRows(shaped.map(r=>({...r,label:null,memberId:null})),'EN');
  const parsed=parseGroupCsv(text,cat,{allowCp932:false});
  if(!parsed.ok)return {rows:[],issues:parsed.errors.map(e=>({index:e.line===null?null:e.line-2,code:e.code,column:e.column}))};
  // serialize writes one physical line per row and the parser reports physical lines, so row i is the (i+2)th line.
  const out:WorkRow[]=[],issues:Issue[]=[];
  parsed.rows.forEach((p,i)=>{
   if(p.line!==i+2){issues.push({index:i,code:'ROW_MISMATCH',column:null});return;}
   const adult=p.adultAtStart;if(adult===null)issues.push({index:i,code:'AGE_REQUIRED',column:'age_at_start'});
   out.push({...stripLine(p),label:shaped[i]!.label,memberId:shaped[i]!.memberId});
  });
  return {rows:out,issues};
 }

 // ------------------------------------------------------------------ recommendation (advisory, read-only) -------------------------------------------
 private profileOf(row:WorkRow,key:string,cat:CustomerCatalog):Profile{
  const d=groupCsvRowToProfileDraft(row,key);
  const model=d.premiumModelCode?cat.models.find(m=>m.code===d.premiumModelCode&&m.sport===row.sport):undefined;
  if(d.premiumModelCode&&!model)throw new GroupError('MODEL_NOT_RELEASED',422);
  const age=d.adultAtStart?'ADULT':'KIDS';
  const wearVariant=(family:string,size:string|null)=>{if(size===null)return null;const want=nk(size);return cat.variants.filter(v=>v.family===family&&v.age===age&&nk(v.size)===want).sort((a,b)=>a.id.localeCompare(b.id))[0]??null;};
  const hasWear=row.sport==='WEAR'||row.wearAddon;let wear:Profile['wearSelection'];
  if(hasWear){const j=wearVariant('WEAR_JACKET',row.jacketSize),p=wearVariant('WEAR_PANTS',row.pantsSize);if(!j||!p)throw new GroupError('WEAR_SIZE_UNAVAILABLE',422);wear={jacketVariantId:j.id,pantsVariantId:p.id};}
  const profile:Profile={key,sport:row.sport,heightCm:row.sport==='WEAR'?null:d.heightCm,footCm:row.sport==='WEAR'?null:d.footCm,adultAtStart:d.adultAtStart,tier:row.tier,ski:row.sport==='WEAR'?null:d.ski,poleVariantId:null,
   ...(d.items?{items:d.items}:{}),...(model?{modelSelection:{modelId:model.modelId,season:model.season}}:{}),...(wear?{wearSelection:wear}:{}),...(hasWear&&d.wearSport?{wearSport:d.wearSport}:{})} as Profile;
  return profile;
 }
 private async withSnapshot<T>(fn:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query("SET LOCAL statement_timeout='30000ms'");
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   return await fn(c,now);}
  finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
 }
 private prober(c:PoolClient,now:Date,base:Omit<HoldConditions,'members'|'reservationId'>){
  const cache=new Map<string,Feasibility|'UNAVAILABLE'>();let probes=0;
  return async(member:HoldMember):Promise<Feasibility|'UNAVAILABLE'>=>{
   const sig=canonical(stripKey(member)),hit=cache.get(sig);if(hit)return hit;
   if(++probes>PROBE_LIMIT)throw new GroupError('INDETERMINATE_PROBE_LIMIT',503);
   const cond:HoldConditions={...base,reservationId:randomUUID(),members:[{...member,key:'p001'}]};let res:Feasibility|'UNAVAILABLE';
   try{await heldIntake(c,cond,now,null);await assertNotSalesStopped(c,cond);res=(await planMixedAllocation(c,cond,now,null)).result;}
   catch(e){if(e instanceof HoldError||(e as {code?:string}).code==='P0062')res='UNAVAILABLE';else throw e;}
   cache.set(sig,res);return res;
  };
 }
 /** One row: the exact selector rules of RecommendationService.preview (normal window; SIZE-EDGE route only when the catalog has nothing
  * in the normal window; boot choices), with availability read from the allocator. Deterministic for a given stock snapshot. */
 private async recommendRow(row:WorkRow,key:string,cat:CustomerCatalog,input:{pickupStore:HoldConditions['pickupStore'];returnStore:HoldConditions['returnStore'];period:Period},probe:(m:HoldMember)=>Promise<Feasibility|'UNAVAILABLE'>):Promise<{advice:Omit<RowAdvice,'index'>;chosen:Record<Direction,Candidate|null>}>{
  const none=(state:RowState,reason:string)=>({advice:{state,reason,candidates:{...EMPTY},defaultDirection:null},chosen:{...EMPTY}});
  let profile:Profile;
  try{profile=this.profileOf(row,key,cat);parseRecommendation({contractVersion:'INTEGRATED_V1_4',pickupStore:input.pickupStore,returnStore:input.returnStore,period:input.period,members:[profile]});}
  catch(e){return none('INVALID',(e as {code?:string}).code??'INVALID_RECOMMENDATION_INPUT');}
  const variants=cat.variants,version='INTEGRATED_V1_4' as const;
  let built=buildMembers(profile,variants,version);
  const size=profile.sport==='WEAR'?{targetCm:0,minCm:0,maxCm:0,bootCm:0}:sizing(profile),items=memberItems(profile);
  const bootOnly=!!items&&!items.includes(profile.sport as never)&&items.some(f=>f.endsWith('_BOOT')),poleOnly=!!items&&items.length===1&&items[0]==='POLE';
  const feasible:Candidate[]=[];const results:(Feasibility|'UNAVAILABLE')[]=[];let edge=false;
  const run=async()=>{for(let choice=0;;choice++){
   for(const candidate of built.candidates){const r=await probe(candidate.member);results.push(r);if(r==='FEASIBLE'){feasible.push(candidate);if(edge&&feasible.length>=3)break;}}
   if(feasible.length||bootOnly||choice+1>=Math.min(3,built.bootChoices??0))break;
   built=buildMembers(profile,variants,version,choice+1,edge);
  }};
  await run();
  if(!feasible.length&&!built.candidates.length&&(built.reason==='NO_CATALOG_LENGTH'||built.reason==='BOOT_SIZE_NOT_FOUND')){edge=true;built=buildMembers(profile,variants,version,0,true);if(built.candidates.length)await run();}
  let candidates=rankCandidates(feasible,poleOnly?feasible[0]?.lengthCm??0:bootOnly?size.bootCm:size.targetCm,bootOnly,edge?Infinity:15);
  let manualFit:RowAdvice['manualFit']|undefined;
  if(edge){const top=candidates.RECOMMENDED;if(top?.fit?.kind==='MANUAL_FIT_REQUIRED')manualFit={fit:top.fit,lengthCm:top.lengthCm,...(top.sizeLabel?{sizeLabel:top.sizeLabel}:{})};
   candidates=Object.fromEntries(DIRECTIONS.map(d=>[d,candidates[d]?.fit?.kind==='MANUAL_FIT_REQUIRED'?null:candidates[d]])) as typeof candidates;}
  const rec=candidates.RECOMMENDED;
  if(!rec){
   if(manualFit)return {advice:{state:'MANUAL_FIT_REQUIRED',reason:'MANUAL_FIT_REQUIRED',candidates:{...EMPTY},defaultDirection:null,manualFit},chosen:{...EMPTY}};
   if(results.length&&results.every(r=>r==='UNAVAILABLE'))return none('UNAVAILABLE','PERIOD_OR_STORE_UNAVAILABLE');
   return none(built.reason&&!['INSUFFICIENT'].includes(built.reason)&&!results.length?'INVALID':'SHORT',built.reason??(results.includes('INDETERMINATE')?'INDETERMINATE':results.includes('TRANSFER_PLAN_REQUIRED')?'TRANSFER_PLAN_REQUIRED':'INSUFFICIENT'));
  }
  const fitKind=rec.fit?.kind??'NORMAL';
  return {advice:{state:fitKind==='NORMAL'?'READY':'EDGE',reason:null,candidates:{RECOMMENDED:view(candidates.RECOMMENDED),SHORTER:view(candidates.SHORTER),LONGER:view(candidates.LONGER)},defaultDirection:'RECOMMENDED'},chosen:candidates};
 }
 private async cover(c:PoolClient,now:Date,base:Omit<HoldConditions,'members'|'reservationId'>,members:{ordinal:number;member:HoldMember}[]):Promise<Feasibility>{
  const all:HoldConditions={...base,reservationId:randomUUID(),members:members.map(m=>({...m.member,key:memberKey(m.ordinal)}))};
  return (await planMixedAllocation(c,all,now,null,undefined,false,GROUP_PLAN_LIMIT)).result;
 }
 /** Physical-stock-only cover (the planner's first, cheap stage). Used only to LOCALISE which rows fall short once the authoritative mixed plan
  * (physical + provisional) has said the whole group does not fit: an infeasible mixed plan re-plans per eligible item (seconds at 100 members),
  * so probing every row with it is not affordable. Consequence (documented): a row that only provisional capacity could cover may be reported short. */
 private async coverPhysical(c:PoolClient,now:Date,base:Omit<HoldConditions,'members'|'reservationId'>,members:{ordinal:number;member:HoldMember}[]):Promise<Feasibility>{
  const all:HoldConditions={...base,reservationId:randomUUID(),members:members.map(m=>({...m.member,key:memberKey(m.ordinal)}))};
  const wear=await wearCapacityDetailed(c,all,now,null,undefined,false);
  return (await planAllocation(c,all,now,null,undefined,undefined,wear.feasible?undefined:false,false,GROUP_PLAN_LIMIT)).result;
 }
 private async load(owner:OwnerActor,groupId:string){
  const v=await this.svc.get(owner,groupId);const g=v.group;
  if(!['DRAFT','QUOTED'].includes(g.status))throw new GroupError('INVALID_STATE',409,{status:g.status});
  const base={contractVersion:'INTEGRATED_V1_4' as const,pickupStore:g.pickupStore as HoldConditions['pickupStore'],returnStore:g.returnStore as HoldConditions['returnStore'],period:g.period};
  const known=new Set(v.members.map(m=>shortMemberId(m.id)));
  return {group:g,base,known,revision:g.revision};
 }
 /** Steps 2->3: per-row recommendation plus a joint stock check. Advisory only: consumes no inventory and stores nothing. */
 async advise(owner:OwnerActor,groupId:string,rawRows:unknown){
  const {group,base,known}=await this.load(owner,groupId);const cat=await this.catalog();
  const {rows,issues}=this.normalizeRows(rawRows,cat.csv,known);
  if(issues.length)return {ok:false as const,revision:group.revision,issues};
  return this.withSnapshot(async(c,now)=>{
   const probe=this.prober(c,now,base),advice:RowAdvice[]=[],chosen:Record<Direction,Candidate|null>[]=[];
   for(const [i,row] of rows.entries()){const r=await this.recommendRow(row,memberKey(i+1),cat,base,probe);advice.push({index:i,...r.advice});chosen.push(r.chosen);}
   // Joint check of the default choices: the same one-problem planning submit() uses. If it fails, find which rows cannot be added.
   const ready=advice.filter(a=>a.defaultDirection).map(a=>({ordinal:a.index+1,member:chosen[a.index]![a.defaultDirection!]!.member}));
   const joint:Feasibility=ready.length?await this.cover(c,now,base,ready):'FEASIBLE';const short:number[]=[];
   if(joint!=='FEASIBLE'){
    // Feasibility only shrinks as members are added, so the longest feasible prefix is found by bisection; the rest are then tried one by one.
    let lo=0,hi=ready.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(await this.coverPhysical(c,now,base,ready.slice(0,mid))==='FEASIBLE')lo=mid;else hi=mid-1;}
    const accepted=ready.slice(0,lo);
    for(const m of ready.slice(lo)){const r=await this.coverPhysical(c,now,base,[...accepted,m]);if(r==='FEASIBLE')accepted.push(m);else short.push(m.ordinal-1);}
    // A row that cannot be covered at its default size may still be covered by the next shorter/longer size (each already individually feasible).
    for(const i of [...short]){for(const d of ['SHORTER','LONGER'] as const){const alt=chosen[i]![d];if(!alt)continue;const m={ordinal:i+1,member:alt.member};
     if(await this.coverPhysical(c,now,base,[...accepted,m])==='FEASIBLE'){accepted.push(m);advice[i]={...advice[i]!,defaultDirection:d,reason:'JOINT_ALTERNATIVE'};short.splice(short.indexOf(i),1);break;}}}
    for(const i of short)advice[i]={...advice[i]!,state:'SHORT',reason:'JOINT_INSUFFICIENT'};
   }
   return {ok:true as const,revision:group.revision,rows,advice,joint:short.length===0?'FEASIBLE' as const:joint,ruleVersion:RECOMMENDATION_RULE,summary:{members:rows.length,ready:advice.filter(a=>a.state==='READY').length,edge:advice.filter(a=>a.state==='EDGE').length,short:advice.filter(a=>a.state==='SHORT').length,manual:advice.filter(a=>a.state==='MANUAL_FIT_REQUIRED').length,invalid:advice.filter(a=>a.state==='INVALID'||a.state==='UNAVAILABLE').length}};
  });
 }
 /** Step 3 -> 4: persists rows with server-derived selections (never client variant ids). Every row must resolve; nothing unverified is saved. */
 async saveRows(owner:OwnerActor,groupId:string,expectedRevision:number,rawRows:unknown,rawDirections:unknown){
  const {group,base,known}=await this.load(owner,groupId);const cat=await this.catalog();
  const {rows,issues}=this.normalizeRows(rawRows,cat.csv,known);
  if(issues.length)throw new GroupError('ROWS_INVALID',422,{issues});
  const dirs=Array.isArray(rawDirections)?rawDirections:[];
  if(dirs.length!==rows.length||dirs.some(d=>!(DIRECTIONS as readonly unknown[]).includes(d)))throw new GroupError('SELECTION_INVALID',422);
  const idMap=new Map((await this.pool.query<{id:string}>('SELECT id FROM group_members WHERE group_id=$1',[group.id])).rows.map(r=>[shortMemberId(r.id),r.id]));
  const inputs=await this.withSnapshot(async(c,now)=>{
   const probe=this.prober(c,now,base),out:GroupMemberInput[]=[],unresolved:{index:number;reason:string}[]=[];
   for(const [i,row] of rows.entries()){
    const r=await this.recommendRow(row,memberKey(i+1),cat,base,probe),pick=r.chosen[dirs[i] as Direction];
    if(!pick){unresolved.push({index:i,reason:r.advice.reason??'DIRECTION_UNAVAILABLE'});continue;}
    const id=row.memberId?idMap.get(row.memberId):undefined;
    out.push({...(id?{memberId:id}:{}),label:row.label??'',profile:{version:GROUP_ROW_VERSION,row:stripMember(row),direction:dirs[i]},selection:stripKey(pick.member),fit:pick.fit?{...pick.fit}:{}});
   }
   if(unresolved.length)throw new GroupError('ROWS_UNRESOLVED',409,{rows:unresolved});
   return out;
  });
  const saved=await this.svc.saveMembers(owner,groupId,expectedRevision,inputs);
  return {revision:saved.revision,status:saved.status,memberIds:saved.memberIds.map(shortMemberId)};
 }

 // ------------------------------------------------------------------ owner read model ---------------------------------------------------------------
 /** Everything the five steps need to rebuild after a reload. Authorization is the service's (404 for any wrong id/secret); the extra
  * reads are of the same group only. Staff-only data (adjustment reasons, contact, hold ids) never leaves. */
 async ownerView(owner:OwnerActor,groupId:string){
  const v=await this.svc.get(owner,groupId);
  const members=(await this.pool.query<{id:string;ordinal:number;label:string;profile:Record<string,unknown>;fit:Record<string,unknown>}>('SELECT id,ordinal,label,profile,fit FROM group_members WHERE group_id=$1 ORDER BY ordinal',[v.group.id])).rows;
  const quoteRow=async(kind:'ESTIMATE'|'CONFIRMED')=>(await this.pool.query('SELECT id,version,kind,group_revision,total_jpy,subtotal_jpy,bundle_discount_jpy,member_discount_jpy,group_discount_jpy,lines,digest FROM group_quotes WHERE group_id=$1 AND kind=$2 ORDER BY version DESC LIMIT 1',[v.group.id,kind])).rows[0]??null;
  const estimate=await quoteRow('ESTIMATE'),final=v.group.status==='CONFIRMED'?await quoteRow('CONFIRMED'):null;
  const consented=estimate?Boolean((await this.pool.query('SELECT 1 FROM group_consents WHERE quote_id=$1',[estimate.id])).rowCount):false;
  const requests=(await this.pool.query<{kind:string;status:string;created_at:Date}>('SELECT kind,status,created_at FROM group_change_requests WHERE group_id=$1 ORDER BY created_at',[v.group.id])).rows;
  const qv=(q:Record<string,unknown>|null)=>q?{id:q.id,version:q.version,kind:q.kind,groupRevision:q.group_revision,totalJpy:Number(q.total_jpy),subtotalJpy:Number(q.subtotal_jpy),bundleDiscountJpy:Number(q.bundle_discount_jpy),memberDiscountJpy:Number(q.member_discount_jpy),groupDiscountJpy:Number(q.group_discount_jpy),lines:q.lines,digest:q.digest}:null;
  const rows=members.map(m=>{const p=m.profile as {row?:GroupCsvMemberValues;direction?:Direction};return {memberId:shortMemberId(m.id),ordinal:m.ordinal,label:m.label,row:p.row??null,direction:p.direction??'RECOMMENDED',fit:m.fit};});
  return {group:v.group,rows,parts:v.parts,estimate:qv(estimate),finalQuote:qv(final),consented,settlement:v.settlement,requests:requests.map(r=>({kind:r.kind,status:r.status,createdAt:r.created_at})),events:v.events.map(e=>({type:e.event_type,at:e.occurred_at}))};
 }
 /** Store-fit acknowledgement is required when any saved member sits on the SIZE-EDGE route (spec: store fit confirmation). */
 async needsFitAcknowledgement(owner:OwnerActor,groupId:string){
  const v=await this.ownerView(owner,groupId);return v.rows.some(r=>(r.fit as {requiresStoreConfirmation?:boolean}).requiresStoreConfirmation===true);
 }
}
function stripLine(p:GroupCsvRow):GroupCsvMemberValues{const {line:_l,memberId:_m,...rest}=p;void _l;void _m;return rest;}
function stripMember(r:WorkRow):GroupCsvMemberValues{const {memberId:_m,...rest}=r;void _m;return rest;}
