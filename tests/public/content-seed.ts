import {randomUUID,createHash} from 'node:crypto';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {preparePhotoDrafts} from '../../packages/core/src/content/media-plan';
import type {ContentWorkflowState} from '../../packages/core/src/content/workflow';
import type {PublicMedia} from '../../packages/core/src/content/public-catalog';
import {publicPolicies} from '../../packages/core/src/content/public-pages';
// Synthetic development fixture only: no source sheet, real product photo or rights claim.
export async function seedPublicContent(pool:Pool,subject:string,model:{id:string;variantIds:string[];season:string}){
 const source=await sharp({create:{width:800,height:600,channels:3,background:{r:170,g:203,b:218}}}).png().toBuffer();const draft=(await preparePhotoDrafts([{filename:'synthetic-ski__COVER__01.png',bytes:source,binding:null}]))[0]!;
 for(const d of draft.derivatives)await pool.query('INSERT INTO content_media_objects VALUES($1,$2) ON CONFLICT DO NOTHING',[d.sha256,d.bytes]);
 const media:PublicMedia={alt:'SYNTHETIC geometric ski catalog fixture',width:draft.width,height:draft.height,variants:draft.derivatives.filter((d,i,a)=>a.findIndex(x=>x.width===d.width&&x.format===d.format)===i).map(d=>({src:'/media/'+d.sha256+'/'+d.width+'.'+(d.format==='jpeg'?'jpg':'webp'),width:d.width,type:d.format==='jpeg'?'image/jpeg':'image/webp'}))};
 const j=randomUUID(),e=randomUUID(),content={ja:{title:'合成スキー / 2026–27',summary:'開発テスト専用のモデル・写真です。実商品ではありません。',fit_note:'店頭で最終確認'},en:{title:'Synthetic ski / 2026–27',summary:'A synthetic development model and image. This is not real inventory.',fit_note:'Final checks at pickup'}};
 const state:ContentWorkflowState={catalog:{current:null,draftIds:{'synthetic-ski/ja':j,'synthetic-ski/en':e},revisions:[{id:j,offerCode:'synthetic-ski',locale:'ja',content:content.ja,sourceRevision:null,translationApproved:true,mediaIds:['synthetic-image'],commercialRevision:'synthetic-v1'},{id:e,offerCode:'synthetic-ski',locale:'en',content:content.en,sourceRevision:j,translationApproved:true,mediaIds:['synthetic-image'],commercialRevision:'synthetic-v1'}],media:[{id:'synthetic-image',processed:true,rightsConfirmed:true,rightsUntil:'2099-01-01T00:00:00Z',alt:media.alt,immutableSha256:draft.derivativeSha256,internalOnly:false}],commercialRevisions:{'synthetic-ski':'synthetic-v1'},releases:[]},plans:{},requests:{},audit:[],outbox:[]};
 await pool.query('INSERT INTO content_workspace(value) VALUES($1)',[JSON.stringify(state)]);for(const permission of ['CONTENT_EDIT','CONTENT_BULK','CONTENT_PUBLISH'])await pool.query('INSERT INTO content_staff_access VALUES($1,$2)',[subject,permission]);
 await pool.query("INSERT INTO content_model_previews VALUES('synthetic-ski',$1,$2,$3,1,'DRAFT',true,true,true,'2099-01-01',$4,$5)",[model.id,model.season,model.variantIds,JSON.stringify(content),JSON.stringify(media)]);
 await pool.query("INSERT INTO content_public_policies VALUES('latePickupPolicy',1,$1,$2,'DRAFT_WORDING_REQUIRES_PUBLICATION_REVIEW')",[publicPolicies.latePickupPolicy.ja,publicPolicies.latePickupPolicy.en]);
 return {source,sourceHash:createHash('sha256').update(source).digest('hex'),state,media,content};
}
