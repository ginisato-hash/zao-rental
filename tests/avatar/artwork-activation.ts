import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation,variants} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {importLocalArtwork,validateLocalArtwork} from '../../scripts/avatar-artwork-local';
import {PostgresAvatarVisuals} from '../../packages/db/src/avatar-visuals';
import {migrationPlan} from '../../packages/db/src/index';
import type {AvatarPreviewPayloads} from '../../packages/core/src/avatar/preview';
const evidence='docs/execution/avatar-artwork-activation',results:{kind:string;name:string;status:'PASS'}[]=[],measurements:Record<string,unknown>[]=[],screenshots:Record<string,unknown>[]=[];
let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,stage='setup',failed=false,externalAttempts=0,measuring=false;
const visualPosts:string[]=[],metadataRequests:string[]=[],fatals:string[]=[];
const check=async(kind:string,name:string,fn:()=>Promise<void>)=>{stage=name;await fn();results.push({kind,name,status:'PASS'});console.log('PASS '+kind+' '+name);};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
try{
 await mkdir(evidence+'/screenshots',{recursive:true});
 await check('ARTWORK','three Owner-approved local derivatives: manifest, format, alpha, dimensions and physical bounds',async()=>{const value=await validateLocalArtwork();await writeFile(evidence+'/artwork-validation.json',JSON.stringify({status:'PASS',assets:value.assets.map(({entry,bounds,transparentPixels,format,metadataPresent})=>({file:entry.file,sha256:entry.sha256,width:entry.width,height:entry.height,bounds,transparentPixels,format,metadataPresent})),bodyGeometryIdentical:'Covered by unit alpha-mask equality',sourcePhotosAreNotImported:true},null,2)+'\n');});
 app=await startFlowApp({publicP0:true,avatarPhase5:true});const {db,origin}=app;
 await check('PG','all0001–0032 historical hashes preserved and migrated',async()=>{const entries=JSON.parse(await readFile(evidence+'/migration-hashes.json','utf8')) as {file:string;sha256:string}[];assert.equal(entries.length,32);assert.equal(migrationPlan.slice(0,32).length,32);for(const h of entries)assert.equal(hash(await readFile(h.file)),h.sha256);assert.equal((await db.pool.query("SELECT count(*)::int n FROM foundation_migrations WHERE id<='0032'")).rows[0].n,32);});
 await seedRecommendation(db.pool,true);await db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
 const password=randomBytes(24).toString('base64url'),subject=await bootstrapDevelopmentAdmin(db.pool,{email:'avatar-artwork@example.invalid',displayName:'LOCAL ACCEPTANCE',password});
 for(const permission of ['PRICE_EDIT','BOOKING_VIEW','HOLD_VIEW','QUOTE_VIEW'])await db.pool.query('INSERT INTO staff_permission_overrides VALUES($1,$2,true)',[subject,permission]);
 await new QuoteService(app.roles.pricingPool,(await loadStaff(db.pool,subject))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const imported=await importLocalArtwork(db.pool),base=structuredClone(imported.state),body=imported.metadata[0]!,reader=new PostgresAvatarVisuals(app.avatar!.avatarPool);
 await check('PG','atomic core import creates three distinct media/visuals, purpose grant and immutable current release',async()=>{
  assert.equal((await reader.read([],new Date())).length,3);assert.equal((await db.pool.query('SELECT count(*)::int n FROM content_media_objects')).rows[0].n,3);
  for(const v of imported.metadata){assert.equal(hash((await reader.readBytes(v.id,v.derivativeSha256))!),v.derivativeSha256);assert.equal(v.match,'GENERIC_REFERENCE');assert.equal(v.modelId,null);}
  await writeFile(evidence+'/import-receipt.json',JSON.stringify(imported.receipt,null,2)+'\n');
 });
 const contentFingerprint=async()=>{const r:Record<string,unknown>={};for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])r[table]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') value FROM ${table} t`)).rows[0].value;return r;};
 await check('PG','second import refuses populated content and leaves every row unchanged',async()=>{const before=await contentFingerprint();await assert.rejects(importLocalArtwork(db.pool),/ARTWORK_FRESH_CONTENT_REQUIRED/);assert.deepEqual(await contentFingerprint(),before);});
 for(const [field,value]of [['id',randomUUID()],['layer','SKI'],['avatar_type','APPEARANCE_2'],['match_kind','EXACT_PROMISE'],['model_id',randomUUID()],['variant_id',randomUUID()],['season','2035/36'],['ski_length_cm',170],['media_id','other'],['derivative_sha256','0'.repeat(64)],['revision_id',randomUUID()],['release_id',randomUUID()],['created_at','2001-01-01']]as const)await check('PG','AV-1 actual imported binding immutable: '+field,async()=>{await assert.rejects(db.pool.query(`UPDATE avatar_visuals SET ${field}=$1 WHERE id=$2`,[value,body.id]),{code:'23514'});});
 for(const table of ['content_workspace','content_media_objects','content_revision_records','avatar_visuals','guest_contexts','recommendation_previews'])await check('PG','AV-3 narrow Avatar role cannot SELECT '+table,async()=>{await assert.rejects(app!.avatar!.avatarPool.query(`SELECT * FROM ${table}`),{code:'42501'});});
 await check('PG','AV-3 cannot mutate visual or business data or create permanent tables',async()=>{for(const sql of ["UPDATE avatar_visuals SET state='DISABLED'",'DELETE FROM inventory_holds','CREATE TABLE forbidden_avatar_artwork(id int)'])await assert.rejects(app!.avatar!.avatarPool.query(sql),{code:'42501'});});
 await check('PG','narrow function has pinned path, PUBLIC execution denied, role has no elevated flags/memberships',async()=>{
  const p=(await db.pool.query("SELECT prosecdef,proconfig,EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE grantee=0 AND privilege_type='EXECUTE') public_execute FROM pg_proc WHERE oid='avatar_visual_derivative(uuid,text)'::regprocedure")).rows[0];assert.equal(p.prosecdef,true);assert.equal(p.public_execute,false);assert.deepEqual(p.proconfig,['search_path=pg_catalog, public, pg_temp']);
  const role=(await db.pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[app!.avatar!.avatarDb.user])).rows[0];assert.ok(Object.values(role).every(x=>x===false));assert.equal((await db.pool.query('SELECT count(*)::int n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[app!.avatar!.avatarDb.user])).rows[0].n,0);
 });
 browser=await chromium.launch();const c=await browser.newContext({baseURL:origin,viewport:{width:390,height:844}}),other=await browser.newContext({baseURL:origin}),anon=await browser.newContext({baseURL:origin}),staff=await browser.newContext({baseURL:origin});
 for(const context of [c,other,anon,staff]){context.setDefaultTimeout(25000);await context.route('**/*',async route=>{const r=route.request(),url=new URL(r.url());if(url.origin!==origin){externalAttempts++;await route.abort();}else{if(measuring&&r.method()==='POST'&&url.pathname!=='/api/guest/context')visualPosts.push(url.pathname);if(measuring&&url.pathname.startsWith('/api/guest/avatar/'))metadataRequests.push(url.pathname);await route.continue();}});}
 for(const p of ['/ja','/ja/book','/staff/login','/staff/ledger','/api/auth/get-session'])await anon.request.get(p);
 const page=await c.newPage();page.on('pageerror',()=>fatals.push('PAGE_ERROR'));page.on('console',m=>{if(m.type()==='error'&&/hydration|uncaught|maximum update/i.test(m.text()))fatals.push('CONSOLE_FATAL');});
 await check('BROWSER','normal GuestBooking creates two synthetic member candidates before artwork interactions',async()=>{
  await page.goto('/ja/book');await page.getByLabel('利用開始日',{exact:true}).fill('2035-01-05');await page.getByLabel('利用終了日',{exact:true}).fill('2035-01-05');await page.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await page.getByLabel('利用人数',{exact:true}).fill('2');
  for(const n of [1,2]){if(n===2)await page.getByText('利用者 2').first().click();await page.getByLabel('身長cm '+n,{exact:true}).fill(n===1?'170':'180');await page.getByLabel('ポールのサイズ '+n,{exact:true}).selectOption('pole-'+variants.pole);}
  await page.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await expect(page.locator('[data-avatar-stage]')).toHaveCount(2);
 });
 const draft=await(await c.request.get('/api/guest/draft')).json();assert.equal(draft.preview.members.length,2);
 const scopes=[1,2].map(n=>draft.id+'/'+draft.revision+'/person-'+n),metadataPath='/api/guest/avatar/'+scopes[0],imagePath='/guest-avatar-media/'+scopes[0]+'/'+body.id+'/'+body.derivativeSha256;
 await other.request.post('/api/guest/context',{headers:{origin},data:{}});
 const business=async()=>{const out:Record<string,unknown>={};for(const table of ['guest_drafts','recommendation_previews','recommendation_selections','inventory_holds','inventory_claims','price_quotes','rental_bookings','rental_payment_attempts','ledger_assets','ledger_poles','wear_pools'])out[table]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') value FROM ${table} t`)).rows[0].value;return out;};
 const before=await business();measuring=true;
 await check('PG','current owner/member metadata includes approved body/ski and optional layers null',async()=>{
  for(const scope of scopes){const r=await c.request.get('/api/guest/avatar/'+scope);assert.equal(r.status(),200);const payload=await r.json() as AvatarPreviewPayloads;
   for(const a of ['APPEARANCE_1','APPEARANCE_2']as const){assert.ok(payload[a]);assert.equal(payload[a]!.avatar!.derivativeSha256,imported.metadata.find(v=>v.avatarType===a)!.derivativeSha256);assert.equal(payload[a]!.boot,null);assert.equal(payload[a]!.jacket,null);assert.equal(payload[a]!.pants,null);for(const d of ['SHORTER','RECOMMENDED','LONGER']as const){assert.equal(payload[a]!.candidates[d]!.visual!.derivativeSha256,imported.metadata[2]!.derivativeSha256);assert.equal(payload[a]!.candidates[d]!.fallback,'GENERIC_REFERENCE');}}
  }
 });
 await check('PG','authenticated guest receives exact approved WebP bytes without public cache',async()=>{for(const v of imported.metadata){const r=await c.request.get('/guest-avatar-media/'+scopes[0]+'/'+v.id+'/'+v.derivativeSha256);assert.equal(r.status(),200);assert.equal(r.headers()['cache-control'],'private, no-store');assert.equal(hash(await r.body()),v.derivativeSha256);}});
 for(const [name,context]of [['anonymous',anon],['cross-guest',other]]as const)await check('PG',name+' denial for owner metadata and bytes',async()=>{for(const p of [metadataPath,imagePath]){const r=await context.request.get(p);assert.equal(r.status(),404);assert.equal(await r.text(),'');}});
 await check('PG','stale revision and foreign member deny media',async()=>{assert.equal((await c.request.get(imagePath.replace('/person-1/','/person-99/'))).status(),404);assert.equal((await c.request.get(imagePath.replace('/'+draft.revision+'/', '/'+(draft.revision+1)+'/'))).status(),404);});
 const shot=async(name:string)=>{const file=evidence+'/screenshots/'+name+'.png';await page.screenshot({path:file,fullPage:true});screenshots.push({file,sha256:hash(await readFile(file)),ownerApprovedLocalArtwork:true,syntheticBusinessData:true});};
 // Images are lazy: scroll each member into view before waiting for its actual decoded bytes.
 const loaded=async(n:number)=>{const section=page.locator('.guest-person').nth(n);await section.locator('[data-avatar-stage]').scrollIntoViewIfNeeded();await expect(section.locator('[data-layer="AVATAR"] img')).toBeVisible();await section.locator('[data-avatar-stage]').evaluate(async element=>{await Promise.all(Array.from(element.querySelectorAll('img')).map(img=>img.decode()));});return section;};
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:width===390?844:1100});
  for(const appearance of [1,2])for(const [direction,label]of [['RECOMMENDED','おすすめ'],['SHORTER','短め'],['LONGER','長め']]as const)await check('BROWSER',width+'px appearance'+appearance+' '+direction+' both members physical ratio/floor',async()=>{
   for(const n of [0,1]){
    const section=await loaded(n);await section.getByRole('button',{name:'見た目 '+appearance,exact:true}).click();await section.getByRole('radio',{name:new RegExp(label)}).check();await loaded(n);
    assert.ok((await section.locator('[data-layer="AVATAR"] img').getAttribute('src'))!.includes(imported.metadata[appearance-1]!.derivativeSha256));
    assert.ok((await section.locator('[data-layer="SKI"] img').getAttribute('src'))!.includes(imported.metadata[2]!.derivativeSha256));
    const m=await section.evaluate(el=>{const b=el.querySelector('[data-layer="AVATAR"]')!.getBoundingClientRect(),s=el.querySelector('[data-layer="SKI"]')!.getBoundingClientRect();return {bodyHeight:b.height,skiHeight:s.height,bodyBottom:b.bottom,skiBottom:s.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
    const length=draft.preview.members[n].candidates[direction].lengthCm,height=n===0?170:180;
    assert.equal(m.overflow,false);assert.ok(Math.abs(m.skiHeight-m.bodyHeight*length/height)<=1);assert.ok(Math.abs(m.skiBottom-m.bodyBottom)<=1);measurements.push({width,appearance,direction,member:n+1,heightCm:height,skiLengthCm:length,expectedRatio:length/height,...m});
   }
   if(direction==='RECOMMENDED'){await page.locator('.guest-person').first().scrollIntoViewIfNeeded();await shot(width+'-appearance'+appearance);}
  });
 }
 await check('BROWSER','visual controls make no metadata reload, business POST or image optimizer request',async()=>{assert.deepEqual(metadataRequests,[]);assert.deepEqual(visualPosts,[]);assert.equal(await page.locator('img[src*="_next/image"]').count(),0);await expect(page.locator('.avatar-disclaimer').first()).toContainText('モデル確約');});
 await check('PG','all guest/business rows unchanged after both appearances/directions/viewports/members',async()=>{assert.deepEqual(await business(),before);for(const table of ['inventory_holds','price_quotes','rental_bookings','rental_payment_attempts'])assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);});
 measuring=false;
 await check('PG','rights revocation denies previously valid derivative URL immediately',async()=>{const state=structuredClone(base);state.catalog.media[0]!.rightsConfirmed=false;await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(state)]);assert.equal((await c.request.get(imagePath)).status(),404);await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(base)]);assert.equal((await c.request.get(imagePath)).status(),200);});
 await check('BROWSER','AV-2 no eligible artwork means no fabricated renderer; ordinary candidates remain',async()=>{const state=structuredClone(base);for(const media of state.catalog.media)media.rightsConfirmed=false;await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(state)]);await page.reload();await expect(page.getByRole('radio',{name:/おすすめ/}).first()).toBeVisible();await expect(page.locator('[data-avatar-stage]')).toHaveCount(0);await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(base)]);await page.reload();await expect(page.locator('[data-avatar-stage]')).toHaveCount(2);});
 const staffPage=await staff.newPage();
 await check('BROWSER','normal local staff login for PHASE4-1 permission proof',async()=>{await staffPage.goto('/staff/login');await staffPage.getByLabel('メールアドレス',{exact:true}).fill('avatar-artwork@example.invalid');await staffPage.getByLabel('パスワード',{exact:true}).fill(password);const signed=staffPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/sign-in/email');await staffPage.getByRole('button',{name:'ログイン',exact:true}).click();assert.equal((await signed).status(),200);await staffPage.waitForURL(origin+'/staff/ledger');});
 await check('PG','PHASE4-1 all three permissions allow bytes; BOOKING_VIEW-only denies bytes and page',async()=>{const path='/avatar-media/'+body.id+'/'+body.derivativeSha256;assert.equal((await staff.request.get(path)).status(),200);assert.match(await(await staff.request.get('/preview/avatar')).text(),/認可済みの保存済み推薦ID/);await db.pool.query("UPDATE staff_permission_overrides SET allowed=false WHERE staff_id=$1 AND permission IN ('HOLD_VIEW','QUOTE_VIEW')",[subject]);assert.equal((await staff.request.get(path)).status(),404);assert.match(await(await staff.request.get('/preview/avatar')).text(),/Staff sign-in/);});
 await check('BROWSER','normal logout revokes owner media/metadata while other guest remains valid',async()=>{const logout=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/guest/logout');await page.getByRole('button',{name:'この予約画面を閉じる'}).click();assert.equal((await logout).status(),200);await page.waitForURL(origin+'/ja',{waitUntil:'domcontentloaded'});for(const p of [imagePath,metadataPath])assert.equal((await c.request.get(p)).status(),404);assert.equal((await other.request.get('/api/guest/draft')).status(),200);});
 await check('BROWSER','no fatal/hydration errors or external attempts',async()=>{assert.deepEqual(fatals,[]);assert.equal(externalAttempts,0);});
 await writeFile(evidence+'/browser-measurements.json',JSON.stringify({tolerancePx:1,engine:'Chromium; mobile viewport, not physical Safari',measurements},null,2)+'\n');await writeFile(evidence+'/screenshots.json',JSON.stringify(screenshots,null,2)+'\n');
}catch(e){failed=true;console.error('ARTWORK_ACTIVATION_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/avatar/')||s.includes('/scripts/avatar-artwork')).join('\n'));}
finally{await browser?.close();await app?.stop();console.log('Owned artwork acceptance browser/Next/PostgreSQL closed.');}
if(failed)process.exit(1);
await writeFile(evidence+'/local-e2e.json',JSON.stringify({status:'PASS',results,artworkChecks:results.filter(x=>x.kind==='ARTWORK').length,pgChecks:results.filter(x=>x.kind==='PG').length,browserChecks:results.filter(x=>x.kind==='BROWSER').length,visualBusinessPosts:visualPosts.length,visualBusinessWrites:0,extraRecommendationCalls:0,extraHold:0,extraQuote:0,extraPayment:0,existingContextInitializationExcluded:true,externalAttempts,ownerApprovedLocalArtwork:true,syntheticBusinessData:true,productionApproved:false,cleanup:'Owned browser/Next/PostgreSQL closed'},null,2)+'\n');
