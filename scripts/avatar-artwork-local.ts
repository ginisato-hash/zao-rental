import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {validAvatarRaster} from '../packages/core/src/avatar/media';
import type {VisualMetadata,VisualLayer,AvatarType,AvatarVisualUse} from '../packages/contracts/src/avatar-visualization';
import {planPrivateRelease,applyPersistedPrivateRelease,type ContentRevision,type CatalogReleaseState} from '../packages/core/src/content/release-plan';
import type {ContentWorkflowState} from '../packages/core/src/content/workflow';
import {worktreeIdentity,rejectAmbientDatabase} from './worktree';

export const artworkDirectory='docs/execution/avatar-artwork-activation/artwork';
export const approvedManifestSha256='34418edbb3cbb1a42474d979d9e938aa962429f286e72b9bff94517b4c6a36b7';
export const artworkAuthoritySha256='f99a96733aedf0214f31d5c02502e60909835a577248d1922caf71449a1edaab';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type Manifest=typeof import('../docs/execution/avatar-artwork-activation/artwork/manifest.json');
// This bounded helper imports only this reviewed package, never arbitrary manifest grants.
export function validateArtworkManifest(bytes:Buffer):Manifest{
 if(hash(bytes)!==approvedManifestSha256)throw new Error('ARTWORK_MANIFEST_NOT_APPROVED');
 return JSON.parse(bytes.toString('utf8')) as Manifest;
}
export async function validateLocalArtwork(directory=artworkDirectory){
 if(hash(await readFile('docs/execution/AVATAR_PHASE5_ARTWORK_AUTHORITY.md'))!==artworkAuthoritySha256)throw new Error('ARTWORK_AUTHORITY_MISMATCH');
 const manifest=validateArtworkManifest(await readFile(resolve(directory,'manifest.json'))),assets=[];
 for(const entry of manifest.files){
  const file=resolve(directory,entry.file),size=(await stat(file)).size;
  if(size!==entry.bytes||size>4*1024*1024)throw new Error('ARTWORK_SIZE_MISMATCH');
  const bytes=await readFile(file),layer=entry.layer as VisualLayer;
  if(hash(bytes)!==entry.sha256||!await validAvatarRaster(bytes,layer))throw new Error('ARTWORK_BYTES_INVALID');
  const image=sharp(bytes),meta=await image.metadata();
  if(meta.width!==entry.width||meta.height!==2000||meta.width!==(layer==='SKI'?160:800))throw new Error('ARTWORK_DIMENSIONS');
  const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=-1,y1=-1,transparentPixels=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
   if(data[(y*info.width+x)*4+3]!>0){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}else transparentPixels++;
  }
  if(y0!==0||y1!==1999||x0<=0||x1>=info.width-1||transparentPixels===0||layer==='AVATAR'&&(x0<80||x1>=720))throw new Error('ARTWORK_PHYSICAL_BOUNDS');
  assets.push({entry,bytes,bounds:{x0,y0,x1,y1},transparentPixels,format:meta.format,metadataPresent:!!(meta.exif||meta.icc||meta.xmp||meta.iptc)});
 }
 return {manifest,assets};
}
/** No CLI connection string, hosted adapter or app import. Only an owned local owner Pool. */
export async function importLocalArtwork(pool:Pool){
 rejectAmbientDatabase();const identity=worktreeIdentity();
 if(process.env.NODE_ENV==='production'||pool.options.host!=='127.0.0.1'||pool.options.port!==identity.dbPort||pool.options.database!==identity.database||pool.options.user!==identity.user)throw new Error('ARTWORK_OWNED_LOOPBACK_REQUIRED');
 const checked=await validateLocalArtwork(),now=new Date(),rightsUntil=new Date(now.getTime()+24*60*60*1000).toISOString();
 const revisionId=randomUUID(),releaseId=randomUUID();
 const metadata:VisualMetadata[]=checked.assets.map(({entry},i)=>({id:randomUUID(),layer:entry.layer as VisualLayer,avatarType:entry.appearance as AvatarType|null,match:'GENERIC_REFERENCE',modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:randomUUID(),derivativeSha256:entry.sha256,revisionId,releaseId,state:'ACTIVE',sortOrder:i,anchor:{x:0.5,y:1},position:{x:0.5,y:1},rightsEligible:true,rightsUntil}));
 const uses:AvatarVisualUse[]=metadata.map(v=>({purpose:'AVATAR_VISUALIZATION_V1',visualId:v.id,layer:v.layer,avatarType:v.avatarType,match:v.match,modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256}));
 const offerCode='owner-local-avatar-core',revision:ContentRevision={id:revisionId,offerCode,locale:'ja',content:{title:'Owner承認・ローカル用の参考イラスト',summary:'特定商品や体格・適合・価格を確約しない見た目参考',fit_note:'OWNER_SUPPLIED_SOURCE_DERIVATIVE_LOCAL_USE_ONLY'},sourceRevision:null,translationApproved:false,mediaIds:metadata.map(v=>v.mediaId),commercialRevision:'local-avatar-artwork-v1',avatarVisualUses:uses};
 const catalog:CatalogReleaseState={current:null,draftIds:{[offerCode+'/ja']:revisionId},revisions:[revision],media:metadata.map(v=>({id:v.mediaId,processed:true,rightsConfirmed:true,rightsUntil,alt:'Owner-approved local generic illustration',immutableSha256:v.derivativeSha256,internalOnly:false})),commercialRevisions:{[offerCode]:revision.commercialRevision},releases:[]};
 const plan=planPrivateRelease(catalog,{id:releaseId,entries:[revisionId],expectedCurrent:null,restoreOf:null},now);
 if(plan.issues.length)throw new Error('LOCAL_ARTWORK_RELEASE_INVALID');
 const state:ContentWorkflowState={catalog:applyPersistedPrivateRelease(catalog,plan,now).state,plans:{},requests:{},audit:[],outbox:[]};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const actual=(await c.query('SELECT current_database() AS db,current_user AS owner,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
  if(actual.db!==identity.database||actual.owner!==identity.user||actual.host!=='127.0.0.1'||actual.port!==identity.dbPort)throw new Error('ARTWORK_SERVER_IDENTITY_MISMATCH');
  // Explicit locks protect the emptiness check; no merge, ON CONFLICT, overwrite or retarget.
  await c.query('LOCK TABLE content_workspace,content_media_objects,content_revision_records,content_outbox,avatar_visuals IN EXCLUSIVE MODE');
  for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])if((await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n!==0)throw new Error('ARTWORK_FRESH_CONTENT_REQUIRED');
  for(const {entry,bytes}of checked.assets)await c.query('INSERT INTO content_media_objects(sha256,bytes) VALUES($1,$2)',[entry.sha256,bytes]);
  await c.query('INSERT INTO content_revision_records(id,payload) VALUES($1,$2)',[revisionId,JSON.stringify(revision)]);
  await c.query("INSERT INTO content_outbox(release_id,event) VALUES($1,'PRIVATE_PREVIEW_CHANGED')",[releaseId]);
  await c.query('INSERT INTO content_workspace(value) VALUES($1)',[JSON.stringify(state)]);
  for(const v of metadata)await c.query('INSERT INTO avatar_visuals(id,layer,avatar_type,match_kind,media_id,derivative_sha256,revision_id,release_id,state,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[v.id,v.layer,v.avatarType,v.match,v.mediaId,v.derivativeSha256,v.revisionId,v.releaseId,v.state,v.sortOrder]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 return {metadata,state,receipt:{manifestSha256:approvedManifestSha256,authoritySha256:artworkAuthoritySha256,revisionId,releaseId,rightsUntil,bindings:metadata.map(v=>({visualId:v.id,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256,layer:v.layer,appearance:v.avatarType})),purpose:'AVATAR_VISUALIZATION_V1',rightsBasis:'OWNER_SUPPLIED_SOURCE_DERIVATIVE_LOCAL_USE_ONLY',localOnly:true,productionApproved:false,sourcePhotosImported:0}};
}
