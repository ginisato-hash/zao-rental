import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium,type BrowserContext,type Page} from '@playwright/test';
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
  await form.getByLabel('初期パスワード（15〜128文字）').fill(staffPassword);await form.getByLabel('初期パスワード（確認）').fill(staffPassword+'x');
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
  const p=admin.p,viewerPassword=secret(),viewerNew=secret();await p.goto('/staff/users');await p.getByRole('button',{name:'スタッフを作成'}).click();const form=p.getByRole('form',{name:'スタッフ作成'});
  await form.getByLabel('表示名',{exact:true}).fill('SYNTHETIC Viewer');await form.getByLabel('メールアドレス',{exact:true}).fill('accounts-viewer@example.invalid');
  await form.getByLabel('初期パスワード（15〜128文字）').fill(viewerPassword);await form.getByLabel('初期パスワード（確認）').fill(viewerPassword);
  await form.getByLabel('担当業務',{exact:true}).selectOption('VIEWER');await form.getByLabel('Mountain Station',{exact:true}).check();
  const created=p.waitForResponse(r=>r.url().endsWith('/api/staff-users')&&r.request().method()==='POST');await form.getByRole('button',{name:'スタッフ設定を保存'}).click();assert.equal((await created).status(),201);
  const v=await signIn('accounts-viewer@example.invalid',viewerPassword,390,'en');
  assert.equal((await v.ctx.request.get('/api/staff-users')).status()>=400,true,'a viewer cannot list staff');
  await v.p.goto('/staff/users');assert.equal(await v.p.getByRole('button',{name:'Create staff member'}).count(),0,'no staff management for a viewer');
  await v.p.goto('/staff/password');await v.p.getByRole('heading',{name:'Change password'}).waitFor();
  await v.p.getByLabel('Current password',{exact:true}).focus();await v.p.keyboard.type(viewerPassword);await v.p.keyboard.press('Tab');await v.p.keyboard.type(viewerNew);
  await v.p.keyboard.press('Tab');await v.p.keyboard.type(viewerNew);
  assert.equal(await v.p.getByLabel('Confirm new password',{exact:true}).inputValue(),viewerNew,'Tab order: current → new → confirm');
  assert.equal(await v.p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal scroll at 390 px');await v.p.screenshot({path:`${shots}/password-en-390.png`});
  const changed=v.p.waitForResponse(r=>r.url().endsWith('/api/auth/change-password'));await v.p.keyboard.press('Enter');assert.equal((await changed).status(),200);await v.p.waitForURL(u=>u.pathname==='/staff/login');
  await v.ctx.close();const again=await signIn('accounts-viewer@example.invalid',viewerNew);await again.ctx.close();
 });
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,secretsPrinted:0}));
 await admin.ctx.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,700)}));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
