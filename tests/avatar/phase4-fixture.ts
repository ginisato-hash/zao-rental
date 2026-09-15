import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {planPrivateRelease,applyPersistedPrivateRelease,type ContentRevision,type CatalogReleaseState} from '../../packages/core/src/content/release-plan';
import type {ContentWorkflowState} from '../../packages/core/src/content/workflow';
import type {VisualLayer} from '../../packages/contracts/src/avatar-visualization';
import {id,visual,visualGrant,recommendation} from './fixture';
// Generated flat geometric test figures, never real people/products or uploaded art.
export async function syntheticAvatarRaster(layer:VisualLayer,appearance=1){
 const width=layer==='SKI'?80:400,height=1000,data=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const body=(x-200)**2/70**2+(y-70)**2/70**2<=1||y>=145&&y<530&&x>95&&x<305||y>=510&&y<965&&(x>115&&x<182||x>218&&x<285)||y>=965&&(x>=90&&x<=184||x>=216&&x<=310);
  const inside=layer==='AVATAR'?body:layer==='SKI'?Math.abs(x-40)<(y<70?Math.max(1,y*.35):y>960?Math.max(1,(999-y)*.45):24):layer==='JACKET'?y>=150&&y<545&&x>80&&x<320:layer==='PANTS'?y>=520&&y<945&&(x>110&&x<187||x>213&&x<290):y>=920&&(x>=88&&x<=188||x>=212&&x<=312);
  if(inside){const c=layer==='AVATAR'?(appearance===1?[158,187,183]:[208,176,148]):layer==='SKI'?[207,120,64]:layer==='JACKET'?[57,109,92]:layer==='PANTS'?[66,82,101]:[65,64,61],stripe=(x+y)%56<5,i=(y*width+x)*4;data[i]=stripe?240:c[0]!;data[i+1]=stripe?229:c[1]!;data[i+2]=stripe?205:c[2]!;data[i+3]=255;}
 }
 const image=sharp(data,{raw:{width,height,channels:4}});return {bytes:await image.clone().webp({lossless:true}).toBuffer(),original:await image.clone().png().toBuffer()};
}
export async function seedAvatarPhase4(pool:Pool,subject:string){
 const metadata=[],sources:Buffer[]=[];
 for(const [n,layer,appearance]of [[101,'AVATAR',1],[102,'AVATAR',2],[103,'SKI',0],[104,'PANTS',0],[105,'JACKET',0],[106,'BOOT',0]] as const){const art=await syntheticAvatarRaster(layer,appearance),sha=createHash('sha256').update(art.bytes).digest('hex');sources.push(art.original);await pool.query('INSERT INTO content_media_objects VALUES($1,$2) ON CONFLICT DO NOTHING',[sha,art.bytes]);metadata.push(visual(n,{layer,avatarType:layer==='AVATAR'?(appearance===1?'APPEARANCE_1':'APPEARANCE_2'):null,mediaId:'phase4-'+n,derivativeSha256:sha,revisionId:id(190),releaseId:id(191)}));}
 const originalHash=createHash('sha256').update(sources[0]!).digest('hex');await pool.query('INSERT INTO content_media_objects VALUES($1,$2)',[originalHash,sources[0]]);
 const revision:ContentRevision={id:id(190),offerCode:'synthetic-avatar-phase4',locale:'ja',content:{title:'SYNTHETIC TEST ONLY',summary:'Not customer artwork',fit_note:'No product or fit promise'},sourceRevision:null,translationApproved:false,mediaIds:metadata.map(v=>v.mediaId),commercialRevision:'synthetic-v1',avatarVisualUses:metadata.map(visualGrant)};
 const catalog:CatalogReleaseState={current:null,draftIds:{'synthetic-avatar-phase4/ja':revision.id},revisions:[revision],media:metadata.map(v=>({id:v.mediaId,processed:true,rightsConfirmed:true,rightsUntil:'2099-01-01T00:00:00Z',alt:'SYNTHETIC TEST ONLY',immutableSha256:v.derivativeSha256,internalOnly:false})),commercialRevisions:{'synthetic-avatar-phase4':'synthetic-v1'},releases:[]};
 const now=new Date(),plan=planPrivateRelease(catalog,{id:id(191),entries:[revision.id],expectedCurrent:null,restoreOf:null},now);if(plan.issues.length)throw Error('SYNTHETIC_RELEASE_INVALID');
 const state:ContentWorkflowState={catalog:applyPersistedPrivateRelease(catalog,plan,now).state,plans:{},requests:{},audit:[],outbox:[]};
 await pool.query('INSERT INTO content_revision_records VALUES($1,$2)',[revision.id,JSON.stringify(revision)]);await pool.query("INSERT INTO content_outbox VALUES($1,'PRIVATE_PREVIEW_CHANGED')",[id(191)]);await pool.query('INSERT INTO content_workspace(value) VALUES($1)',[JSON.stringify(state)]);
 for(const v of metadata)await pool.query('INSERT INTO avatar_visuals(id,layer,avatar_type,match_kind,media_id,derivative_sha256,revision_id,release_id,state,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[v.id,v.layer,v.avatarType,v.match,v.mediaId,v.derivativeSha256,v.revisionId,v.releaseId,v.state,v.sortOrder]);
 const x=recommendation();for(const [d,len]of [['RECOMMENDED',153],['SHORTER',150],['LONGER',187]] as const){x.recommendation.candidates[d]!.lengthCm=len;x.recommendation.candidates[d]!.member.items.push({family:'WEAR_JACKET',variantIds:[id(120)]},{family:'WEAR_PANTS',variantIds:[id(121)]});}
 const previewId=randomUUID(),input={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-01-01',endDate:'2035-01-01',slot:'DAY'},members:[x.profile]};
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[subject]);
 await c.query('INSERT INTO recommendation_previews(id,owner_id,request_key,fingerprint,rule_version,model_policy,input,offered,reservation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[previewId,subject,randomUUID(),'c'.repeat(64),'SYNTHETIC_RENDERER_FIXTURE','SYNTHETIC_NO_BUSINESS_DECISION',JSON.stringify(input),JSON.stringify([x.recommendation]),randomUUID()]);
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 return {metadata,state,previewId,memberKey:x.profile.key,originalHash};
}
