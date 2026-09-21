import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {VisualMetadata} from '../../../contracts/src/avatar-visualization';
import {canonical} from '../../../contracts/src/hold';
export const avatarUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const avatarDigest=/^[a-f0-9]{64}$/;
export interface AvatarMediaReader{
 findForDelivery(id:string,hash:string,now:Date):Promise<VisualMetadata|null>;
 readBytes(hash:string):Promise<Buffer|null>;
}
/** Decode bounded raster bytes, never SVG, URLs or arbitrary files. Enforce the
 * canonical artboard and physical crop; optional overlays retain the full artboard. */
export async function validAvatarRaster(bytes:Buffer,layer:VisualMetadata['layer']){
 if(bytes.length<20||bytes.length>4*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)!==bytes.length-8)return false;
 let offset=12;
 while(offset<bytes.length){if(offset+8>bytes.length||!['VP8X','VP8 ','VP8L','ALPH'].includes(bytes.toString('ascii',offset,offset+4)))return false;const size=bytes.readUInt32LE(offset+4);offset+=8+size+(size%2);}
 if(offset!==bytes.length)return false;
 try{
  const image=sharp(bytes,{limitInputPixels:1_600_000,failOn:'warning',animated:false}),info=await image.metadata();
  if(info.format!=='webp'||!info.width||!info.height||!info.hasAlpha||(info.pages??1)>1||info.exif||info.icc||info.xmp||info.iptc||info.height>2000||info.width/info.height!==(layer==='SKI'?0.08:0.4))return false;
  const {data,info:decoded}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let first=decoded.height,last=-1,transparent=false;
  for(let y=0;y<decoded.height;y++)for(let x=0;x<decoded.width;x++){const a=data[(y*decoded.width+x)*4+3]!;if(a===0)transparent=true;if(a>0){first=Math.min(first,y);last=y;}}
  return transparent&&last>=0&&(!['AVATAR','SKI'].includes(layer)||first===0&&last===decoded.height-1);
 }catch{return false;}
}
export async function avatarDerivative(reader:AvatarMediaReader,id:string,digest:string,clock:()=>Date=()=>new Date()){
 if(!avatarUuid.test(id)||!avatarDigest.test(digest))return null;
 const before=await reader.findForDelivery(id,digest,clock());if(!before)return null;
 const bytes=await reader.readBytes(digest);
 if(!bytes||createHash('sha256').update(bytes).digest('hex')!==digest||!await validAvatarRaster(bytes,before.layer))return null;
 // Rights may have changed during byte IO/decode. Never cache an earlier grant.
 const after=await reader.findForDelivery(id,digest,clock());
 if(!after||canonical(after)!==canonical(before))return null;
 return bytes;
}
