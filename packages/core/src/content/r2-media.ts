import {createHash} from 'node:crypto';
import {S3Client,GetObjectCommand,PutObjectCommand,type S3ClientConfig} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {ContentInputError} from './bulk-plan';
import type {MediaProviderPort} from './provider-media';
export type R2Credential={accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string;expiresAt:Date;revoked:boolean};
export type R2Purge=(keys:readonly string[],requestId:string)=>Promise<{requestId:string;keys:readonly string[];completed:boolean}>;
const validKey=(key:string)=>/^private\/(original|derivative)\/sha256\/[a-f0-9]{64}$/.test(key);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
/** R2 S3-compatible adapter. SDK signing, no home credential-chain/default resolver.
 * All objects stay private; only authorized CMS derivative responses are public-facing.
 * Composition/contract/credentials/CDN are still Owner gates; tests inject a local handler. */
export class R2MediaProvider implements MediaProviderPort {
 readonly id='CLOUDFLARE_R2';private client:S3Client;readonly origin:string;
 constructor(private accountId:string,private bucket:string,private credentials:()=>Promise<R2Credential>,private purge:R2Purge,private now:()=>Date=()=>new Date(),requestHandler?:S3ClientConfig['requestHandler']){
  if(!/^[a-f0-9]{32}$/.test(accountId)||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw new ContentInputError('R2_CONFIGURATION_INVALID');
  this.origin='https://'+accountId+'.r2.cloudflarestorage.com';
  this.client=new S3Client({region:'auto',endpoint:this.origin,forcePathStyle:true,maxAttempts:1,credentials:async()=>{const c=await this.check();return {accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey,expiration:c.expiresAt};},...(requestHandler?{requestHandler}:{})});
 }
 private async check(){const c=await this.credentials();if(c.accountId!==this.accountId||c.bucket!==this.bucket||c.revoked||!Number.isFinite(c.expiresAt.getTime())||c.expiresAt<=this.now()||!c.accessKeyId||!c.secretAccessKey)throw new ContentInputError('R2_CREDENTIAL_UNAVAILABLE');return c;}
 async putIfAbsent(key:string,bytes:Uint8Array,metadata:{sha256:string;mime:string;visibility:'PRIVATE'}){
  if(!validKey(key)||!key.endsWith('/'+sha(bytes))||metadata.sha256!==sha(bytes)||metadata.visibility!=='PRIVATE'||bytes.byteLength<1||bytes.byteLength>32*1024*1024||!['image/jpeg','image/png','image/webp'].includes(metadata.mime))throw new ContentInputError('MEDIA_OBJECT_INVALID');await this.check();
  try{await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:bytes,IfNoneMatch:'*',ContentType:metadata.mime,CacheControl:'private, no-store',Metadata:{sha256:metadata.sha256}}),{abortSignal:AbortSignal.timeout(5000)});}
  catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw new ContentInputError('MEDIA_STORE_FAILED');const existing=await this.readPrivate(key);if(!existing||sha(existing)!==metadata.sha256||existing.byteLength!==bytes.byteLength)throw new ContentInputError('MEDIA_DIGEST_MISMATCH');}
  return {sha256:metadata.sha256};
 }
 async readPrivate(key:string){if(!validKey(key))throw new ContentInputError('MEDIA_OBJECT_INVALID');await this.check();
  let response;try{response=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}),{abortSignal:AbortSignal.timeout(5000)});}catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return null;throw new ContentInputError('MEDIA_FETCH_FAILED');}
  if(!response.Body)throw new ContentInputError('MEDIA_FETCH_FAILED');const reader=response.Body.transformToWebStream().getReader();const chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>32*1024*1024)throw new ContentInputError('MEDIA_OBJECT_INVALID');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(chunks);if(!key.endsWith('/'+sha(bytes))||response.Metadata?.sha256!==sha(bytes))throw new ContentInputError('MEDIA_DIGEST_MISMATCH');return bytes;
 }
 async signPrivateRead(key:string,expiresAt:Date){if(!validKey(key)||!key.startsWith('private/original/'))throw new ContentInputError('PRIVATE_MEDIA_DENIED');const credential=await this.check(),now=this.now(),seconds=Math.floor((expiresAt.getTime()-now.getTime())/1000);
  if(!Number.isSafeInteger(seconds)||seconds<1||seconds>604800||expiresAt>credential.expiresAt)throw new ContentInputError('MEDIA_TICKET_POLICY_INVALID');
  const url=await getSignedUrl(this.client,new GetObjectCommand({Bucket:this.bucket,Key:key}),{expiresIn:seconds,signingDate:now});return {url,expiresAt};
 }
 async invalidate(keys:readonly string[],requestId:string){if(!keys.length||keys.length>1000||keys.some(k=>!validKey(k)))throw new ContentInputError('MEDIA_REVOCATION_INVALID');return this.purge(keys,requestId);}
 close(){this.client.destroy();}
}
