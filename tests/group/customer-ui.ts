// Customer group application: real browser (Chromium) + real tests/group-app (next dev) + isolated PostgreSQL. Synthetic data only.
// JA/EN x 390/1440, all five steps (CSV download -> edited file import -> one-person change -> quote -> submit -> real hold),
// errors/reload/multi-tab/recovery, independent groups from one entrance, no online-payment traffic, no public link to the entrance.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {newQuietContext} from '../flow/dev-hmr';
import {startGroupApp} from './launcher';
import {GROUP_COPY} from '../../apps/web/src/components/group-copy';
import {serializeGroupCsvRows,type GroupCsvMemberValues} from '../../packages/contracts/src/group-csv';
import {skiMember} from './fixture';

let stage='startup',count=0,failed=false,last:Page|undefined;
const browser=await chromium.launch(),app=await startGroupApp({stock:150});
const {origin}=app,q=(s:string,p:unknown[]=[])=>app.db.pool.query(s,p);
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
const ctx=async(width:number,height=900,extra:Record<string,unknown>={}):Promise<BrowserContext>=>{const c=await newQuietContext(browser,{baseURL:origin,viewport:{width,height},...extra});c.setDefaultTimeout(60000);return c;};
const noOverflow=async(p:Page)=>assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+await p.evaluate(()=>innerWidth));
const groupHolds=async()=>Number((await q("SELECT count(*) n FROM inventory_holds WHERE allocation_stage='GROUP_RESERVED'")).rows[0].n);
const row=(label:string,over:Partial<GroupCsvMemberValues>={}):GroupCsvMemberValues&{memberId:null}=>({memberId:null,label,sport:'SKI',equipment:{kind:'SET'},tier:'REGULAR',ageAtStart:34,adultAtStart:true,heightCm:170,weightKg:65,footCm:25.5,skierType:'TYPE_II',premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false,...over});
const PERIOD={startDate:'2035-02-10',endDate:'2035-02-10'};
const paymentish=/\/api\/(bookings|guest|booking-access)|squareup|square\.|checkout|payment/i;

async function openEntrance(page:Page,locale:'ja'|'en'){last=page;await page.goto(`/${locale}/group/${app.entranceToken}`);await expect(page.getByRole('heading',{level:1,name:GROUP_COPY[locale].title})).toBeVisible();}
async function fillStart(page:Page,locale:'ja'|'en',label:string,date=PERIOD.startDate,people='3'){
 const t=GROUP_COPY[locale];
 await page.getByLabel(t.form.group,{exact:true}).fill(label);await page.getByLabel(t.form.rep,{exact:true}).fill('SYNTHETIC Rep');await page.getByLabel(t.form.email,{exact:true}).fill('synthetic-rep@example.invalid');
 await page.getByLabel(t.form.start,{exact:true}).fill(date);await page.getByLabel(t.form.end,{exact:true}).fill(date);await page.getByLabel(t.form.people,{exact:true}).fill(people);
 await page.getByRole('button',{name:t.form.go,exact:true}).click();await expect(page.getByRole('heading',{name:t.rows.heading})).toBeVisible();
}
async function importCsv(page:Page,locale:'ja'|'en',csv:string,apply=true){
 const t=GROUP_COPY[locale];await page.getByLabel(t.rows.file,{exact:true}).setInputFiles({name:'group.csv',mimeType:'text/csv',buffer:Buffer.from(csv,'utf8')});
 if(apply){await expect(page.getByRole('button',{name:t.rows.apply,exact:true})).toBeEnabled();await page.getByRole('button',{name:t.rows.apply,exact:true}).click();}
}
const cards=(page:Page)=>page.locator('li.group-row');
try{
 await check('page bootstrap: entrance page renders for JA/EN with noindex/no-store/no-referrer and a GET changes nothing',async()=>{
  const before=Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n),ev=Number((await q('SELECT count(*) n FROM group_events')).rows[0].n);
  const c=await ctx(1440),p=await c.newPage();
  for(const locale of ['ja','en'] as const){await openEntrance(p,locale);await expect(p.getByRole('button',{name:GROUP_COPY[locale].form.go,exact:true})).toBeVisible();}
  assert.equal(Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n),before);assert.equal(Number((await q('SELECT count(*) n FROM group_events')).rows[0].n),ev);
  assert.equal(await groupHolds(),0);await c.close();
 });

 for(const locale of ['ja','en'] as const)for(const width of [390,1440])await check(`five steps ${locale} x ${width}px: CSV download -> edited file import -> one-person change -> advice -> quote -> submit -> real hold; reload and second tab agree`,async()=>{
  const t=GROUP_COPY[locale],c=await ctx(width,width===390?844:900,{acceptDownloads:true}),page=await c.newPage(),requests:string[]=[];
  page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin)requests.push(r.method()+' '+u.pathname);});
  const label=`SYNTHETIC ${locale}-${width}`;
  await openEntrance(page,locale);
  // step 1: accessible validation first (errors announced, focus moves to the first invalid field)
  await page.getByRole('button',{name:t.form.go,exact:true}).click();await expect(page.getByRole('alert').first()).toBeVisible();await expect(page.getByLabel(t.form.group,{exact:true})).toBeFocused();
  await noOverflow(page);
  const day=locale==='ja'?(width===390?'2035-02-11':'2035-02-12'):(width===390?'2035-02-13':'2035-02-14');
  await fillStart(page,locale,label,day,'3');
  // resume link is shown once, with the secret only in the fragment
  const link=await page.getByRole('textbox',{name:t.resume.title}).inputValue();assert.match(link,/\/group\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}#k=[A-Za-z0-9_-]{43}$/);
  // step 2: templates download (3 files), example import (replace), then screen edits
  let example='';
  for(const [btn,kind] of [[t.rows.dlEmpty,'empty'],[t.rows.dlExample,'example'],[t.rows.dlLegend,'guide']] as const){const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:btn,exact:true}).click()]);assert.match(d.suggestedFilename(),new RegExp(kind+'\\.csv$'));if(kind==='example')example=await readFile((await d.path())!,'utf8');}
  assert.ok(example.startsWith('\uFEFF'));
  // the customer edits the downloaded file: the child sample row is dropped (this fixture stocks no child sizes)
  example=example.split('\r\n').filter(l=>!l.includes(',TYPE_I,')&&!l.includes('PREMIUM')).join('\r\n');
  await importCsv(page,locale,example,false);await expect(page.getByRole('heading',{name:t.rows.diffTitle})).toBeVisible();await expect(page.getByText(`${t.rows.diff.ADD} 2`)).toBeVisible();
  await page.getByRole('button',{name:t.rows.apply,exact:true}).click();await expect(cards(page)).toHaveCount(2);
  // second import in ADD mode shows the explicit mode and a diff, then cancel leaves the list unchanged
  await page.getByRole('radio',{name:t.rows.modeAdd}).check();await importCsv(page,locale,example,false);await expect(page.getByText(`${t.rows.diff.ADD} 2`)).toBeVisible();await page.getByRole('button',{name:t.rows.cancel,exact:true}).click();await expect(cards(page)).toHaveCount(2);
  await page.getByRole('radio',{name:t.rows.modeReplace}).check();
  // add a blank row: it must be flagged and block the next step; the filter finds it; delete needs a second click
  await page.getByRole('button',{name:t.rows.add,exact:true}).click();await expect(cards(page)).toHaveCount(3);
  await expect(page.getByRole('button',{name:t.rows.next,exact:true})).toBeDisabled();
  await page.getByRole('button',{name:new RegExp('^'+t.rows.filter.check)}).click();await expect(cards(page)).toHaveCount(1);
  await cards(page).first().getByRole('button',{name:t.rows.del,exact:true}).click();await cards(page).first().getByRole('button',{name:t.rows.delConfirm,exact:true}).click();
  await page.getByRole('button',{name:new RegExp('^'+t.rows.filter.all)}).click();await expect(cards(page)).toHaveCount(2);
  // copy one row, change one person on screen (height), keep the rest
  await cards(page).first().getByRole('button',{name:t.rows.copy,exact:true}).click();await expect(cards(page)).toHaveCount(3);
  await cards(page).nth(1).getByLabel(t.rows.fields.height,{exact:true}).fill('170');await cards(page).nth(1).getByLabel(t.rows.fields.foot,{exact:true}).fill('25.5');
  await noOverflow(page);
  // reload keeps the unsaved list in this tab only
  await page.reload();await expect(cards(page)).toHaveCount(3);
  // step 3: one click -> exactly one advise request even if clicked twice; nothing is held
  const heldBefore=await groupHolds();requests.length=0;
  const advise=page.getByRole('button',{name:t.rows.next,exact:true});await advise.dblclick();
  await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();
  assert.equal(requests.filter(r=>/advise/.test(r)).length,1,'duplicate advise calls');assert.equal(await groupHolds(),heldBefore,'advice holds nothing');
  await expect(page.getByTestId('row-state')).toHaveCount(3);for(const s of await page.getByTestId('row-state').allTextContents())assert.equal(s,t.rows.status.READY);
  await expect(page.getByRole('radio',{name:new RegExp(t.advice.direction.RECOMMENDED)}).first()).toBeChecked();
  await noOverflow(page);
  // step 4: quote with itemised lines, on-site payment, no payment inputs
  await page.getByRole('button',{name:t.advice.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.quote.heading})).toBeVisible();
  const total=await page.getByTestId('quote-total').innerText();assert.match(total,/[¥￥]\s?[\d,]+/);await expect(page.getByTestId('pay-on-site')).toContainText(t.quote.pay);
  await expect(page.locator('input[type=password],input[autocomplete^="cc-"],input[name*=card i]')).toHaveCount(0);
  await expect(page.locator('.group-quote-lines li')).toHaveCount(3);await noOverflow(page);
  const submit=page.getByRole('button',{name:t.quote.submit,exact:true});await expect(submit).toBeDisabled();
  await page.getByLabel(t.quote.agree,{exact:true}).check();await expect(submit).toBeEnabled();
  requests.length=0;await submit.dblclick();
  await expect(page.getByTestId('group-status')).toHaveAttribute('data-status','REVIEW_HELD');
  assert.equal(requests.filter(r=>/\/submit$/.test(r)).length,1,'duplicate submit calls');assert.equal(requests.filter(r=>/\/consent$/.test(r)).length,1);
  const statusText=await page.getByTestId('group-status').innerText();assert.equal(statusText,t.done.status.REVIEW_HELD);
  // real hold in the database: all three members, no expiry, no booking/payment rows
  const g=(await q('SELECT id,status,member_count,payment_method,group_number FROM group_orders WHERE group_label=$1',[label])).rows[0];assert.equal(g.status,'REVIEW_HELD');assert.equal(g.member_count,3);assert.equal(g.payment_method,'PAY_ON_SITE');
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1 AND h.allocation_stage='GROUP_RESERVED' AND h.expires_at IS NULL AND h.state='ACTIVE'",[g.id])).rows[0].n),1);
  assert.ok(Number((await q("SELECT claim_count n FROM group_order_parts WHERE group_id=$1",[g.id])).rows[0].n)>=6);
  assert.equal(Number((await q('SELECT count(*) n FROM rental_bookings')).rows[0].n),0);
  assert.equal(requests.filter(r=>paymentish.test(r)).length,0,'no payment-related request: '+requests.filter(r=>paymentish.test(r)).join(','));
  const body=await page.locator('main').innerText();assert.equal(/期限|延長|expire|deadline|extend/i.test(body),false,'no expiry/extension wording');
  await noOverflow(page);
  // reload and a second tab show the same state
  await page.reload();await expect(page.getByTestId('group-status')).toHaveAttribute('data-status','REVIEW_HELD');await expect(page.getByTestId('group-number')).toHaveText(g.group_number);
  const tab2=await c.newPage();await tab2.goto(new URL(page.url()).pathname);await expect(tab2.getByTestId('group-status')).toHaveAttribute('data-status','REVIEW_HELD');await tab2.close();
  // request a change: recorded as a request only
  await page.getByRole('radio',{name:t.done.kindChange}).check();await page.getByLabel(t.done.body,{exact:true}).fill('SYNTHETIC change');await page.getByRole('button',{name:t.done.send,exact:true}).click();await expect(page.getByText(t.done.sent)).toBeVisible();
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[g.id])).rows[0].status,'REVIEW_HELD');
  assert.equal(Number((await q("SELECT count(*) n FROM group_change_requests WHERE group_id=$1",[g.id])).rows[0].n),1);
  await c.close();
 });

 await check('recovery and isolation: a fresh browser cannot open an existing group from the entrance or the group URL; the resume link can; two groups from one entrance stay independent',async()=>{
  const t=GROUP_COPY.ja,c1=await ctx(1440),p1=await c1.newPage(),c2=await ctx(1440),p2=await c2.newPage();
  await openEntrance(p1,'ja');await fillStart(p1,'ja','SYNTHETIC Iso A','2035-03-01','1');const linkA=await p1.getByRole('textbox',{name:t.resume.title}).inputValue();const idA=/\/([a-f0-9-]{36})#/.exec(linkA)![1]!;
  await openEntrance(p2,'ja');await fillStart(p2,'ja','SYNTHETIC Iso B','2035-03-02','1');
  assert.equal(await p2.getByText('SYNTHETIC Iso A').count(),0,'B never sees A');assert.equal((await c2.request.get('/api/group/g/'+idA)).status(),404);
  // A's group URL in a browser without its cookie: closed door, offer a new application only
  const c3=await ctx(1440),p3=await c3.newPage();await p3.goto(`/ja/group/${app.entranceToken}/${idA}`);await expect(p3.getByText(t.noAccess)).toBeVisible();await expect(p3.getByRole('link',{name:t.newApplication})).toBeVisible();
  assert.equal(await p3.getByText('SYNTHETIC Iso A').count(),0);
  // the resume link restores access and the secret leaves the URL
  await p3.goto(linkA.replace(origin,''));await expect(p3.getByRole('heading',{name:t.rows.heading})).toBeVisible();assert.equal(new URL(p3.url()).hash,'');
  await p3.reload();await expect(p3.getByRole('heading',{name:t.rows.heading})).toBeVisible();
  // closing the door: unknown entrance token
  const bad=await c3.newPage();await bad.goto(`/ja/group/${'a'.repeat(43)}`);await expect(bad.getByText(t.closed)).toBeVisible();
  await c1.close();await c2.close();await c3.close();
 });

 await check('CSV: errors name row and column and import nothing; formula text stays inert; export prefixes it; unknown/PII columns are refused',async()=>{
  const t=GROUP_COPY.ja,c=await ctx(1440,900,{acceptDownloads:true}),page=await c.newPage();await openEntrance(page,'ja');await fillStart(page,'ja','SYNTHETIC CSV','2035-03-03','2');
  await importCsv(page,'ja','﻿メンバーID,参加者表示名,競技,用品,グレード,貸出開始時年齢,身長(cm),体重(kg),足の実測長(cm),スキーヤータイプ\r\n,A,SKI,SET,REGULAR,34,1.7,65,25.5,TYPE_II\r\n,B,SKI,SET,REGULAR,34,170,65kg,25.5,TYPE_II\r\n',false);
  const alert=page.getByRole('alert').filter({hasText:t.rows.parseFail});await expect(alert).toBeVisible();const text=await alert.innerText();assert.match(text,/2行目/);assert.match(text,/3行目/);await expect(cards(page)).toHaveCount(0);
  await importCsv(page,'ja','﻿メンバーID,生年月日,競技,用品,グレード\r\n',false);await expect(page.getByRole('alert').filter({hasText:t.rows.parseFail})).toBeVisible();
  await importCsv(page,'ja',serializeGroupCsvRows([row('=1+1'),row('@SUM(A1)',{ageAtStart:35})],'JA'),true);await expect(cards(page)).toHaveCount(2);
  // CSV contract: the importer never strips the export apostrophe, so an imported label is kept as the file had it; a label typed on screen is kept as typed.
  assert.equal(await cards(page).first().getByLabel(t.rows.fields.label,{exact:true}).inputValue(),"'=1+1");
  await cards(page).first().getByLabel(t.rows.fields.label,{exact:true}).fill('=1+1');assert.equal(await cards(page).first().getByLabel(t.rows.fields.label,{exact:true}).inputValue(),'=1+1');
  const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:t.rows.dlCurrent,exact:true}).click()]);const out=await readFile((await d.path())!,'utf8');assert.match(out,/'=1\+1/);assert.match(out,/'@SUM\(A1\)/);
  assert.equal(await page.locator('main a[href^="javascript:"]').count(),0);
  await c.close();
 });

 await check('SIZE-EDGE and per-guest choice in the browser: edge shows the notice and needs the store-fit acknowledgement; a manual-fit row blocks; shorter is chosen and saved; the row id stays',async()=>{
  const t=GROUP_COPY.ja,c=await ctx(390,844),page=await c.newPage();
  await openEntrance(page,'ja');await fillStart(page,'ja','SYNTHETIC Edge','2035-04-20','3');
  await importCsv(page,'ja',serializeGroupCsvRows([row('N1'),row('E1',{heightCm:215}),row('M1',{heightCm:235})],'JA'),true);await expect(cards(page)).toHaveCount(3);
  await page.getByRole('button',{name:t.rows.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();
  const states=await page.getByTestId('row-state').allTextContents();assert.deepEqual(states,[t.rows.status.READY,t.rows.status.EDGE,t.rows.status.MANUAL_FIT_REQUIRED]);
  await expect(page.getByText('店舗で適合確認が必要です。').first()).toBeVisible();await expect(page.getByText(/自動での確保・お支払いは行いません/)).toBeVisible();
  await expect(page.getByRole('button',{name:t.advice.next,exact:true})).toBeDisabled();
  // fix the manual-fit row on the list (keeps the other rows), check again
  await page.getByRole('button',{name:t.advice.fixRow,exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+t.rows.filter.all)}).click();
  await cards(page).nth(2).getByLabel(t.rows.fields.height,{exact:true}).fill('170');await page.getByRole('button',{name:t.rows.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();
  assert.deepEqual(await page.getByTestId('row-state').allTextContents(),[t.rows.status.READY,t.rows.status.EDGE,t.rows.status.READY]);
  // per-guest direction: guest 1 takes the shorter ski
  const shorter=page.getByRole('radio',{name:new RegExp(t.advice.direction.SHORTER)}).first();await shorter.check();await expect(shorter).toBeChecked();
  await page.getByRole('button',{name:t.advice.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.quote.heading})).toBeVisible();
  const submit=page.getByRole('button',{name:t.quote.submit,exact:true});await page.getByLabel(t.quote.agree,{exact:true}).check();await expect(submit).toBeDisabled();
  await page.getByLabel(t.quote.fit,{exact:true}).check();await expect(submit).toBeEnabled();
  const g=(await q("SELECT id FROM group_orders WHERE group_label='SYNTHETIC Edge'")).rows[0];
  const ids=(await q('SELECT id,profile,selection,fit FROM group_members WHERE group_id=$1 ORDER BY ordinal',[g.id])).rows;assert.equal(ids[0].profile.direction,'SHORTER');assert.equal(ids[1].fit.requiresStoreConfirmation,true);assert.equal(ids[2].fit.requiresStoreConfirmation??false,false);
  assert.notEqual(ids[0].selection.items[0].variantIds[0],ids[2].selection.items[0].variantIds[0],'guest 1 holds a different (shorter) ski than guest 3');
  await submit.click();await expect(page.getByTestId('group-status')).toHaveAttribute('data-status','REVIEW_HELD');
  assert.deepEqual((await q('SELECT id FROM group_members WHERE group_id=$1 ORDER BY ordinal',[g.id])).rows.map(r=>r.id),ids.map(r=>r.id),'row ids are stable through submit');
  await noOverflow(page);await c.close();
 });

 await check('shortage in the browser: advice names the short rows (filter), a late stock loss makes submit fail with nothing held and the rows editable',async()=>{
  const t=GROUP_COPY.ja,c=await ctx(1440),page=await c.newPage();
  await openEntrance(page,'ja');await fillStart(page,'ja','SYNTHETIC Short','2035-04-10','5');
  const five=serializeGroupCsvRows(Array.from({length:5},(_,i)=>row('S'+i)),'JA');await importCsv(page,'ja',five,true);await expect(cards(page)).toHaveCount(5);
  await page.getByRole('button',{name:t.rows.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();await page.getByRole('button',{name:t.advice.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.quote.heading})).toBeVisible();
  // other groups take the stock (two 70-person groups = 140 of the 142 public units) before this one is sent
  const token=app.entranceToken;
  for(let n=0;n<2;n++){const s=randomUUID(),secret=Buffer.from(randomUUID().replace(/-/g,'')+randomUUID().replace(/-/g,'')).toString('base64url').slice(0,43);
   const st=await app.svc.startApplication(token,s,secret,{groupLabel:'SYNTHETIC Rival '+n,contactName:'r',contactEmail:'r@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',contractVersion:'INTEGRATED_V1_4',period:{startDate:'2035-04-10',endDate:'2035-04-10',slot:'DAY',startAt:'08:30',returnBy:'17:00'}});
   const owner={kind:'OWNER' as const,groupId:st.groupId,secret};
   const m=await app.svc.saveMembers(owner,st.groupId,st.revision,Array.from({length:70},(_,i)=>({...skiMember('r'+i),profile:{heightCm:170,footCm:25.5,synthetic:true}})));
   const qt=await app.svc.quote(owner,st.groupId,m.revision);await app.svc.consent(owner,st.groupId,{quoteId:qt.quoteId,digest:qt.digest,termsVersion:'SYNTHETIC',termsSha256:'a'.repeat(64),explanationConfirmed:true});
   await app.svc.submit(owner,st.groupId,{requestKey:randomUUID(),expectedRevision:qt.revision,quoteId:qt.quoteId});}
  const before=await groupHolds();
  await page.getByLabel(t.quote.agree,{exact:true}).check();await page.getByRole('button',{name:t.quote.submit,exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:t.quote.failTitle})).toBeVisible();assert.equal(await groupHolds(),before,'nothing held for the failed group');
  assert.equal((await q("SELECT status FROM group_orders WHERE group_label='SYNTHETIC Short'")).rows[0].status,'QUOTED');
  await page.getByRole('button',{name:t.quote.back,exact:true}).click();await page.getByRole('button',{name:t.rows.next,exact:true}).click();
  await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:t.advice.jointShort})).toBeVisible();
  assert.ok((await page.getByTestId('row-state').allTextContents()).includes(t.rows.status.SHORT));await expect(page.getByRole('button',{name:t.advice.next,exact:true})).toBeDisabled();
  await page.getByRole('button',{name:t.advice.fixRow,exact:true}).first().click();await expect(page.getByRole('heading',{name:t.rows.heading})).toBeVisible();await expect(cards(page).first()).toBeVisible();
  await c.close();
 });

 await check('100 members through the browser (development server build): import, one edit, advice, quote, submit; responsive, no duplicate calls',async()=>{
  const t=GROUP_COPY.en,c=await ctx(1440),page=await c.newPage();
  // free the stock taken above so a full 100 fits
  for(const g of (await q("SELECT id,revision FROM group_orders WHERE group_label LIKE 'SYNTHETIC Rival%' OR group_label='SYNTHETIC Short'")).rows)if((await q('SELECT status FROM group_orders WHERE id=$1',[g.id])).rows[0].status==='REVIEW_HELD')await app.svc.release(app.admin,g.id,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});
  await openEntrance(page,'en');await fillStart(page,'en','SYNTHETIC Hundred','2035-05-10','100');
  const rows=Array.from({length:100},(_,i)=>i%4===3?row('H'+i,{sport:'SNOWBOARD',equipment:{kind:'ITEMS',items:['SNOWBOARD','SNOWBOARD_BOOT']},weightKg:null,skierType:null}):row('H'+i,{heightCm:168+(i%5)}));
  let t0=performance.now();await importCsv(page,'en',serializeGroupCsvRows(rows,'EN'),false);await expect(page.getByText(`${t.rows.diff.ADD} 100`)).toBeVisible();await page.getByRole('button',{name:t.rows.apply,exact:true}).click();await expect(cards(page)).toHaveCount(100);
  console.log('PERF_UI import+render 100 rows '+Math.round(performance.now()-t0)+' ms (dev server)');
  t0=performance.now();await cards(page).nth(50).getByLabel(t.rows.fields.height,{exact:true}).fill('171');const typed=Math.round(performance.now()-t0);console.log('PERF_UI edit one of 100 rows '+typed+' ms (dev server)');
  await noOverflow(page);
  const reqs:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/group'))reqs.push(r.method()+' '+u.pathname.replace(/[a-f0-9-]{36}/,':id'));});
  t0=performance.now();await page.getByRole('button',{name:t.rows.next,exact:true}).dblclick();await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();console.log('PERF_UI advise 100 '+Math.round(performance.now()-t0)+' ms (dev server)');
  assert.equal(reqs.filter(r=>/advise/.test(r)).length,1);
  await expect(page.getByText(/100 guests/)).toBeVisible();
  t0=performance.now();await page.getByRole('button',{name:t.advice.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.quote.heading})).toBeVisible();console.log('PERF_UI save+quote 100 '+Math.round(performance.now()-t0)+' ms (dev server)');
  await expect(page.locator('.group-quote-lines li')).toHaveCount(100);await noOverflow(page);
  await page.getByLabel(t.quote.agree,{exact:true}).check();t0=performance.now();await page.getByRole('button',{name:t.quote.submit,exact:true}).click();await expect(page.getByTestId('group-status')).toHaveAttribute('data-status','REVIEW_HELD');console.log('PERF_UI submit 100 '+Math.round(performance.now()-t0)+' ms (dev server)');
  const g=(await q("SELECT id FROM group_orders WHERE group_label='SYNTHETIC Hundred'")).rows[0];assert.equal(Number((await q('SELECT count(*) n FROM group_order_parts WHERE group_id=$1 AND active',[g.id])).rows[0].n),5);
  assert.equal(reqs.filter(r=>/consent|submit/.test(r)).length,2);
  await c.close();
 });

 await check('reflow: 320px and 720px (200% zoom equivalents of 640 and 1440) have no horizontal scroll on every step',async()=>{
  for(const width of [320,720]){const t=GROUP_COPY.ja,c=await ctx(width,700),page=await c.newPage();await openEntrance(page,'ja');await noOverflow(page);await fillStart(page,'ja','SYNTHETIC Reflow '+width,'2035-06-0'+(width===320?1:2),'2');
   await importCsv(page,'ja',serializeGroupCsvRows([row('R1'),row('R2')],'JA'),true);await noOverflow(page);
   await page.getByRole('button',{name:t.rows.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.advice.heading})).toBeVisible();await noOverflow(page);
   await page.getByRole('button',{name:t.advice.next,exact:true}).click();await expect(page.getByRole('heading',{name:t.quote.heading})).toBeVisible();await noOverflow(page);await c.close();}
 });

 await check('keyboard: the whole of step 1 and the row editor can be completed without a pointer; focus lands on the step heading',async()=>{
  const t=GROUP_COPY.en,c=await ctx(1440),page=await c.newPage();await openEntrance(page,'en');
  await page.getByLabel(t.form.group,{exact:true}).focus();
  for(const v of ['SYNTHETIC Keyboard','SYNTHETIC Rep','synthetic-rep@example.invalid','']){await page.keyboard.type(v);await page.keyboard.press('Tab');}
  await page.getByLabel(t.form.start,{exact:true}).fill('2035-07-01');await page.getByLabel(t.form.end,{exact:true}).fill('2035-07-01');
  await page.getByLabel(t.form.people,{exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:t.rows.heading})).toBeVisible();await expect(page.locator('h1')).toBeFocused();
  await page.getByRole('button',{name:t.rows.add,exact:true}).focus();await page.keyboard.press('Enter');await expect(cards(page)).toHaveCount(1);
  await c.close();
 });

 await check('no online payment anywhere: group pages and API never reference booking/payment endpoints; nothing in the database',async()=>{
  assert.equal(Number((await q('SELECT count(*) n FROM rental_payment_attempts')).rows[0].n),0);assert.equal(Number((await q('SELECT count(*) n FROM rental_provider_events')).rows[0].n),0);
  assert.equal(Number((await q('SELECT count(*) n FROM rental_bookings')).rows[0].n),0);
 });
 console.log(`GROUP customer UI/Chromium/PostgreSQL: ${count} passed, 0 skipped. Development server (next dev), synthetic data. No production build run here; no real email or payment.`);
}catch(e){failed=true;console.error('GROUP_CUSTOMER_UI_FAILED '+stage+' '+(e as Error).name+': '+(e as Error).message?.slice(0,900));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}).slice(0,600));console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/group/')).join('\n'));if(last){console.error('LAST_PAGE '+new URL(last.url()).pathname.replace(/[A-Za-z0-9_-]{43}/g,':t'));console.error('PAGE_TEXT '+(await last.locator('main').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,1800));}console.error(app.logs.slice(-6).join('\n'));}
finally{await browser.close();await app.stop();}
if(failed)process.exit(1);
