import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {newQuietContext} from '../flow/dev-hmr';
import {startFlowApp} from '../flow/launcher';
import {fillGuestProfile} from './guest-profile';
import {seedRecommendation} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {PRICE_PRODUCTS} from '../../packages/contracts/src/pricing';
// Guests get ONE uniform coupon refusal (no existence/state leak); staff keep detailed messages (tests/staff/coupon-order-ui.ts).
// Customer booking form coupon UI against real PostgreSQL. Synthetic coupons only (created through QuoteService); payment is the
// development stub (no provider, no real charge, no email). Fixed price: SKI_SET_ADULT_REGULAR/DAY_1 = 7,500 JPY.
const browser=await chromium.launch();let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,failed=false,stage='setup',count=0;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
const terms=(code:string,over:Record<string,unknown>={})=>({code,validFrom:'2034-12-01T00:00:00+09:00',validUntil:'2035-12-31T00:00:00+09:00',storeBasis:'PICKUP_STORE' as const,stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:PRICE_PRODUCTS.map(p=>p.key),kind:'PERCENT_BPS' as const,value:1000,minimumJpy:0,minimumBasis:'CART_SUBTOTAL' as const,maximumDiscountJpy:100000,advanceCombination:'DENY' as const,maxActiveReservations:null,...over});
/** Dates -> sizes -> final review (no coupon), returns on the step-2 page ready to continue. */
async function toSizes(page:Page,locale:'ja'|'en',ready=true){
 const t=(j:string,e:string)=>locale==='ja'?j:e;await page.goto('/'+locale+'/book');
 await expect(page.getByLabel(t('利用開始日','Start date'),{exact:true})).toBeEnabled();
 await page.getByLabel(t('利用開始日','Start date'),{exact:true}).fill('2035-01-05');await page.getByLabel(t('利用終了日','End date'),{exact:true}).fill('2035-01-05');
 await page.getByRole('button',{name:'CONTINUE',exact:true}).click();await fillGuestProfile(page,locale);
 await page.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates'),exact:true}).click();
 if(ready){await page.getByRole('radio',{name:t('おすすめ','Recommended')}).first().check();await page.getByRole('checkbox',{name:t('全員の内容を確認しました','I have checked everyone’s selections')}).check();}
}
let held:{context:BrowserContext;page:Page}|undefined;
const coupon=(page:Page)=>page.getByTestId('coupon-box');
const price=(page:Page)=>page.locator('dl.guest-price');
const noOverflow=async(page:Page)=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
try{
 app=await startFlowApp({publicP0:true});await seedRecommendation(app.db.pool,true);
 await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'coupon-ui-root@example.invalid',displayName:'SYNTHETIC Root',password:randomBytes(24).toString('base64url')});
 for(const permission of ['PRICE_EDIT','QUOTE_VIEW','QUOTE_CREATE'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);
 const quotes=new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!);await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 for(const c of [terms('UIGOOD10'),terms('UIPAST',{validFrom:'2030-01-01T00:00:00+09:00',validUntil:'2031-01-01T00:00:00+09:00'}),terms('UIONSEN',{stores:['ONSEN_BASE']}),terms('UINOADV',{advanceCombination:'DENY'}),terms('UIALLOW10',{advanceCombination:'ALLOW'}),terms('UIFIX700',{kind:'FIXED_JPY',value:700,maximumDiscountJpy:700,advanceCombination:'ALLOW'}),terms('UICAP500',{value:5000,maximumDiscountJpy:500,advanceCombination:'DENY'}),terms('UIUNSET10',{advanceCombination:'UNSET'}),terms('UIMIN9000',{minimumJpy:9000,advanceCombination:'ALLOW'})])await quotes.createCoupon(randomUUID(),c);
 for(let n=0;n<100;n++){try{if((await fetch(app.origin+'/api/health')).ok)break;}catch{}if(n===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 const mk=async(width:number,locale:string):Promise<{context:BrowserContext;page:Page}>=>{const context=await newQuietContext(browser,{baseURL:app!.origin,viewport:{width,height:844},hasTouch:width<500,locale});context.setDefaultTimeout(15000);return {context,page:await context.newPage()};};

 await check('JA 390px: bad codes show a user message and keep the amount; valid code shows breakdown; remove; re-apply; pay uses the discounted total',async()=>{
  const {context,page}=await mk(390,'ja-JP');await toSizes(page,'ja');
  // Step 2: an unknown code is rejected before any selection exists; no amount appears.
  await expect(coupon(page)).toBeVisible();await coupon(page).getByLabel(/クーポンコード/).fill('NOSUCHCODE');await coupon(page).getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.getByTestId('coupon-error')).toContainText('使えません');await expect(price(page)).toHaveCount(0);
  await coupon(page).getByLabel(/クーポンコード/).fill('');await page.getByRole('button',{name:'全員分の最終確認へ'}).click();
  await expect(price(page)).toContainText('7,500');await expect(price(page)).not.toContainText('クーポン割引');
  const before=await price(page).innerText();
  // Step 3: wrong codes keep the previous valid amount.
  for(const [code,message] of [['uipast',/使えません/],['UIONSEN',/使えません/],['no-such',/使えません/]] as const){
   await coupon(page).getByLabel(/クーポンコード/).fill(code);await coupon(page).getByRole('button',{name:'適用',exact:true}).click();
   await expect(page.getByTestId('coupon-error')).toContainText(message);assert.equal(await price(page).innerText(),before,'amount unchanged after '+code);
  }
  await coupon(page).getByLabel(/クーポンコード/).fill(' uigood10 ');await coupon(page).getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.getByTestId('coupon-applied')).toContainText('UIGOOD10');await expect(page.getByTestId('coupon-error')).toHaveCount(0);
  await expect(price(page)).toContainText('7,500');await expect(price(page)).toContainText('クーポン割引');await expect(price(page)).toContainText('750');await expect(price(page).locator('dd').last()).toContainText('6,750');
  await noOverflow(page);await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/coupon-guest-ja-390.png',fullPage:true});
  await coupon(page).getByRole('button',{name:'解除',exact:true}).click();
  await expect(price(page)).not.toContainText('クーポン割引');await expect(price(page).locator('dd').last()).toContainText('7,500');await expect(page.getByTestId('coupon-applied')).toHaveCount(0);
  await coupon(page).getByLabel(/クーポンコード/).fill('UIGOOD10');await coupon(page).getByRole('button',{name:'適用',exact:true}).click();
  await expect(price(page).locator('dd').last()).toContainText('6,750');
  // Reload keeps the applied coupon (server is the source of truth) and the pay summary matches.
  await page.reload();await expect(page.getByTestId('coupon-applied')).toContainText('UIGOOD10');await expect(price(page).locator('dd').last()).toContainText('6,750');
  await expect(page.locator('.guest-pay-summary')).toContainText('6,750');
  held={context,page};
 });

 await check('A coupon that cannot combine with the advance discount is still applied alone (no rejection) and says so',async()=>{
  const {context,page}=await mk(390,'ja-JP');await toSizes(page,'ja');
  await page.getByRole('checkbox',{name:/事前に支払って5%OFF/}).check();await coupon(page).getByLabel(/クーポンコード/).fill('UINOADV');await coupon(page).getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.getByTestId('coupon-applied')).toBeVisible();await expect(page.getByTestId('coupon-error')).toHaveCount(0);await expect(page.getByTestId('coupon-advance-folded')).toBeVisible();await context.close();
 });

 // Price matrix on the real screen: server total == the amount shown == the amount a hand formula gives, and the note
 // "cannot be combined with the 5% advance discount" appears exactly when the server folded the 5% into the coupon.
 // 7,500 base. Advance 5% is HALF_UP on the post-coupon amount (6,750 -> 338, 6,800 -> 340); no tax is added.
 for(const [code,advance,total,advanceLine,folded] of [
  ['UIALLOW10',true,6412,true,false],['UIALLOW10',false,6750,false,false],['UIFIX700',true,6460,true,false],['UICAP500',true,7000,false,true],['UICAP500',false,7000,false,false],
  ['UIUNSET10',true,6750,false,true],['UINOADV',true,6750,false,true],['UINOADV',false,6750,false,false]] as const)
  await check('price matrix (JA): '+code+(advance?' with':' without')+' the 5% check shows '+total+' yen, the same as the server draft; advance line '+(advanceLine?'shown':'absent')+'; combine note '+(folded?'shown':'absent'),async()=>{
   const {context,page}=await mk(390,'ja-JP');await toSizes(page,'ja');
   const box=page.getByRole('checkbox',{name:/事前に支払って5%OFF/});if(advance)await box.check();
   await coupon(page).getByLabel(/クーポンコード/).fill(code);await coupon(page).getByRole('button',{name:'適用',exact:true}).click();await expect(page.getByTestId('coupon-applied')).toBeVisible();
   if(await price(page).count()===0)await page.getByRole('button',{name:'全員分の最終確認へ'}).click();
   await expect(price(page).locator('dd').last()).toContainText(total.toLocaleString('en-US'));
   const server=await page.evaluate(async()=>{const d=await (await fetch('/api/guest/draft',{cache:'no-store'})).json();return d.estimate as {totalJpy:number;advanceDiscountJpy:number;subtotalJpy:number;couponDiscountJpy:number};});
   assert.equal(server.totalJpy,total,'server draft estimate');assert.equal(server.subtotalJpy-server.couponDiscountJpy-server.advanceDiscountJpy,total,'lines add up');
   if(advanceLine)await expect(price(page)).toContainText('事前決済割引');else await expect(price(page)).not.toContainText('事前決済割引');
   if(folded)await expect(page.getByTestId('coupon-advance-folded')).toBeVisible();else await expect(page.getByTestId('coupon-advance-folded')).toHaveCount(0);
   await expect(page.locator('.guest-pay-summary')).toContainText(total.toLocaleString('en-US'));
   await context.close();
  });
 await check('price matrix (JA): a coupon whose minimum is not met is refused with the uniform message and no amount changes',async()=>{
  const {context,page}=await mk(390,'ja-JP');await toSizes(page,'ja');await coupon(page).getByLabel(/クーポンコード/).fill('UIMIN9000');await coupon(page).getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.getByTestId('coupon-error')).toContainText('使えません');await expect(page.getByTestId('coupon-applied')).toHaveCount(0);await context.close();
 });
 await check('EN desktop: apply, breakdown in English, error copy in English, remove',async()=>{
  const {context,page}=await mk(1280,'en-US');await toSizes(page,'en');
  await coupon(page).getByLabel(/Coupon code/).fill('nosuch');await coupon(page).getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.getByTestId('coupon-error')).toContainText('cannot be used');
  await coupon(page).getByLabel(/Coupon code/).fill('UIGOOD10');await coupon(page).getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.getByTestId('coupon-applied')).toContainText('Coupon applied');await expect(price(page)).toContainText('Coupon discount');await expect(price(page).locator('dd').last()).toContainText('6,750');
  await noOverflow(page);await coupon(page).getByRole('button',{name:'Remove',exact:true}).click();await expect(price(page)).not.toContainText('Coupon discount');await expect(price(page).locator('dd').last()).toContainText('7,500');await context.close();
 });
 await check('JA: the discounted total is what the development payment confirms, the result screen shows, and the stored quote carries (no double discount)',async()=>{
  const {context,page}=held!;
  await page.getByRole('checkbox',{name:'合成データによる開発確認であることを確認'}).check();await page.getByRole('button',{name:'この内容で支払う（開発用決済）'}).click();
  await expect(page.getByRole('heading',{name:'予約が確定しました',exact:true})).toBeVisible().catch(async e=>{throw new Error('NOT_CONFIRMED alert='+await page.locator('.guest-alert').allInnerTexts()+' msg='+e.message.slice(0,80));});await expect(page.locator('.guest-result-total')).toContainText('6,750');
  const row=(await app!.db.pool.query("SELECT (q.snapshot->>'totalJpy')::int total,(q.snapshot->>'couponDiscountJpy')::int disc,q.coupon_id FROM rental_bookings b JOIN price_quotes q ON q.id=b.quote_id ORDER BY b.created_at DESC LIMIT 1")).rows[0];
  assert.equal(row.total,6750);assert.equal(row.disc,750);assert.ok(row.coupon_id);
  await context.close();
 });

 for(const locale of ['ja','en'] as const)await check(locale.toUpperCase()+': Apply is pressable before a length is chosen or the box is ticked, but never sends a selection (and never skips the confirmation) until both are done; Enter behaves the same',async()=>{
  const t=(j:string,e:string)=>locale==='ja'?j:e;const {context,page}=await mk(390,locale==='ja'?'ja-JP':'en-GB');await toSizes(page,locale,false);
  const selections:string[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/guest/selection')selections.push(r.method());});
  const apply=coupon(page).getByRole('button',{name:t('適用','Apply'),exact:true}),field=coupon(page).getByLabel(locale==='ja'?/クーポンコード/:/Coupon code/);
  await field.fill('UIGOOD10');await expect(apply).toBeEnabled();
  await apply.click();await expect(page.getByText(t('長さを1つ選んでください。','Choose one length.')).first()).toBeVisible();await expect(page.getByText(t('内容を確認したらチェックを入れてください。','Tick this box once you have checked the details.')).first()).toBeVisible();
  await field.press('Enter');
  await page.getByRole('radio',{name:t('おすすめ','Recommended')}).first().check();await apply.click();await field.press('Enter');
  await expect(page.getByText(t('内容を確認したらチェックを入れてください。','Tick this box once you have checked the details.')).first()).toBeVisible();
  assert.deepEqual(selections,[],'no selection request before the confirmation box is ticked');await expect(page.getByTestId('coupon-applied')).toHaveCount(0);
  await page.getByRole('checkbox',{name:t('全員の内容を確認しました','I have checked everyone’s selections')}).check();await apply.click();
  await expect(page.getByTestId('coupon-applied')).toBeVisible();assert.equal(selections.length,1);
  await context.close();
 });
 console.log('Coupon guest UI '+count+' cases passed; synthetic coupons, development payment stub only.');
}catch(e){failed=true;const err=e as {message?:string;code?:string;stack?:string}|undefined;console.error('COUPON_GUEST_UI_FAILED '+stage+' '+String(err?.code??'')+' '+(err?.message??String(e)).split('\n').slice(0,8).join(' | '));console.error(err?.stack?.split('\n').filter(s=>s.includes('/tests/public/')).join('\n'));}finally{await browser.close();await app?.stop();console.log('Owned coupon UI browser/Web/PostgreSQL stopped.');if(failed)process.exitCode=1;}
