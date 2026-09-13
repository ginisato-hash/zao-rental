import {randomUUID,createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {id} from '../../../contracts/src/pricing';
import {ContentInputError,planContentBulk,applyPersistedContentPlan,type Content,type BulkPlan,type Draft} from './bulk-plan';
import {planPrivateRelease,applyPersistedPrivateRelease,type CatalogReleaseState,type ReleasePlan} from './release-plan';
export type ContentPermission='CONTENT_EDIT'|'CONTENT_BULK'|'CONTENT_PUBLISH';
export type ContentWorkflowState={catalog:CatalogReleaseState;plans:Record<string,{owner:string;kind:'BULK';plan:BulkPlan;completed?:unknown}|{owner:string;kind:'RELEASE';plan:ReleasePlan;completed?:unknown}>;requests:Record<string,{hash:string;result:unknown}>;audit:{actor:string;action:string;objectId:string;before:string|null;after:string|null}[];outbox:{releaseId:string;event:string}[]};
export interface ContentRepository{transaction<T>(fn:(state:ContentWorkflowState)=>Promise<T>):Promise<T>}
export interface ContentAuthority{assert(subject:string,permission:ContentPermission):Promise<void>}
const hash=(x:unknown)=>createHash('sha256').update(canonical(x)).digest('hex');
const drafts=(s:CatalogReleaseState):Draft[]=>Object.entries(s.draftIds).map(([key,rid])=>{const r=s.revisions.find(r=>r.id===rid);if(!r||key!==r.offerCode+'/'+r.locale)throw new ContentInputError('DRAFT_REFERENCE_INVALID');return {offerCode:r.offerCode,locale:r.locale,revision:s.revisions.filter(x=>x.offerCode===r.offerCode&&x.locale===r.locale).length,content:structuredClone(r.content)};});
// Transactional application port. The adapter must enforce rollback/serialization and
// supply server-authenticated subjects. Public P0 adds the dedicated development
// PostgreSQL adapter; production publication remains disabled.
export class PrivateContentWorkflow{
 constructor(private repo:ContentRepository,private authority:ContentAuthority,private clock:()=>Date=()=>new Date()){}
 private async change<T>(subject:string,permission:ContentPermission,key:string,payload:unknown,fn:(s:ContentWorkflowState)=>Promise<T>|T){
  id(key);await this.authority.assert(subject,permission);
  return this.repo.transaction(async s=>{await this.authority.assert(subject,permission);const rk=subject+'/'+key,fingerprint=hash({permission,payload}),prior=s.requests[rk];if(prior){if(prior.hash!==fingerprint)throw new ContentInputError('REQUEST_KEY_MISMATCH');return structuredClone(prior.result) as T;}
   const result=await fn(s);s.requests[rk]={hash:fingerprint,result:structuredClone(result)};return result;
  });
 }
 async prepareBulk(subject:string,key:string,csv:string){return this.change(subject,'CONTENT_BULK',key,{op:'PREPARE_BULK',csv},s=>{const plan=planContentBulk(drafts(s.catalog),csv),planId=randomUUID();s.plans[planId]={owner:subject,kind:'BULK',plan};return {planId,hash:plan.hash,targets:plan.targets,issues:plan.issues,state:plan.issues.length?'PARTIAL_VALIDATION':'VALIDATED',saved:true};});}
 async commitBulk(subject:string,key:string,planId:string,expectedHash:string){return this.change(subject,'CONTENT_BULK',key,{op:'COMMIT_BULK',planId,expectedHash},s=>{
  const stored=s.plans[planId];if(!stored||stored.kind!=='BULK'||stored.owner!==subject||stored.plan.hash!==expectedHash)throw new ContentInputError('STORED_PLAN_MISMATCH');
  if(stored.completed)return structuredClone(stored.completed) as {state:string;revisionIds:string[];issues:BulkPlan['issues'];productionPublished:boolean};if(!stored.plan.targets.length)throw new ContentInputError('NO_VALID_TARGETS');const current=drafts(s.catalog),after=applyPersistedContentPlan(current,stored.plan),updated:string[]=[];
  for(const t of stored.plan.targets){const target=t.offerCode+'/'+t.locale,previousId=s.catalog.draftIds[target]!,old=s.catalog.revisions.find(r=>r.id===previousId)!;const replacement=after.find(r=>r.offerCode===t.offerCode&&r.locale===t.locale)!,nextId=randomUUID();s.catalog.revisions.push({...structuredClone(old),id:nextId,content:replacement.content});s.catalog.draftIds[target]=nextId;s.audit.push({actor:subject,action:'BULK_DRAFT',objectId:target,before:previousId,after:nextId});updated.push(nextId);}
  const result={state:stored.plan.issues.length?'PARTIAL':'COMMITTED',revisionIds:updated,issues:stored.plan.issues,productionPublished:false};stored.completed=structuredClone(result);return result;
 });}
 async saveDraft(subject:string,key:string,offerCode:string,locale:'ja'|'en',expectedRevision:number,content:Content){return this.change(subject,'CONTENT_EDIT',key,{op:'SAVE_DRAFT',offerCode,locale,expectedRevision,content},s=>{
  if(!content||Object.keys(content).sort().join()!=='fit_note,summary,title'||Object.values(content).some(v=>typeof v!=='string'))throw new ContentInputError('CONTENT_SHAPE');
  const cell=(v:string)=>'"'+v.replaceAll('"','""')+'"';const rows=Object.entries(content).map(([field,value])=>['1',offerCode,locale,String(expectedRevision),field,value===''?'CLEAR':'SET',value].map(cell).join(','));const plan=planContentBulk(drafts(s.catalog),'schema_version,offer_code,locale,expected_revision,field,operation,value\n'+rows.join('\n'));
  if(plan.issues.length||plan.targets.length!==1)throw new ContentInputError('DRAFT_CONFLICT_OR_INVALID');const after=applyPersistedContentPlan(drafts(s.catalog),plan),target=offerCode+'/'+locale,oldId=s.catalog.draftIds[target]!,old=s.catalog.revisions.find(r=>r.id===oldId)!,nextId=randomUUID();s.catalog.revisions.push({...structuredClone(old),id:nextId,content:after.find(r=>r.offerCode===offerCode&&r.locale===locale)!.content});s.catalog.draftIds[target]=nextId;s.audit.push({actor:subject,action:'DRAFT_SAVE',objectId:target,before:oldId,after:nextId});return {id:nextId,revision:expectedRevision+1,productionPublished:false};
 });}
 async prepareRelease(subject:string,key:string,entries:string[],expectedCurrent:string|null,restoreOf:string|null=null){return this.change(subject,'CONTENT_PUBLISH',key,{op:'PREPARE_RELEASE',entries,expectedCurrent,restoreOf},s=>{
  const selected=restoreOf?s.catalog.releases.find(r=>r.id===restoreOf)?.entries:entries;if(!selected)throw new ContentInputError('RESTORE_NOT_FOUND');if(restoreOf&&entries.length)throw new ContentInputError('RESTORE_ENTRIES_SERVER_ONLY');
  const plan=planPrivateRelease(s.catalog,{id:randomUUID(),entries:selected,expectedCurrent,restoreOf},this.clock()),planId=randomUUID();s.plans[planId]={owner:subject,kind:'RELEASE',plan};return {planId,hash:plan.hash,issues:plan.issues,visibility:'PRIVATE_FIXTURE_ONLY'};
 });}
 async commitRelease(subject:string,key:string,planId:string,expectedHash:string){return this.change(subject,'CONTENT_PUBLISH',key,{op:'COMMIT_RELEASE',planId,expectedHash},s=>{
  const stored=s.plans[planId];if(!stored||stored.kind!=='RELEASE'||stored.owner!==subject||stored.plan.hash!==expectedHash)throw new ContentInputError('STORED_PLAN_MISMATCH');if(stored.completed)return structuredClone(stored.completed) as {release:{id:string};visibility:string;productionPublished:boolean};const result=applyPersistedPrivateRelease(s.catalog,stored.plan,this.clock());s.catalog=result.state;s.audit.push({actor:subject,action:result.audit.action,objectId:result.release.id,before:result.audit.before,after:result.audit.after});s.outbox.push(result.outbox);const saved={release:result.release,visibility:result.visibility,productionPublished:false};stored.completed=structuredClone(saved);return saved;
 });}
}
