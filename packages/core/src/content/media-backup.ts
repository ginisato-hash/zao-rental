import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
import {mediaObjectKey,type MediaObject} from './provider-media';
export type MediaBackupPlan={id:string;revision:string;rightsRevision:string;objects:MediaObject[];retentionUntil:string};
export interface MediaBackupPort{
 readonly id:string;
 /** Real implementations must store privately, encrypt off-host, and verify every
  * immutable hash. An acknowledgement alone is not a successful restore drill. */
 capture(plan:Readonly<MediaBackupPlan>,planSha256:string):Promise<{planSha256:string;manifestSha256:string;encrypted:boolean;offHost:boolean;private:boolean;verifiedObjects:{key:string;sha256:string;bytes:number}[]}>;
 restoreCheck(manifestSha256:string):Promise<{manifestSha256:string;integrityPassed:boolean}>;
}
export async function rehearseMediaBackup(plan:MediaBackupPlan,provider:MediaBackupPort,now:Date){
 if(!/^[a-f0-9-]{36}$/.test(plan.id)||!plan.revision||!plan.rightsRevision||!plan.objects.length||plan.objects.length>1000||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(plan.retentionUntil))||Date.parse(plan.retentionUntil)<=now.getTime())throw new ContentInputError('MEDIA_BACKUP_INVALID');
 const copy=structuredClone(plan),objects=copy.objects.map(o=>({key:mediaObjectKey(o),sha256:o.sha256,bytes:o.bytes})).sort((a,b)=>a.key.localeCompare(b.key));if(new Set(objects.map(o=>o.key)).size!==objects.length)throw new ContentInputError('MEDIA_BACKUP_INVALID');
 const planSha256=createHash('sha256').update(canonical(copy)).digest('hex');let receipt;
 try{receipt=await provider.capture(copy,planSha256);}catch{throw new ContentInputError('MEDIA_BACKUP_UNCONFIRMED');}
 if(receipt.planSha256!==planSha256||!/^[a-f0-9]{64}$/.test(receipt.manifestSha256)||!receipt.encrypted||!receipt.offHost||!receipt.private||canonical([...receipt.verifiedObjects].sort((a,b)=>a.key.localeCompare(b.key)))!==canonical(objects))throw new ContentInputError('MEDIA_BACKUP_UNCONFIRMED');
 let restored;try{restored=await provider.restoreCheck(receipt.manifestSha256);}catch{throw new ContentInputError('MEDIA_RESTORE_UNCONFIRMED');}
 if(!restored.integrityPassed||restored.manifestSha256!==receipt.manifestSha256)throw new ContentInputError('MEDIA_RESTORE_UNCONFIRMED');
 return {providerId:provider.id,planSha256,manifestSha256:receipt.manifestSha256,objectCount:objects.length,restoreIntegrity:true,productionAcceptance:false};
}
