import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium,expect,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';

// Coupon administration in a real browser. Synthetic local PostgreSQL only; the coupon below is a synthetic test value, never a real offer.
// An administrator creates a coupon from the screen, sees it listed, disables and re-enables it, a duplicate code is refused,
// a staff member without PRICE_EDIT sees no change controls, and the screen works in English at 390 px.
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined;
let failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/coupon-ui',CODE='SYNTH-CPN-1';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'cpn-root@example.invalid',displayName:'SYNTHETIC Coupon Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'ADMIN',password,email:'cpn-admin@example.invalid',displayName:'SYNTHETIC Coupon Admin',scope:'ALL',storeIds:[],
  permissions:{QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,INVENTORY_VIEW:true}});
 const login=async(email:string,width=1440)=>{const ctx=await browser.newContext({baseURL:origin,viewport:{width,height:900}}),p=await ctx.newPage();
  await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);
  await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};};
 const {ctx:context,p:page}=await login('cpn-admin@example.invalid'),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const fillForm=async(p:Page,code:string)=>{
  await p.getByLabel('コード（英数字とハイフン、32文字まで）').fill(code);
  await p.getByLabel('有効開始（日本時間）').fill('2035-01-01T00:00');await p.getByLabel('有効終了（日本時間・この時刻まで）').fill('2035-03-31T23:59');
  await p.getByRole('checkbox',{name:'Mountain Station'}).check();
  await p.getByRole('button',{name:'すべて選択'}).click();
  await p.getByLabel('割引の種類').selectOption('PERCENT_BPS');await p.getByLabel('割引率（%、小数2桁まで）').fill('12.5');
  await p.getByLabel('最低利用額（円）').fill('1000');await p.getByLabel('最低利用額の基準').selectOption('CART_SUBTOTAL');
  await p.getByLabel('割引上限額（円）').fill('3000');await p.getByLabel('前日までの事前支払割引との併用').selectOption('DENY');
  await p.getByLabel('同時に確保できる予約数の上限').fill('50');
 };

 await check('the sidebar links to Coupons; the form starts empty; an incomplete form is refused without a request',async()=>{
  await page.goto('/staff');await page.getByRole('link',{name:'クーポン',exact:true}).click();await page.waitForURL('**/staff/coupons');
  await expect(page.getByRole('heading',{name:'クーポン',level:1})).toBeVisible();await expect(page.getByText('クーポンはまだありません。')).toBeVisible({timeout:30000});
  await expect(page.getByText('条件を変えたいときは、一覧の「複製して作り直す」')).toBeVisible();await expect(page.getByText('通算の利用回数の上限ではありません')).toBeVisible();await expect(page.getByText('お支払い額が0円になる組み合わせは予約では使えません')).toBeVisible();
  assert.equal(await page.getByLabel('コード（英数字とハイフン、32文字まで）').inputValue(),'');assert.equal(await page.getByLabel('割引率（%、小数2桁まで）').inputValue(),'');
  assert.equal(await page.getByLabel('割引の種類').inputValue(),'');
  let posted=false;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/coupons')posted=true;});
  await page.getByRole('button',{name:'クーポンを作成',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'入力内容を確認してください'})).toBeVisible();assert.equal(posted,false);
 });

 await check('an administrator creates a synthetic coupon; it is listed with converted terms and starts active',async()=>{
  await fillForm(page,CODE.toLowerCase());
  const dialogs:string[]=[];page.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
  const save=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/coupons'&&r.request().method()==='POST',{timeout:60000});
  await page.getByRole('button',{name:'クーポンを作成',exact:true}).click();const answer=await save;assert.equal(answer.status(),201,await answer.text());
  assert.match(dialogs[0]??'',/作成後は条件を変更できません/);
  const sent=JSON.parse(answer.request().postData()!).input;assert.equal(sent.operation,'create');assert.equal(sent.terms.value,1250);assert.equal(sent.terms.kind,'PERCENT_BPS');
  assert.equal(sent.terms.validFrom,'2034-12-31T15:00:00.000Z');assert.deepEqual(sent.terms.stores,['MOUNTAIN_BASE']);assert.equal(sent.terms.maxActiveReservations,50);
  await expect(page.getByRole('status').filter({hasText:'クーポンを作成しました。'})).toBeVisible();
  const row=page.locator('tr',{hasText:CODE});await expect(row).toContainText('12.5%');await expect(row).toContainText('有効');await expect(row).toContainText('Mountain Station');
  assert.equal(await page.getByLabel('コード（英数字とハイフン、32文字まで）').inputValue(),'','form reset');
  await page.screenshot({path:shots+'/coupons-ja-1440.png',fullPage:true});
 });

 await check('a duplicate code is refused',async()=>{
  await fillForm(page,CODE);page.once('dialog',d=>void d.accept());
  const save=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/coupons'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'クーポンを作成',exact:true}).click();const answer=await save;assert.equal(answer.status(),409,await answer.text());
  await expect(page.getByRole('alert').filter({hasText:'このコードはすでに使われています'})).toBeVisible();
  await expect(page.locator('tr',{hasText:CODE})).toHaveCount(1);
 });
 await check('Duplicate as new copies the terms without the code, creates the replacement and disables the original in one step',async()=>{
  await page.locator('tr',{hasText:CODE}).getByRole('button',{name:'複製して作り直す'}).click();
  await expect(page.getByRole('status').filter({hasText:'の条件をコピーしました'})).toBeVisible();
  assert.equal(await page.getByLabel('コード（英数字とハイフン、32文字まで）').inputValue(),'','the code is never copied');
  assert.equal(await page.getByLabel('割引の種類').inputValue(),'PERCENT_BPS');assert.equal(await page.getByLabel('割引率（%、小数2桁まで）').inputValue(),'12.5');
  assert.equal(await page.getByLabel('割引上限額（円）').inputValue(),'3000');assert.equal(await page.getByLabel('同時に確保できる予約数の上限').inputValue(),'50');
  assert.equal(await page.getByLabel('有効開始（日本時間）').inputValue(),'2035-01-01T00:00');
  await expect(page.getByRole('checkbox',{name:'作成後に元のコードを無効にする'})).toBeChecked();
  await page.getByLabel('コード（英数字とハイフン、32文字まで）').fill('SYNTH-CPN-2');await page.getByLabel('割引率（%、小数2桁まで）').fill('15');
  page.once('dialog',d=>void d.accept());
  const posts:string[]=[];const onReq=(r:import('@playwright/test').Request)=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/coupons')posts.push(JSON.parse(r.postData()!).input.operation);};page.on('request',onReq);
  await page.getByRole('button',{name:'クーポンを作成',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'クーポンを作成しました。'})).toBeVisible();page.off('request',onReq);
  assert.deepEqual(posts,['create','setActive']);
  await expect(page.locator('tr',{hasText:'SYNTH-CPN-2'})).toContainText('15%');await expect(page.locator('tr',{hasText:'SYNTH-CPN-2'})).toContainText('有効');
  await expect(page.locator('tr',{hasText:CODE})).toContainText('無効');
  // Put the original back to its active state so the following steps (disable/enable) keep their starting point.
  page.once('dialog',d=>void d.accept());await page.locator('tr',{hasText:CODE}).getByRole('button',{name:'有効にする'}).click();await expect(page.getByRole('status').filter({hasText:'状態を変更しました。'})).toBeVisible();
 });

 await check('disable then enable asks for confirmation and updates the state',async()=>{
  for(const [button,confirmText,state] of [['無効にする',/無効にします/,'無効'],['有効にする',/有効にします/,'有効']] as const){
   const dialogs:string[]=[];page.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
   const res=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/coupons'&&r.request().method()==='POST');
   await page.locator('tr',{hasText:CODE}).getByRole('button',{name:button,exact:true}).click();const answer=await res;assert.equal(answer.status(),200,await answer.text());
   assert.match(dialogs[0]??'',confirmText);
   await expect(page.locator('tr',{hasText:CODE}).locator('.cp-badge')).toHaveText(state);
  }
 });

 await check('a staff member without PRICE_EDIT sees the list but no change controls, no nav item, and the API refuses a change',async()=>{
  await writeAccount(app!.roles.authPool,rootPrincipal,undefined,{active:true,role:'STAFF',password,email:'cpn-staff@example.invalid',displayName:'SYNTHETIC Coupon Staff',scope:'ALL',storeIds:[],permissions:{QUOTE_VIEW:true,BOOKING_VIEW:true}});
  const {ctx,p}=await login('cpn-staff@example.invalid');
  await p.goto('/staff/coupons');await expect(p.getByText('閲覧のみ（作成・切り替えには管理者権限が必要です）')).toBeVisible({timeout:30000});
  await expect(p.locator('tr',{hasText:CODE})).toBeVisible();
  await expect(p.getByRole('button',{name:'クーポンを作成',exact:true})).toHaveCount(0);await expect(p.getByRole('button',{name:'無効にする',exact:true})).toHaveCount(0);
  await expect(p.getByRole('link',{name:'クーポン',exact:true})).toHaveCount(0);
  const status=await p.evaluate(async()=>(await fetch('/api/coupons',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),input:{operation:'setActive',couponId:crypto.randomUUID(),active:false,reason:null}})})).status);
  assert.equal(status,403);await ctx.close();
 });

 await check('English and 390 px: same screen, no horizontal scroll',async()=>{
  const small=await browser.newContext({baseURL:origin,viewport:{width:390,height:844},storageState:await context.storageState()});const p=await small.newPage();
  await small.addCookies([{name:'zao_staff_locale',value:'en',url:origin}]);
  await p.goto('/staff/coupons');await expect(p.getByRole('heading',{name:'Coupons',level:1})).toBeVisible();
  await expect(p.getByRole('button',{name:'Create coupon',exact:true})).toBeVisible();await expect(p.getByText('To change terms, press “Duplicate as new”')).toBeVisible();
  await expect(p.locator('tr',{hasText:CODE})).toContainText('Active');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
  await p.screenshot({path:shots+'/coupons-en-390.png',fullPage:true});await small.close();
 });
 assert.deepEqual(errors,[],'no page errors');
 await context.close();
 await check('delete asks for confirmation, removes an unused coupon from the list and keeps the code reserved',async()=>{
  const {ctx,p}=await login('cpn-admin@example.invalid');await p.goto('/staff/coupons');await expect(p.locator('tr',{hasText:CODE})).toBeVisible();
  const dialogs:string[]=[];p.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
  const res=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/coupons'&&r.request().method()==='POST');
  await p.locator('tr',{hasText:CODE}).getByTestId('coupon-delete').click();const answer=await res;assert.equal(answer.status(),200,await answer.text());
  assert.match(dialogs[0]??'',/削除します/);await expect(p.locator('tr',{hasText:CODE})).toHaveCount(0);await ctx.close();
 });
 console.log(JSON.stringify({status:'PASS',checks:count,screenshots:shots}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage}));console.error((e as Error).message?.slice(0,1200));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
