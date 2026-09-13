import {randomUUID,createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
import {preparePhotoDrafts,photoMetadata} from './media-plan';
export type PhotoRole='COVER'|'DETAIL'|'LIFESTYLE'|'SERVICE'|'INTERNAL_IDENTITY';
export type PhotoSelection={filename:string;bytes:number;sha256:string};
export type PhotoItem={selection:PhotoSelection;candidate:{offerCode:string;role:PhotoRole;sort:number}|null;issues:string[];state:'PENDING'|'READY'|'FAILED';metadata:ReturnType<typeof photoMetadata>|null;error:string|null};
export type PhotoJob={id:string;owner:string;inputHash:string;items:PhotoItem[];outputBytes:number;revision:number;state:'PENDING'|'PARTIAL'|'READY';productionPublished:false};
export interface PhotoJobStore{transaction<T>(fn:(jobs:Record<string,PhotoJob>,context:{offers:readonly string[]})=>Promise<T>):Promise<T>;putPrivateObject(sha256:string,bytes:Buffer):Promise<void>}
export interface PhotoAuthority{assert(subject:string):Promise<void>}
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
// Exact code__role__sort only. No fuzzy model/season inference and no automatic binding.
export function photoCandidate(filename:string,knownOffers:readonly string[]):PhotoItem['candidate']{
 const m=/^(.+)__(COVER|DETAIL|LIFESTYLE|SERVICE|INTERNAL_IDENTITY)__([0-9]{1,3})\.(?:jpe?g|png|webp)$/i.exec(filename);
 if(!m||!knownOffers.includes(m[1]!)||Number(m[3])<1||Number(m[3])>12)return null;
 return {offerCode:m[1]!,role:m[2]!.toUpperCase() as PhotoRole,sort:Number(m[3])};
}
export class PrivatePhotoJobs{
 constructor(private store:PhotoJobStore,private authority:PhotoAuthority,private decode:typeof preparePhotoDrafts=preparePhotoDrafts){}
 async prepare(subject:string,jobId:string,files:PhotoSelection[]){
  if(!/^[0-9a-f-]{36}$/.test(jobId)||!files.length||files.length>200)throw new ContentInputError('PHOTO_BATCH_LIMIT');
  const names=new Set<string>();for(const f of files){if(!f||Object.keys(f).sort().join()!=='bytes,filename,sha256'||!Number.isInteger(f.bytes)||f.bytes<1||f.bytes>10*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256)||typeof f.filename!=='string'||!/^([^/\\\u0000-\u001f]{1,180})\.(?:jpe?g|png|webp)$/i.test(f.filename)||f.filename.startsWith('.')||names.has(f.filename.toLowerCase()))throw new ContentInputError('PHOTO_SELECTION');names.add(f.filename.toLowerCase());}
  if(files.reduce((n,f)=>n+f.bytes,0)>500*1024*1024)throw new ContentInputError('PHOTO_BATCH_LIMIT');await this.authority.assert(subject);return this.store.transaction(async (jobs,context)=>{await this.authority.assert(subject);const inputHash=sha(Buffer.from(canonical(files))),old=jobs[jobId];if(old){if(old.owner!==subject||old.inputHash!==inputHash)throw new ContentInputError('PHOTO_JOB_MISMATCH');return structuredClone(old);}
   const items=files.map(selection=>({selection:structuredClone(selection),candidate:photoCandidate(selection.filename,context.offers),issues:[] as string[],state:'PENDING' as const,metadata:null,error:null}));
   for(const item of items){if(!item.candidate)item.issues.push('BINDING_UNCONFIRMED');else if(items.filter(x=>x.candidate?.offerCode===item.candidate!.offerCode&&x.candidate?.role===item.candidate!.role&&x.candidate?.sort===item.candidate!.sort).length>1)item.issues.push('DUPLICATE_ROLE_ORDER');item.issues.push('RIGHTS_AND_ALT_UNCONFIRMED');}
   const job:PhotoJob={id:jobId,owner:subject,inputHash,items,outputBytes:0,revision:1,state:'PENDING',productionPublished:false};jobs[jobId]=job;return structuredClone(job);
  });
 }
 async upload(subject:string,jobId:string,index:number,bytes:Buffer){
  await this.authority.assert(subject);return this.store.transaction(async jobs=>{
   await this.authority.assert(subject);const job=jobs[jobId];if(!job||job.owner!==subject||!Number.isInteger(index)||!job.items[index])throw new ContentInputError('PHOTO_JOB_MISMATCH');const item=job.items[index]!;
   if(bytes.length!==item.selection.bytes||sha(bytes)!==item.selection.sha256)throw new ContentInputError('PHOTO_BYTES_MISMATCH');if(item.state!=='PENDING')return structuredClone(item);
   // The adapter's bounded exclusive job gate admits one decoder at a time. The
   // shipped adapter is a private file lock, never a reservation DB connection.
   let prepared:Awaited<ReturnType<typeof preparePhotoDrafts>>[number]|undefined,error:string|null=null;
   try{prepared=(await this.decode([{filename:item.selection.filename,bytes,binding:null}]))[0]!;}catch(e){if(!(e instanceof ContentInputError))throw e;error=e.code;}
   await this.authority.assert(subject);const output=prepared?.derivatives.reduce((n,d)=>n+d.bytes.length,0)??0;if(job.outputBytes+output>500*1024*1024)throw new ContentInputError('PHOTO_OUTPUT_BATCH_LIMIT');
   if(prepared){await this.store.putPrivateObject(sha(bytes),bytes);for(const d of prepared.derivatives)await this.store.putPrivateObject(d.sha256,d.bytes);}
   item.metadata=prepared?photoMetadata(prepared):null;item.error=error;item.state=error?'FAILED':'READY';job.outputBytes+=output;job.revision++;job.state=job.items.some(i=>i.state==='FAILED')?'PARTIAL':job.items.every(i=>i.state==='READY')?'READY':'PENDING';return structuredClone(item);
  });
 }
 async read(subject:string,jobId:string){await this.authority.assert(subject);return this.store.transaction(async jobs=>{await this.authority.assert(subject);const job=jobs[jobId];if(!job||job.owner!==subject)throw new ContentInputError('PHOTO_JOB_MISMATCH');return structuredClone(job);});}
}
export const newPhotoJobId=()=>randomUUID();
