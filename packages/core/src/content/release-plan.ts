import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError,type Content} from './bulk-plan';
export type ContentRevision={id:string;offerCode:string;locale:'ja'|'en';content:Content;sourceRevision:string|null;translationApproved:boolean;mediaIds:string[];commercialRevision:string};
export type MediaReadiness={id:string;processed:boolean;rightsConfirmed:boolean;rightsUntil:string|null;alt:string;immutableSha256:string;internalOnly:boolean};
export type ReleaseInput={id:string;entries:string[];expectedCurrent:string|null;restoreOf:string|null};
export type CatalogReleaseState={current:string|null;draftIds:Record<string,string>;revisions:ContentRevision[];media:MediaReadiness[];commercialRevisions:Record<string,string>;releases:{id:string;entries:string[];manifestSha256:string;restoreOf:string|null}[]};
export type ReleasePlan=ReleaseInput&{entryHashes:Record<string,string>;mediaHashes:Record<string,string>;commercialRevisions:Record<string,string>;issues:{id:string;code:string}[];hash:string};
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const target=(r:ContentRevision)=>r.offerCode+'/'+r.locale;
// Pure validation, not publish authority. State must be read by a trusted adapter.
// No production endpoint, DB grant, file write or object-store request is provided.
export function planPrivateRelease(state:CatalogReleaseState,input:ReleaseInput,now:Date):ReleasePlan{
 if(!Number.isFinite(now.getTime())||!input.id||input.entries.length<1||input.entries.length>200||new Set(input.entries).size!==input.entries.length)throw new ContentInputError('RELEASE_INPUT');
 if(state.current!==input.expectedCurrent)throw new ContentInputError('RELEASE_CURRENT_STALE');
 if(input.restoreOf){const old=state.releases.find(r=>r.id===input.restoreOf);if(!old||canonical([...old.entries].sort())!==canonical([...input.entries].sort()))throw new ContentInputError('RESTORE_REFERENCE_MISMATCH');}
 const issues:ReleasePlan['issues']=[],entryHashes:Record<string,string>={},mediaHashes:Record<string,string>={},commercialRevisions:Record<string,string>={},targets=new Set<string>();
 for(const id of [...input.entries].sort()){
  const r=state.revisions.find(r=>r.id===id);if(!r){issues.push({id,code:'REVISION_NOT_FOUND'});continue;}
  const key=target(r);if(targets.has(key))issues.push({id,code:'DUPLICATE_OFFER_LOCALE'});targets.add(key);
  if(!input.restoreOf&&state.draftIds[key]!==r.id)issues.push({id,code:'DRAFT_STALE'});
  if(!r.content.title.trim()||Object.values(r.content).some(v=>typeof v!=='string'||v.length>5000||/<[^>]*>/.test(v)))issues.push({id,code:'PLAIN_CONTENT_REQUIRED'});
  if(!state.commercialRevisions[r.offerCode]||r.commercialRevision!==state.commercialRevisions[r.offerCode])issues.push({id,code:'COMMERCIAL_MAPPING_STALE'});
  commercialRevisions[r.offerCode]=state.commercialRevisions[r.offerCode]??'';
  if(r.locale==='en'){
   const original=state.revisions.find(x=>x.id===r.sourceRevision&&x.offerCode===r.offerCode&&x.locale==='ja');
   // A translation refers to the Japanese revision in this release, never a hidden fallback.
   if(!r.translationApproved||!original||!input.entries.includes(original.id))issues.push({id,code:'TRANSLATION_UNVERIFIED_OR_STALE'});
  }
  if(!r.mediaIds.length)issues.push({id,code:'MEDIA_REQUIRED'});
  for(const mid of r.mediaIds){const m=state.media.find(m=>m.id===mid);if(!m){issues.push({id:mid,code:'MEDIA_NOT_FOUND'});continue;}
   if(!m.processed||m.internalOnly||!m.alt.trim()||!/^[0-9a-f]{64}$/.test(m.immutableSha256))issues.push({id:mid,code:'MEDIA_NOT_READY'});
   if(!m.rightsConfirmed||m.rightsUntil!==null&&(!Number.isFinite(Date.parse(m.rightsUntil))||now>=new Date(m.rightsUntil)))issues.push({id:mid,code:'RIGHTS_UNVERIFIED_OR_EXPIRED'});
   mediaHashes[mid]=digest(m);
  }
  entryHashes[id]=digest(r);
 }
 const plan={...structuredClone(input),entries:[...input.entries].sort(),entryHashes,mediaHashes,commercialRevisions,issues};return {...plan,hash:digest(plan)};
}
// Caller must persist the original plan, reauthorize AFTER its transaction lock, then
// atomically persist returned release/current/audit/outbox. Hash alone is not permission.
export function applyPersistedPrivateRelease(state:CatalogReleaseState,plan:ReleasePlan,now:Date){
 const {hash,...material}=plan;if(hash!==digest(material))throw new ContentInputError('RELEASE_PLAN_HASH');
 if(state.releases.some(r=>r.id===plan.id))throw new ContentInputError('RELEASE_ID_EXISTS');
 const checked=planPrivateRelease(state,{id:plan.id,entries:plan.entries,expectedCurrent:plan.expectedCurrent,restoreOf:plan.restoreOf},now);
 if(checked.issues.length)throw new ContentInputError('RELEASE_INVALID');if(checked.hash!==plan.hash)throw new ContentInputError('RELEASE_PLAN_STALE');
 const release={id:plan.id,entries:[...plan.entries],manifestSha256:plan.hash,restoreOf:plan.restoreOf};
 return {state:{...structuredClone(state),current:release.id,releases:[...structuredClone(state.releases),release]},release,audit:{action:plan.restoreOf?'PRIVATE_RESTORE':'PRIVATE_RELEASE',before:state.current,after:release.id},outbox:{releaseId:release.id,event:'PRIVATE_PREVIEW_CHANGED'},visibility:'PRIVATE_FIXTURE_ONLY' as const,productionPublished:false as const};
}
