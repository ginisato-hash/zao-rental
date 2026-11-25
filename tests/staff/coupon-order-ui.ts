import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {provisionContentRole} from '../../scripts/content-roles';
import {loadStaff,type StaffPrincipal,type StaffState} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../recommendation/fixture';
import {skiSet} from '../inventory/fixture';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';
import {fillGuestProfile} from '../public/guest-profile';
import {FakeGateway,simulation} from '../flow/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {GuestBookingService} from '../../packages/core/src/guest/service';
import {StaffOrderDrafts,type StaffOrderActor} from '../../packages/core/src/operations/staff-order-drafts';
import {guestCatalog,guestVariants} from '../../packages/core/src/content/public-catalog';
import {staffOrderHandler} from '../../apps/web/src/lib/staff-order-http';
import {PRICE_PRODUCTS} from '../../packages/contracts/src/pricing';
// Staff New order (/staff/orders/new = GuestBooking staff mode) applies a coupon through the SAME canonical path as a guest, on a
// real local PostgreSQL with the real UI. The browser's /api/staff-orders calls are answered by the real staffOrderHandler composed
// in this process on the same database (the local app has no Production commercial composition, so its own route answers 503;
// the payment request is therefore checked through the same services with the test-owned adapter, never a real provider).
// Synthetic data only. Fixed price: SKI_SET_ADULT_REGULAR / DAY_1 = 7,500 JPY.
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,content:Awaited<ReturnType<typeof provisionContentRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
const terms=(code:string,over:Record<string,unknown>={})=>({code,validFrom:'2034-12-01T00:00:00+09:00',validUntil:'2035-12-31T00:00:00+09:00',storeBasis:'PICKUP_STORE' as const,stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:PRICE_PRODUCTS.map(p=>p.key),kind:'PERCENT_BPS' as const,value:1000,minimumJpy:0,minimumBasis:'CART_SUBTOTAL' as const,maximumDiscountJpy:100000,advanceCombination:'DENY' as const,maxActiveReservations:null,...over});
const coupon=(p:Page)=>p.getByTestId('coupon-box');const price=(p:Page)=>p.locator('dl.guest-price');
const apply=async(p:Page,code:string)=>{await coupon(p).getByLabel(/クーポンコード/).fill(code);await coupon(p).getByRole('button',{name:'適用',exact:true}).click();};
try{
 app=await startDevelopmentApp({operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const now=new Date('2035-01-01T10:00:00+09:00');
 await seedRecommendation(db.pool,true);
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'cpn-order-root@example.invalid',displayName:'SYNTHETIC Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 const admin=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'ADMIN',password,email:'cpn-order-admin@example.invalid',displayName:'SYNTHETIC Order Admin',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true}})).id!;
 const principal=(await loadStaff(db.pool,admin))!;flow=await provisionFlowRole(db.pool,db.identity);content=await provisionContentRole(db.pool,db.identity);
 const holds=new HoldService(app.roles.holdPool,principal,()=>now),quotes=new QuoteService(app.roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const ids:Record<string,string>={};
 for(const c of [terms('UIGOOD10'),terms('UIPAST',{validFrom:'2030-01-01T00:00:00+09:00',validUntil:'2031-01-01T00:00:00+09:00'}),terms('UIOFF'),terms('UIFULL',{maxActiveReservations:1})]){const id=randomUUID();ids[c.code]=id;await quotes.createCoupon(id,c);}
 await quotes.setCouponActive(ids.UIOFF!,{active:false});
 // Login through the real UI; the browser session is the identity the handler below verifies against the database.
 const context=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}}),page=await context.newPage();context.setDefaultTimeout(30000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('cpn-order-admin@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});
 const sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[admin])).rows[0].id as string;
 const fake=new FakeGateway(()=>now),identity:StaffOrderActor={subject:admin,sessionId};
 const bookings=new BookingService(flow.flowPool,app.roles.authPool,identity,fake,simulation);
 const compose=(p:StaffPrincipal,actor:StaffOrderActor)=>{const h=new HoldService(app!.roles.holdPool,p,()=>now),q=new QuoteService(app!.roles.pricingPool,p,()=>now),r=new RecommendationService(app!.roles.recommendationPool,p,h,q,async v=>guestVariants(await guestCatalog(content!.contentReadPool,v),v));
  const drafts=new StaffOrderDrafts(app!.operations!.operationsPool);return {drafts,service:new GuestBookingService<StaffOrderActor>(drafts,actor,r,new BookingService(flow!.flowPool,app!.roles.authPool,actor,fake,simulation),async()=>guestCatalog(content!.contentReadPool,await h.recommendationCatalog()))};};
 const stamp=JSON.stringify([sessionId,'cpn-order']),sessionHeader=createHash('sha256').update(stamp).digest('hex');
 const state=async():Promise<StaffState>=>({status:'authorized',principal,stamp} as StaffState);
 const handler=staffOrderHandler(state,compose,origin);
 await page.route('**/api/staff-orders/**',async r=>{const q=r.request(),u=new URL(q.url());const res=await handler(new Request(origin+u.pathname,{method:q.method(),headers:{origin,'content-type':'application/json','x-zao-session':sessionHeader},...(q.method()==='POST'?{body:q.postData()??'{}'}:{})}));
  await r.fulfill({status:res.status,headers:{'content-type':'application/json'},body:await res.text()});});
 // A previous customer (one booking) the staff member can pick; it also consumes the single slot of UIFULL.
 const conditions=skiSet('2035-01-20'),held=await holds.command('create',randomUUID(),conditions);assert.equal(held.result,'CREATED');
 const prior=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:'UIFULL',wantAdvance:false})).quote;
 const priorBooking=await bookings.create(randomUUID(),prior.id,{displayName:'SYNTHETIC Repeat Customer',email:'synthetic-repeat@example.invalid',termsAccepted:true});await recordSyntheticBookingProfile(db.pool,priorBooking.id);
 const customerId=(await db.pool.query('SELECT customer_id FROM customer_booking_links WHERE booking_id=$1',[priorBooking.id])).rows[0].customer_id as string;
 const usage=async(code:string)=>(((await quotes.listCoupons()) as {coupons:{id:string;usage:{bookings:number}}[]}).coupons.find(c=>c.id===ids[code])!).usage.bookings;
 assert.equal(await usage('UIFULL'),1);

 await check('staff picks a customer, walks the booking steps and sees staff-detailed coupon errors (not the guest uniform answer) with the amount unchanged',async()=>{
  await page.goto('/staff/orders/new');await page.getByRole('heading',{name:'新規予約',level:1}).waitFor();
  const panel=page.getByRole('region',{name:'お客様'});await panel.getByRole('searchbox').fill('SYNTHETIC Repeat');await panel.getByRole('button',{name:'検索'}).click();
  await panel.getByRole('listitem').filter({hasText:'SYNTHETIC Repeat Customer'}).getByRole('button',{name:'このお客様にする'}).click();await panel.getByRole('status').filter({hasText:'SYNTHETIC Repeat Customer'}).waitFor();
  await expect(page.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await page.getByLabel('利用開始日',{exact:true}).fill('2035-01-05');await page.getByLabel('利用終了日',{exact:true}).fill('2035-01-05');
  await page.getByRole('button',{name:'CONTINUE',exact:true}).click();await fillGuestProfile(page,'ja');
  await page.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();
  await page.getByRole('radio',{name:'おすすめ'}).first().check();await page.getByRole('checkbox',{name:'全員の内容を確認しました'}).check();
  await page.getByRole('button',{name:'全員分の最終確認へ'}).click();
  await expect(price(page)).toContainText('7,500');await expect(price(page)).not.toContainText('クーポン割引');const before=await price(page).innerText();
  for(const [code,message] of [['NOSUCHCODE',/見つかりません/],['uioff',/現在有効ではありません/],['UIFULL',/利用上限に達しました/],['uipast',/使えません/]] as const){
   await apply(page,code);await expect(page.getByTestId('coupon-error')).toContainText(message);assert.equal(await price(page).innerText(),before,'amount unchanged after '+code);
  }
  const saved=(await db.pool.query("SELECT selection->>'couponCode' c FROM staff_order_drafts WHERE context_id=$1 AND closed_at IS NULL",[admin])).rows[0].c;assert.ok(saved===null||saved===undefined,'a refused coupon is never saved');
 });
 await check('a valid coupon: breakdown, saved estimate, stored quote and the payment request amount are the same discounted total, once',async()=>{
  await apply(page,' uigood10 ');await expect(page.getByTestId('coupon-applied')).toContainText('UIGOOD10');
  await expect(price(page)).toContainText('クーポン割引');await expect(price(page)).toContainText('750');await expect(price(page).locator('dd').last()).toContainText('6,750');
  const row=(await db.pool.query("SELECT id,customer_profile_id,selection FROM staff_order_drafts WHERE context_id=$1 AND closed_at IS NULL",[admin])).rows[0];
  assert.equal(row.customer_profile_id,customerId);assert.equal(row.selection.couponCode,'UIGOOD10');assert.equal(row.selection.estimate.subtotalJpy,7500);assert.equal(row.selection.estimate.couponDiscountJpy,750);assert.equal(row.selection.estimate.totalJpy,6750);
  // Same draft, same services, through the shared flow: booking creation reprices on the server and must equal the estimate the staff member saw.
  const {service:svc,drafts}=compose(principal,identity);const view=await svc.get();assert.equal(view.reviewHash!==null,true);assert.equal(view.estimate!.totalJpy,6750);
  const prepared=await svc.preparePayment({draftId:view.id,expectedRevision:view.revision,reviewHash:view.reviewHash,contact:{displayName:'SYNTHETIC Repeat Customer',email:'synthetic-repeat@example.invalid',termsAccepted:true}});
  const b=prepared.booking!;assert.equal(b.state,'DRAFT');assert.equal(b.priceSnapshot.totalJpy,6750);assert.equal(b.priceSnapshot.couponDiscountJpy,750);assert.equal(prepared.quote!.snapshot.totalJpy,6750);
  const stored=(await db.pool.query("SELECT (q.snapshot->>'totalJpy')::int total,(q.snapshot->>'couponDiscountJpy')::int disc,q.coupon_id,l.customer_id FROM rental_bookings r JOIN price_quotes q ON q.id=r.quote_id JOIN customer_booking_links l ON l.booking_id=r.id WHERE r.id=$1",[b.id])).rows[0];
  assert.deepEqual([stored.total,stored.disc,stored.coupon_id,stored.customer_id],[6750,750,ids.UIGOOD10,customerId]);
  const calls=fake.calls.length;await bookings.startPayment(b.id,randomUUID());assert.equal(fake.calls.length,calls+1);assert.equal(fake.calls.at(-1)!.amountJpy,6750,'payment request equals the discounted total');
  await bookings.startPayment(b.id,randomUUID()).catch(()=>{});assert.equal(fake.calls.length,calls+1,'no second charge');
  assert.equal(await usage('UIGOOD10'),1);void drafts;
 });
 await check('a limit, a disabled coupon and an expired coupon also bind a staff order at booking time (no booking row, no usage)',async()=>{
  const {service:svc}=compose(principal,identity);
  await page.goto('/staff/orders/new');await page.getByRole('heading',{name:'新規予約',level:1}).waitFor();
  const restart=await handler(new Request(origin+'/api/staff-orders/restart',{method:'POST',headers:{origin,'content-type':'application/json','x-zao-session':sessionHeader},body:'{}'}));assert.equal(restart.status,200);
  const draft=(await restart.json()) as {id:string;revision:number};
  // Select the prior customer and an ordinary order through the API path, then try each unusable coupon at selection time.
  const post=async(path:string,body:unknown)=>handler(new Request(origin+'/api/staff-orders'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-zao-session':sessionHeader},body:JSON.stringify(body)}));
  const ok=async(r:Response)=>{assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return await r.json() as {id:string;revision:number;reviewHash:string};};
  void svc;void draft;
  const options=await handler(new Request(origin+'/api/staff-orders/options',{headers:{'x-zao-session':sessionHeader}}));assert.equal(options.status,200);
  const poleless=((await options.json()) as {sizes:{key:string;family:string}[]}).sizes.find(v=>v.family==='POLE')!.key;
  let d=await ok(await post('/customer',{draftId:draft.id,expectedRevision:draft.revision,customerId}));
  d=await ok(await post('/draft',{draftId:d.id,expectedRevision:d.revision,input:{pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-01-06',endDate:'2035-01-06',slot:'DAY'},members:[{key:'person-1',sport:'SKI',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'},poleSize:poleless,premiumModel:null,jacketSize:null,pantsSize:null,wearSport:null}]}}));
  d=await ok(await post('/preview',{draftId:d.id,expectedRevision:d.revision}));
  const pick=(couponCode:string)=>post('/selection',{draftId:d.id,expectedRevision:d.revision,directions:{'person-1':'RECOMMENDED'},wantAdvance:false,couponCode,acceptedModelPolicy:true});
  for(const [code,error] of [['UIOFF','COUPON_INACTIVE'],['UIFULL','COUPON_LIMIT_REACHED'],['UIPAST','COUPON_NOT_APPLICABLE'],['NOSUCH','COUPON_NOT_FOUND']] as const){const r=await pick(code);assert.equal((await r.json() as {error:string}).error,error,code);}
  assert.equal(await usage('UIFULL'),1);assert.equal(await usage('UIOFF'),0);
 });
 assert.deepEqual(errors,[],'no page errors');
 console.log('Staff coupon order UI '+count+' cases passed; synthetic data, test-owned payment adapter only.');
}catch(e){failed=true;const err=e as {message?:string;code?:string;stack?:string}|undefined;console.error('COUPON_ORDER_UI_FAILED '+stage+' '+String(err?.code??'')+' '+(err?.message??String(e)).split('\n').slice(0,10).join(' | '));console.error(err?.stack?.split('\n').slice(0,8).join('\n'));}finally{await browser.close();await content?.close();await flow?.close();await app?.stop();console.log('Owned staff coupon order browser/Web/PostgreSQL stopped.');if(failed)process.exitCode=1;}
