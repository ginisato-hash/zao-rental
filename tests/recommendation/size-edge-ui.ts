// SIZE-EDGE (Issue 47 A) customer UI acceptance: JA/EN x 390px/desktop, real PostgreSQL, development payment stub only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect,type Page} from '@playwright/test';
import {newQuietContext} from '../flow/dev-hmr';
import {startFlowApp} from '../flow/launcher';
import {fillGuestProfile} from '../public/guest-profile';
import {seedRecommendation,fid} from './fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
const browser=await chromium.launch();let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,failed=false,stage='setup',count=0;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
const JA_NOTICE='取扱サイズ範囲外のため、最も近いサイズを表示しています。店舗で適合確認が必要です。';
const EN_NOTICE='This is outside the sizes we normally handle, so the nearest size is shown. The store must confirm the fit.';
let lastPage:Page|undefined;
const noOverflow=async(page:Page)=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
async function toSizes(page:Page,locale:'ja'|'en',heightCm:number,date:string){
 const t=(j:string,e:string)=>locale==='ja'?j:e;lastPage=page;await page.goto('/'+locale+'/book');
 await expect(page.getByLabel(t('利用開始日','Start date'),{exact:true})).toBeEnabled();
 await page.getByLabel(t('利用開始日','Start date'),{exact:true}).fill(date);await page.getByLabel(t('利用終了日','End date'),{exact:true}).fill(date);
 await page.getByRole('button',{name:'CONTINUE',exact:true}).click();await fillGuestProfile(page,locale,{heightCm});
 await page.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates'),exact:true}).click();
}
try{
 app=await startFlowApp({publicP0:true});await seedRecommendation(app.db.pool,true);
 // Public booking keeps a 95% capacity ceiling, so the real extreme sizes need several units to be bookable online.
 const seed=await app.db.pool.connect();try{await seed.query('BEGIN');await seed.query("SELECT set_config('zao.actor','synthetic-size-edge-ui',true),set_config('zao.reason','SYNTHETIC edge stock',true)");
  for(let n=0;n<4;n++)await seed.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) SELECT gen_random_uuid(),id,family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC edge','SYNTHETIC','tests/recommendation/size-edge-ui.ts','edge-'||id||'-'||$2::int FROM ledger_variants WHERE id=ANY($1::uuid[])`,[[fid(7105),fid(7103),fid(7104)],n]);await seed.query('COMMIT');}catch(e){await seed.query('ROLLBACK');throw e;}finally{seed.release();}
 await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'size-edge-ui-root@example.invalid',displayName:'SYNTHETIC Root',password:randomBytes(24).toString('base64url')});
 for(const permission of ['PRICE_EDIT','QUOTE_VIEW','QUOTE_CREATE'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);
 await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 for(let n=0;n<100;n++){try{if((await fetch(app.origin+'/api/health')).ok)break;}catch{}if(n===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 const mk=async(width:number,locale:string)=>{const context=await newQuietContext(browser,{baseURL:app!.origin,viewport:{width,height:844},hasTouch:width<500,locale});context.setDefaultTimeout(20000);return {context,page:await context.newPage()};};
 await mkdir('.local/screenshots',{recursive:true});
 for(const [locale,width,tag] of [['ja',390,'ja-390'],['en',390,'en-390'],['ja',1280,'ja-1280'],['en',1280,'en-1280']] as const){
  const t=(j:string,e:string)=>locale==='ja'?j:e;
  await check(tag+': a normal guest sees no edge badge or notice; the edge guest sees badge + notice and the real largest size, never a guarantee',async()=>{
   const normal=await mk(width,locale==='ja'?'ja-JP':'en-GB');await toSizes(normal.page,locale,170,'2035-01-05');
   await expect(normal.page.getByRole('radio',{name:t('おすすめ','Recommended')}).first()).toBeVisible();
   assert.equal(await normal.page.locator('[data-fit-notice],[data-fit-manual],[data-fit]').count(),0);await normal.context.close();
   const {context,page}=await mk(width,locale==='ja'?'ja-JP':'en-GB');await toSizes(page,locale,215,'2035-01-06');
   await expect(page.locator('[data-fit-notice]').first()).toHaveText(locale==='ja'?JA_NOTICE:EN_NOTICE);
   await expect(page.locator('[data-fit="EDGE_ABOVE"]').first()).toBeVisible();await expect(page.locator('label.guest-candidate:has([data-fit="EDGE_ABOVE"]) .guest-candidate-value')).toContainText('166');await expect(page.locator('label.guest-candidate:has([data-fit="NEAREST_AVAILABLE"]) .guest-candidate-value')).toContainText('165');
   await noOverflow(page);await page.screenshot({path:`.local/screenshots/size-edge-guest-${tag}.png`,fullPage:true});
   await page.getByRole('radio',{name:t('おすすめ','Recommended')}).first().check();await page.getByRole('checkbox',{name:t('全員の内容を確認しました','I have checked everyone’s selections')}).check();
   await page.getByRole('button',{name:t('全員分の最終確認へ','Review the whole group')}).click();
   await expect(page.locator('.guest-review [data-fit="EDGE_ABOVE"]')).toBeVisible();await expect(page.locator('.guest-review [data-fit-notice]')).toContainText(locale==='ja'?'店舗で適合確認が必要です':'The store must confirm the fit');
   await noOverflow(page);await page.screenshot({path:`.local/screenshots/size-edge-guest-review-${tag}.png`,fullPage:true});await context.close();
  });
  await check(tag+': a measurement beyond the auto-fit limit offers nothing selectable and explains the store route, with no payment path',async()=>{
   const {context,page}=await mk(width,locale==='ja'?'ja-JP':'en-GB');await toSizes(page,locale,225,'2035-01-07');
   await expect(page.locator('[data-fit-manual]').first()).toContainText(locale==='ja'?'店舗へお問い合わせください':'contact the store');
   assert.equal(await page.getByRole('radio').count(),0);await noOverflow(page);await page.screenshot({path:`.local/screenshots/size-edge-guest-manual-${tag}.png`,fullPage:true});await context.close();
  });
 }
 await check('browsing edge and manual-fit results consumed nothing: no hold, claim or selection exists before an explicit payment step',async()=>{
  for(const table of ['inventory_holds','inventory_claims','recommendation_selections'])assert.equal(Number((await app!.db.pool.query('SELECT count(*) AS n FROM '+table)).rows[0].n),0,table);
  const previews=(await app!.db.pool.query("SELECT offered->0->'fit'->>'kind' AS kind FROM recommendation_previews")).rows.map(r=>r.kind);
  assert.ok(previews.includes('EDGE_ABOVE')&&previews.includes('MANUAL_FIT_REQUIRED')&&previews.includes('NORMAL'));
 });
 console.log('Size-edge guest UI '+count+' cases passed; synthetic data, development payment stub only.');
}catch(e){failed=true;const err=e as {message?:string;stack?:string}|undefined;console.error('SIZE_EDGE_UI_FAILED '+stage+' '+(err?.message??String(e)).split('\n').slice(0,10).join(' | '));if(lastPage)console.error('PAGE_TEXT '+(await lastPage.locator('main').innerText().catch(()=>'')).slice(0,1500).replace(/\n/g,' | '));if(app)console.error('MANUAL_PARTS '+JSON.stringify((await app.db.pool.query("SELECT offered->0->'manualFit'->'fit'->'parts' AS p FROM recommendation_previews ORDER BY created_at DESC LIMIT 1").catch(()=>({rows:[]}))).rows[0]));console.error(err?.stack?.split('\n').filter(l=>l.includes('/tests/recommendation/size-edge-ui.ts:')).join('\n'));process.exitCode=1;}
finally{await browser.close();await app?.stop();if(failed)process.exitCode=1;}
