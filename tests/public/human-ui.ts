/** R64 production-copy visual proof. Local fixture app, unchanged real API/PG, fake payment only. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium,expect,type Page} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
const out=process.env.ZAO_VISUAL_OUTPUT??'.local/r64-human/production-copy';mkdirSync(out,{recursive:true});
const app=await startFlowApp({productionCopy:true,publicP0:true,publicP1:true,publicP4:true,publicP5:true,warmRoutes:true}),browser=await chromium.launch();
const records:object[]=[];let external=0;
const forbidden=/開発プレビュー|架空|合成|synthetic|development|test payment|fake provider|開発用決済|本番予約ではありません|請求確定不可|配送未接続|内部処理|reconcile|capability|HOLD|UUID|person-[a-z0-9]+:|PICKUP_WINDOW|CONFIRMED_DEV|PRIVATE_AVAILABLE/i;
async function capture(p:Page,name:string,en=false){
 for(const width of en?[390]:[390,1440]){
  await p.setViewportSize({width,height:width===390?844:900});await p.evaluate(()=>document.fonts.ready);
  await p.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=innerHeight){scrollTo(0,y);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}scrollTo(0,0);});
  const text=await p.locator('body').innerText();assert.doesNotMatch(text,forbidden,name);
  const values=await p.locator('input:visible').evaluateAll(els=>els.filter(e=>(e as HTMLInputElement).type!=='password').map(e=>(e as HTMLInputElement).value).join(' '));assert.doesNotMatch(values,forbidden,name+' input values');
  if(en)assert.doesNotMatch(text.replaceAll('日本語',''),/[一-龯ぁ-んァ-ヶ]/,name+' EN copy');
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.equal(overflow,0,name+' overflow');
  await p.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true,animations:'disabled'});await p.screenshot({path:`${out}/${name}-${width}-viewport.png`,animations:'disabled'});
  writeFileSync(`${out}/${name}-${width}.txt`,text);records.push({name,width,productionCopy:true,data:'synthetic fixture',provider:'SIMULATED_DEV',realProviderWrites:0,overflow});console.log('CAPTURE '+name+' '+width);
 }
}
try{
 await seedRecommendation(app.db.pool,true);await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T10:00:00+09:00'::timestamptz$$");
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'human-ui@example.invalid',displayName:'SYNTHETIC R64',password:randomBytes(24).toString('base64url')});
 for(const permission of ['PRICE_EDIT','QUOTE_VIEW'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true) ON CONFLICT DO NOTHING',[root,permission]);
 await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 for(const locale of ['ja','en'] as const){const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
  const ctx=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(30000);
  // Fixture-boundary aliases only: the service's mandatory SYNTHETIC contact guard is unchanged.
  // Only this exact fictional name/address is accepted. No real contact is forwarded or stored.
  await ctx.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==app.origin){external++;await route.abort();return;}
   if(url.pathname==='/api/guest/checkout'&&req.method()==='POST'){const body=req.postDataJSON();assert.equal(body.contact.displayName,'Aki Sato');assert.equal(body.contact.email,'aki@example.invalid');await route.continue({postData:JSON.stringify({...body,contact:{...body.contact,displayName:'SYNTHETIC Aki Sato',email:'synthetic-aki@example.invalid'}})});return;}
   if(url.pathname==='/api/guest/draft'&&req.method()==='GET'){
    const response=await route.fetch();const value=await response.json();if(value.selection?.contact){value.selection.contact.displayName='Aki Sato';value.selection.contact.email='aki@example.invalid';}await route.fulfill({response,json:value});return;
   }await route.continue();
  });
  const p=await ctx.newPage();
  if(ja)for(const path of ['','rental','rental/ski','rental/snowboard','rental/wear','rental/premium','rental/kids-family','prices','pickup-return','stores/mountain-base','stores/onsen-base','faq']){await p.goto('/ja'+(path?'/'+path:''));await capture(p,'public-'+(path.replaceAll('/','-')||'home'));}
  await p.goto('/'+locale+'/book');await expect(p.getByLabel(t('利用開始日','Start date'),{exact:true})).toBeEnabled();await capture(p,locale+'-book-dates',!ja);
  await p.getByLabel(t('利用開始日','Start date'),{exact:true}).fill(ja?'2035-02-05':'2035-02-06');await p.getByRole('button',{name:t('用品を選ぶ','Choose equipment'),exact:true}).click();
  const person=p.getByRole('article',{name:t('利用者 1','Person 1'),exact:true}),warning=p.getByText(t('保存されていない変更があります。移動すると失われます。','You have unsaved changes. Leaving now will lose them.'),{exact:true});
  await expect(warning).toHaveCount(0);await capture(p,locale+'-book-equipment-entry',!ja);
  await person.getByLabel(t('身長（cm）','Height (cm)'),{exact:true}).fill('171');await expect(warning).toBeVisible();await person.getByLabel(t('身長（cm）','Height (cm)'),{exact:true}).fill('170');await expect(warning).toHaveCount(0);
  await person.getByLabel(t('身長（cm）','Height (cm)'),{exact:true}).fill('171');await expect(warning).toBeVisible();
  await p.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates'),exact:true}).click();await p.getByRole('radio',{name:ja?/おすすめ/:/Recommended/}).check();await p.getByLabel(t('全員の内容を確認しました','I have checked everyone’s selections')).check();await p.getByLabel(t('事前に支払って5%OFFを利用する','Use the 5% advance payment discount')).check();await capture(p,locale+'-book-candidate',!ja);
  await p.getByRole('button',{name:t('全員分の最終確認へ','Review the whole group'),exact:true}).click();await expect(p.getByRole('region',{name:t('全員分の確認','Group review')})).toBeVisible();
  await p.getByLabel(t('お名前','Name'),{exact:true}).fill('Aki Sato');await p.getByLabel(t('メール','Email'),{exact:true}).fill('aki@example.invalid');await p.getByRole('checkbox',{name:ja?/利用開始48時間前/:/I accept the cancellation policy/}).check();await capture(p,locale+'-book-review-payment',!ja);
  await p.getByRole('button',{name:t('支払いへ進む','Continue to payment'),exact:true}).click();await expect(p.getByRole('heading',{name:t('予約が確認されました','Booking confirmed'),exact:true})).toBeVisible();await capture(p,locale+'-book-success',!ja);
  const draft=await (await ctx.request.get('/api/guest/draft')).json();assert.equal(draft.booking.state,'CONFIRMED_DEV');assert.equal(draft.booking.payments[0].state,'COMPLETED');
  await p.getByRole('button',{name:t('この端末に予約を保存','Save booking on this device')}).click();await p.getByRole('link',{name:t('保存した予約とQRを開く','Open the saved booking and QR')}).click();await expect(p.getByRole('img',{name:t('保存済み予約QR','Saved booking QR')})).toBeVisible();await expect(p.getByLabel(t('確認コード','Verification code'),{exact:true})).not.toBeVisible();await capture(p,locale+'-reservation',!ja);
  const guest=(await ctx.cookies()).find(c=>c.name==='zao_guest')!;await app.recoveryFixture!.enroll(guest.value,draft.booking.id,randomUUID());
  // The fixture mailbox is kept in memory, never written to captures/logs.
  const code=app.recoveryFixture!.code(ja?1:2);await ctx.clearCookies({name:'zao_booking_access'});await p.reload();await p.getByText(t('別の端末で予約を見る','View booking on another device'),{exact:true}).click();await capture(p,locale+'-recovery-form',!ja);
  await p.getByLabel(t('確認コード','Verification code'),{exact:true}).fill(code);await p.getByRole('button',{name:t('予約を開く','Open the booking with this code'),exact:true}).click();await expect(p.getByRole('img',{name:t('保存済み予約QR','Saved booking QR')})).toBeVisible();await capture(p,locale+'-recovery-success',!ja);
  await p.getByRole('button',{name:t('予約をキャンセル','Cancel booking'),exact:true}).click();await expect(p.getByRole('heading',{name:t('キャンセル内容の最終確認','Review cancellation')})).toBeVisible();await capture(p,locale+'-cancellation-preview',!ja);
  await p.getByRole('button',{name:t('この返金額でキャンセルを確定','Confirm cancellation with this refund amount')}).click();await expect(p.getByRole('region',{name:t('キャンセル状況','Cancellation status')})).toContainText(t('返金処理待ち','Refund pending'));await capture(p,locale+'-cancellation-status',!ja);await ctx.close();
 }
 assert.equal(external,0);writeFileSync(`${out}/customer-captures.json`,JSON.stringify({records,externalRequests:external,realProviderWrites:0},null,2));console.log('PASS production-copy JA/EN booking, save, recovery, cancellation; unchanged backend statuses; dirty-state entry/edit/revert; external requests 0');
}finally{await browser.close();await app.stop();}
