import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {chromium,type BrowserContext,type Page} from '@playwright/test';
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
import {storeName} from '../../apps/web/src/components/guest-format';

// P0-QR E2E proof: REAL QR images are rendered on a canvas, exposed to the page as a synthetic camera (getUserMedia replaced by
// canvas.captureStream), and decoded by the page's own jsQR loop. The decoded value then travels through the real lookup APIs to
// the real screens. Nothing is injected as an id. Synthetic PostgreSQL / synthetic bookings and items only. A real phone camera
// and real printed labels are NOT exercised here (PHYSICAL_CAMERA: NOT_RUN). Screenshots go to .local/evidence/qr-e2e (not committed).
const contexts:BrowserContext[]=[];
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/qr-e2e';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}

const CAMERA=`(()=>{const md=navigator.mediaDevices;if(!md)return;const cam={requests:0,mode:'ok',streams:[],canvases:[],current:null,timer:0,orig:null};window.__cam=cam;
 const getUserMedia=async()=>{cam.requests++;if(cam.mode==='deny')throw new DOMException('denied','NotAllowedError');if(cam.mode==='nocamera')throw new DOMException('none','NotFoundError');
  const c=document.createElement('canvas');c.width=360;c.height=360;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,360,360);const s=c.captureStream(0);cam.streams.push(s);cam.canvases.push(c);return s;};
 Object.defineProperty(md,'getUserMedia',{configurable:true,writable:true,value:getUserMedia});
 const paint=async()=>{const c=cam.canvases[cam.canvases.length-1],s=cam.streams[cam.streams.length-1];if(!c||!cam.current)return;const img=new Image();img.src=cam.current;await img.decode();c.getContext('2d').drawImage(img,0,0,360,360);s.getVideoTracks()[0].requestFrame();};
 cam.show=(data)=>{cam.current=data;clearInterval(cam.timer);if(data)cam.timer=setInterval(()=>{void paint();},400);};
 cam.states=()=>cam.streams.map(s=>s.getTracks().map(t=>t.readyState).join('+'));
 cam.live=()=>cam.streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length;
 cam.support=(on)=>{Object.defineProperty(md,'getUserMedia',{configurable:true,writable:true,value:on?getUserMedia:undefined});};})();`;

const qr=(text:string)=>QRCode.toDataURL(text,{width:360,margin:4});

try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built:process.argv.includes('--built'),operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'qre2e-root@example.invalid',displayName:'SYNTHETIC QR E2E Root',password}),rootP=(await loadStaff(db.pool,root))!;
 await seedRecommendation(db.pool);
 const seedAsset=async(store:'MOUNTAIN_BASE'|'ONSEN_BASE',tag:string)=>{const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-qre2e',true),set_config('zao.reason','SYNTHETIC qr e2e fixture',true)");
  const r=await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),id,family,$2,$2,'AVAILABLE','NOT_APPLICABLE','','SYNTHETIC qre2e','SYNTHETIC','tests/staff/qr-e2e-ui.ts',$3||'-'||gen_random_uuid() FROM ledger_variants WHERE id=$1 RETURNING id`,[variants.ski,store,tag]);await c.query('COMMIT');return r.rows[0].id as string;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const mountainItem=await seedAsset('MOUNTAIN_BASE','mtn'),foreignItem=await seedAsset('ONSEN_BASE','onsen');
 const modelId=(await db.pool.query('SELECT model_id FROM ledger_variants WHERE id=$1',[variants.ski])).rows[0].model_id as string;
 const mk=(email:string,role:'ADMIN'|'STAFF'|'VIEWER',permissions:Record<string,boolean>,scope:'ALL'|'ASSIGNED'='ALL')=>writeAccount(app!.roles.authPool,rootP,undefined,{active:true,role,password,email,displayName:'SYNTHETIC '+email,scope,storeIds:scope==='ALL'?[]:['MOUNTAIN_BASE'],permissions});
 const full=(await mk('qre2e-admin@example.invalid','ADMIN',{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true})).id!;
 await mk('qre2e-staff@example.invalid','STAFF',{BOOKING_VIEW:true,INVENTORY_VIEW:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true},'ASSIGNED');
 await mk('qre2e-viewer@example.invalid','VIEWER',{BOOKING_VIEW:true,INVENTORY_VIEW:false});
 await mk('qre2e-inv@example.invalid','STAFF',{BOOKING_VIEW:false,INVENTORY_VIEW:true},'ASSIGNED');
 await mk('qre2e-none@example.invalid','VIEWER',{BOOKING_VIEW:false,INVENTORY_VIEW:false,QUOTE_VIEW:true});
 const now=new Date('2035-06-16T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);

 // Every request of every context: nothing may leave the app origin, and the camera image must never be posted anywhere.
 
 const reqs:{url:string;method:string;body:string|null}[]=[];
 async function login(email:string,width=1440,height=900){const ctx=await browser.newContext({baseURL:origin,viewport:{width,height}});contexts.push(ctx);
  ctx.on('request',r=>{reqs.push({url:r.url(),method:r.method(),body:r.method()==='GET'?null:(r.postData()??'').slice(0,4000)});});
  await ctx.addInitScript({content:CAMERA});const p=await ctx.newPage();await p.goto('/staff/login');
  await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();
  await p.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};}
 const mark=()=>reqs.length;
 const postsSince=(m:number)=>reqs.slice(m).filter(r=>r.method!=='GET'&&r.method!=='HEAD');
 const apiSince=(m:number)=>reqs.slice(m).filter(r=>new URL(r.url).pathname.startsWith('/api/operations/'));
 const noOverflow=async(p:Page)=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'horizontal scroll');
 const show=async(p:Page,text:string|null)=>{const d=text===null?null:await qr(text);await p.evaluate(x=>(window as unknown as {__cam:{show:(d:string|null)=>void}}).__cam.show(x),d);};
 const cam=<T,>(p:Page,fn:string)=>p.evaluate(`window.__cam.${fn}`) as Promise<T>;
 const bookingRows=async()=>(await db.pool.query("SELECT (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM rental_bookings r) b,(SELECT count(*)::int FROM rental_loan_items) l,(SELECT count(*)::int FROM rental_receipts) c")).rows[0] as {b:string;l:number;c:number};

 const principal=(await loadStaff(db.pool,full))!;
 const holds=new HoldService(app.roles.holdPool,principal,()=>now),quotes=new QuoteService(app.roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2032-01-01','2038-12-31');flow=await provisionFlowRole(db.pool,db.identity);
 const sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[full])).rows[0]?.id as string|undefined;
 const admin=await login('qre2e-admin@example.invalid');
 const sid=sessionId??(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[full])).rows[0].id as string;
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,app.roles.authPool,{subject:full,sessionId:sid},fake,simulation);
 async function makeBooking(name:string,date:string){const conditions=requestFor(date,[variants.ski]),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const b=await bookings.create(randomUUID(),q.id,{displayName:name,email:'synthetic-qre2e-guest@example.invalid',termsAccepted:true});await recordSyntheticBookingProfile(db.pool,b.id);fake.status='COMPLETED';await bookings.startPayment(b.id,randomUUID());return b.id;}
 const A=await makeBooking('SYNTHETIC QR E2E A','2035-06-16'),B=await makeBooking('SYNTHETIC QR E2E B','2035-06-17'),C0=await makeBooking('SYNTHETIC QR E2E C','2035-06-18');
 // Force a shared 8-character prefix between B and C (a real collision is astronomically rare), keeping B's id valid.
 const base=B.slice(0,8),C=base+'-0000-4000-8000-000000000001';
 {const c=await db.pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await c.query('UPDATE rental_bookings SET id=$2 WHERE id=$1',[C0,C]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const refA=A.slice(0,8).toUpperCase(),refBC=base.toUpperCase();
 assert.notEqual(A.slice(0,8),base);
 // Clear the previous picture first so a freshly opened camera can never decode the old code.
 const resCamera=async(p:Page,name:RegExp|string)=>{await p.evaluate('window.__cam.show(null)');await p.getByRole('button',{name}).click();};

 await check('QR-a: a real customer reservation QR image, decoded from the camera, opens that reservation; nothing is confirmed by reading',async()=>{
  const p=admin.p;await p.goto('/staff/scan');const before=await bookingRows(),m=mark();
  await resCamera(p,'カメラで読み取る');await p.locator('video[aria-label="予約QRカメラ"]').waitFor({state:'visible'});assert.equal(await cam<number>(p,'live()'),1);
  await show(p,'zao-rental:reservation:'+A);
  await p.waitForURL(u=>u.pathname==='/staff/orders/'+A,{timeout:30000});await p.getByText('SYNTHETIC QR E2E A').first().waitFor();
  await show(p,null);assert.equal(await cam<number>(p,'live()'),0,'camera stopped once the reservation opened');
  assert.deepEqual(await bookingRows(),before,'reading changed no booking, loan or receipt');
  assert.deepEqual(postsSince(m),[],'no POST at all while scanning and opening');
  await p.screenshot({path:`${shots}/a-order-ja-1440.png`});
 });

 await check('QR-b: typed display number opens a unique booking; a forced multi-match lists candidates and opens only after a person chooses',async()=>{
  const p=admin.p;await p.goto('/staff/scan');const before=await bookingRows();
  await p.getByLabel('予約番号または予約QR').fill('#'+refA);await p.getByRole('button',{name:'この予約を開く'}).click();await p.waitForURL(u=>u.pathname==='/staff/orders/'+A);
  await p.goto('/staff/scan');await p.getByLabel('予約番号または予約QR').fill('#'+refBC);await p.getByRole('button',{name:'この予約を開く'}).click();
  const list=p.locator('ul[aria-label="候補の予約"]');await list.waitFor();assert.equal(await list.locator('li').count(),2);
  await p.waitForTimeout(1500);assert.equal(new URL(p.url()).pathname,'/staff/scan','nothing opens before a person chooses');
  assert.equal(await list.getByRole('button',{name:'この予約を選ぶ'}).count(),2);await p.screenshot({path:`${shots}/b-candidates-ja-1440.png`});
  await list.locator('li',{hasText:'SYNTHETIC QR E2E B'}).getByRole('button',{name:'この予約を選ぶ'}).click();await p.waitForURL(u=>u.pathname==='/staff/orders/'+B);
  assert.equal((await bookingRows()).b.length>0,true);assert.equal((await bookingRows()).l,before.l);
 });

 await check('QR-c: item QR (real image) opens the product at its current station; wrong kinds and arbitrary URLs are only explained',async()=>{
  const p=admin.p;await p.goto('/staff/scan');await p.getByRole('tab',{name:'用品'}).click();const m0=mark();
  // Booking QR on the item tab: explained, not opened (camera keeps running, no lookup request).
  await resCamera(p,'カメラを開く');await show(p,'zao-rental:reservation:'+A);await p.getByText('これは予約のQRです。「予約」タブで読み取ってください。').waitFor();
  assert.equal(new URL(p.url()).pathname,'/staff/scan');assert.deepEqual(apiSince(m0).filter(r=>!/\/api\/operations\/(me|inbox)/.test(r.url)),[],'a booking QR on the item tab sends no lookup');
  // Arbitrary URL QR: unsupported, never opened and never fetched.
  const m1=mark();await show(p,'https://evil.example/open?id='+mountainItem);await p.getByText('対応していないコードです。用品の個体IDのQRを読み取ってください。').waitFor();await p.waitForTimeout(800);
  assert.equal(reqs.slice(m1).some(r=>r.url.includes('evil.example')),false,'the URL is never requested');assert.equal(new URL(p.url()).pathname,'/staff/scan');
  // Bare booking UUID: told apart from an item.
  await show(p,A);await p.getByRole('alert').filter({hasText:'これは予約のQRまたは予約IDです'}).waitFor();
  // Nonexistent item.
  assert.equal(await cam<number>(p,'live()'),0,'an id-shaped code ends the read');await resCamera(p,'カメラを開く');await show(p,randomUUID());await p.getByRole('alert').filter({hasText:'見つからない'}).waitFor();assert.equal(new URL(p.url()).pathname,'/staff/scan');
  // The real item: product page at its current station.
  await resCamera(p,'カメラを開く');await show(p,mountainItem);await p.waitForURL(u=>u.pathname==='/staff/inventory/'+modelId&&u.searchParams.get('store')==='MOUNTAIN_BASE',{timeout:30000});
  await p.getByText(storeName(true,'MOUNTAIN_BASE')).first().waitFor();await show(p,null);assert.equal(await cam<number>(p,'live()'),0);
  await p.screenshot({path:`${shots}/c-item-ja-1440.png`});
  // Item QR on the booking tab: explained.
  await p.goto('/staff/scan');await resCamera(p,'カメラで読み取る');await show(p,mountainItem);await p.getByText('これは用品のQRです。「用品」タブで読み取ってください。').waitFor();assert.equal(new URL(p.url()).pathname,'/staff/scan');
  // Unsupported URL on the booking tab.
  await resCamera(p,'もう一度読み取る');const m2=mark();await show(p,'https://evil.example/booking/'+A);await p.getByText('対応していないコードです。').waitFor();await p.waitForTimeout(500);
  assert.equal(reqs.slice(m2).some(r=>r.url.includes('evil.example')),false);assert.deepEqual(apiSince(m2).filter(r=>r.url.includes('/orders/')),[],'no order lookup for an unsupported code');
  await show(p,null);
 });

 await check('QR-c2: another station\'s item is refused for station-scoped staff, and the same staff open their own item',async()=>{
  const s=await login('qre2e-staff@example.invalid');const p=s.p;await p.goto('/staff/scan');await p.getByRole('tab',{name:'用品'}).click();
  await resCamera(p,'カメラを開く');await show(p,foreignItem);await p.getByRole('alert').filter({hasText:'見つからない'}).waitFor();assert.equal(new URL(p.url()).pathname,'/staff/scan');
  assert.equal(await cam<number>(p,'live()'),0,'a refused item still stops the camera (stopAfterRead)');
  await resCamera(p,'カメラを開く');await show(p,mountainItem);await p.waitForURL(u=>u.pathname==='/staff/inventory/'+modelId&&u.searchParams.get('store')==='MOUNTAIN_BASE',{timeout:30000});await show(p,null);
 });

 await check('QR-d: pickups and returns screen: a reservation QR payload finds the booking and item; the camera adds a return candidate once; nothing is confirmed by reading',async()=>{
  const p=admin.p;await p.goto('/staff/rentals');const before=await bookingRows();
  await p.getByLabel('予約番号または予約QR').fill('zao-rental:reservation:'+A);await p.getByRole('button',{name:'予約と用品を確認'}).click();
  await p.getByRole('region',{name:'貸出用品'}).getByText(refA,{exact:false}).first().waitFor();
  assert.deepEqual(await bookingRows(),before,'looking up the booking confirms nothing');
  await p.getByRole('button',{name:'この店舗で返却受付を開始'}).click();await p.getByRole('region',{name:'返却受付'}).waitFor();const bid=await p.getByLabel('返却処理番号').inputValue();
  const m=mark();await resCamera(p,'カメラを開く');await show(p,mountainItem);
  await p.waitForFunction(()=>true);
  for(let i=0;i<60;i++){if(reqs.slice(m).some(r=>r.method==='POST'&&new URL(r.url).pathname==='/api/custody/scan'))break;await p.waitForTimeout(250);}
  await p.waitForTimeout(1500);
  const scans=reqs.slice(m).filter(r=>r.method==='POST'&&new URL(r.url).pathname==='/api/custody/scan');
  assert.equal(scans.length,1,'the same label held in view is sent once (consecutive duplicates are dropped)');
  assert.ok(!scans[0]!.body!.includes('data:image'),'only the decoded id is posted, never camera pixels');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM rental_return_candidates WHERE batch_id=$1',[bid])).rows[0].n,1);
  const after=await bookingRows();assert.equal(after.c,before.c,'no receipt from reading');assert.equal(after.l,before.l);assert.equal(after.b,before.b);
  await show(p,null);await p.getByRole('button',{name:'カメラを止める'}).click();assert.equal(await cam<number>(p,'live()'),0);
  await p.screenshot({path:`${shots}/d-returns-ja-1440.png`});
 });

 await check('QR-e: camera denied / absent / unsupported and a cut connection fall back to typing; tracks end on result, stop, tab switch and leaving the page',async()=>{
  const p=admin.p;await p.goto('/staff/scan');
  await p.evaluate("window.__cam.mode='deny'");await resCamera(p,'カメラで読み取る');await p.getByText('カメラの許可がありません。予約番号を手入力できます。').waitFor();
  await p.evaluate("window.__cam.mode='nocamera'");await resCamera(p,'カメラで読み取る');await p.getByText('カメラが見つかりません。予約番号を手入力できます。').waitFor();
  await p.evaluate("window.__cam.support(false)");await resCamera(p,'カメラで読み取る');await p.getByText('このブラウザ・接続ではカメラを使えません').waitFor();
  await p.evaluate("window.__cam.support(true);window.__cam.mode='ok'");
  // The typing fallback still works after each failure.
  await p.getByLabel('予約番号または予約QR').fill('#'+refA);await p.getByRole('button',{name:'この予約を開く'}).click();await p.waitForURL(u=>u.pathname==='/staff/orders/'+A);
  // Connection cut during lookup.
  await p.goto('/staff/scan');await p.route('**/api/operations/orders/lookup*',r=>r.abort('failed'));
  await p.getByLabel('予約番号または予約QR').fill('#'+refA);await p.getByRole('button',{name:'この予約を開く'}).click();await p.getByText('通信できませんでした。').waitFor();await p.unroute('**/api/operations/orders/lookup*');
  assert.equal(new URL(p.url()).pathname,'/staff/scan');
  // Stop button.
  await resCamera(p,'カメラで読み取る');await p.locator('video[aria-label="予約QRカメラ"]').waitFor({state:'visible'});assert.ok(await cam<number>(p,'live()')>=1);
  await p.getByRole('button',{name:'カメラを止める'}).click();assert.equal(await cam<number>(p,'live()'),0,'stopped by the button');
  // Tab switch (unmount).
  await resCamera(p,'カメラで読み取る');await p.locator('video[aria-label="予約QRカメラ"]').waitFor({state:'visible'});assert.ok(await cam<number>(p,'live()')>=1);
  await p.getByRole('tab',{name:'用品'}).click();await p.waitForTimeout(300);assert.equal(await cam<number>(p,'live()'),0,'stopped by switching tab');
  // Leaving the page.
  await resCamera(p,'カメラを開く');await p.locator('video[aria-label="用品QRカメラ"]').waitFor({state:'visible'});assert.ok(await cam<number>(p,'live()')>=1);
  await p.getByRole('link',{name:'ダッシュボード'}).first().click();await p.waitForURL(u=>u.pathname==='/staff');await p.waitForTimeout(300);assert.equal(await cam<number>(p,'live()'),0,'stopped by leaving the page');
  // Scan again after a result.
  await p.goto('/staff/scan');await resCamera(p,'カメラで読み取る');await show(p,'zao-rental:reservation:'+B);await p.waitForURL(u=>u.pathname==='/staff/orders/'+B);await show(p,null);
  await p.goto('/staff/scan');await resCamera(p,'カメラで読み取る');await show(p,mountainItem);await p.getByRole('button',{name:'もう一度読み取る'}).waitFor();
  assert.equal(await cam<number>(p,'live()'),0,'result shown, camera ended');await resCamera(p,'もう一度読み取る');await p.locator('video[aria-label="予約QRカメラ"]').waitFor({state:'visible'});
  await show(p,'zao-rental:reservation:'+A);await p.waitForURL(u=>u.pathname==='/staff/orders/'+A);await show(p,null);
  // The item tab's own camera denial text.
  await p.goto('/staff/scan');await p.getByRole('tab',{name:'用品'}).click();await p.evaluate("window.__cam.mode='deny'");await resCamera(p,'カメラを開く');await p.getByText('カメラの許可がありません。設定を確認するか個体IDを手入力してください。').waitFor();
  await p.evaluate("window.__cam.mode='ok'");await p.getByLabel('用品の個体ID').fill(mountainItem);await p.getByRole('button',{name:'入力したIDを照合へ送る'}).click();await p.waitForURL(u=>u.pathname==='/staff/inventory/'+modelId);
 });

 await check('QR-f: permissions: viewer (booking only) and inventory-only staff get just their tab; no permission has no button and a permission notice',async()=>{
  const v=await login('qre2e-viewer@example.invalid');await v.p.goto('/staff/scan');assert.equal(await v.p.getByRole('tab',{name:'用品'}).count(),0);
  await resCamera(v.p,'カメラで読み取る');await show(v.p,'zao-rental:reservation:'+A);await v.p.waitForURL(u=>u.pathname==='/staff/orders/'+A);await show(v.p,null);
  const i=await login('qre2e-inv@example.invalid');await i.p.goto('/staff/scan');assert.equal(await i.p.getByRole('tab',{name:'予約'}).count(),0);
  await resCamera(i.p,'カメラを開く');await show(i.p,mountainItem);await i.p.waitForURL(u=>u.pathname==='/staff/inventory/'+modelId,{timeout:30000});await show(i.p,null);
  const n=await login('qre2e-none@example.invalid');await n.p.goto('/staff');await n.p.locator('header.sx-top').waitFor();assert.equal(await n.p.locator('a[href="/staff/scan"]').count(),0);
  await n.p.goto('/staff/scan');await n.p.getByRole('heading',{name:'閲覧権限が必要です'}).waitFor();assert.equal(await n.p.getByRole('button',{name:'カメラで読み取る'}).count(),0);
  // Admin and staff see the QR button in the top bar on a main screen.
  await admin.p.goto('/staff');assert.ok(await admin.p.locator('header.sx-top').getByRole('link',{name:/QR/}).isVisible());
 });

 await check('QR-f2: English UI at desktop 1440 and phone 390 (reservation and item, camera to screen), no horizontal scroll',async()=>{
  for(const [w,h] of [[1440,900],[390,844]] as const){
   const s=await login('qre2e-admin@example.invalid',w,h);const p=s.p;await p.goto('/staff/scan');await p.getByRole('button',{name:'English'}).click();
   await p.getByRole('heading',{name:'Scan QR',exact:true}).waitFor();await noOverflow(p);
   await p.getByRole('button',{name:'Scan with camera'}).click();await p.locator('video[aria-label="Booking QR camera"]').waitFor({state:'visible'});await noOverflow(p);await p.screenshot({path:`${shots}/f-scan-camera-en-${w}.png`});
   await show(p,'zao-rental:reservation:'+A);await p.waitForURL(u=>u.pathname==='/staff/orders/'+A);await show(p,null);
   await p.goto('/staff/scan');await p.getByLabel('Booking number or booking QR').fill('#'+refBC);await p.getByRole('button',{name:'Open this booking'}).click();
   await p.locator('ul[aria-label="Candidate bookings"]').waitFor();await p.getByRole('button',{name:'Choose this booking'}).first().waitFor();await noOverflow(p);await p.screenshot({path:`${shots}/f-candidates-en-${w}.png`});
   await p.goto('/staff/scan');await p.getByRole('tab',{name:'Item'}).click();await p.getByRole('button',{name:'Open camera'}).click();await show(p,'zao-rental:reservation:'+A);
   await p.getByText('This is a booking QR. Scan it on the Booking tab.').waitFor();await show(p,mountainItem);await p.waitForURL(u=>u.pathname==='/staff/inventory/'+modelId,{timeout:30000});await show(p,null);await noOverflow(p);
   await p.goto('/staff/scan');await p.getByRole('button',{name:'Scan with camera'}).click();await p.evaluate("window.__cam.mode='deny'");await p.getByRole('button',{name:'Stop camera'}).click();
   await p.getByRole('button',{name:'Scan with camera'}).click();await p.getByText('Camera permission was denied. You can type the booking number.').waitFor();await noOverflow(p);
  }
 });

 await check('QR-g: no request left the app origin; no camera image or decoded content went anywhere but the lookup URLs; bookings never posted',async()=>{
  const outside=reqs.filter(r=>{const u=new URL(r.url);return !(u.origin===origin||u.protocol==='data:'||u.protocol==='blob:'||u.protocol==='about:');});
  assert.deepEqual(outside.map(r=>r.url),[],'requests outside the app origin');
  const posts=reqs.filter(r=>r.method!=='GET'&&r.method!=='HEAD');
  for(const r of posts){const path=new URL(r.url).pathname;assert.ok(!/^data:image|iVBOR/.test(r.body??'')&&!(r.body??'').includes('data:image'),'camera pixels in POST '+path);
   assert.ok(/^\/api\/(auth|custody)\//.test(path)||path.startsWith('/staff/')||path.startsWith('/api/staff'),'unexpected POST '+r.method+' '+path);}
  assert.equal(reqs.some(r=>r.url.includes('evil.example')),false);
 });

 await check('QR-h: the QR images used decode back to synthetic data only (no real reservation or customer information)',async()=>{
  const p=admin.p;await p.goto('/staff/scan');
  const decode=async(text:string)=>{const d=await qr(text);const px=await p.evaluate(async data=>{const i=new Image();i.src=data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d')!;x.drawImage(i,0,0);const g=x.getImageData(0,0,c.width,c.height);return {w:g.width,h:g.height,data:Array.from(g.data)};},d);
   return jsQR(Uint8ClampedArray.from(px.data),px.w,px.h)?.data;};
  assert.equal(await decode('zao-rental:reservation:'+A),'zao-rental:reservation:'+A);assert.equal(await decode(mountainItem),mountainItem);
  const known=(await db.pool.query("SELECT id::text FROM rental_bookings UNION SELECT id::text FROM ledger_assets")).rows.map(r=>r.id as string);
  const synthetic=(await db.pool.query("SELECT count(*)::int n FROM rental_bookings WHERE id=ANY($1::uuid[]) AND 1=1",[[A,B,C]])).rows[0].n;assert.ok(synthetic>=2);
  for(const t of ['zao-rental:reservation:'+A,mountainItem,foreignItem]){const v=t.replace('zao-rental:reservation:','');assert.match(v,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);assert.ok(known.includes(v),'only ids created by this test');}
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM rental_bookings r WHERE to_jsonb(r)::text NOT LIKE '%SYNTHETIC%'")).rows[0].n,0,'every booking in this database is synthetic');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE notes NOT LIKE 'SYNTHETIC%' AND source_kind<>'SYNTHETIC'")).rows[0].n,0);
 });

 for(const c of contexts)await c.close().catch(()=>{});
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,physicalCamera:'NOT_RUN',externalRequests:0}));
}catch(e){failed=true;const pages=contexts.flatMap(c=>c.pages());const last=pages[pages.length-1];const info=last?await last.evaluate(()=>({path:location.pathname,status:document.querySelector('[role=status]')?.textContent,alert:document.querySelector('[role=alert]')?.textContent,cam:JSON.stringify((window as unknown as {__cam?:{states:()=>string[]}}).__cam?.states())})).catch(()=>null):null;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,900),page:info}));}
finally{await browser.close();await flow?.close();await app?.stop();}
if(failed)process.exitCode=1;
