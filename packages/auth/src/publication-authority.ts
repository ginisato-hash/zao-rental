import {assertProductionIdentityFacts,exactProductionIdentityConfiguration,productionHostFingerprint,productionVercelProjectFingerprint,type ExactProductionIdentity,type ProductionIdentityFacts} from './production-identity';
export const PUBLICATION_ORIGIN='https://salomon-rental.yuge-zao.com';
export type PublicationApproval=Readonly<{state:'PUBLICATION_APPROVED';origin:typeof PUBLICATION_ORIGIN;releaseId:string;approvedBy:string;approvedAt:string}>;
export type PublicationAuthority=Readonly<{kind:'PUBLICATION_AUTHORITY'}>;
/** One exact-shape parser shared by runtime bootstrap and per-isolate indexing. Binding and
 * approval time are checked by the respective verifier; no capability is issued by parsing. */
export function parsePublicationApproval(raw:string|undefined):PublicationApproval|undefined{
 if(raw===undefined)return undefined;
 const fail=():never=>{throw new Error('PRODUCTION_COMMERCIAL_PUBLICATION_APPROVAL_INVALID');};
 let v:unknown;try{v=JSON.parse(raw);}catch{return fail();}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!=='approvedAt,approvedBy,origin,releaseId,state')return fail();
 const a=v as Record<string,unknown>;
 if(a.state!=='PUBLICATION_APPROVED'||a.origin!==PUBLICATION_ORIGIN||typeof a.releaseId!=='string'||typeof a.approvedBy!=='string'||typeof a.approvedAt!=='string')return fail();
 return Object.freeze({state:'PUBLICATION_APPROVED',origin:PUBLICATION_ORIGIN,releaseId:a.releaseId,approvedBy:a.approvedBy,approvedAt:a.approvedAt});
}
export type PublicationDeploymentFacts=ProductionIdentityFacts&Readonly<{
 environment:string|undefined;releaseId:string|undefined;gitCommitSha:string|undefined;
 origin:string|undefined;approval:string|undefined;
}>;
/** Layer B: publication/indexing only. Pinned fingerprints are never caller-overridable.
 * Pure facts allow acceptance tests without committing the real Production Neon hostname. */
export function publicationDeploymentFactsApproved(facts:PublicationDeploymentFacts,now=new Date()):boolean{
 try{
  assertProductionIdentityFacts(facts);
  if(facts.environment!=='production'||!facts.releaseId||facts.releaseId.length!==40||!/^[a-f0-9]{40}$/.test(facts.releaseId)||facts.gitCommitSha!==undefined&&facts.gitCommitSha!==''&&facts.gitCommitSha!==facts.releaseId||facts.origin!==PUBLICATION_ORIGIN)return false;
  const a=parsePublicationApproval(facts.approval);
  return Boolean(a&&a.releaseId===facts.releaseId&&a.approvedBy.trim()&&a.approvedBy.length<=120&&Number.isFinite(Date.parse(a.approvedAt))&&Number.isFinite(now.getTime())&&Date.parse(a.approvedAt)<=now.getTime());
 }catch{return false;}
}
/** Layer A: each Vercel route/proxy isolate derives the same facts from trusted deployment env.
 * No global memory, request input, DB/provider I/O or financial/runtime capability issuance. */
export function publicationEnvironmentApproved(env:Readonly<Record<string,string|undefined>>,now=new Date()):boolean{
 if(!env.VERCEL_PROJECT_ID||!env.PRODUCTION_DB_HOST||!env.PRODUCTION_DB_NAME)return false;
 return publicationDeploymentFactsApproved({
  vercelProjectFingerprintSha256:productionVercelProjectFingerprint(env.VERCEL_PROJECT_ID),
  hostFingerprintSha256:productionHostFingerprint(env.PRODUCTION_DB_HOST),databaseName:env.PRODUCTION_DB_NAME,
  environment:env.VERCEL_ENV,releaseId:env.PRODUCTION_RELEASE_ID,gitCommitSha:env.VERCEL_GIT_COMMIT_SHA,
  origin:env.PRODUCTION_PUBLIC_ORIGIN,approval:env.PRODUCTION_PUBLICATION_APPROVAL,
 },now);
}
const issued=new WeakMap<PublicationAuthority,PublicationApproval>();
/** Explicit owner approval supplied by trusted server bootstrap. A deployment flag,
 * HTTP request or a shape-compatible identity cannot authorize publication. */
export function issuePublicationAuthority(identity:ExactProductionIdentity,approval:PublicationApproval):PublicationAuthority{
 const c=exactProductionIdentityConfiguration(identity);
 if(!c||c.deployment.origin!==PUBLICATION_ORIGIN||approval?.state!=='PUBLICATION_APPROVED'||approval.origin!==PUBLICATION_ORIGIN||approval.releaseId!==c.deployment.releaseId||!approval.approvedBy?.trim()||approval.approvedBy.length>120||!Number.isFinite(Date.parse(approval.approvedAt))||Date.parse(approval.approvedAt)>Date.now())throw new Error('PUBLICATION_APPROVAL_INVALID');
 const authority=Object.freeze({kind:'PUBLICATION_AUTHORITY' as const});issued.set(authority,Object.freeze({...approval}));return authority;
}
const key=Symbol.for('zao.publication.authority.v1');
const root=globalThis as typeof globalThis&{[key]?:PublicationAuthority};
export function installPublicationAuthority(authority:PublicationAuthority){if(!issued.has(authority)||root[key])throw new Error('PUBLICATION_AUTHORITY_REQUIRED');root[key]=authority;}
export function revokePublicationAuthority(authority:PublicationAuthority){issued.delete(authority);if(root[key]===authority)delete root[key];}
export function publicationApproved(){return Boolean(root[key]&&issued.has(root[key]))||publicationEnvironmentApproved(process.env);}
/** Pure URL policy. Does not issue or install authority. Queries are always private. */
export function publicIndexablePath(path:string,query=''){
 return !query&&/^\/(ja|en)(?:\/?$|\/(?:rental(?:\/(?:ski|snowboard|wear|kids-family|premium(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?))?|prices|stores\/(?:mountain-base|onsen-base)|pickup-return|faq|legal\/(?:terms|privacy|commercial-disclosure|cancellation))\/?$)/.test(path);
}
/** Pure per-request robots decision used by proxy.ts: index only with installed authority, the
 * exact public origin and an allowlisted query-free public path; everything else is noindex. */
export function indexablePage(approved:boolean,origin:string,path:string,query=''){return approved&&origin===PUBLICATION_ORIGIN&&publicIndexablePath(path,query);}
