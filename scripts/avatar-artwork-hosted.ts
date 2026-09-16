import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {validateLocalArtwork,approvedManifestSha256} from './avatar-artwork-local';
import {worktreeIdentity,rejectAmbientDatabase} from './worktree';
import {phase6NeonHostname,proveNeonClientTls} from '../packages/db/src/neon-tls';
import {phase6Database} from '../packages/auth/src/hosted-preview-config';
import {planPrivateRelease,applyPersistedPrivateRelease,type ContentRevision,type CatalogReleaseState} from '../packages/core/src/content/release-plan';
import type {ContentWorkflowState} from '../packages/core/src/content/workflow';
import type {VisualMetadata,VisualLayer,AvatarType,AvatarVisualUse} from '../packages/contracts/src/avatar-visualization';
export const phase6RightsBasis='OWNER_SUPPLIED_SOURCE_DERIVATIVE_PROTECTED_PREVIEW_ONLY';
/** Exact Owner-approved package, never an arbitrary import or a local gate relaxation.
 * Existing hosted content is confirmed empty; any populated/partial state refuses a merge. */
export async function importPhase6Artwork(pool:Pool){
 if(process.env.NODE_ENV==='production')throw Error('PHASE6_SETUP_NOT_RUNTIME');
 const local=pool.options.host==='127.0.0.1';
 if(local){rejectAmbientDatabase();const i=worktreeIdentity();if(pool.options.port!==i.dbPort||pool.options.database!==i.database||pool.options.user!==i.user)throw Error('PHASE6_OWNED_LOCAL_REQUIRED');}
 else if(pool.options.host!==phase6NeonHostname||pool.options.database!==phase6Database||pool.options.user!=='neondb_owner')throw Error('PHASE6_SETUP_OWNER_REQUIRED');
 const authorityHash=createHash('sha256').update(await readFile('docs/execution/AVATAR_PHASE6_AUTHORITY.md')).digest('hex');
 if(authorityHash!=='75c44bd480fdbda12b9aafbea7d2ef2a53206c79830c3e1f93774cbb3118013b')throw Error('PHASE6_AUTHORITY_HASH');
 const checked=await validateLocalArtwork(),now=new Date(),rightsUntil=new Date(now.getTime()+7*86400000).toISOString(),revisionId=randomUUID(),releaseId=randomUUID();
 // Seven-day operational Preview expiry is not a copyright/title determination.
 const metadata:VisualMetadata[]=checked.assets.map(({entry},i)=>({id:randomUUID(),layer:entry.layer as VisualLayer,avatarType:entry.appearance as AvatarType|null,match:'GENERIC_REFERENCE',modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:randomUUID(),derivativeSha256:entry.sha256,revisionId,releaseId,state:'ACTIVE',sortOrder:i,anchor:{x:0.5,y:1},position:{x:0.5,y:1},rightsEligible:true,rightsUntil}));
 const uses:AvatarVisualUse[]=metadata.map(v=>({purpose:'AVATAR_VISUALIZATION_V1',visualId:v.id,layer:v.layer,avatarType:v.avatarType,match:v.match,modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256}));
 const offerCode='owner-phase6-avatar-core',revision:ContentRevision={id:revisionId,offerCode,locale:'ja',content:{title:'Owner承認・保護されたPreview用の参考イラスト',summary:'特定商品や体格・適合・価格を確約しない見た目参考',fit_note:phase6RightsBasis},sourceRevision:null,translationApproved:false,mediaIds:metadata.map(v=>v.mediaId),commercialRevision:'phase6-avatar-v1',avatarVisualUses:uses};
 const catalog:CatalogReleaseState={current:null,draftIds:{[offerCode+'/ja']:revisionId},revisions:[revision],media:metadata.map(v=>({id:v.mediaId,processed:true,rightsConfirmed:true,rightsUntil,alt:'Owner-approved protected Preview generic illustration',immutableSha256:v.derivativeSha256,internalOnly:false})),commercialRevisions:{[offerCode]:revision.commercialRevision},releases:[]};
 const plan=planPrivateRelease(catalog,{id:releaseId,entries:[revisionId],expectedCurrent:null,restoreOf:null},now);if(plan.issues.length)throw Error('PHASE6_ARTWORK_RELEASE_INVALID');
 const state:ContentWorkflowState={catalog:applyPersistedPrivateRelease(catalog,plan,now).state,plans:{},requests:{},audit:[],outbox:[]};
 const c=await pool.connect();let timeouts;
 try{
  if(!local)proveNeonClientTls(c,pool.options);
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");
  timeouts=(await c.query("SELECT current_setting('lock_timeout') lock_timeout,current_setting('statement_timeout') statement_timeout")).rows[0];
  const identity=(await c.query('SELECT current_database() db,current_user role')).rows[0];if(identity.db!==pool.options.database||identity.role!==pool.options.user)throw Error('PHASE6_ARTWORK_IDENTITY');
  await c.query('LOCK TABLE content_workspace,content_media_objects,content_revision_records,content_outbox,avatar_visuals IN EXCLUSIVE MODE');
  for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])if((await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n!==0)throw Error('PHASE6_UNEXPECTED_CONTENT_STATE');
  for(const {entry,bytes}of checked.assets)await c.query('INSERT INTO content_media_objects(sha256,bytes) VALUES($1,$2)',[entry.sha256,bytes]);
  await c.query('INSERT INTO content_revision_records(id,payload) VALUES($1,$2)',[revisionId,JSON.stringify(revision)]);
  await c.query("INSERT INTO content_outbox(release_id,event) VALUES($1,'PRIVATE_PREVIEW_CHANGED')",[releaseId]);
  await c.query('INSERT INTO content_workspace(value) VALUES($1)',[JSON.stringify(state)]);
  for(const v of metadata)await c.query('INSERT INTO avatar_visuals(id,layer,avatar_type,match_kind,media_id,derivative_sha256,revision_id,release_id,state,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[v.id,v.layer,v.avatarType,v.match,v.mediaId,v.derivativeSha256,v.revisionId,v.releaseId,v.state,v.sortOrder]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 return {metadata,state,receipt:{manifestSha256:approvedManifestSha256,authoritySha256:authorityHash,revisionId,releaseId,rightsUntil,rightsBasis:phase6RightsBasis,approvedByOwner:true,purpose:'AVATAR_VISUALIZATION_V1',productionApproved:false,publicApproved:false,sourcePhotosImported:0,timeouts,bindings:metadata.map(v=>({visualId:v.id,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256,layer:v.layer,appearance:v.avatarType}))}};
}
