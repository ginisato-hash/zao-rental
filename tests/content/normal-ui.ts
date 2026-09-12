import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {PrivatePhotoJobs} from '../../packages/core/src/content/photo-job';
import {preparePhotoDrafts} from '../../packages/core/src/content/media-plan';
import {PhotoFileFixture} from './photo-fixture';
import {PRICE_PRODUCTS,INITIAL_TABLE} from '../../packages/contracts/src/pricing';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {FileFixture,seedContentFixture,removeContentFixture} from './file-fixture';
let stage='start',failed=false,owned=false,count=0,app:Awaited<ReturnType<typeof startFlowApp>>|undefined,namespace:string|undefined;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 app=await startFlowApp({contentFixture:true});namespace=app.db.identity.namespace;const origin=app.origin;
 await bootstrapDevelopmentAdmin(app.db.pool,{email:'content-root@example.invalid',displayName:'SYNTHETIC Content Root',password});
 const subject=(await app.db.pool.query("SELECT id FROM staff_users WHERE email='content-root@example.invalid'")).rows[0].id;
 await seedContentFixture(namespace,subject);owned=true;const fixture=new FileFixture(namespace);
 async function ready(){for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('APP_START_TIMEOUT');}await ready();
 const context=await browser.newContext({baseURL:origin,viewport:{width:390,height:844}});context.setDefaultTimeout(15000);const p=await context.newPage();
 await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill('content-root@example.invalid');await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(origin+'/staff/ledger');
 const session=await context.request.get('/api/session');assert.equal(session.status(),200);const stamp=(await session.json()).stamp;
 const headers={origin,'x-zao-session':stamp};const body=(input:unknown)=>({requestKey:randomUUID(),input});
 await check('normal password authentication plus explicit synthetic CONTENT fixture grant, not role auto-publish',async()=>{
  await p.goto('/staff/content-fixture');await expect(p.getByRole('region',{name:'現在の下書き'})).toContainText('合成 SKI');
  const anon=await browser.newContext({baseURL:origin});assert.equal((await anon.request.get('/api/content-fixture')).status(),401);await anon.close();
  assert.equal((await context.request.get('/api/content-fixture')).status(),409);
  assert.equal((await context.request.post('/api/content-fixture/bulk-prepare',{headers:{'x-zao-session':stamp},data:body({csv:''})})).status(),403);
  assert.equal((await context.request.post('/api/content-fixture/bulk-prepare',{headers,data:{...body({csv:''}),actor:'forged'}})).status(),409);
 });
 const header='schema_version,offer_code,locale,expected_revision,field,operation,value\n';
 await check('CSV file dry-run, partial draft commit, lost HTTP response and reload recover original server job once',async()=>{
  await p.getByLabel('CSVファイル').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(header+'1,SKI,ja,1,summary,SET,SYNTHETIC NEW\n1,BOARD,ja,1,price,SET,5000')});
  await p.getByRole('button',{name:'差分を検証して保存',exact:true}).click();await expect(p.getByRole('button',{name:/^有効な下書きを反映/})).toHaveCount(1);assert.equal((await fixture.read()).state.catalog.revisions.length,2);
  await p.route('**/api/content-fixture/bulk-commit',async route=>{assert.equal((await route.fetch()).status(),200);await route.abort('failed');});await p.getByRole('button',{name:/^有効な下書きを反映/}).click();await expect(p.getByRole('button',{name:'同じ保存要求を照合'})).toBeVisible();
  await p.unroute('**/api/content-fixture/bulk-commit');await p.reload();await p.getByRole('button',{name:'同じ保存要求を照合'}).click();await expect(p.getByRole('status',{name:'説明処理状態'})).toContainText('一部の下書きを保存済み');
  const r=await fixture.read();assert.equal(r.state.catalog.revisions.length,3);assert.equal(r.state.catalog.draftIds['BOARD/ja'],'board-j1');assert.equal(r.state.catalog.current,null);assert.equal(r.state.audit.length,1);
  const stored=Object.entries(r.state.plans).find(([,v])=>v.kind==='BULK')!;assert.equal((await context.request.post('/api/content-fixture/bulk-commit',{headers,data:body({planId:stored[0],hash:stored[1].plan.hash})})).status(),200);assert.equal((await fixture.read()).state.catalog.revisions.length,3);
 });
 let firstRelease='';
 await check('private release persists current, audit and outbox through actual Web process restart; width fits',async()=>{
  await p.getByRole('button',{name:'下書き全体のreleaseを検証'}).click();const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/content-fixture/release-commit'&&r.request().method()==='POST');await p.getByRole('button',{name:/^非公開releaseへ反映/}).click();assert.equal((await response).status(),200);await expect(p.getByRole('status',{name:'説明処理状態'})).toContainText('保存済み');const r=await fixture.read();firstRelease=r.state.catalog.current!;assert.ok(firstRelease);assert.equal(r.state.outbox.length,1);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('.local/screenshots',{recursive:true});await p.screenshot({path:'.local/screenshots/content-fixture-mobile-width.png',fullPage:true});
  await p.close();const ids=await app!.restartWeb();assert.notEqual(ids.newPid,ids.oldPid);await ready();const back=await context.newPage();await back.goto('/staff/content-fixture');await expect(back.getByText('現在の非公開release '+firstRelease,{exact:true})).toBeVisible();assert.equal((await fixture.read()).state.outbox.length,1);await back.close();
 });
 await check('stale release/rights revocation rejects with pointer preserved; restore is a new private manifest',async()=>{
  const r=await fixture.read();const prepared=await context.request.post('/api/content-fixture/release-prepare',{headers,data:body({entries:Object.values(r.state.catalog.draftIds),expectedCurrent:firstRelease,restoreOf:null})});assert.equal(prepared.status(),200);const plan=await prepared.json();
  await fixture.edit(async d=>{d.state.catalog.media[0]!.rightsConfirmed=false;});assert.equal((await context.request.post('/api/content-fixture/release-commit',{headers,data:body({planId:plan.planId,hash:plan.hash})})).status(),409);assert.equal((await fixture.read()).state.catalog.current,firstRelease);
  await fixture.edit(async d=>{d.state.catalog.media[0]!.rightsConfirmed=true;});const restored=await context.request.post('/api/content-fixture/release-prepare',{headers,data:body({entries:[],expectedCurrent:firstRelease,restoreOf:firstRelease})});assert.equal(restored.status(),200);const rp=await restored.json();assert.equal((await context.request.post('/api/content-fixture/release-commit',{headers,data:body({planId:rp.planId,hash:rp.hash})})).status(),200);const after=await fixture.read();assert.notEqual(after.state.catalog.current,firstRelease);assert.equal(after.state.catalog.releases.length,2);assert.equal(after.state.outbox.length,2);
 });
 await check('50 selected synthetic photos survive interrupted upload, same-job resume and authenticated derivative display',async()=>{
  const pp=await context.newPage();await pp.goto('/staff/content-fixture');await expect(pp.getByRole('region',{name:'写真一括fixture'})).toBeVisible();
  const bytes=await sharp({create:{width:48,height:64,channels:3,background:{r:40,g:70,b:110}}}).png().toBuffer();const files=Array.from({length:50},(_,n)=>({name:n===49?'unmatched.png':n===48?'BOARD__SERVICE__01.png':`${n<24?'SKI':'BOARD'}__${n%24<12?'DETAIL':'LIFESTYLE'}__${String(n%12+1).padStart(2,'0')}.png`,mimeType:'image/png',buffer:bytes}));
  await pp.getByLabel('写真ファイル').setInputFiles(files);
  let entered!:()=>void,release!:()=>void;const atUpload=new Promise<void>(r=>entered=r),unblock=new Promise<void>(r=>release=r);await pp.route('**/api/photo-fixture/upload',async route=>{entered();await unblock;await route.abort('failed').catch(()=>{});});await pp.getByRole('button',{name:'選択した写真を送信・再開'}).click();await atUpload;await pp.getByRole('button',{name:'写真処理を中断',exact:true}).click();release();await expect(pp.getByRole('status',{name:'写真処理状態'})).toContainText('未確認または拒否');await pp.unroute('**/api/photo-fixture/upload');assert.ok(Object.values((await fixture.read()).photoJobs!).every(j=>j.items.every(i=>i.state==='PENDING')));
  await pp.route('**/api/photo-fixture/upload',async route=>{const d=route.request().postDataJSON();if(d.index===2){assert.equal((await route.fetch()).status(),200);await route.abort('failed');}else await route.continue();});await pp.getByRole('button',{name:'選択した写真を送信・再開'}).click();await expect(pp.getByRole('status',{name:'写真処理状態'})).toContainText('未確認または拒否');await pp.unroute('**/api/photo-fixture/upload');
  let r=await fixture.read();const ids=Object.keys(r.photoJobs!);assert.equal(ids.length,1);const jobId=ids[0]!;assert.equal(r.photoJobs![jobId]!.items.filter(i=>i.state==='READY').length,3);
  await pp.reload();await pp.getByRole('button',{name:'保存済み写真jobを照合'}).click();await expect(pp.getByRole('region',{name:'写真一括fixture'})).toContainText('変換済み 3');await pp.getByLabel('写真ファイル').setInputFiles(files);
  // Each file is an explicit sequential operation. Verify each normal response with
  // the existing per-operation timeout; do not impose expect's 5s on a 47-file job.
  const nextUpload=(index:number)=>pp.waitForResponse(r=>new URL(r.url()).pathname==='/api/photo-fixture/upload'&&r.request().postDataJSON().index===index);
  let pending=nextUpload(3);await pp.getByRole('button',{name:'選択した写真を送信・再開'}).click();
  for(let index=3;index<50;index++){const response=await pending;if(index<49)pending=nextUpload(index+1);assert.equal(response.status(),200);console.log('PHOTO_RESUME_ITEM '+index+' HTTP 200');}
  await expect(pp.getByRole('status',{name:'写真処理状態'})).toContainText('処理結果を保存');r=await fixture.read();assert.equal(Object.keys(r.photoJobs!).length,1);assert.equal(r.photoJobs![jobId]!.items.length,50);assert.equal(r.photoJobs![jobId]!.state,'READY');assert.equal(r.photoJobs![jobId]!.revision,51);assert.equal(r.photoJobs![jobId]!.items[49]!.candidate,null);assert.ok(r.photoJobs![jobId]!.items.every(i=>i.metadata!.rights==='UNVERIFIED'&&i.metadata!.publication==='DRAFT_ONLY'&&i.metadata!.derivatives.length===10));
  const image=await context.request.get('/api/photo-fixture/derivative?jobId='+jobId+'&index=0',{headers});assert.equal(image.status(),200);const meta=await sharp(await image.body()).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.ok(await pp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await pp.getByRole('region',{name:'写真一括fixture'}).screenshot({path:'.local/screenshots/photo-fixture-mobile-width.png'});
  assert.equal((await context.request.get('/api/photo-fixture/derivative?jobId='+jobId+'&index=0')).status(),409);await pp.close();
 });
 await check('authenticated photo HTTP accepts 9MiB transport to manifest validation and rejects malformed or oversized bytes',async()=>{
  const before=JSON.stringify((await fixture.read()).photoJobs),jobId=randomUUID();
  const send=(base64:string)=>context.request.post('/api/photo-fixture/upload',{headers,data:{jobId,index:0,base64}});
  const valid=await send(Buffer.alloc(9*1024*1024,17).toString('base64'));assert.equal(valid.status(),409);assert.equal((await valid.json()).error,'PHOTO_JOB_MISMATCH');
  const invalid=await send('YR==');assert.equal(invalid.status(),409);assert.equal((await invalid.json()).error,'PHOTO_REQUEST');
  const oversized=await send(Buffer.alloc(10*1024*1024+1).toString('base64'));assert.equal(oversized.status(),409);assert.equal((await oversized.json()).error,'PHOTO_SIZE');
  assert.equal(JSON.stringify((await fixture.read()).photoJobs),before);
 });
 await check('25MP synthetic photo gate returns retryable busy to concurrent authenticated HTTP and replays once',async()=>{
  const store=new PhotoFileFixture(namespace!),jobId=randomUUID(),photo=await sharp({create:{width:5000,height:5000,channels:3,background:'blue'}}).png().toBuffer();
  assert.ok(photo.length<10*1024*1024);const shape=await sharp(photo).metadata();assert.equal(shape.width!*shape.height!,25_000_000);
  let entered!:()=>void,release!:()=>void,decodes=0;const at=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const service=new PrivatePhotoJobs(store,{async assert(s){assert.equal(s,subject);}},async files=>{decodes++;const result=await preparePhotoDrafts(files);entered();await gate;return result;});
  const files=[{filename:'SKI__COVER__01.png',bytes:photo.length,sha256:createHash('sha256').update(photo).digest('hex')}];
  assert.equal((await context.request.post('/api/photo-fixture/prepare',{headers,data:{jobId,files}})).status(),200);
  const bp=await context.newPage();await bp.goto('/staff/content-fixture');await expect(bp.getByRole('region',{name:'写真一括fixture'})).toBeVisible();await bp.evaluate(v=>sessionStorage.setItem('zao-private-photo-job',JSON.stringify(v)),{stamp,jobId});
  const owner=service.upload(subject,jobId,0,photo);await at;
  try{
   const busy=await context.request.post('/api/photo-fixture/upload',{headers,data:{jobId,index:0,base64:photo.toString('base64')}});
   assert.equal(busy.status(),503);assert.equal((await busy.json()).error,'FIXTURE_LOCKED');assert.equal(busy.headers()['retry-after'],'1');
   const alsoBusy=await context.request.post('/api/content-fixture/bulk-prepare',{headers,data:body({csv:header+'1,BOARD,ja,1,summary,SET,busy'})});assert.equal(alsoBusy.status(),503);
   assert.equal((await fixture.read()).photoJobs![jobId]!.items[0]!.state,'PENDING');
   await bp.getByRole('button',{name:'保存済み写真jobを照合'}).click();await expect(bp.getByRole('status',{name:'写真処理状態'})).toContainText('別の写真・説明処理が実行中');
  }finally{release();await owner;}
  const replay=await context.request.post('/api/photo-fixture/upload',{headers,data:{jobId,index:0,base64:photo.toString('base64')}});assert.equal(replay.status(),200);assert.equal((await replay.json()).metadata.derivatives.length,10);
  await bp.getByRole('button',{name:'保存済み写真jobを照合'}).click();await expect(bp.getByRole('status',{name:'写真処理状態'})).toContainText('保存済み。未送信分は');await bp.close();
  const saved=(await fixture.read()).photoJobs![jobId]!;assert.equal(saved.revision,2);assert.equal(saved.items[0]!.state,'READY');assert.equal(decodes,1);assert.equal(saved.productionPublished,false);
  console.log('PHOTO_BOUNDARY '+JSON.stringify({inputPixels:25_000_000,inputBytes:photo.length,derivatives:10,gate:'test synchronization after real decode; not a latency benchmark',lockBudgetChanged:false}));
 });
 await check('real file transaction candidate follows intervening catalog commit; later offer removal preserves replay',async()=>{
  const store=new PhotoFileFixture(namespace!),jobId=randomUUID(),files=[{filename:'SYNTHETIC_NEW__COVER__01.png',bytes:1,sha256:'1'.repeat(64)}];
  let entered!:()=>void,release!:()=>void;const at=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const catalog=fixture.edit(async record=>{entered();await gate;record.state.catalog.commercialRevisions.SYNTHETIC_NEW='SYNTHETIC-TERMS1';});await at;
  const service=new PrivatePhotoJobs(store,{async assert(s){assert.equal(s,subject);}}),candidate=service.prepare(subject,jobId,files);release();await catalog;
  assert.equal((await candidate).items[0]!.candidate?.offerCode,'SYNTHETIC_NEW');
  const read=await context.request.get('/api/photo-fixture?jobId='+jobId,{headers});assert.equal(read.status(),200);assert.equal((await read.json()).items[0].candidate.offerCode,'SYNTHETIC_NEW');
  await fixture.edit(async record=>{delete record.state.catalog.commercialRevisions.SYNTHETIC_NEW;});
  const replay=await context.request.post('/api/photo-fixture/prepare',{headers,data:{jobId,files}});assert.equal(replay.status(),200);assert.equal((await replay.json()).items[0].candidate.offerCode,'SYNTHETIC_NEW');
 });
 await check('manufacturer source staging keeps sport/season/cell provenance, reimport is idempotent and never writes inventory',async()=>{
  const cp=await context.newPage();await cp.goto('/staff/content-fixture');const before=(await app!.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n;
  const rows=['SKI','SNOWBOARD'].map((sport,n)=>({sourceDocument:'SYNTHETIC last-year sheet',sourceLocator:'Inventory!A'+(n+2),brand:'SYNTHETIC',modelName:n?'Board Demo':'Ski Demo',sport,season:n?'2025/26':null,manufacturerSku:null,size:null,quantity:2,quantityUnit:'UNKNOWN',intent:'UNKNOWN'}));
  await cp.getByLabel('資料のJSONファイル').setInputFiles({name:'synthetic-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(rows))});const receive=cp.waitForResponse(r=>new URL(r.url()).pathname==='/api/content-fixture/catalog-prepare');await cp.getByRole('button',{name:'資料の行を照合して保存'}).click();assert.equal((await receive).status(),200);await expect(cp.getByRole('region',{name:'メーカー資料fixture'})).toContainText('保存済み照合行 2件');
  assert.equal((await context.request.post('/api/content-fixture/catalog-prepare',{headers,data:body({rows})})).status(),200);assert.equal(Object.keys((await fixture.read()).catalogSources!).length,2);assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n,before);
  const changed=structuredClone(rows);changed[0]!.quantity=3;assert.equal((await context.request.post('/api/content-fixture/catalog-prepare',{headers,data:body({rows:changed})})).status(),200);const staged=Object.values((await fixture.read()).catalogSources!);assert.equal(staged.length,3);assert.ok(staged.some(r=>r.issues.includes('SOURCE_CHANGED_RECONFIRM')));assert.ok(staged.every(r=>r.createsStock===false));await cp.close();
 });
 await check('18 approved equipment offer codes receive one bulk description update without price, release or inventory mutation',async()=>{
  assert.equal(PRICE_PRODUCTS.length,18);const oldPrices=JSON.stringify(INITIAL_TABLE),before=(await app!.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n;
  await fixture.edit(async r=>{for(const {key} of PRICE_PRODUCTS){const id='synthetic-content-'+key;r.state.catalog.draftIds[key+'/ja']=id;r.state.catalog.commercialRevisions[key]='SYNTHETIC-TERMS1';r.state.catalog.revisions.push({id,offerCode:key,locale:'ja',content:{title:key,summary:'old',fit_note:''},sourceRevision:null,translationApproved:true,mediaIds:['synthetic-image'],commercialRevision:'SYNTHETIC-TERMS1'});}});
  const current=(await fixture.read()).state.catalog.current,ep=await context.newPage();await ep.goto('/staff/content-fixture');await ep.getByLabel('CSVファイル').setInputFiles({name:'synthetic-18.csv',mimeType:'text/csv',buffer:Buffer.from(header+PRICE_PRODUCTS.map(p=>'1,'+p.key+',ja,1,summary,SET,SYNTHETIC description '+p.key).join('\n'))});await ep.getByRole('button',{name:'差分を検証して保存'}).click();const button=ep.getByRole('button',{name:/^有効な下書きを反映/});await expect(button).toHaveCount(1);const response=ep.waitForResponse(r=>new URL(r.url()).pathname==='/api/content-fixture/bulk-commit');await button.click();assert.equal((await response).status(),200);const after=await fixture.read();assert.equal(PRICE_PRODUCTS.filter(({key})=>after.state.catalog.revisions.find(r=>r.id===after.state.catalog.draftIds[key+'/ja'])!.content.summary.startsWith('SYNTHETIC description')).length,18);assert.equal(after.state.catalog.current,current);assert.equal(JSON.stringify(INITIAL_TABLE),oldPrices);assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM ledger_assets')).rows[0].n,before);await ep.close();
 });
 await check('CONTENT fixture revocation and real staff disable deny pending commits without persistent changes',async()=>{
  const request=body({csv:header+'1,BOARD,ja,1,summary,SET,denied'}),prep=await context.request.post('/api/content-fixture/bulk-prepare',{headers,data:request});assert.equal(prep.status(),200);const plan=await prep.json();const before=(await fixture.read()).state.catalog.revisions.length;
  await fixture.edit(async r=>{r.grants[subject]=['CONTENT_EDIT'];});assert.equal((await context.request.post('/api/content-fixture/bulk-commit',{headers,data:body({planId:plan.planId,hash:plan.hash})})).status(),403);assert.equal((await fixture.read()).state.catalog.revisions.length,before);
  const created=await context.request.post('/api/staff-users',{headers:{origin},data:{email:'content-manager@example.invalid',password,displayName:'SYNTHETIC Manager',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{}}});assert.equal(created.status(),201);
  const manager=await browser.newContext({baseURL:origin}),mp=await manager.newPage();await mp.goto('/staff/login');await mp.getByLabel('メールアドレス',{exact:true}).fill('content-manager@example.invalid');await mp.getByLabel('パスワード',{exact:true}).fill(password);await mp.getByRole('button',{name:'ログイン',exact:true}).click();await mp.waitForURL(origin+'/staff/ledger');const target=(await (await manager.request.get('/api/staff-users')).json()).items.find((a:{id:string})=>a.id===subject);assert.equal((await manager.request.patch('/api/staff-users/'+subject,{headers:{origin},data:{expectedRevision:target.revision,displayName:target.displayName,active:false,role:target.role,scope:target.scope,storeIds:target.storeIds,permissions:target.permissions}})).status(),200);await manager.close();assert.equal((await context.request.get('/api/content-fixture',{headers})).status(),401);
  const normal=await readFile('apps/web/src/lib/staff-runtime.ts','utf8');assert.ok(!normal.includes('content-fixture'));const source=await readFile('tests/content/http.ts','utf8');assert.ok(source.includes("process.env.NODE_ENV!=='development'"));
 });
 console.log(`CONTENT fixture ${count} passed: normal password/real session DB, local synthetic content file; no production CMS role/storage/permissions or public release.`);
}catch(e){failed=true;console.error('CONTENT_FIXTURE_FAILED '+stage+' '+(e as Error).name);if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/content/')).join('\n'));}finally{await browser.close();await app?.stop();if(namespace&&owned)await removeContentFixture(namespace);console.log('Owned content fixture/Web/browser/PostgreSQL stopped.');}if(failed)process.exit(1);
