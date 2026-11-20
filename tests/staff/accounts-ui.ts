import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';

// Owner requirement (Issue #47, 2026-11-20): an administrator adds staff accounts, and every staff member changes their own
// password. The existing API, Argon2id hashing, role/permission rules and session revocation are reused unchanged; this
// test drives the real screens end to end. Synthetic accounts only; no password or token is printed or written to evidence
// (password fields are masked in the screenshots).
const built=process.argv.includes('--built');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),shots='.local/evidence/issue47-accounts';
const secret=()=>randomBytes(18).toString('base64url')+'Aa1';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const rootPassword=secret();await bootstrapDevelopmentAdmin(db.pool,{email:'accounts-root@example.invalid',displayName:'SYNTHETIC Accounts Root',password:rootPassword});
 const errors:string[]=[];
 async function signIn(email:string,password:string,width=1440,locale:'ja'|'en'='ja'):Promise<{ctx:BrowserContext;p:Page}>{
  const ctx=await browser.newContext({baseURL:origin,viewport:{width,height:width===390?844:900}});await ctx.addCookies([{name:'zao_staff_locale',value:locale,url:origin}]);
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('/staff/login');
  await p.getByLabel(locale==='en'?'Email':'メールアドレス',{exact:true}).fill(email);await p.getByLabel(locale==='en'?'Password':'パスワード',{exact:true}).fill(password);
  await p.getByRole('button',{name:locale==='en'?'Sign in':'ログイン',exact:true}).click();await p.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};}
 const signInFails=async(email:string,password:string)=>{const ctx=await browser.newContext({baseURL:origin}),p=await ctx.newPage();await p.goto('/staff/login');
  await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();
  const ok=await p.getByRole('alert').waitFor({timeout:15000}).then(()=>true,()=>false);const still=new URL(p.url()).pathname==='/staff/login';await ctx.close();return ok&&still;};
 const admin=await signIn('accounts-root@example.invalid',rootPassword);
 const staffPassword=secret(),newPassword=secret();

 await check('admin creates a staff member on screen: simple first form, detailed permissions folded, confirmation mismatch caught before sending',async()=>{
  const p=admin.p;await p.goto('/staff/users');await p.getByRole('button',{name:'スタッフを作成'}).click();const form=p.getByRole('form',{name:'スタッフ作成'});
  assert.equal(await form.locator('details.staff-perm-details').evaluate(d=>(d as HTMLDetailsElement).open),false,'detailed permissions start folded');
  assert.equal(await form.getByLabel('台帳の閲覧',{exact:true}).isVisible(),false);
  await form.getByLabel('表示名',{exact:true}).fill('SYNTHETIC Front Desk');await form.getByLabel('メールアドレス',{exact:true}).fill('accounts-desk@example.invalid');
  await form.getByLabel('初期パスワード（6〜128文字）').fill(staffPassword);await form.getByLabel('初期パスワード（確認）').fill(staffPassword+'x');
  await form.getByLabel('Mountain Station',{exact:true}).check();let posts=0;const count=(r:import('@playwright/test').Request)=>{if(r.method()==='POST'&&r.url().endsWith('/api/staff-users'))posts++;};p.on('request',count);
  await form.getByRole('button',{name:'スタッフ設定を保存'}).click();await form.getByRole('alert').filter({hasText:'一致しません'}).waitFor();assert.equal(posts,0,'nothing sent on a mismatch');
  assert.equal(await form.getByLabel('表示名',{exact:true}).inputValue(),'SYNTHETIC Front Desk','entries are kept');
  await form.getByLabel('初期パスワード（確認）').fill(staffPassword);const created=p.waitForResponse(r=>r.url().endsWith('/api/staff-users')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'スタッフ設定を保存'}).dblclick();assert.equal((await created).status(),201);await p.getByRole('button',{name:'スタッフを編集：SYNTHETIC Front Desk'}).waitFor();
  await p.waitForTimeout(500);assert.equal(posts,1,'double click creates one account');p.off('request',count);await p.screenshot({path:`${shots}/users-ja-1440.png`});
 });
 await check('strong permissions need an explicit confirmation (grant, ADMIN role, all-station scope); it resets when another person is opened',async()=>{
  const p=admin.p;await p.getByRole('button',{name:'スタッフを編集：SYNTHETIC Front Desk'}).click();const form=p.locator('form.staff-management-form');
  await form.locator('details.staff-perm-details>summary').click();await form.getByLabel('スタッフ管理',{exact:true}).selectOption('allow');
  const confirm=form.getByLabel('強い権限の付与を確認しました');await confirm.waitFor();assert.equal(await confirm.isChecked(),false);
  let patches=0;const count=(r:import('@playwright/test').Request)=>{if(r.method()==='PATCH')patches++;};p.on('request',count);
  await form.getByRole('button',{name:'スタッフ設定を保存'}).click();await p.waitForTimeout(400);assert.equal(patches,0,'the browser blocks saving without the confirmation');
  await form.getByLabel('スタッフ管理',{exact:true}).selectOption('default');await form.getByLabel('担当業務',{exact:true}).selectOption('ADMIN');await confirm.waitFor();
  await form.getByLabel('担当業務',{exact:true}).selectOption('STAFF');await form.getByLabel('店舗範囲',{exact:true}).selectOption('ALL');await confirm.waitFor();
  await form.getByRole('button',{name:'閉じる'}).click();await p.getByRole('button',{name:'スタッフを編集：SYNTHETIC Front Desk'}).click();
  assert.equal(await p.getByLabel('強い権限の付与を確認しました').count(),0,'no leftover confirmation');p.off('request',count);await p.locator('form.staff-management-form').getByRole('button',{name:'閉じる'}).click();
 });
 await check('the new person signs in and changes their own password; mismatch and a wrong current password keep the form; old sessions end',async()=>{
  const first=await signIn('accounts-desk@example.invalid',staffPassword),other=await signIn('accounts-desk@example.invalid',staffPassword);
  const p=first.p;await p.goto('/staff/password');await p.getByRole('heading',{name:'パスワード変更'}).waitFor();
  // Every aria-describedby on the page points at an element that exists; the new password's rule is its description.
  assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('[aria-describedby]')].flatMap(e=>e.getAttribute('aria-describedby')!.split(/\s+/)).filter(id=>!document.getElementById(id))),[],'no dangling aria-describedby');
  await expect(p.getByLabel('新しいパスワード',{exact:true})).toHaveAccessibleDescription('6〜128文字');
  await p.getByLabel('現在のパスワード',{exact:true}).fill(staffPassword);await p.getByLabel('新しいパスワード',{exact:true}).fill(newPassword);await p.getByLabel('新しいパスワード（確認）',{exact:true}).fill(newPassword+'y');
  await p.getByRole('button',{name:'パスワードを変更'}).click();const mismatch=p.getByRole('alert').filter({hasText:'一致しません'});await mismatch.waitFor();
  assert.equal(await mismatch.evaluate(e=>document.activeElement===e),true,'focus moves to the error');assert.equal(await p.getByLabel('新しいパスワード',{exact:true}).inputValue(),newPassword,'typed values are kept');
  await p.getByLabel('新しいパスワード（確認）',{exact:true}).fill(newPassword);await p.getByLabel('現在のパスワード',{exact:true}).fill(staffPassword+'wrong');
  await p.getByRole('button',{name:'パスワードを変更'}).click();await p.getByRole('alert').filter({hasText:'変更できませんでした'}).waitFor();
  assert.equal(await p.getByLabel('新しいパスワード',{exact:true}).inputValue(),newPassword,'kept after a server refusal');await p.screenshot({path:`${shots}/password-error-ja-1440.png`});
  await p.getByLabel('現在のパスワード',{exact:true}).fill(staffPassword);const changed=p.waitForResponse(r=>r.url().endsWith('/api/auth/change-password'));
  await p.getByRole('button',{name:'パスワードを変更'}).click();assert.equal((await changed).status(),200);await p.waitForURL(u=>u.pathname==='/staff/login');
  assert.equal((await other.ctx.request.get('/api/session')).status()===200,false,'the other tab’s session ended');
  assert.equal(await signInFails('accounts-desk@example.invalid',staffPassword),true,'the old password no longer works');
  const again=await signIn('accounts-desk@example.invalid',newPassword);assert.equal((await again.ctx.request.get('/api/session')).status(),200,'the new password works');
  await first.ctx.close();await other.ctx.close();await again.ctx.close();
 });
 await check('non-administrators: staff management is refused, own password change works (EN, 390 px, keyboard)',async()=>{
  // Owner 2026-11-21: 6 characters are enough. The viewer's new password is exactly 6 characters (synthetic); 5 are refused.
  const p=admin.p,viewerPassword=secret(),viewerNew='Zao6pw';await p.goto('/staff/users');await p.getByRole('button',{name:'スタッフを作成'}).click();const form=p.getByRole('form',{name:'スタッフ作成'});
  await form.getByLabel('表示名',{exact:true}).fill('SYNTHETIC Viewer');await form.getByLabel('メールアドレス',{exact:true}).fill('accounts-viewer@example.invalid');
  await form.getByLabel('初期パスワード（6〜128文字）').fill(viewerPassword);await form.getByLabel('初期パスワード（確認）').fill(viewerPassword);
  await form.getByLabel('担当業務',{exact:true}).selectOption('VIEWER');await form.getByLabel('Mountain Station',{exact:true}).check();
  const created=p.waitForResponse(r=>r.url().endsWith('/api/staff-users')&&r.request().method()==='POST');await form.getByRole('button',{name:'スタッフ設定を保存'}).click();assert.equal((await created).status(),201);
  const v=await signIn('accounts-viewer@example.invalid',viewerPassword,390,'en');
  assert.equal((await v.ctx.request.get('/api/staff-users')).status()>=400,true,'a viewer cannot list staff');
  await v.p.goto('/staff/users');assert.equal(await v.p.getByRole('button',{name:'Create staff member'}).count(),0,'no staff management for a viewer');
  await v.p.goto('/staff/password');await v.p.getByRole('heading',{name:'Change password'}).waitFor();
  {let sent=0;const count=(r:import('@playwright/test').Request)=>{if(r.url().endsWith('/api/auth/change-password'))sent++;};v.p.on('request',count);
   await v.p.getByLabel('Current password',{exact:true}).fill(viewerPassword);await v.p.getByLabel('New password',{exact:true}).fill('Zao5p');await v.p.getByLabel('Confirm new password',{exact:true}).fill('Zao5p');
   await v.p.getByRole('button',{name:'Change password'}).click();await v.p.getByRole('alert').filter({hasText:'Use 6 to 128 characters'}).waitFor();
   assert.equal(sent,0,'5 characters are refused before anything is sent');v.p.off('request',count);
   for(const label of ['Current password','New password','Confirm new password'])await v.p.getByLabel(label,{exact:true}).fill('');}
  await v.p.getByLabel('Current password',{exact:true}).focus();await v.p.keyboard.type(viewerPassword);await v.p.keyboard.press('Tab');await v.p.keyboard.type(viewerNew);
  await v.p.keyboard.press('Tab');await v.p.keyboard.type(viewerNew);
  assert.equal(await v.p.getByLabel('Confirm new password',{exact:true}).inputValue(),viewerNew,'Tab order: current → new → confirm');
  assert.equal(await v.p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal scroll at 390 px');await v.p.screenshot({path:`${shots}/password-en-390.png`});
  const changed=v.p.waitForResponse(r=>r.url().endsWith('/api/auth/change-password'));await v.p.keyboard.press('Enter');assert.equal((await changed).status(),200);await v.p.waitForURL(u=>u.pathname==='/staff/login');
  await v.ctx.close();const again=await signIn('accounts-viewer@example.invalid',viewerNew);await again.ctx.close();
 });
 assert.deepEqual(errors,[]);
 await check('failures never look like success: a duplicate email, a server error and another administrator\'s change are shown and saved nothing; a slow save is sent once; a failed password change keeps the form',async()=>{
  const p=admin.p,list=async()=>((await (await p.request.get('/api/staff-users')).json()) as {items:{email:string}[]}).items.map(i=>i.email).sort();
  const before=await list(),open=async()=>{await p.goto('/staff/users');await p.getByRole('button',{name:'スタッフを作成'}).click();const f=p.getByRole('form',{name:'スタッフ作成'});
   await f.getByLabel('表示名',{exact:true}).fill('SYNTHETIC Failure');await f.getByLabel('初期パスワード（6〜128文字）').fill('fail-pass-1');await f.getByLabel('初期パスワード（確認）').fill('fail-pass-1');
   await f.getByLabel('Mountain Station',{exact:true}).check();return f;};
  // 1. Duplicate email (the front desk account exists): the server refuses, the page says so, the entries stay.
  let f=await open();await f.getByLabel('メールアドレス',{exact:true}).fill('accounts-desk@example.invalid');
  const dup=p.waitForResponse(r=>r.url().endsWith('/api/staff-users')&&r.request().method()==='POST');await f.getByRole('button',{name:'スタッフ設定を保存'}).click();
  {const res=await dup;assert.ok(res.status()>=400,'duplicate email refused');console.log('DUPLICATE_ANSWER '+res.status());}await f.getByRole('alert').filter({hasText:'保存できませんでした'}).waitFor();
  assert.equal(await f.getByLabel('表示名',{exact:true}).inputValue(),'SYNTHETIC Failure','entries kept');assert.deepEqual(await list(),before,'no account added');
  // 2. Server error 500: shown as a failure, nothing created.
  f=await open();await f.getByLabel('メールアドレス',{exact:true}).fill('accounts-500@example.invalid');
  await p.route('**/api/staff-users',r=>r.request().method()==='POST'?r.fulfill({status:500,json:{error:'STAFF_MANAGEMENT_FAILED'}}):r.fallback());
  await f.getByRole('button',{name:'スタッフ設定を保存'}).click();await f.getByRole('alert').filter({hasText:'保存できませんでした'}).waitFor();await p.unroute('**/api/staff-users');
  assert.deepEqual(await list(),before,'nothing created on 500');
  // 3. A slow save pressed again while waiting: exactly one request, one account.
  let posts=0;const count=(r:import('@playwright/test').Request)=>{if(r.method()==='POST'&&r.url().endsWith('/api/staff-users'))posts++;};p.on('request',count);
  await p.route('**/api/staff-users',async r=>{if(r.request().method()==='POST')await new Promise(x=>setTimeout(x,2000));await r.fallback();});
  f=await open();await f.getByLabel('メールアドレス',{exact:true}).fill('accounts-slow@example.invalid');const slow=p.waitForResponse(r=>r.url().endsWith('/api/staff-users')&&r.request().method()==='POST');
  await f.getByRole('button',{name:'スタッフ設定を保存'}).click();for(let i=0;i<3;i++)await f.getByRole('button',{name:'スタッフ設定を保存'}).click({timeout:400}).catch(()=>{/* disabled while saving */});
  {const res=await slow;assert.equal(res.status(),201,'slow save status');}await p.unroute('**/api/staff-users');await p.waitForTimeout(500);p.off('request',count);
  assert.equal(posts,1,'one request for a slow save pressed repeatedly');assert.equal((await list()).filter(e=>e==='accounts-slow@example.invalid').length,1);
  // 4. Another administrator changed the person meanwhile (stale revision): the page asks to reload and does not claim success.
  await p.goto('/staff/users');await p.getByRole('button',{name:'スタッフを編集：SYNTHETIC Front Desk'}).click();const edit=p.getByRole('form').first();
  await p.route('**/api/staff-users/*',r=>r.request().method()==='PATCH'?r.fulfill({status:409,json:{error:'STALE_STAFF_REVISION'}}):r.fallback());
  await edit.getByLabel('表示名',{exact:true}).fill('SYNTHETIC Front Desk Renamed');await edit.getByRole('button',{name:'スタッフ設定を保存'}).click();
  await p.getByText('別の管理者が更新したため再読込が必要です',{exact:false}).first().waitFor();await p.unroute('**/api/staff-users/*');
  assert.ok((await (await p.request.get('/api/staff-users')).text()).includes('SYNTHETIC Front Desk')&&!(await (await p.request.get('/api/staff-users')).text()).includes('Renamed'),'nothing saved on a stale revision');
  // 5. Own password change: a server error and a lost connection keep the typed values and show an error.
  const v=await signIn('accounts-slow@example.invalid','fail-pass-1');await v.p.goto('/staff/password');
  for(const [kind,answer] of [['500',(r:import('@playwright/test').Route)=>r.fulfill({status:500,json:{error:'INTERNAL'}})],['offline',(r:import('@playwright/test').Route)=>r.abort('internetdisconnected')]] as const){
   await v.p.route('**/api/auth/change-password',answer);
   await v.p.getByLabel('現在のパスワード',{exact:true}).fill('fail-pass-1');await v.p.getByLabel('新しいパスワード',{exact:true}).fill('next-pass-2');await v.p.getByLabel('新しいパスワード（確認）',{exact:true}).fill('next-pass-2');
   await v.p.getByRole('button',{name:'パスワードを変更'}).click();await v.p.getByRole('alert').first().waitFor();await v.p.unroute('**/api/auth/change-password');
   assert.equal(new URL(v.p.url()).pathname,'/staff/password',kind+': stays on the form');assert.equal(await v.p.getByLabel('新しいパスワード',{exact:true}).inputValue(),'next-pass-2',kind+': typed values kept');
  }
  assert.equal((await v.ctx.request.get('/api/session')).status(),200,'still signed in: nothing was changed');await v.ctx.close();
 });
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,secretsPrinted:0}));
 await admin.ctx.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,700)}));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
