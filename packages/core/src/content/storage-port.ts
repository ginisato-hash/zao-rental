import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
export interface PrivateObjectReader{readPrivateObject(sha256:string):Promise<Buffer|null>;}
export interface PrivateImmutableObjectStore extends PrivateObjectReader{putPrivateObject(sha256:string,bytes:Buffer):Promise<void>;}
export type DerivativeGrant={path:string;sha256:string;type:'image/webp'|'image/jpeg';revision:string};
/** Grants come only from current verified CMS releases. Arbitrary original digests,
 * provider public ACLs/signed URLs and browser release claims are not accepted. */
export async function releasedDerivative(path:string,store:PrivateObjectReader,grant:()=>Promise<DerivativeGrant|null>){
 if(!/^\/media\/[a-f0-9]{64}\/\d+\.(?:webp|jpg)$/.test(path))return null;
 const before=await grant();if(!before||before.path!==path||!path.includes('/'+before.sha256+'/'))return null;
 let bytes:Buffer|null;try{bytes=await store.readPrivateObject(before.sha256);}catch{throw new ContentInputError('MEDIA_FETCH_FAILED');}if(!bytes||createHash('sha256').update(bytes).digest('hex')!==before.sha256)throw new ContentInputError('MEDIA_DIGEST_MISMATCH');
 const after=await grant();if(!after||canonical(after)!==canonical(before))return null;
 return {bytes,type:before.type,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}};
}
