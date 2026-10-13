import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff,ledgerPrincipal,permissions} from '../../packages/auth/src/staff-auth';
import {verifyLedgerWrite} from '../../packages/auth/src/ledger-write-authority';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {WearService} from '../../packages/core/src/wear/service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {registerWear} from '../wear/fixture';
import {seedPublicContent} from '../public/content-seed';
import {capture,saveManifest} from './visual';
const app=await startFlowApp({publicP0:true,productionCopy:true,warmRoutes:true}),browser=await chromium.launch();let stage='setup';
try{
 await seedRecommendation(app.db.pool,true);await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T10:00:00+09:00'::timestamptz$$");
 const password=randomBytes(24).toString('base64url'),email='r65-catalog@example.invalid',subject=await bootstrapDevelopmentAdmin(app.db.pool,{email,password,displayName:'受付担当'});
 for(const permission of permissions)await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true) ON CONFLICT DO NOTHING',[subject,permission]);
 const staff=await browser.newContext({baseURL:app.origin}),sp=await staff.newPage();staff.setDefaultTimeout(30000);
 await sp.goto('/staff/login');await sp.getByLabel('メールアドレス',{exact:true}).fill(email);await sp.getByLabel('パスワード',{exact:true}).fill(password);await sp.getByRole('button',{name:'ログイン',exact:true}).click();await sp.waitForURL('**/staff/ledger');
 const principal=(await loadStaff(app.db.pool,subject))!,identity={subject,sessionId:(await app.db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1',[subject])).rows[0].id};
 const ledger=new LedgerService(app.roles.ledgerPool,ledgerPrincipal(principal),(c,s,a)=>verifyLedgerWrite(c,app.roles.authPool,identity,s,a),async()=>{/* Only newly created test stock. */});
 await new QuoteService(app.roles.pricingPool,principal).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const wear=await registerWear(ledger,new WearService(app.flow.flowPool,app.roles.authPool,identity));
 const provenance={notes:'SYNTHETIC R65 visual fixture',sourceKind:'SYNTHETIC',sourceDocument:'tests/preparation/customer-ui.ts',sourceLocator:'premium-board'};
 let board='',boardVariant='';
 for(const family of ['SNOWBOARD','SNOWBOARD_BOOT'] as const){const m=await ledger.create('models',{...provenance,sourceLocator:family+'-model',code:'R65-'+family,name:family==='SNOWBOARD'?'Mountain Board':'Snowboard Boots',brand:'SYNTHETIC',family,catalogSeason:'2026/27'});
  const v=await ledger.create('variants',{...provenance,sourceLocator:family+'-variant',modelId:m.id,family,age:'ADULT',tier:'PREMIUM',size:family==='SNOWBOARD'?'150 cm':'26.5 cm'});
  for(let n=0;n<4;n++)await ledger.create('assets',{...provenance,sourceLocator:family+'-'+n,family,variantId:v.id,storeId:'MOUNTAIN_BASE',status:'AVAILABLE',bslStatus:'NOT_APPLICABLE',bslMm:null,bslEvidence:''});
  if(family==='SNOWBOARD'){board=m.id;boardVariant=v.id;}
 }
 await seedPublicContent(app.db.pool,subject,{id:board,variantIds:[boardVariant],season:'2026/27'},{source:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e5edf2"/></svg>'),content:{ja:{title:'Mountain Board',summary:'モデル・シーズン・長さを選択',fit_note:'店頭で最終確認'},en:{title:'Mountain Board',summary:'Choose model, season and length',fit_note:'Final fit at pickup'}}});
 stage='unreleased models excluded';const before=await browser.newContext({baseURL:app.origin});await before.request.post('/api/guest/context',{headers:{origin:app.origin},data:{}});assert.equal((await (await before.request.get('/api/guest/options')).json()).models.length,0);await before.close();
 await sp.goto('/staff/content');await sp.getByRole('button',{name:'下書き全体の掲載版を確認'}).click();await sp.getByRole('button',{name:/^非公開の掲載版へ反映/}).click();await expect(sp.getByRole('status',{name:'説明処理状態'})).toContainText('保存済み');
 let serial=5;
 for(const locale of ['ja','en'] as const){const t=(j:string,e:string)=>locale==='ja'?j:e;
  for(const scenario of ['ski','board','premium','individual','wear']){stage=locale+' '+scenario;
   const ctx=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(30000);
   await ctx.route('**/api/guest/checkout',async route=>{const body=route.request().postDataJSON();assert.equal(body.contact.displayName,'Aki Sato');assert.equal(body.contact.email,'aki@example.invalid');await route.continue({postData:JSON.stringify({...body,contact:{...body.contact,displayName:'SYNTHETIC Aki Sato',email:'synthetic-aki@example.invalid'}})});});
   const p=await ctx.newPage();await p.goto('/'+locale+'/book');await p.getByLabel(t('利用開始日','Start date'),{exact:true}).fill('2035-02-'+String(serial++).padStart(2,'0'));await p.getByRole('button',{name:t('用品を選ぶ','Choose equipment'),exact:true}).click();
   const equipment=p.getByLabel(t('用品','Equipment'),{exact:true});assert.deepEqual(await equipment.locator('option').allTextContents(),locale==='ja'?['スキーセット','スノーボードセット','単品','ウェア']:['Ski Set','Snowboard Set','Individual Items','Wear']);
   assert.equal(await p.locator('select[aria-label*="ポール"],select[aria-label*="pole" i]').count(),0);assert.doesNotMatch(await p.locator('body').innerText(),/DIN|BSL/);
   if(scenario==='ski'){await capture(p,locale+'-four-categories-ski');}
   if(scenario==='board'||scenario==='premium'){await equipment.selectOption('SNOWBOARD');await expect(p.getByLabel(t('プラン','Plan'),{exact:true})).toContainText('Premium');if(scenario==='premium'){await p.getByLabel(t('プラン','Plan'),{exact:true}).selectOption('PREMIUM');await p.getByLabel(t('モデルとシーズン','Model and season'),{exact:true}).selectOption('synthetic-ski');}await capture(p,locale+'-snowboard-'+scenario);}
   if(scenario==='individual'){await equipment.selectOption('INDIVIDUAL');for(const item of ['SKI','SKI_BOOT','SNOWBOARD','SNOWBOARD_BOOT','POLE']){await p.getByLabel(t('単品の種類','Individual item'),{exact:true}).selectOption(item);await capture(p,locale+'-individual-'+item.toLowerCase());}await ctx.close();continue;}
   if(scenario==='wear'){await equipment.selectOption('WEAR');await p.getByLabel(t('ジャケット','Jacket'),{exact:true}).selectOption('wear_jacket-'+wear.selection.jacketVariantId);await p.getByLabel(t('パンツ','Pants'),{exact:true}).selectOption('wear_pants-'+wear.selection.pantsVariantId);await capture(p,locale+'-wear');}
   await p.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates'),exact:true}).click();await p.getByRole('radio',{name:locale==='ja'?/おすすめ/:/Recommended/}).check();await p.getByLabel(t('全員の内容を確認しました','I have checked everyone’s selections')).check();await p.getByRole('button',{name:t('全員分の最終確認へ','Review the whole group'),exact:true}).click();await expect(p.getByRole('region',{name:t('全員分の確認','Group review')})).toBeVisible();
   const draft=await (await ctx.request.get('/api/guest/draft')).json();assert.equal(draft.input.contractVersion,'INTEGRATED_V1_3');assert.equal(draft.input.members[0].poleSize,null);
   if(scenario==='ski'){await expect(p.getByRole('region',{name:t('全員分の確認','Group review')})).toContainText(t('お客様に合わせて最適な長さをご用意します。','We’ll prepare the most suitable length for you.'));await capture(p,locale+'-review-pole');}
   if(scenario==='premium'){await expect(p.getByRole('region',{name:t('全員分の確認','Group review')})).toContainText('Mountain Board · 2026/27');await capture(p,locale+'-premium-promise-review');await p.getByLabel(t('お名前','Name'),{exact:true}).fill('Aki Sato');await p.getByLabel(t('メール','Email'),{exact:true}).fill('aki@example.invalid');await p.getByRole('checkbox',{name:locale==='ja'?/利用開始48時間前/:/I accept the cancellation policy/}).check();await p.getByRole('button',{name:t('支払いへ進む','Continue to payment'),exact:true}).click();await expect(p.getByRole('heading',{name:t('予約が確認されました','Booking confirmed'),exact:true})).toBeVisible();const row=(await app.db.pool.query('SELECT conditions FROM rental_bookings ORDER BY created_at DESC LIMIT 1')).rows[0];assert.deepEqual(row.conditions.members[0].items.find((i:{family:string})=>i.family==='SNOWBOARD').modelPromise,{modelId:board,variantId:boardVariant,season:'2026/27'});}
   console.log('PASS '+stage+' real selection/review'+(scenario==='premium'?' and paid immutable model promise':''));await ctx.close();
  }
 }
 saveManifest('customer');
}catch(e){console.error('R65_CUSTOMER_UI_FAILED '+stage);throw e;}finally{await browser.close();await app.stop();}
