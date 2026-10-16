// Exact three-image intake for R67. No connection, credential, role or provider operation here.
// The live operator must prove accepted main, TLS, backup freshness and matching private R2 bytes.
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {validateLocalArtwork,approvedManifestSha256} from './avatar-artwork-local';
import {planPrivateRelease,applyPersistedPrivateRelease,type ContentRevision,type CatalogReleaseState} from '../packages/core/src/content/release-plan';
import type {ContentWorkflowState} from '../packages/core/src/content/workflow';
import type {VisualMetadata,VisualLayer,AvatarType,AvatarVisualUse} from '../packages/contracts/src/avatar-visualization';
export const productionAvatarRightsBasis='OWNER_CONFIRMED_PUBLIC_USE_R67_2026_10_16';
// Operational season limit, not a claim about the legal expiration of the Owner's rights.
export const productionAvatarRightsUntil='2027-03-31T15:00:00.000Z';
const fail=(reason:string):never=>{throw new Error('PRODUCTION_AVATAR_'+reason);};
export async function applyProductionAvatarArtwork(c:PoolClient,database:string,owner:string){
 const checked=await validateLocalArtwork(),now=new Date();
 if(now>=new Date(productionAvatarRightsUntil))fail('APPROVAL_EXPIRED');
 const authority=await readFile('docs/execution/R67_AVATAR_PUBLICATION.md');
 if(!authority.toString().includes('公開利用の権利がある。この3画像を使用する'))fail('OWNER_CONFIRMATION_REQUIRED');
 const revisionId=randomUUID(),releaseId=randomUUID();
 const metadata:VisualMetadata[]=checked.assets.map(({entry},i)=>({id:randomUUID(),layer:entry.layer as VisualLayer,avatarType:entry.appearance as AvatarType|null,match:'GENERIC_REFERENCE',modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:randomUUID(),derivativeSha256:entry.sha256,revisionId,releaseId,state:'ACTIVE',sortOrder:i,anchor:{x:0.5,y:1},position:{x:0.5,y:1},rightsEligible:true,rightsUntil:productionAvatarRightsUntil}));
 const uses:AvatarVisualUse[]=metadata.map(v=>({purpose:'AVATAR_VISUALIZATION_V1',visualId:v.id,layer:v.layer,avatarType:v.avatarType,match:v.match,modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256}));
 const offerCode='owner-public-avatar-core',revision:ContentRevision={id:revisionId,offerCode,locale:'ja',content:{title:'サイズ比較用の参考イラスト',summary:'特定商品、体格、適合、在庫、料金を確約しない参考画像',fit_note:productionAvatarRightsBasis},sourceRevision:null,translationApproved:false,mediaIds:metadata.map(v=>v.mediaId),commercialRevision:'r67-avatar-v1',avatarVisualUses:uses};
 const catalog:CatalogReleaseState={current:null,draftIds:{[offerCode+'/ja']:revisionId},revisions:[revision],media:metadata.map(v=>({id:v.mediaId,processed:true,rightsConfirmed:true,rightsUntil:productionAvatarRightsUntil,alt:'Owner-approved generic size-reference illustration',immutableSha256:v.derivativeSha256,internalOnly:false})),commercialRevisions:{[offerCode]:revision.commercialRevision},releases:[]};
 const plan=planPrivateRelease(catalog,{id:releaseId,entries:[revisionId],expectedCurrent:null,restoreOf:null},now);
 if(plan.issues.length)fail('RELEASE_INVALID');
 const state:ContentWorkflowState={catalog:applyPersistedPrivateRelease(catalog,plan,now).state,plans:{},requests:{},audit:[],outbox:[]};
 await c.query('BEGIN');
 try{
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms';SET LOCAL search_path=public,pg_catalog");
  const id=(await c.query('SELECT current_database() db,current_user role,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
  if(id?.db!==database||id.role!==owner||id.owner!==owner)fail('OWNER_IDENTITY');
  const registry=(await c.query('SELECT count(*)::int n,max(id) latest FROM foundation_migrations')).rows[0];
  if(registry.n!==58||registry.latest!=='0058')fail('REGISTRY_MISMATCH');
  await c.query('LOCK TABLE content_workspace,content_media_objects,content_revision_records,content_outbox,avatar_visuals IN EXCLUSIVE MODE');
  for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])if((await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n!==0)fail('EXISTING_CONTENT_RECONCILE');
  for(const {entry,bytes}of checked.assets)await c.query('INSERT INTO content_media_objects(sha256,bytes) VALUES($1,$2)',[entry.sha256,bytes]);
  await c.query('INSERT INTO content_revision_records(id,payload) VALUES($1,$2)',[revisionId,JSON.stringify(revision)]);
  await c.query("INSERT INTO content_outbox(release_id,event) VALUES($1,'PRIVATE_PREVIEW_CHANGED')",[releaseId]);
  await c.query('INSERT INTO content_workspace(value) VALUES($1)',[JSON.stringify(state)]);
  for(const v of metadata)await c.query('INSERT INTO avatar_visuals(id,layer,avatar_type,match_kind,media_id,derivative_sha256,revision_id,release_id,state,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[v.id,v.layer,v.avatarType,v.match,v.mediaId,v.derivativeSha256,v.revisionId,v.releaseId,v.state,v.sortOrder]);
  const eligible=(await c.query('SELECT id,derivative_sha256 FROM avatar_current_visuals ORDER BY id')).rows;
  if(eligible.length!==3||eligible.some(row=>!metadata.some(v=>v.id===row.id&&v.derivativeSha256===row.derivative_sha256)))fail('ELIGIBILITY_MISMATCH');
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
 return {manifestSha256:approvedManifestSha256,authoritySha256:createHash('sha256').update(authority).digest('hex'),rightsBasis:productionAvatarRightsBasis,rightsUntil:productionAvatarRightsUntil,productionApproved:true,publicApproved:true,revisionId,releaseId,bindings:metadata.map(v=>({visualId:v.id,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256,layer:v.layer,appearance:v.avatarType}))};
}
