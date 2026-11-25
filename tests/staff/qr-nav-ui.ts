import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../recommendation/fixture';
import {requestFor,variants} from '../inventory/fixture';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';

// P0-QR navigation: the QR scan entry is always visible in the shared shell (desktop top bar + sidebar, one tap on a
// phone) for exactly the staff who may use /staff/scan, and each work screen links to it. No physical camera is used.
// Screenshots go to .local/evidence/qr-nav (not committed).
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/qr-nav';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built:process.argv.includes('--built'),operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'qrnav-root@example.invalid',displayName:'SYNTHETIC QR Root',password}),rootP=(await loadStaff(db.pool,root))!;
 await seedRecommendation(db.pool);
 const seed=await db.pool.connect();try{await seed.query('BEGIN');await seed.query("SELECT set_config('zao.actor','synthetic-qrnav',true),set_config('zao.reason','SYNTHETIC qr nav fixture',true)");
  await seed.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),id,family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC qrnav','SYNTHETIC','tests/staff/qr-nav-ui.ts','qrnav-'||id FROM ledger_variants WHERE id=$1`,[variants.ski]);await seed.query('COMMIT');
 }catch(e){await seed.query('ROLLBACK');throw e;}finally{seed.release();}
 const mk=(email:string,role:'ADMIN'|'STAFF'|'VIEWER',permissions:Record<string,boolean>)=>writeAccount(app!.roles.authPool,rootP,undefined,{active:true,role,password,email,displayName:'SYNTHETIC '+email,scope:'ALL',storeIds:[],permissions});
 const full=(await mk('qrnav-admin@example.invalid','ADMIN',{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true})).id!;
 await mk('qrnav-staff@example.invalid','STAFF',{BOOKING_VIEW:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:false});
 await mk('qrnav-viewer@example.invalid','VIEWER',{BOOKING_VIEW:true,INVENTORY_VIEW:false});
 await mk('qrnav-inv@example.invalid','STAFF',{BOOKING_VIEW:false,INVENTORY_VIEW:true});
 await mk('qrnav-none@example.invalid','VIEWER',{BOOKING_VIEW:false,INVENTORY_VIEW:false,QUOTE_VIEW:true});
 const now=new Date('2035-06-16T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 async function login(email:string,width=1440,height=900){const ctx=await browser.newContext({baseURL:origin,viewport:{width,height}}),p=await ctx.newPage();await p.goto('/staff/login');
  await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();
  await p.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};}
 const admin=await login('qrnav-admin@example.invalid');
 const principal=(await loadStaff(db.pool,full))!;
 const holds=new HoldService(app.roles.holdPool,principal,()=>now),quotes=new QuoteService(app.roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2032-01-01','2038-12-31');flow=await provisionFlowRole(db.pool,db.identity);
 const sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[full])).rows[0].id as string;
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,app.roles.authPool,{subject:full,sessionId},fake,simulation);
 const conditions=requestFor('2035-06-16',[variants.ski]),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
 const booking=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC QR Nav',email:'synthetic-qrnav-guest@example.invalid',termsAccepted:true});
 await recordSyntheticBookingProfile(db.pool,booking.id);fake.status='COMPLETED';await bookings.startPayment(booking.id,randomUUID());
 const bid=booking.id;

 const topScan=(p:Page,name:RegExp)=>p.locator('header.sx-top').getByRole('link',{name});
 const noOverflow=async(p:Page)=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'horizontal scroll');
 async function reach(p:Page,path:string,link:RegExp){
  await p.goto(path);const l=p.locator('main').getByRole('link',{name:link}).first();await l.waitFor();await l.click();await p.waitForURL(u=>u.pathname==='/staff/scan');
 }

 await check('desktop 1440: QR button in the top bar and in the sidebar main group, on every main screen (ja)',async()=>{
  const p=admin.p;for(const path of ['/staff','/staff/orders','/staff/orders/'+bid,'/staff/today','/staff/rentals','/staff/calendar','/staff/settings']){
   await p.goto(path);await topScan(p,/QR/).waitFor();
   const side=p.getByRole('complementary').getByRole('link',{name:'QR読取'});assert.equal(await side.count(),1,path);
   // The sidebar entry sits in the first (primary) group, above 予約.
   const labels=(await p.getByRole('complementary').getByRole('link').allInnerTexts()).map(s=>s.trim());
   assert.ok(labels.indexOf('QR読取')<labels.indexOf('予約'),path+' primary position');}
  await admin.p.goto('/staff');await topScan(admin.p,/QR/).click();await admin.p.waitForURL(u=>u.pathname==='/staff/scan');
  assert.equal(await topScan(admin.p,/QR/).getAttribute('aria-current'),'page');
  await admin.p.screenshot({path:`${shots}/scan-ja-1440.png`});await noOverflow(admin.p);
 });
 await check('each work screen links to the scan page with wording that names booking and item QR',async()=>{
  const p=admin.p;
  await reach(p,'/staff/orders',/予約QRを読み取る/);
  await reach(p,'/staff/orders/'+bid,/予約QR・用品QR/);
  await reach(p,'/staff',/予約QR・用品QR/);
  await reach(p,'/staff/today',/予約QR・用品QR/);
  await p.goto('/staff/rentals');await p.getByRole('link',{name:/予約QR・用品QRを読み取る/}).click();await p.waitForURL(u=>u.pathname==='/staff/scan');
 });
 await check('English labels (desktop)',async()=>{
  const p=admin.p;await p.goto('/staff');await p.getByRole('button',{name:'English'}).click();await p.getByRole('region',{name:/Going out/}).waitFor();
  await topScan(p,/Scan QR/).waitFor();assert.equal(await p.getByRole('complementary').getByRole('link',{name:'Scan QR'}).count(),1);
  await reach(p,'/staff/orders',/Scan a booking QR/);await reach(p,'/staff/orders/'+bid,/Scan booking or item QR/);
  await p.goto('/staff/rentals');await p.getByRole('link',{name:/Scan booking or item QR/}).click();await p.waitForURL(u=>u.pathname==='/staff/scan');
  await p.screenshot({path:`${shots}/scan-en-1440.png`});await p.goto('/staff');await p.getByRole('button',{name:'日本語'}).click();await p.getByRole('region',{name:/貸出予定/}).waitFor();
 });
 await check('phone 390: one tap from the top bar without opening the menu, no horizontal scroll (ja and en)',async()=>{
  const m=await login('qrnav-admin@example.invalid',390,844);const p=m.p;
  for(const path of ['/staff','/staff/orders','/staff/orders/'+bid,'/staff/today','/staff/rentals']){
   await p.goto(path);const b=topScan(p,/QR/);await b.waitFor();assert.ok(await b.isVisible());
   const box=(await b.boundingBox())!;assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=390,path+' fits and is a 44px target');await noOverflow(p);}
  await p.goto('/staff');await p.screenshot({path:`${shots}/top-ja-390.png`});
  await topScan(p,/QR/).click();await p.waitForURL(u=>u.pathname==='/staff/scan');await noOverflow(p);
  await p.getByRole('button',{name:'English'}).click();await topScan(p,/Scan QR/).waitFor();await noOverflow(p);await p.screenshot({path:`${shots}/top-en-390.png`});
  await p.getByRole('button',{name:'Menu'}).click();await p.getByRole('complementary').getByRole('link',{name:'Scan QR'}).waitFor();
  await m.ctx.close();
 });
 await check('permissions: booking-only and inventory-only staff see it; staff without either do not (URL access stays guarded)',async()=>{
  for(const email of ['qrnav-staff@example.invalid','qrnav-viewer@example.invalid','qrnav-inv@example.invalid']){
   const s=await login(email);await s.p.goto('/staff/today');await topScan(s.p,/QR/).waitFor();
   assert.equal(await s.p.getByRole('complementary').getByRole('link',{name:'QR読取'}).count(),1,email);
   await topScan(s.p,/QR/).click();await s.p.waitForURL(u=>u.pathname==='/staff/scan');
   assert.equal(await s.p.getByText('閲覧権限が必要です').count(),0,email+' reaches the scan page');await s.ctx.close();}
  const none=await login('qrnav-none@example.invalid');
  for(const path of ['/staff','/staff/quotes','/staff/settings']){await none.p.goto(path);await none.p.locator('header.sx-top').waitFor();
   assert.equal(await none.p.locator('a[href="/staff/scan"]').count(),0,path+' shows no scan link');}
  await none.p.goto('/staff/scan');await none.p.getByRole('heading',{name:'閲覧権限が必要です'}).waitFor();await none.ctx.close();
 });
 await admin.ctx.close();
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,physicalCamera:'NOT_RUN',externalRequests:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,700)}));}
finally{await browser.close();await flow?.close();await app?.stop();}
if(failed)process.exitCode=1;
