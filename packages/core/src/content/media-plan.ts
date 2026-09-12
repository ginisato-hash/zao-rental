import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {ContentInputError} from './bulk-plan';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export type IncomingPhoto={filename:string;bytes:Buffer;binding:{modelId:string;season:string;sport:'SKI'|'SNOWBOARD';role:'HERO'|'DETAIL';rightsEvidence:string|null}|null};
export type PhotoDraft={sourceSha256:string;derivativeSha256:string;filename:string;binding:IncomingPhoto['binding'];rights:'UNVERIFIED';publication:'DRAFT_ONLY';width:number;height:number;webp:Buffer};
// Byte-only boundary: no arbitrary URL fetch, filesystem traversal, object-store write,
// auth authority, model creation or inventory generation. Every rights claim stays pending.
export async function preparePhotoDrafts(files:IncomingPhoto[]):Promise<PhotoDraft[]>{
 if(!files.length||files.length>200||files.reduce((n,f)=>n+f.bytes.length,0)>500*1024*1024)throw new ContentInputError('PHOTO_BATCH_LIMIT');const names=new Set<string>();
 for(const f of files){if(!/^[^/\\\u0000-\u001f]{1,180}\.(?:jpe?g|png|webp)$/i.test(f.filename)||f.filename.startsWith('.')||names.has(f.filename.toLowerCase()))throw new ContentInputError('PHOTO_FILENAME');names.add(f.filename.toLowerCase());if(!f.bytes.length||f.bytes.length>10*1024*1024)throw new ContentInputError('PHOTO_SIZE');if(f.binding&&(!['SKI','SNOWBOARD'].includes(f.binding.sport)||!['HERO','DETAIL'].includes(f.binding.role)||!/^[0-9a-f-]{36}$/i.test(f.binding.modelId)||!/^20\d{2}\/\d{2}$/.test(f.binding.season)||f.binding.rightsEvidence!==null&&(!f.binding.rightsEvidence.trim()||f.binding.rightsEvidence.length>500)))throw new ContentInputError('PHOTO_BINDING');}
 const result:PhotoDraft[]=[];
 // Sequential bounded decodes avoid multiplying pixel-memory use by200.
 for(const f of files){try{const image=sharp(f.bytes,{limitInputPixels:25_000_000,failOn:'warning',animated:false});const info=await image.metadata();if(!['jpeg','png','webp'].includes(info.format??'')||!info.width||!info.height||info.width*info.height>25_000_000||(info.pages??1)>1)throw new ContentInputError('PHOTO_FORMAT');const ext=f.filename.split('.').pop()!.toLowerCase();if((ext==='jpg'?'jpeg':ext)!==info.format)throw new ContentInputError('PHOTO_EXTENSION_MISMATCH');
 const {data,info:output}=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
 result.push({sourceSha256:hash(f.bytes),derivativeSha256:hash(data),filename:f.filename,binding:f.binding?structuredClone(f.binding):null,rights:'UNVERIFIED',publication:'DRAFT_ONLY',width:output.width,height:output.height,webp:data});
 }catch(e){if(e instanceof ContentInputError)throw e;throw new ContentInputError('PHOTO_DECODE_FAILED');}}
 return result;
}
export function photoMetadata(draft:PhotoDraft){const {webp,...record}=draft;return {...record,derivativeBytes:webp.length,originalRetained:'PRIVATE_SOURCE_REQUIRED',displayAltText:'PENDING_HUMAN_DESCRIPTION'};}
