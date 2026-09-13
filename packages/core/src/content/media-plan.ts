import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {ContentInputError} from './bulk-plan';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export type IncomingPhoto={filename:string;bytes:Buffer;binding:{modelId:string;season:string;sport:'SKI'|'SNOWBOARD';role:'COVER'|'DETAIL'|'LIFESTYLE'|'SERVICE'|'INTERNAL_IDENTITY';rightsEvidence:string|null}|null};
export type PhotoDerivative={requestedWidth:number;format:'webp'|'jpeg';width:number;height:number;sha256:string;bytes:Buffer};
export type PhotoDraft={sourceSha256:string;derivativeSha256:string;filename:string;binding:IncomingPhoto['binding'];rights:'UNVERIFIED';publication:'DRAFT_ONLY';width:number;height:number;webp:Buffer;derivatives:PhotoDerivative[]};
// Byte-only boundary: no arbitrary URL fetch, filesystem traversal, object-store write,
// auth authority, model creation or inventory generation. Every rights claim stays pending.
export async function preparePhotoDrafts(files:IncomingPhoto[]):Promise<PhotoDraft[]>{
 if(!files.length||files.length>200||files.reduce((n,f)=>n+f.bytes.length,0)>500*1024*1024)throw new ContentInputError('PHOTO_BATCH_LIMIT');const names=new Set<string>();
 for(const f of files){if(!/^[^/\\\u0000-\u001f]{1,180}\.(?:jpe?g|png|webp)$/i.test(f.filename)||f.filename.startsWith('.')||names.has(f.filename.toLowerCase()))throw new ContentInputError('PHOTO_FILENAME');names.add(f.filename.toLowerCase());if(!f.bytes.length||f.bytes.length>10*1024*1024)throw new ContentInputError('PHOTO_SIZE');if(f.binding&&(!['SKI','SNOWBOARD'].includes(f.binding.sport)||!['COVER','DETAIL','LIFESTYLE','SERVICE','INTERNAL_IDENTITY'].includes(f.binding.role)||!/^[0-9a-f-]{36}$/i.test(f.binding.modelId)||!/^20\d{2}\/\d{2}$/.test(f.binding.season)||f.binding.rightsEvidence!==null&&(!f.binding.rightsEvidence.trim()||f.binding.rightsEvidence.length>500)))throw new ContentInputError('PHOTO_BINDING');}
 const result:PhotoDraft[]=[];
 // Sequential bounded decodes avoid multiplying pixel-memory use by200.
 for(const f of files){try{const b=f.bytes,isJpeg=b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255,isPng=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),isWebp=b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';if(!isJpeg&&!isPng&&!isWebp)throw new ContentInputError('PHOTO_FORMAT');const image=sharp(f.bytes,{limitInputPixels:25_000_000,failOn:'warning',animated:false});const info=await image.metadata();if(!['jpeg','png','webp'].includes(info.format??'')||!info.width||!info.height||info.width*info.height>25_000_000||(info.pages??1)>1)throw new ContentInputError('PHOTO_FORMAT');const ext=f.filename.split('.').pop()!.toLowerCase();if((ext==='jpg'?'jpeg':ext)!==info.format)throw new ContentInputError('PHOTO_EXTENSION_MISMATCH');
 const derivatives:PhotoDerivative[]=[];
 for(const requestedWidth of [320,640,960,1440,1920])for(const format of ['webp','jpeg'] as const){
  const output=image.clone().rotate().resize({width:requestedWidth,height:requestedWidth,fit:'inside',withoutEnlargement:true});
  const {data,info:d}=await (format==='webp'?output.webp({quality:82}):output.jpeg({quality:85})).toBuffer({resolveWithObject:true});
  derivatives.push({requestedWidth,format,width:d.width,height:d.height,sha256:hash(data),bytes:data});
 }
 const primary=derivatives.find(d=>d.requestedWidth===1920&&d.format==='webp')!;
 result.push({sourceSha256:hash(f.bytes),derivativeSha256:primary.sha256,filename:f.filename,binding:f.binding?structuredClone(f.binding):null,rights:'UNVERIFIED',publication:'DRAFT_ONLY',width:primary.width,height:primary.height,webp:primary.bytes,derivatives});
 if(result.reduce((n,r)=>n+r.derivatives.reduce((sum,d)=>sum+d.bytes.length,0),0)>500*1024*1024)throw new ContentInputError('PHOTO_OUTPUT_BATCH_LIMIT');
 }catch(e){if(e instanceof ContentInputError)throw e;throw new ContentInputError('PHOTO_DECODE_FAILED');}}
 return result;
}
export function photoMetadata(draft:PhotoDraft){const {webp,derivatives,...record}=draft;return {...record,derivativeBytes:webp.length,derivatives:derivatives.map(({bytes,...d})=>({...d,byteLength:bytes.length})),originalRetained:'PRIVATE_SOURCE_REQUIRED',displayAltText:'PENDING_HUMAN_DESCRIPTION'};}
