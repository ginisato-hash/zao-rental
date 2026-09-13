import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
export type MediaObject={kind:'ORIGINAL'|'DERIVATIVE';sha256:string;bytes:number;mime:'image/jpeg'|'image/webp'|'image/png'};
export type MediaAccess={object:MediaObject;revision:string;rightsRevision:string;purpose:'PRIVATE_ORIGINAL'|'RELEASED_DERIVATIVE'};
export interface MediaProviderPort{
 readonly id:string;
 putIfAbsent(key:string,bytes:Uint8Array,metadata:{sha256:string;mime:string;visibility:'PRIVATE'}):Promise<{sha256:string}>;
 readPrivate(key:string):Promise<Uint8Array|null>;
 signPrivateRead(key:string,expiresAt:Date):Promise<{url:string;expiresAt:Date}>;
 invalidate(keys:readonly string[],requestId:string):Promise<{requestId:string;keys:readonly string[];completed:boolean}>;
}
export const mediaObjectKey=(o:MediaObject)=>{if(!['ORIGINAL','DERIVATIVE'].includes(o.kind)||!/^[a-f0-9]{64}$/.test(o.sha256)||!Number.isSafeInteger(o.bytes)||o.bytes<1||o.bytes>32*1024*1024||!['image/jpeg','image/webp','image/png'].includes(o.mime))throw new ContentInputError('MEDIA_OBJECT_INVALID');return 'private/'+o.kind.toLowerCase()+'/sha256/'+o.sha256;};
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** CMS authorization/release remains authoritative. Provider public ACLs are never used. */
export class ProviderMediaStore{
 constructor(private provider:MediaProviderPort){}
 async put(object:MediaObject,bytes:Uint8Array){const key=mediaObjectKey(object);if(bytes.byteLength!==object.bytes||hash(bytes)!==object.sha256)throw new ContentInputError('MEDIA_DIGEST_MISMATCH');try{const r=await this.provider.putIfAbsent(key,bytes,{sha256:object.sha256,mime:object.mime,visibility:'PRIVATE'});if(r.sha256!==object.sha256)throw new Error();}catch{throw new ContentInputError('MEDIA_STORE_FAILED');}return {key,sha256:object.sha256};}
 async read(authorize:()=>Promise<MediaAccess|null>){const a=await access(authorize);if(!a)return null;let bytes:Uint8Array|null;try{bytes=await this.provider.readPrivate(mediaObjectKey(a.object));}catch{throw new ContentInputError('MEDIA_FETCH_FAILED');}if(!bytes||bytes.byteLength!==a.object.bytes||hash(bytes)!==a.object.sha256)throw new ContentInputError('MEDIA_DIGEST_MISMATCH');const after=await access(authorize);if(!after||canonical(a)!==canonical(after))return null;return {bytes,contentType:a.object.mime,cacheControl:'private, no-store' as const};}
 async privateTicket(authorize:()=>Promise<MediaAccess|null>,options:{now:Date;expiresAt:Date;maximumSeconds:number;approvedOrigin:string}){
  const a=await access(authorize);if(!a||a.purpose!=='PRIVATE_ORIGINAL')throw new ContentInputError('PRIVATE_MEDIA_DENIED');
  const origin=new URL(options.approvedOrigin);if(origin.protocol!=='https:'||origin.origin!==options.approvedOrigin||!Number.isSafeInteger(options.maximumSeconds)||options.maximumSeconds<1||!Number.isFinite(options.now.getTime())||!Number.isFinite(options.expiresAt.getTime())||options.expiresAt<=options.now||options.expiresAt.getTime()-options.now.getTime()>options.maximumSeconds*1000)throw new ContentInputError('MEDIA_TICKET_POLICY_INVALID');
  let ticket;try{ticket=await this.provider.signPrivateRead(mediaObjectKey(a.object),options.expiresAt);}catch{throw new ContentInputError('MEDIA_TICKET_FAILED');}
  const after=await access(authorize);if(!after||canonical(after)!==canonical(a))throw new ContentInputError('PRIVATE_MEDIA_DENIED');
  let url:URL;try{url=new URL(ticket.url);}catch{throw new ContentInputError('MEDIA_TICKET_FAILED');}
  if(url.origin!==origin.origin||url.username||url.password||ticket.expiresAt.getTime()!==options.expiresAt.getTime())throw new ContentInputError('MEDIA_TICKET_FAILED');return ticket;
 }
 async revoke(plan:MediaRevocation){validateRevocation(plan);let ack;try{ack=await this.provider.invalidate(plan.keys,plan.id);}catch{throw new ContentInputError('MEDIA_INVALIDATION_PENDING');}if(!ack.completed||ack.requestId!==plan.id||canonical([...ack.keys].sort())!==canonical([...plan.keys].sort()))throw new ContentInputError('MEDIA_INVALIDATION_PENDING');return {planSha256:hash(Buffer.from(canonical(plan))),invalidationConfirmed:true,deletePerformed:false};}
}
async function access(authorize:()=>Promise<MediaAccess|null>){const a=await authorize();if(!a)return null;mediaObjectKey(a.object);if(!a.revision||!a.rightsRevision||!(a.purpose==='PRIVATE_ORIGINAL'&&a.object.kind==='ORIGINAL'||a.purpose==='RELEASED_DERIVATIVE'&&a.object.kind==='DERIVATIVE'))throw new ContentInputError('MEDIA_ACCESS_INVALID');return structuredClone(a);}
export type MediaRevocation={id:string;revision:string;keys:string[];lastTicketExpiresAt:string;legalRetentionUntil:string|null;cmsWithdrawn:true};
function validateRevocation(p:MediaRevocation){if(!/^[a-f0-9-]{36}$/.test(p.id)||!p.revision||p.cmsWithdrawn!==true||!p.keys.length||p.keys.length>1000||new Set(p.keys).size!==p.keys.length||p.keys.some(k=>!/^private\/(original|derivative)\/sha256\/[a-f0-9]{64}$/.test(k))||!Number.isFinite(Date.parse(p.lastTicketExpiresAt))||p.legalRetentionUntil!==null&&!Number.isFinite(Date.parse(p.legalRetentionUntil)))throw new ContentInputError('MEDIA_REVOCATION_INVALID');}
/** Planning only. Deletion needs an authorized worker and no remaining release/reference.
 * Logical CMS withdrawal is immediate; existing signed tickets can survive until expiry. */
export function mediaDeletionEligibility(plan:MediaRevocation,receipt:{planSha256:string;invalidationConfirmed:boolean},now:Date,hasReferences:boolean){validateRevocation(plan);return {eligible:Number.isFinite(now.getTime())&&!hasReferences&&receipt.invalidationConfirmed&&receipt.planSha256===hash(Buffer.from(canonical(plan)))&&Date.parse(plan.lastTicketExpiresAt)<=now.getTime()&&plan.legalRetentionUntil!==null&&Date.parse(plan.legalRetentionUntil)<=now.getTime(),deletePerformed:false};}
