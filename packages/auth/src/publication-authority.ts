import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from './production-identity';
export const PUBLICATION_ORIGIN='https://salomonzao.rent';
export type PublicationApproval=Readonly<{state:'PUBLICATION_APPROVED';origin:typeof PUBLICATION_ORIGIN;releaseId:string;approvedBy:string;approvedAt:string}>;
export type PublicationAuthority=Readonly<{kind:'PUBLICATION_AUTHORITY'}>;
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
export function publicationApproved(){return Boolean(root[key]&&issued.has(root[key]));}
/** Pure URL policy. Does not issue or install authority. Queries are always private. */
export function publicIndexablePath(path:string,query=''){
 return !query&&/^\/(ja|en)(?:\/?$|\/(?:rental(?:\/(?:ski|snowboard|wear|kids-family|premium(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?))?|prices|stores\/(?:mountain-base|onsen-base)|pickup-return|faq)\/?$)/.test(path);
}
