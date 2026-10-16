import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect,type BrowserContext} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation,lengthVariants} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff,ledgerPrincipal} from '../../packages/auth/src/staff-auth';
import {verifyLedgerWrite} from '../../packages/auth/src/ledger-write-authority';
import {reconcileLedgerProtection} from '../../packages/core/src/catalog/reconcile-protection';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {WearService} from '../../packages/core/src/wear/service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {registerWear} from '../wear/fixture';
import {fillGuestProfile} from '../public/guest-profile';
import {decodeReference} from './reference-browser';
import {WEAR_COLOR_NOTICE} from '../../apps/web/src/components/wear-copy';
const evidence=process.env.ZAO_AVATAR_EVIDENCE_DIR??'.local/avatar-reference',proof:unknown[]=[];
let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,stage='setup';
try{
 app=await startFlowApp({publicP0:true,publicP1:true,productionCopy:true});const {db,origin}=app;
 await seedRecommendation(db.pool,true);
 const lengths=await db.pool.connect();try{await lengths.query('BEGIN');await lengths.query("SELECT set_config('zao.actor','synthetic-avatar-reference',true),set_config('zao.reason','SYNTHETIC alternate-length visual fixture',true)");
  await lengths.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),id,family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','tests/avatar/reference-e2e.ts','public-direction-'||id FROM ledger_variants WHERE id=ANY($1::uuid[])`,[[lengthVariants.ski165,lengthVariants.ski166,lengthVariants.board145,lengthVariants.board155]]);await lengths.query('COMMIT');
 }catch(e){await lengths.query('ROLLBACK');throw e;}finally{lengths.release();}
 await db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
 const password=randomBytes(24).toString('base64url'),email='reference-staff@example.invalid',subject=await bootstrapDevelopmentAdmin(db.pool,{email,displayName:'SYNTHETIC reference fixture',password});
 for(const permission of ['PRICE_EDIT','QUOTE_VIEW','INVENTORY_EDIT','INVENTORY_VIEW','BOOKING_VIEW','BOOKING_CREATE','TRANSFER_VIEW'])await db.pool.query('INSERT INTO staff_permission_overrides VALUES($1,$2,true)',[subject,permission]);
 const principal=(await loadStaff(db.pool,subject))!;
 await new QuoteService(app.roles.pricingPool,principal).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 browser=await chromium.launch();const staff=await browser.newContext({baseURL:origin});
 const signed=await staff.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password}});assert.equal(signed.status(),200);
 const sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[subject])).rows[0].id,identity={subject,sessionId};
 const ledger=new LedgerService(app.roles.ledgerPool,ledgerPrincipal(principal),(c,stores,global)=>verifyLedgerWrite(c,app!.roles.authPool,identity,stores,global),(resource,id,version)=>reconcileLedgerProtection(app!.roles.transferPool,app!.roles.authPool,identity,resource,id,version));
 const stock=await registerWear(ledger,new WearService(app.flow.flowPool,app.roles.authPool,identity));await staff.close();
 await mkdir(evidence,{recursive:true});
 // Warm the two normal booking routes before opening a form; no business request is repeated.
 for(const locale of ['ja','en'])assert.equal((await fetch(origin+'/'+locale+'/book')).status,200);
 for(const locale of ['ja','en'] as const){stage=locale+' mixed group';const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
  const c:BrowserContext=await browser.newContext({baseURL:origin,viewport:{width:390,height:844},reducedMotion:'reduce'}),p=await c.newPage();p.setDefaultTimeout(30000);
  const errors:string[]=[];let external=0,posts=0,measuring=false;
  p.on('pageerror',()=>errors.push('PAGE_ERROR'));await c.route('**/*',async route=>{const r=route.request();if(new URL(r.url()).origin!==origin){external++;await route.abort();return;}if(measuring&&r.method()==='POST')posts++;await route.continue();});
  await p.goto('/'+locale+'/book');await expect(p.getByLabel(t('利用開始日','Start date'),{exact:true})).toBeEnabled();
  await p.getByLabel(t('利用開始日','Start date'),{exact:true}).fill('2035-02-05');await p.getByRole('button',{name:'CONTINUE',exact:true}).click();await p.getByLabel(t('利用人数','Group size'),{exact:true}).fill('3');
  for(const [n,sport,height]of [[1,'SKI',180],[2,'SNOWBOARD',170],[3,'WEAR',null]]as const){
   const card=p.getByRole('article',{name:t('利用者 ','Person ')+n,exact:true,includeHidden:true}),details=card.locator('..');
   if(!await details.evaluate(e=>(e as HTMLDetailsElement).open))await details.locator('summary').click();
   await card.getByLabel(t('用品','Equipment'),{exact:true}).selectOption(sport);
   if(height!==null)await fillGuestProfile(card,locale,{heightCm:height});
   else{await card.getByLabel(t('ジャケット','Jacket'),{exact:true}).selectOption('wear_jacket-'+stock.selection.jacketVariantId);await card.getByLabel(t('パンツ','Pants'),{exact:true}).selectOption('wear_pants-'+stock.selection.pantsVariantId);await expect(card.locator('.guest-wear-colour')).toHaveText(WEAR_COLOR_NOTICE[locale]);}
  }
  await p.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates'),exact:true}).click();await expect(p.locator('.fit-study')).toHaveCount(3);await decodeReference(p);
  const draft:{preview:{members:{candidates:Record<string,{lengthCm:number}|null>}[]}}=await(await c.request.get('/api/guest/draft')).json(),before=JSON.stringify(draft);measuring=true;
  for(const member of draft.preview.members.slice(0,2))for(const direction of ['SHORTER','RECOMMENDED','LONGER'])assert.ok(member.candidates[direction],'All three equipment directions must be exercised');
  for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:width<768?844:900});
   for(const [index,sport,height]of [[0,'SKI',180],[1,'SNOWBOARD',170],[2,'WEAR',null]]as const){const panel=p.locator('.fit-study').nth(index);
    await expect(panel.locator('image[data-layer="AVATAR"]')).toHaveCount(1);
    await expect(panel.locator('image[data-layer="SKI"]')).toHaveCount(sport==='SKI'?1:0);await expect(panel.locator('image[data-layer="SNOWBOARD"]')).toHaveCount(sport==='SNOWBOARD'?1:0);
    if(height!==null){const stageHeight=(await panel.locator('[data-avatar-stage]').boundingBox())!.height;
     for(const [key,label]of [['SHORTER',t('短め','Shorter')],['RECOMMENDED',t('おすすめ','Recommended')],['LONGER',t('長め','Longer')]]as const){const direction=draft.preview.members[index]!.candidates[key];if(!direction)continue;
      await p.getByRole('article',{name:t('利用者 ','Person ')+(index+1),exact:true}).getByRole('radio',{name:new RegExp(label,'i')}).check();await decodeReference(panel);
      const m=await panel.evaluate((el,sport)=>{const body=el.querySelector('[data-layer="AVATAR"]')!.getBoundingClientRect(),gear=el.querySelector('[data-layer="'+sport+'"]')!.getBoundingClientRect();return {body:body.height,gear:gear.height,bottomDelta:Math.abs(body.bottom-gear.bottom)};},sport);
      assert.ok(Math.abs(m.gear-m.body*direction.lengthCm/height)<1);assert.ok(m.bottomDelta<1);assert.equal((await panel.locator('[data-avatar-stage]').boundingBox())!.height,stageHeight);
      proof.push({locale,width,sport,direction:key,lengthCm:direction.lengthCm,expectedRatio:direction.lengthCm/height,...m,stageHeight});
     }
    }
    else{await expect(panel.locator('.fit-study-footnote')).toHaveText(WEAR_COLOR_NOTICE[locale]);await expect(panel.locator('.fit-study-measures')).toHaveCount(0);}
   }
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('.fit-study').nth(1).screenshot({path:evidence+'/'+locale+'-snowboard-'+width+'.png'});proof.push({locale,width,mixedMembers:3,ratioAndFloor:true,overflow:false});
  }
  // Keyboard-operated appearance controls are cosmetic; they preserve the saved draft.
  const board=p.locator('.fit-study').nth(1),button=board.getByRole('button',{name:t('見た目 2 · CHALK','Appearance 2 · CHALK'),exact:true});await button.focus();await p.keyboard.press('Enter');await expect(button).toHaveAttribute('aria-pressed','true');await decodeReference(board);
  assert.equal(JSON.stringify(await(await c.request.get('/api/guest/draft')).json()),before);assert.equal(posts,0);measuring=false;
  for(const radio of await p.getByRole('radio',{name:ja?/おすすめ/:/RECOMMENDED/i}).all())await radio.check();await p.getByLabel(t('全員の内容を確認しました','I have checked everyone’s selections')).check();await p.getByRole('button',{name:t('全員分の最終確認へ','Review the whole group'),exact:true}).click();
  await expect(p.locator('.guest-review-people .guest-wear-colour')).toHaveText(WEAR_COLOR_NOTICE[locale]);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM rental_payment_attempts')).rows[0].n,0);assert.deepEqual(errors,[]);assert.equal(external,0);
  proof.push({locale,keyboardAppearance:true,visualPosts:posts,draftUnchanged:true,draftSha256:createHash('sha256').update(before).digest('hex'),colourNoticeInputAndReview:true,holds:0,payments:0,externalAttempts:external,fatalErrors:errors});await c.close();console.log('PASS '+locale+' mixed ski / snowboard / wear, physical scale, keyboard and nonmutation');
 }
 await writeFile(evidence+'/report.json',JSON.stringify({status:'PASS',syntheticOnly:true,proof},null,2)+'\n');
}catch(e){console.error('REFERENCE_E2E_FAILED '+stage+' '+(e instanceof Error?e.name:'UNKNOWN'));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error(e instanceof Error?e.stack?.split('\n').filter(s=>s.includes('/tests/avatar/')).join('\n'):'');process.exitCode=1;}
finally{await browser?.close();await app?.stop();}
