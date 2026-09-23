import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedRecommendation,variants,inputFor} from './fixture';
import {requestFor} from '../inventory/fixture';
import type {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
type View=Awaited<ReturnType<RecommendationService['get']>>;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,passed=0,failed=0;
async function check(name:string,fn:()=>Promise<void>){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+(e as Error).name);console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/recommendation/audit-followup-ui.ts:')).join('\n'));}}
try{
 app=await startDevelopmentApp({built:true});await seedRecommendation(app.db.pool,true);
 await bootstrapDevelopmentAdmin(app.db.pool,{email:'audit-bootstrap@example.invalid',displayName:'合成初期ADMIN',password});
 const {origin}=app;
 async function clock(iso:string){const normalized=new Date(iso).toISOString();await app!.db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT '${normalized}'::timestamptz $$`);}
 await clock('2035-01-01T00:00:00Z');
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function context(){const c=await browser.newContext({baseURL:origin,viewport:{width:1280,height:960}});c.setDefaultTimeout(10000);return c;}
 async function login(c:BrowserContext,email:string){const p=await c.newPage();await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(origin+'/staff/ledger');return p;}
 const bootstrap=await context();await login(bootstrap,'audit-bootstrap@example.invalid');
 const created=await bootstrap.request.post('/api/staff-users',{headers:{origin},data:{displayName:'合成監査担当',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,INVENTORY_VIEW:true,INVENTORY_EDIT:true},email:'audit-staff@example.invalid',password}});assert.equal(created.status(),201);
 const staff=await context(),page=await login(staff,'audit-staff@example.invalid');
 const price=await staff.request.post('/api/quotes/private-initialize',{headers:{origin},data:{operation:'initializePrivate',input:{requestKey:randomUUID(),rentalFrom:'2035-01-01',rentalUntil:'2036-12-31'}}});assert.equal(price.status(),201);
 async function profile(p:Page,i:number,sport:'SKI'|'SNOWBOARD'){await p.getByLabel('競技 '+i,{exact:true}).selectOption(sport);await p.getByLabel('利用開始時の年齢区分 '+i,{exact:true}).selectOption('ADULT');await p.getByLabel('身長cm '+i,{exact:true}).fill('170');await p.getByLabel('足サイズcm '+i,{exact:true}).fill('25.5');if(sport==='SKI'){await p.getByLabel('体重kg '+i,{exact:true}).fill('60');await p.getByLabel('利用開始時の年齢 '+i,{exact:true}).fill('30');await p.getByLabel('レベル '+i,{exact:true}).selectOption('BEGINNER');await p.getByLabel('ポールのサイズ '+i,{exact:true}).selectOption(variants.pole);}}
 async function selected(p:Page,date:string,slot:'DAY'|'AM'|'PM'){
  await p.goto('/staff/recommendations');await p.getByLabel('利用開始日',{exact:true}).fill(date);await p.getByLabel('利用終了日',{exact:true}).fill(date);await p.getByLabel('利用区分',{exact:true}).selectOption(slot);await profile(p,1,'SKI');await p.getByRole('button',{name:'利用者を追加',exact:true}).click();await profile(p,2,'SNOWBOARD');
  const response=p.waitForResponse(r=>r.url()===origin+'/api/recommendations'&&r.request().method()==='POST');await p.getByRole('button',{name:'推薦候補を確認',exact:true}).click();const preview:View=await (await response).json();assert.ok(preview.preview.offered.every(o=>o.candidates.RECOMMENDED));
  for(const i of [1,2])await p.getByRole('button',{name:'おすすめを選ぶ '+i,exact:true}).click();await p.getByLabel('モデル指定なし・表示したサイズとクラスを選択条件とすることを確認').check();return preview;
 }
 for(const [date,slot,hour,due,total]of [['2035-06-01','DAY','10:00','17:00',15000],['2035-06-02','AM','10:00','12:00',11200],['2035-06-03','PM','14:00','17:00',11200]] as const){
  await check(`same-day ${slot} ${hour} normal login/UI -> selected group -> HOLD -> quote -> reread`,async()=>{
   await clock(date+'T'+hour+':00+09:00');const p=await staff.newPage();try{await selected(p,date,slot);const response=p.waitForResponse(r=>r.url().endsWith('/select'));await p.getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true}).click();const v:View=await (await response).json();
    console.log('SAME_DAY '+JSON.stringify({slot,now:date+'T'+hour+':00+09:00',stage:v.selection?.stage,outcome:v.selection?.outcome,holdState:v.hold?.state,quotePresent:Boolean(v.quote)}));
    assert.equal(v.hold?.state,'ACTIVE');assert.equal(v.selection?.stage,'COMPLETE');assert.equal(v.quote?.snapshot.totalJpy,total);assert.equal(v.quote.chargeReady,false);assert.equal(v.quote.validity,'VALID_PRIVATE_ESTIMATE');assert.ok(Date.parse(String(v.quote.snapshot.expiresAt))>Date.parse(date+'T'+hour+':00+09:00'));assert.ok(Date.parse(String(v.quote.snapshot.expiresAt))<=Date.parse(date+'T'+due+':00+09:00'));
    assert.equal(v.hold.period.startsAt,new Date(date+(slot==='PM'?'T13:00:00+09:00':'T08:30:00+09:00')).toISOString());assert.equal(v.hold.period.dueAt,new Date(date+'T'+due+':00+09:00').toISOString());
    const reloaded=await (await staff.request.get('/api/recommendations/'+v.preview.id)).json();assert.deepEqual(reloaded.quote,v.quote);assert.equal((await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_claims WHERE hold_id=$1 AND active',[v.hold.id])).rows[0].n,5);
    await p.reload();await p.getByRole('button',{name:new RegExp('推薦 '+v.preview.id.slice(0,8))}).click();await expect(p.getByRole('region',{name:'見積詳細',exact:true})).toContainText(total.toLocaleString()+' 円');
   }finally{await p.close();}
  });
 }
 await check('same-day committed quote response loss: reload/replay preserves both keys, counts, expiry, snapshot hash',async()=>{
  const date='2035-06-04';await clock(date+'T10:00:00+09:00');await selected(page,date,'DAY');let saved:View|undefined;
  await page.route('**/api/recommendations/*/select',async route=>{const r=await route.fetch();saved=await r.json();await route.abort('failed');});await page.getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true}).click();await expect(page.getByRole('button',{name:'同じ要求を照合・再送'})).toBeVisible();await page.unroute('**/api/recommendations/*/select');assert.equal(saved?.selection?.stage,'COMPLETE');
  await clock(date+'T10:01:00+09:00');await page.reload();await page.getByRole('button',{name:'同じ要求を照合・再送'}).click();await expect(page.getByRole('region',{name:'見積詳細',exact:true})).toContainText('15,000 円');const v:View=await (await staff.request.get('/api/recommendations/'+saved!.preview.id)).json();assert.deepEqual(v.quote,saved!.quote);assert.equal(v.hold!.expiresAt,saved!.hold!.expiresAt);assert.equal(v.selection!.hold_key,saved!.selection!.hold_key);assert.equal(v.selection!.quote_key,saved!.selection!.quote_key);
  for(const table of ['inventory_holds','price_quotes'])assert.equal((await app!.db.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE id=$1`,[table==='inventory_holds'?v.hold!.id:v.quote!.id])).rows[0].n,1);
  await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/e09-audit-same-day.png',fullPage:true});
 });
 for(const [date,end,slot,now]of [['2035-06-05','2035-06-05','AM','2035-06-05T12:00:00+09:00'],['2035-06-06','2035-06-06','DAY','2035-06-06T17:00:00+09:00'],['2035-06-07','2035-06-07','PM','2035-06-07T17:00:00+09:00'],['2035-06-07','2035-06-10','MULTIDAY','2035-06-08T10:00:00+09:00'],['2035-06-09','2035-06-10','MULTIDAY','2035-06-09T17:00:00+09:00']] as const){
  await check(`new intake rejects ${slot} start=${date} at ${now} without stock writes`,async()=>{await clock(now);const conditions=requestFor(date);conditions.period={startDate:date,endDate:end,slot};const before=(await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_holds')).rows[0].n;
   const h=await staff.request.post('/api/holds',{headers:{origin},data:{requestKey:randomUUID(),conditions}});const q=await staff.request.post('/api/quotes',{headers:{origin},data:{requestKey:randomUUID(),input:{conditions,holdId:null,couponCode:null,wantAdvance:false}}});console.log('INTAKE_CLOSE '+JSON.stringify({slot,date,now,holdStatus:h.status(),quoteStatus:q.status()}));assert.ok([409,422].includes(h.status()));assert.ok([409,422].includes(q.status()));assert.equal((await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_holds')).rows[0].n,before);
  });
 }
 await check('near AM cutoff new quote expires at12:00, HOLD lease never extended; saved quote remains immutable',async()=>{await clock('2035-06-11T11:59:00+09:00');const conditions=requestFor('2035-06-11');conditions.period.slot='AM';const key=randomUUID(),h=await (await staff.request.post('/api/holds',{headers:{origin},data:{requestKey:randomUUID(),conditions}})).json();const body={requestKey:key,input:{conditions,holdId:h.hold.id,couponCode:null,wantAdvance:false}};const response=await staff.request.post('/api/quotes',{headers:{origin},data:body});assert.equal(response.status(),201);const first=await response.json();assert.equal(first.quote.snapshot.expiresAt,'2035-06-11T03:00:00.000Z');await clock('2035-06-11T12:00:00+09:00');const again=await (await staff.request.post('/api/quotes',{headers:{origin},data:body})).json();assert.equal(again.quote.id,first.quote.id);assert.equal(again.quote.validity,'EXPIRED');assert.equal(again.quote.snapshotSha256,first.quote.snapshotSha256);assert.deepEqual(again.quote.snapshot,first.quote.snapshot);assert.equal((await (await staff.request.get('/api/holds/'+h.hold.id)).json()).expiresAt,h.hold.expiresAt);});
 // Each candidate comes from the normal ledger API. Two units provide one public slot;
 // invalid sizes must still reject. Distinct models avoid lexical duplicate keys.
 const cases=[['SKI','150 cm',true],['SKI','150 CM',true],['SKI','150 Cm',true],['SKI','150\tCM',true],['SKI_BOOT','26.5 cm',true],['SKI_BOOT','26.5 CM',true],['SKI_BOOT','26.5  Cm',true],['SKI','150',false],['SKI','M',false],['SKI','150 mm',false]] as const;
 await clock('2035-06-12T10:00:00+09:00');
 for(const [index,[family,size,eligible]]of cases.entries())await check(`normal ledger registration -> recommendation ${family} ${JSON.stringify(size)} eligible=${eligible}`,async()=>{
  const provenance={notes:'SYNTHETIC audit case',sourceKind:'SYNTHETIC',sourceDocument:'tests/recommendation/audit-followup-ui.ts',sourceLocator:'cm-'+index};
  async function post(resource:string,data:unknown){const r=await staff.request.post('/api/ledger/'+resource,{headers:{origin},data});assert.equal(r.status(),201);return r.json();}
  const model=await post('models',{code:'AUDIT-CM-'+index,name:'合成cm監査 '+index,brand:'SYNTHETIC',family,...provenance});const variant=await post('variants',{modelId:model.id,family,age:'ADULT',tier:'REGULAR',size,...provenance});for(let n=0;n<2;n++)await post('assets',{variantId:variant.id,family,storeId:'MOUNTAIN_BASE',status:'AVAILABLE',bslStatus:family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE',bslMm:null,bslEvidence:'',...provenance,sourceLocator:provenance.sourceLocator+'-asset-'+n});
  const r=await staff.request.post('/api/recommendations',{headers:{origin},data:{requestKey:randomUUID(),input:inputFor('2035-06-13'),replaceHoldId:null}});assert.equal(r.status(),201);const v:View=await r.json();const ids=v.preview.offered[0]!.candidates.RECOMMENDED?.member.items.find(i=>i.family===family)?.variantIds??[];console.log('LEDGER_CM '+JSON.stringify({size,family,eligible,selected:ids.includes(variant.id)}));assert.equal(ids.includes(variant.id),eligible);
 });
 console.log(`E09 audit normal UI/API/PostgreSQL: ${passed} passed; ${failed} failed; 0 skipped. Synthetic local password sessions; real app roles/DB. Clock and response delivery controlled only by test owner. No physical device claim.`);
}catch(e){failed++;console.error('AUDIT_SETUP_FAILURE '+(e as Error).name);console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/recommendation/audit-followup-ui.ts:')).join('\n'));}finally{await browser.close();if(app)await app.stop();console.log('Owned audit Web, browser and PostgreSQL stopped.');}if(failed)process.exit(1);
