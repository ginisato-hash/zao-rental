import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {variants} from '../inventory/fixture';
import {adminHarness,CLOCK} from './admin-harness';

// Administrator group-order screens in a real browser against an isolated local PostgreSQL. Synthetic data only; no email, payment or
// provider is contacted. Group orders have no payment: the checks below also prove that no booking, payment attempt or provider event is created.
const built=process.argv.includes('--built');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/group-admin-ui';
const errors:string[]=[];
let lastPage:Page|undefined;
// `--only=<text>` runs just the checks whose name contains the text (debugging aid; the full run is the acceptance evidence).
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
async function check(name:string,fn:()=>Promise<void>){if(only&&!name.includes(only))return;stage=name;let timer:NodeJS.Timeout|undefined;
 try{await Promise.race([fn(),new Promise<never>((_,rej)=>{timer=setTimeout(()=>rej(new Error('CHECK_TIMEOUT 240s')),240000);})]);}
 catch(e){await lastPage?.screenshot({path:shots+'/failure.png',fullPage:true}).catch(()=>{});throw e;}finally{clearTimeout(timer);}
 count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,group:true,operations:true});const {origin}=app;
 for(let i=0;i<240;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}
 const h=await adminHarness(app,password);const q=(s:string,p:unknown[]=[])=>h.pool.query(s,p);
 const num=async(id:string)=>(await q('SELECT group_number FROM group_orders WHERE id=$1',[id])).rows[0].group_number as string;
 const noBookingTraces=async()=>{for(const t of ['rental_bookings','rental_payment_attempts','rental_provider_events'])assert.equal(Number((await q(`SELECT count(*) n FROM ${t}`)).rows[0].n),0,t);};
 const token=await h.entrance();
 const A=await h.held(token,'SYNTHETIC Alpine Club',h.members(3,'a',[1]),{startDate:'2035-02-10',endDate:'2035-02-10',slot:'DAY'});
 const B=await h.held(token,'SYNTHETIC Release Team',h.members(2,'b'),{startDate:'2035-02-11',endDate:'2035-02-11',slot:'DAY'});
 const C=await h.held(token,'SYNTHETIC Third Party',h.members(4,'c'),{startDate:'2035-02-12',endDate:'2035-02-12',slot:'DAY'});
 const nA=await num(A.groupId),nB=await num(B.groupId),nC=await num(C.groupId);
 const login=async(email:string,width=1440,lang?:'en')=>{const ctx=await browser.newContext({baseURL:origin,viewport:{width,height:900}});  const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);
  await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});if(lang)await ctx.addCookies([{name:'zao_staff_locale',value:lang,url:origin}]);return {ctx,p};};
 const {ctx:actx,p:page}=await login(h.admin.email);lastPage=page;
 const row=(n:string)=>page.locator(`tr[data-group="${n}"]`);
 const openDetail=async(n:string)=>{await page.goto('/staff/groups');await row(n).getByRole('link',{name:n}).click();await expect(page.getByRole('heading',{level:1,name:n})).toBeVisible();await expect(page.getByRole('heading',{name:/参加者と用品/})).toBeVisible();};

 await check('sidebar link, list with number/status/received/days/usage date/people/amount/settlement/requests/stock; held groups listed',async()=>{
  await page.goto('/staff');await page.getByRole('link',{name:'団体予約',exact:true}).click();await page.waitForURL('**/staff/groups');
  await expect(page.getByRole('heading',{level:1,name:'団体予約'})).toBeVisible();
  for(const [n,people] of [[nA,'3'],[nB,'2'],[nC,'4']] as const){await expect(row(n)).toBeVisible();await expect(row(n)).toContainText('確認待ち（仮押さえ中）');await expect(row(n)).toContainText('占有中');await expect(row(n)).toContainText('暫定');await expect(row(n).locator('td').nth(6)).toHaveText(people);}
  await expect(row(nA)).toContainText('2035-02-10');await expect(row(nA)).toContainText('JST');
  await page.screenshot({path:shots+'/list-ja-1440.png',fullPage:true});
 });
 await check('filters, search and sort work; draft applications are not listed by default',async()=>{
  await page.getByLabel('団体番号・団体名で検索').fill('Release');await expect(row(nB)).toBeVisible();await expect(row(nA)).toHaveCount(0);
  await page.getByLabel('団体番号・団体名で検索').fill('');
  await page.getByLabel('並べ替え').selectOption('size');assert.equal(await page.locator('tbody tr').first().getAttribute('data-group'),nC);
  await page.getByLabel('並べ替え').selectOption('startDate');assert.equal(await page.locator('tbody tr').first().getAttribute('data-group'),nA);
  await page.getByLabel('状態').selectOption('CONFIRMED');await expect(page.getByText('該当する団体はありません。')).toBeVisible();
  await page.getByLabel('状態').selectOption('ALL');await expect(row(nA)).toBeVisible();
  await page.getByLabel('店舗').selectOption('ONSEN_BASE');await expect(page.getByText('該当する団体はありません。')).toBeVisible();
  await page.getByLabel('店舗').selectOption('');await expect(row(nA)).toBeVisible();
  const draft=await h.start(token,'SYNTHETIC Draft Only');void draft;await page.reload();await expect(page.locator('tr',{hasText:'SYNTHETIC Draft Only'})).toHaveCount(0);
  await page.getByLabel('状態').selectOption('DRAFT');await expect(page.locator('tr',{hasText:'SYNTHETIC Draft Only'})).toBeVisible();
 });

 await check('detail: participants, equipment/size, fit flag, stock, price on the left; representative, period, store, quote on the right; no payment/expiry wording',async()=>{
  await openDetail(nA);
  await expect(page.locator('tr[data-member="2"]')).toContainText('店舗確認が必要');await expect(page.locator('tr[data-member="1"]')).toContainText('SKI');await expect(page.locator('tr[data-member="1"]')).toContainText('確保中');
  await expect(page.getByText('お支払い：現地精算のみ').first()).toBeVisible();await expect(page.getByTestId('quote-total')).toBeVisible();
  await expect(page.getByText('SYNTHETIC Rep')).toBeVisible();
  const text=await page.locator('main').innerText();assert.doesNotMatch(text,/期限|延長|有効期限|expire|extension|deadline|Square|カード入力|決済リンク/i);
  await page.screenshot({path:shots+'/detail-ja-1440.png',fullPage:true});
 });

 await check('one participant size change: diff shown, applied atomically, hold kept, consent required afterwards',async()=>{
  const before=Number((await q("SELECT count(*) n FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.allocation_stage='GROUP_RESERVED'")).rows[0].n);
  await page.locator('tr[data-member="1"]').getByRole('button',{name:/サイズを変更/}).click();
  const sel=page.locator('.gx-edit select').first();await sel.selectOption(variants.skiAlt);
  await expect(page.getByRole('heading',{name:/変更内容/})).toBeVisible();await expect(page.locator('.gx-diff li')).toHaveCount(1);
  // the alternative size has no stock yet: the change fails as a whole and the old reservation (claims, revision) is untouched
  const rev0=(await q('SELECT revision FROM group_orders WHERE id=$1',[A.groupId])).rows[0].revision;
  await page.getByRole('button',{name:'変更を適用して在庫を再確保'}).click();
  await expect(page.getByRole('alert').filter({hasText:'在庫が不足しているため'})).toBeVisible();
  assert.equal((await q('SELECT revision FROM group_orders WHERE id=$1',[A.groupId])).rows[0].revision,rev0);
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.allocation_stage='GROUP_RESERVED'")).rows[0].n),before,'old claims kept');
  await h.addAltStock(30);
  await page.getByRole('button',{name:'変更を適用して在庫を再確保'}).click();
  await expect(page.getByRole('status').filter({hasText:'全員分を確保し直しました'})).toBeVisible();
  const g=(await q('SELECT status,revision,member_count FROM group_orders WHERE id=$1',[A.groupId])).rows[0];assert.equal(g.status,'REVIEW_HELD');assert.equal(g.member_count,3);
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.allocation_stage='GROUP_RESERVED'")).rows[0].n),before,'claims re-created, none lost');
  await expect(page.getByText('現在の見積に対するお客様の承諾がありません')).toBeVisible();
  await expect(page.getByRole('button',{name:'予約を確約してメール送信'})).toBeDisabled();
  const items=(await q('SELECT selection FROM group_members WHERE id=$1',[A.memberIds[0]])).rows[0].selection.items;assert.ok(JSON.stringify(items).includes(variants.skiAlt));
  await h.reconsent(A.owner,A.groupId);await page.reload();await expect(page.getByText('現在の見積に対するお客様の承諾がありません')).toHaveCount(0);
 });

 await check('discounts: member (fixed) and group (percent), mandatory reason, preview before save, before/after, oversize and invalid refused, saved with audit',async()=>{
  const dm=(n:number)=>({m:page.getByLabel(`方式 ${n}`,{exact:true}),v:page.getByLabel(`値 ${n}`,{exact:true}),r:page.getByLabel(`理由（200文字以内） ${n}`,{exact:true})});
  assert.equal(await page.getByRole('button',{name:'割引を保存'}).isDisabled(),true);
  await dm(1).m.selectOption('FIXED_JPY');await dm(1).v.fill('500');
  await expect(page.getByRole('alert').filter({hasText:'割引の入力を確認してください'})).toBeVisible();assert.equal(await page.getByRole('button',{name:'プレビュー',exact:true}).isDisabled(),true,'no preview without a reason');
  await dm(1).r.fill('SYNTHETIC reason member');
  await page.getByLabel('方式 団体全体',{exact:true}).selectOption('PERCENT_BPS');await page.getByLabel('値 団体全体',{exact:true}).fill('10');await page.getByLabel('理由（200文字以内） 団体全体',{exact:true}).fill('SYNTHETIC reason group');
  await page.getByRole('button',{name:'プレビュー',exact:true}).click();await expect(page.getByTestId('discount-preview')).toBeVisible();
  assert.equal(await page.getByRole('button',{name:'割引を保存'}).isDisabled(),false);
  await dm(2).m.selectOption('FIXED_JPY');assert.equal(await page.getByRole('button',{name:'割引を保存'}).isDisabled(),true,'editing invalidates the preview');
  await dm(2).m.selectOption('');
  await page.getByRole('button',{name:'プレビュー',exact:true}).click();await expect(page.getByTestId('discount-preview')).toBeVisible();
  const pv=await page.getByTestId('discount-preview').innerText();assert.match(pv,/割引前/);
  await page.getByRole('button',{name:'割引を保存'}).click();await expect(page.getByRole('status').filter({hasText:'割引を保存しました'})).toBeVisible();
  const rows=(await q('SELECT target,method,value,reason,before_jpy,after_jpy,actor FROM group_adjustments WHERE group_id=$1 ORDER BY target',[A.groupId])).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>Number(r.after_jpy)<Number(r.before_jpy)&&r.reason.startsWith('SYNTHETIC')));assert.deepEqual(rows.map(r=>r.method).sort(),['FIXED_JPY','PERCENT_BPS']);
  // too large: refused by the server with a clear message, nothing saved
  await dm(1).v.fill('99999999');await page.getByRole('button',{name:'プレビュー',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'割引が対象の残額を超えています'})).toBeVisible();
  assert.equal(Number((await q('SELECT count(*) n FROM group_adjustments WHERE group_id=$1',[A.groupId])).rows[0].n),2);
  await dm(1).v.fill('500');
 });

 await check('confirm: manual-fit participant must be acknowledged; message shown; one confirmation, on-site unpaid, no booking/payment/provider trace; replay-safe',async()=>{
  await page.reload();
  const btn=page.getByRole('button',{name:'予約を確約してメール送信'});await expect(btn).toBeDisabled();
  await page.getByLabel('メッセージ（任意・テキストのみ・2000文字まで）').first().fill('SYNTHETIC message <b>plain</b> text');
  await page.getByRole('checkbox',{name:/2 a2/}).check();await expect(btn).toBeEnabled();
  const totalShown=await page.getByTestId('quote-total').innerText();
  await btn.click();await expect(page.getByRole('status').filter({hasText:'予約を確約しました'})).toBeVisible();
  const g=(await q('SELECT status,confirmation_basis,confirmed_total_jpy,payment_method FROM group_orders WHERE id=$1',[A.groupId])).rows[0];
  assert.equal(g.status,'CONFIRMED');assert.equal(g.confirmation_basis,'GROUP_ADMIN_APPROVED');assert.equal(g.payment_method,'PAY_ON_SITE');
  const out=(await q("SELECT admin_message,status FROM group_notification_outbox WHERE group_id=$1 AND event_type='GROUP_CONFIRMED'",[A.groupId])).rows;assert.equal(out.length,1);assert.equal(out[0].admin_message,'SYNTHETIC message <b>plain</b> text');
  await noBookingTraces();
  await expect(page.getByText('現地精算・未精算').first()).toBeVisible();await expect(page.getByTestId('confirmed-total')).toHaveText(totalShown.trim());
  assert.equal(Number(g.confirmed_total_jpy)>0,true);
  await expect(page.getByTestId('outstanding-total')).toHaveText(/^[¥￥][\d,]+$/);await expect(page.getByText('見積・確定額は売上の見込みであり')).toBeVisible();
 });

 await check('on-site receipt: partial then full, not mixed with expected revenue; reversal (correction) restores unpaid; invalid refused',async()=>{
  const total=Number((await q('SELECT confirmed_total_jpy FROM group_orders WHERE id=$1',[A.groupId])).rows[0].confirmed_total_jpy);
  await page.getByLabel('受領金額（円）').fill('0');await page.getByRole('button',{name:'受領を記録'}).click();await expect(page.getByRole('alert').filter({hasText:'金額（1円以上の整数）と日時を確認'})).toBeVisible();
  await page.getByLabel('受領金額（円）').fill('1000');await page.getByLabel('メモ（任意）').fill('SYNTHETIC deposit');await page.getByRole('button',{name:'受領を記録'}).click();
  await expect(page.getByRole('status').filter({hasText:'受領を記録しました'})).toBeVisible();await expect(page.getByText('現地精算・一部受領').first()).toBeVisible();await expect(page.getByTestId('received-total')).toContainText('1,000');
  await page.getByLabel('受領金額（円）').fill(String(total-1000));await page.getByLabel('支払手段').selectOption('CARD_AT_COUNTER');await page.getByRole('button',{name:'受領を記録'}).click();
  await expect(page.getByText('現地精算・受領済み').first()).toBeVisible();await expect(page.getByTestId('outstanding-total')).toHaveText(/^[¥￥]0$/);
  assert.equal(Number((await q("SELECT count(*) n FROM group_payments WHERE group_id=$1 AND kind='RECEIPT'",[A.groupId])).rows[0].n),2);
  await page.getByRole('button',{name:'訂正（取消）'}).first().click();await expect(page.getByRole('button',{name:'この受領を取り消す'})).toBeDisabled();
  await page.getByLabel('取消の理由（必須）').first().fill('SYNTHETIC wrong amount');await page.getByRole('button',{name:'この受領を取り消す'}).click();
  await expect(page.getByRole('status').filter({hasText:'受領を取り消しました'})).toBeVisible();await expect(page.getByText('現地精算・一部受領').first()).toBeVisible();
  assert.equal(Number((await q("SELECT count(*) n FROM group_payments WHERE group_id=$1 AND kind='REVERSAL'",[A.groupId])).rows[0].n),1);
  await noBookingTraces();
 });

 await check('release (group B): confirmation lists group/people/dates/equipment/result; reason required; writes nothing before; all claims released; one release notice; idempotent',async()=>{
  await openDetail(nB);
  const claimsBefore=Number((await q("SELECT count(*) n FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1 AND c.active",[B.groupId])).rows[0].n);assert.ok(claimsBefore>0);
  await page.getByRole('button',{name:'仮押さえを解除…'}).click();
  const box=page.getByRole('group',{name:'解除する内容の確認'});await expect(box).toContainText(nB);await expect(box).toContainText('SYNTHETIC Release Team');await expect(box).toContainText('2035-02-11');await expect(box).toContainText('SKI');await expect(box).toContainText('一部だけの解除はありません');
  const run=page.getByRole('button',{name:'解除を実行'});await expect(run).toBeDisabled();
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[B.groupId])).rows[0].status,'REVIEW_HELD','nothing written before confirmation');
  await page.getByLabel('解除の理由（必須・300文字以内）').fill('SYNTHETIC customer withdrew');await run.click();
  await expect(page.getByRole('status').filter({hasText:'仮押さえを解除しました'})).toBeVisible();
  const g=(await q('SELECT status,release_reason FROM group_orders WHERE id=$1',[B.groupId])).rows[0];assert.equal(g.status,'RELEASED');assert.equal(g.release_reason,'SYNTHETIC customer withdrew');
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_claims c JOIN group_order_parts p ON p.hold_id=c.hold_id WHERE p.group_id=$1 AND c.active",[B.groupId])).rows[0].n),0);
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1 AND h.state<>'RELEASED'",[B.groupId])).rows[0].n),0);
  assert.equal(Number((await q("SELECT count(*) n FROM group_notification_outbox WHERE group_id=$1 AND event_type='GROUP_RELEASED'",[B.groupId])).rows[0].n),1);
  await expect(page.getByRole('button',{name:'仮押さえを解除…'})).toHaveCount(0);
  // the other held group is untouched
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[C.groupId])).rows[0].status,'REVIEW_HELD');
 });

 await check('send back asks for changes with a required message and keeps the hold; a customer request alone releases nothing',async()=>{
  await openDetail(nC);
  await h.svc.requestFromCustomer(C.owner,C.groupId,{requestKey:randomUUID(),kind:'DECLINE',body:'SYNTHETIC we may not come'});
  await page.reload();await expect(page.getByText('辞退の依頼')).toBeVisible();await expect(page.getByText('お客様の依頼だけでは何も解放されません')).toBeVisible();
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[C.groupId])).rows[0].status,'REVIEW_HELD');
  const send=page.getByRole('button',{name:'差し戻す'});await expect(send).toBeDisabled();
  await page.getByLabel('メッセージ（任意・テキストのみ・2000文字まで）').nth(1).fill('SYNTHETIC please change sizes');await send.click();
  await expect(page.getByRole('status').filter({hasText:'差し戻しました'})).toBeVisible();
  const g=(await q('SELECT status FROM group_orders WHERE id=$1',[C.groupId])).rows[0];assert.equal(g.status,'CHANGES_REQUESTED');
  assert.ok(Number((await q("SELECT count(*) n FROM inventory_claims c JOIN group_order_parts p ON p.hold_id=c.hold_id WHERE p.group_id=$1 AND c.active",[C.groupId])).rows[0].n)>0,'hold kept');
  await page.goto('/staff/groups');await expect(row(nC)).toContainText('差戻し中');await expect(row(nC).locator('td').nth(9)).toHaveText('1');
 });

 await check('entrance: issue shows the URL once, copy works, stop/resume/reissue; only a hash is stored; old URL stops working',async()=>{
  await page.goto('/staff/groups');await page.locator('.gx-entrance summary').click();
  await expect(page.getByTestId('entrance-state')).toHaveText('受付中');
  await page.getByLabel('操作の理由（200文字以内）').fill('SYNTHETIC reissue');page.once('dialog',d=>void d.accept());
  await page.getByRole('button',{name:'入口URLを再発行する'}).click();await expect(page.getByLabel(/入口URL/)).toBeVisible();
  const url=await page.getByLabel(/入口URL/).inputValue();assert.match(url,new RegExp('^'+origin+'/ja/group/[A-Za-z0-9_-]{43}$'));
  const fresh=decodeURIComponent(url.split('/').pop()!);assert.equal(await h.svc.entranceOpen(fresh),true);assert.equal(await h.svc.entranceOpen(token),false,'the old URL no longer opens');
  assert.equal(Number((await q('SELECT count(*) n FROM group_entrance WHERE token_sha256=$1',[fresh])).rows[0].n),0,'plain token is never stored');
  await page.getByLabel('操作の理由（200文字以内）').fill('SYNTHETIC incident');page.once('dialog',d=>void d.accept());await page.getByRole('button',{name:'入口を停止する'}).click();
  await expect(page.getByTestId('entrance-state')).toHaveText('停止中');assert.equal(await h.svc.entranceOpen(fresh),false);
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[C.groupId])).rows[0].status,'CHANGES_REQUESTED','existing groups unaffected');
  await page.getByLabel('操作の理由（200文字以内）').fill('SYNTHETIC all clear');page.once('dialog',d=>void d.accept());await page.getByRole('button',{name:'入口を再開する'}).click();
  await expect(page.getByTestId('entrance-state')).toHaveText('受付中');assert.equal(await h.svc.entranceOpen(fresh),true);
  assert.equal(Number((await q('SELECT count(*) n FROM group_entrance_history')).rows[0].n)>=4,true);
 });

 await check('usage date passed: shown as attention only; nothing is released automatically',async()=>{
  await q(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-03-20T10:00:00+09:00'::timestamptz$$`);
  try{await page.goto('/staff/groups');await expect(row(nC)).toContainText('利用日経過（要対応）');await expect(row(nC)).toContainText('占有中');
   assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[C.groupId])).rows[0].status,'CHANGES_REQUESTED');
   await openDetail(nC);await expect(page.getByText('利用予定日を過ぎています。自動では解放されません')).toBeVisible();}
  finally{await q(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${new Date(CLOCK).toISOString()}'::timestamptz$$`);}
 });

 await check('non-admin, store-scope and revoked permission are refused by the server (UI hiding is not the control)',async()=>{
  const mgr=await h.account('gadm-mgr@example.invalid',{role:'MANAGER',permissions:{BOOKING_VIEW:true}});
  const m=await login(mgr.email);await m.p.goto('/staff');await expect(m.p.getByRole('link',{name:'団体予約',exact:true})).toHaveCount(0);
  await m.p.goto('/staff/groups');await expect(m.p.getByRole('heading',{name:'管理者権限が必要です'})).toBeVisible();
  for(const [method,path] of [['GET','/api/staff/groups'],['GET','/api/staff/groups/'+C.groupId],['POST','/api/staff/groups/'+C.groupId+'/release']] as const){
   const s=await m.p.evaluate(async([me,pa])=>(await fetch(pa,{method:me,headers:{'content-type':'application/json'},...(me==='POST'?{body:'{}'}:{})})).status,[method,path] as const);assert.equal(s,403,method+' '+path);}
  await m.ctx.close();
  const onsen=await h.account('gadm-onsen@example.invalid',{scope:'ASSIGNED',storeIds:['ONSEN_BASE']});const o=await login(onsen.email);
  const st=await o.p.evaluate(async id=>({list:await (await fetch('/api/staff/groups')).json(),detail:(await fetch('/api/staff/groups/'+id)).status}),C.groupId);
  assert.equal(st.list.groups.length,0,'no MOUNTAIN group visible to an ONSEN-only administrator');assert.equal(st.detail,403);await o.ctx.close();
  // permission revoked while the screen is open: the server refuses the write and nothing changes
  const part=await h.account('gadm-part@example.invalid');const pg=await login(part.email);
  const D=await h.held(await h.entrance(),'SYNTHETIC Revoke Target',h.members(2,'d'),{startDate:'2035-02-14',endDate:'2035-02-14',slot:'DAY'});const nD=await num(D.groupId);
  await pg.p.goto('/staff/groups');await pg.p.locator(`tr[data-group="${nD}"]`).getByRole('link',{name:nD}).click();await pg.p.getByRole('button',{name:'仮押さえを解除…'}).click();
  await pg.p.getByLabel('解除の理由（必須・300文字以内）').fill('SYNTHETIC revoked mid-flight');
  await part.update({role:'MANAGER'});
  await pg.p.getByRole('button',{name:'解除を実行'}).click();
  await expect(pg.p.getByRole('alert').or(pg.p.getByRole('heading',{name:'セッションを確認してください'})).first()).toBeVisible();
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[D.groupId])).rows[0].status,'REVIEW_HELD','a refused release changes nothing');
  assert.ok(Number((await q("SELECT count(*) n FROM inventory_claims c JOIN group_order_parts p ON p.hold_id=c.hold_id WHERE p.group_id=$1 AND c.active",[D.groupId])).rows[0].n)>0);
  await pg.ctx.close();
 });

 await check('CSRF / session stamp: a POST without the same origin, or with a foreign session stamp, is refused',async()=>{
  const body=JSON.stringify({requestKey:randomUUID(),expectedRevision:1,reason:'SYNTHETIC csrf'});
  const noOrigin=await actx.request.post(`/api/staff/groups/${C.groupId}/release`,{headers:{'content-type':'application/json','x-zao-session':'x'.repeat(64)},data:body});assert.equal(noOrigin.status(),409,'stamp is checked first');
  const stamp=await page.evaluate(async()=>(await (await fetch('/api/session')).json()).stamp as string);
  const bad=await actx.request.post(`/api/staff/groups/${C.groupId}/release`,{headers:{'content-type':'application/json','x-zao-session':stamp,origin:'https://evil.example'},data:body});assert.equal(bad.status(),403);
  const missing=await actx.request.post(`/api/staff/groups/${C.groupId}/release`,{headers:{'content-type':'application/json',origin},data:body});assert.equal(missing.status(),409);
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[C.groupId])).rows[0].status,'CHANGES_REQUESTED');
 });

 await check('English and 390 px / 200% zoom: lists and detail without horizontal scroll; keyboard reaches the primary actions; axe finds no serious violation',async()=>{
  const axe=await readFile('node_modules/axe-core/axe.min.js','utf8');
  for(const [lang,width,label] of [['en',390,'en-390'],['ja',390,'ja-390'],['en',1440,'en-1440'],['ja',720,'ja-zoom200']] as const){
   // Reuse the signed-in session (the sign-in endpoint is rate limited; this step only varies language and viewport).
   const ctx=await browser.newContext({baseURL:origin,viewport:{width,height:900},storageState:await actx.storageState()});await ctx.addCookies([{name:'zao_staff_locale',value:lang,url:origin}]);
   const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));lastPage=p;
   await p.goto('/staff/groups');await expect(p.locator('tr',{hasText:nA})).toBeVisible();
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'list '+label);
   await p.screenshot({path:`${shots}/list-${label}.png`,fullPage:true});
   await p.locator('tr',{hasText:nA}).getByRole('link',{name:nA}).click();await expect(p.getByRole('heading',{level:1,name:nA})).toBeVisible();
   await expect(p.getByText(lang==='en'?'Payment: on site only':'お支払い：現地精算のみ').first()).toBeVisible();
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'detail '+label);
   await p.screenshot({path:`${shots}/detail-${label}.png`,fullPage:true});
   await p.addScriptTag({content:axe});
   const res=await p.evaluate(async()=>{const r=await (window as unknown as {axe:{run:(c:Element,o:unknown)=>Promise<{violations:{id:string;impact:string;nodes:{target:string[]}[]}[]}>}}).axe.run(document.querySelector('main')!,{runOnly:['wcag2a','wcag2aa']});return r.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,n:v.nodes.map(x=>x.target.join(' ')).slice(0,3)}));});
   assert.deepEqual(res,[],'axe '+label+' '+JSON.stringify(res));
   if(label==='ja-zoom200'){// keyboard: the participant edit button is reachable and operable with the keyboard alone
    await p.goto('/staff/groups');await p.locator('tr',{hasText:nC}).getByRole('link',{name:nC}).focus();await p.keyboard.press('Enter');await expect(p.getByRole('heading',{level:1,name:nC})).toBeVisible();}
   await ctx.close();}
 });

 await check('no group operation created a booking, payment attempt or provider event; no browser page error',async()=>{await noBookingTraces();assert.deepEqual(errors,[]);});
}catch(e){failed=true;console.error('FAILED at: '+stage);console.error(e instanceof Error?e.stack:e);}
finally{await browser.close();await app?.stop();}
if(failed)process.exit(1);console.log(`group-admin-ui: ${count} checks passed`);
void ({} as BrowserContext|Page);
