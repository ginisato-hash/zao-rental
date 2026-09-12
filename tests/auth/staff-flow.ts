import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {assertPortFree,worktreeIdentity} from '../../scripts/worktree';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedLedgerSample} from '../fixtures/seed-ledger';
import {fixtureId} from '../fixtures/ledger-sample';
import {createStaffAuth} from '../../packages/auth/src/staff-auth';
import {authHandler} from '../../apps/web/src/lib/auth-http';
import {hashStaffPassword,verifyStaffPassword} from '../../packages/auth/src/password';
await mkdir('.local/screenshots',{recursive:true});
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined;let stage='startup',count=0,failed=false;
const browser=await chromium.launch();
const password=randomBytes(24).toString('base64url'),newPassword=randomBytes(24).toString('base64url');
const emails={admin:'synthetic-admin@example.invalid',editor:'synthetic-editor@example.invalid',reader:'synthetic-reader@example.invalid'};
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log(`PASS ${name}`);}
try{
 app=await startDevelopmentApp({built:true});const {origin}=app;const owner=app.db.pool;
 for(let i=0;i<100;i++){try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}if(i===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 await seedLedgerSample(owner);
 const adminId=await bootstrapDevelopmentAdmin(owner,{email:emails.admin,displayName:'合成ADMIN',password});
 async function context(){const ctx=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});ctx.setDefaultTimeout(10000);ctx.setDefaultNavigationTimeout(15000);return ctx;}
 async function login(ctx:BrowserContext,email:string,secret=password){const page=await ctx.newPage();await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill(email);await page.getByLabel('パスワード',{exact:true}).fill(secret);await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(`${origin}/staff/ledger`);return page;}
 const admin=await context();let adminPage:Page;let editorId:string,readerId:string,assetId:string;
 const settings={displayName:'合成STAFF',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{INVENTORY_EDIT:true}};
 await check('no public signup, social login, fixture login or ambient identity bypass; anonymous API is 401',async()=>{
  for(const path of ['/api/session','/api/ledger/assets','/api/staff-users'])assert.equal((await admin.request.get(path,{headers:{'x-role':'ADMIN','x-user-id':adminId,cookie:'role=ADMIN; testAuth=1'}})).status(),401);
  for(const path of ['/api/test-login','/test-ledger','/race','/api/auth/sign-up/email','/api/auth/sign-in/social','/api/auth/get-session'])assert.equal((await admin.request.post(path,{data:{email:emails.editor,password}})).status(),404);
  await assert.rejects(bootstrapDevelopmentAdmin(owner,{email:emails.reader,displayName:'not permitted',password}),/BOOTSTRAP_ALREADY_COMPLETED/);
 });
 await check('ADMIN logs in normally and creates a store-scoped STAFF through the actual management UI/API',async()=>{
  adminPage=await login(admin,emails.admin);await adminPage.goto('/staff/users');await adminPage.getByRole('button',{name:'スタッフを作成',exact:true}).click();const form=adminPage.getByRole('form',{name:'スタッフ作成'});
  await form.getByLabel('表示名',{exact:true}).fill(settings.displayName);await form.getByLabel('メールアドレス',{exact:true}).fill('SYNTHETIC-EDITOR@example.invalid');await form.getByLabel('初期パスワード（15〜128文字）').fill(password);await form.getByLabel('MOUNTAIN_BASE',{exact:true}).check();await form.getByLabel('台帳の登録・更新',{exact:true}).selectOption('allow');await form.getByRole('button',{name:'スタッフ設定を保存'}).click();await expect(adminPage.getByRole('heading',{name:settings.displayName,exact:true})).toBeVisible();
  editorId=(await owner.query('SELECT id FROM staff_users WHERE email=$1',[emails.editor])).rows[0].id;
  const user=(await owner.query('SELECT password_hash FROM staff_users WHERE id=$1',[editorId])).rows[0];assert.ok(user.password_hash.startsWith('$argon2id$v=19$m=65536,t=3,p=1$'));assert.ok(user.password_hash!==password,'plaintext must never be stored');assert.ok(await verifyStaffPassword({hash:user.password_hash,password}));
  assert.equal((await admin.request.post('/api/staff-users',{headers:{origin},data:{...settings,email:emails.editor.toUpperCase(),password}})).status(),409);
  const reader=await admin.request.post('/api/staff-users',{headers:{origin},data:{...settings,displayName:'合成VIEWER',email:emails.reader,password,role:'VIEWER',storeIds:['ONSEN_BASE'],permissions:{}}});assert.equal(reader.status(),201);readerId=(await reader.json()).id;
  await adminPage.screenshot({path:'.local/screenshots/e05-staff-management.png',fullPage:true});await adminPage.setViewportSize({width:390,height:844});assert.ok(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await adminPage.screenshot({path:'.local/screenshots/e05-staff-management-mobile-width.png',fullPage:true});
 });
 const editor=await context();let page:Page;
 await check('individual email/password login establishes a real DB session with HttpOnly SameSite cookie and no token response body',async()=>{
  page=await login(editor,emails.editor);await expect(page.getByRole('heading',{name:'道具の台帳'})).toBeVisible();assert.equal((await editor.request.get('/api/session')).status(),200);
  const ttl=(await owner.query('SELECT extract(epoch from ("expiresAt"-"createdAt")) AS seconds FROM auth_session WHERE "userId"=$1',[editorId])).rows[0].seconds;assert.ok(Number(ttl)<=28801&&Number(ttl)>=28790);
  const c=(await editor.cookies(origin)).find(c=>c.name.endsWith('session_token'));assert.ok(c?.httpOnly);assert.equal(c.sameSite,'Lax');assert.equal(c.secure,false);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM auth_session WHERE "userId"=$1',[editorId])).rows[0].n,1);
  assert.ok((await owner.query('SELECT last_login_at FROM staff_members WHERE id=$1',[editorId])).rows[0].last_login_at);
 });
 await check('normal STAFF UI registers, updates and reloads a synthetic Asset in real Postgres with its own audit actor',async()=>{
  await page.getByRole('button',{name:'＋ 登録',exact:true}).click();const form=page.getByRole('region',{name:'登録フォーム'});
  await form.getByRole('combobox',{name:'サイズ・区分',exact:true}).selectOption(fixtureId(101));await form.getByLabel('データ区分').selectOption('SYNTHETIC');await form.getByLabel('出典文書').fill('tests/auth/staff-flow.ts');await form.getByLabel('出典の行・セル・記録キー').fill('normal-ui-asset');await form.getByLabel('備考',{exact:true}).fill('E05 合成個体');await form.getByRole('button',{name:'登録を保存'}).click();
  const detail=page.getByRole('complementary',{name:'台帳詳細'});await expect(detail.getByText('normal-ui-asset',{exact:true})).toBeVisible();assetId=(await owner.query("SELECT id FROM ledger_assets WHERE source_locator='normal-ui-asset'")).rows[0].id;
  await page.getByRole('button',{name:'基本情報を更新'}).click();const edit=page.getByRole('region',{name:'更新フォーム'});await edit.getByLabel('備考',{exact:true}).fill('E05 再読込確認');await edit.getByLabel('更新理由').fill('合成テストの更新');await edit.getByRole('button',{name:'変更を保存'}).click();await expect(detail.getByText('E05 再読込確認',{exact:true})).toBeVisible();
  assert.deepEqual((await owner.query('SELECT actor,action FROM ledger_history WHERE entity_id=$1 ORDER BY occurred_at',[assetId])).rows,[{actor:editorId,action:'REGISTER'},{actor:editorId,action:'UPDATE'}]);
  await page.reload();await expect(page.getByRole('heading',{name:'道具の台帳'})).toBeVisible();assert.equal((await (await editor.request.get(`/api/ledger/assets/${assetId}`)).json()).notes,'E05 再読込確認');
  await page.screenshot({path:'.local/screenshots/e05-normal-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/screenshots/e05-normal-mobile-width.png',fullPage:true});
 });
 await check('out-of-store requests, immutable field/actor/role spoofing and CSRF are rejected without writes',async()=>{
  const n=(await owner.query('SELECT count(*)::int AS n FROM ledger_history')).rows[0].n;
  assert.equal((await editor.request.get('/api/ledger/assets?storeId=ONSEN_BASE')).status(),403);
  const foreign=fixtureId(202),own=fixtureId(201),payload={version:1,notes:'spoof',reason:'synthetic',status:'UNVERIFIED',bslStatus:'NOT_APPLICABLE',bslMm:null,bslEvidence:''};
  assert.equal((await editor.request.patch(`/api/ledger/assets/${foreign}`,{headers:{origin},data:payload})).status(),403); // inaccessible and absent physical IDs share 403 in normal API
  for(const extra of [{actor:adminId},{role:'ADMIN'},{storeId:'ONSEN_BASE'},{id:foreign},{variantId:fixtureId(102)}])assert.equal((await editor.request.patch(`/api/ledger/assets/${own}`,{headers:{origin},data:{...payload,...extra}})).status(),422);
  for(const headers of [{},{origin:'https://untrusted.invalid'},{origin:'null'}])assert.equal((await editor.request.patch(`/api/ledger/assets/${own}`,{headers,data:payload})).status(),403);
  assert.equal((await editor.request.post('/api/staff-users',{headers:{origin,'x-role':'ADMIN'},data:{...settings,email:'synthetic-unauthorized@example.invalid',password}})).status(),403);
  assert.equal((await editor.request.post('/api/auth/sign-out',{data:{}})).status(),403);
  assert.equal((await editor.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emails.editor,password,role:'ADMIN'}})).status(),422);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM ledger_history')).rows[0].n,n);
 });
 await check('application DB roles cannot DDL, create roles, edit audit, change permissions from ledger role, or read hashes',async()=>{
  for(const sql of ['CREATE TABLE escape_probe(id int)',"UPDATE staff_members SET role='ADMIN'",'DELETE FROM ledger_history','UPDATE ledger_history SET actor=actor','INSERT INTO ledger_history SELECT * FROM ledger_history LIMIT 1','ALTER TABLE ledger_assets DISABLE TRIGGER ALL','CREATE ROLE escape_role','SELECT * FROM auth_session','SELECT * FROM staff_users','SELECT * FROM staff_members','SELECT * FROM staff_store_access','SELECT * FROM staff_permission_overrides','SELECT * FROM staff_role_permissions'])await assert.rejects(app!.roles.ledgerPool.query(sql),(e:{code:string})=>e.code==='42501');
  for(const sql of ['SELECT * FROM ledger_assets','DELETE FROM staff_audit','UPDATE staff_audit SET event=event','CREATE TABLE escape_auth(id int)'])await assert.rejects(app!.roles.authPool.query(sql),(e:{code:string})=>e.code==='42501');
 });
 await check('logout revokes old session; re-login reads the same stored Asset and stale session stamp is refused',async()=>{
  const oldStamp=(await (await editor.request.get('/api/session')).json()).stamp;
  await page.getByRole('button',{name:'ログアウト',exact:true}).click();await page.waitForURL(`${origin}/staff/login`);assert.equal((await editor.request.get('/api/ledger/assets')).status(),401);
  await page.close();page=await login(editor,emails.editor);await expect(page.getByRole('heading',{name:'道具の台帳'})).toBeVisible();assert.equal((await editor.request.get('/api/ledger/assets',{headers:{'x-zao-session':oldStamp}})).status(),409);assert.equal((await (await editor.request.get(`/api/ledger/assets/${assetId}`)).json()).notes,'E05 再読込確認');
 });
 await check('permission and store removals are enforced by normal APIs, while old displayed data is unmounted',async()=>{
  assert.equal((await admin.request.patch(`/api/staff-users/${editorId}`,{headers:{origin},data:{...settings,expectedRevision:(await owner.query('SELECT revision FROM staff_members WHERE id=$1',[editorId])).rows[0].revision,role:'MANAGER',permissions:{INVENTORY_EDIT:false}}})).status(),200);
  assert.equal((await editor.request.post('/api/ledger/assets',{headers:{origin},data:{}})).status(),403);
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await expect(page.getByRole('heading',{name:'セッションを確認してください'})).toBeVisible();await expect(page.getByRole('heading',{name:'道具の台帳'})).toHaveCount(0);
  assert.equal((await admin.request.patch(`/api/staff-users/${editorId}`,{headers:{origin},data:{...settings,expectedRevision:(await owner.query('SELECT revision FROM staff_members WHERE id=$1',[editorId])).rows[0].revision,storeIds:['ONSEN_BASE']}})).status(),200);
  assert.equal((await editor.request.get('/api/ledger/assets?storeId=MOUNTAIN_BASE')).status(),403);
  assert.equal((await admin.request.patch(`/api/staff-users/${editorId}`,{headers:{origin},data:{...settings,expectedRevision:(await owner.query('SELECT revision FROM staff_members WHERE id=$1',[editorId])).rows[0].revision}})).status(),200);
 });
 await check('account disabled via normal management API invalidates all sessions and rejects correct-password login',async()=>{
  assert.equal((await admin.request.patch(`/api/staff-users/${editorId}`,{headers:{origin},data:{...settings,expectedRevision:(await owner.query('SELECT revision FROM staff_members WHERE id=$1',[editorId])).rows[0].revision,active:false}})).status(),200);assert.equal((await editor.request.get('/api/ledger/assets')).status(),401);
  assert.equal((await editor.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emails.editor,password}})).status(),401);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM auth_session WHERE "userId"=$1',[editorId])).rows[0].n,0);
  assert.equal((await admin.request.patch(`/api/staff-users/${editorId}`,{headers:{origin},data:{...settings,expectedRevision:(await owner.query('SELECT revision FROM staff_members WHERE id=$1',[editorId])).rows[0].revision}})).status(),200);
 });
 await check('five concurrent wrong-password attempts lock the account; correct password cannot bypass lock',async()=>{
  const results=await Promise.all(Array.from({length:5},()=>editor.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emails.editor,password:newPassword}})));
  assert.ok(results.every(r=>r.status()===401));const locked=(await owner.query('SELECT failed_login_count,locked_until FROM staff_members WHERE id=$1',[editorId])).rows[0];assert.equal(locked.failed_login_count,5);assert.ok(locked.locked_until);
  assert.equal((await editor.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emails.editor,password}})).status(),401);
  await owner.query("UPDATE staff_members SET locked_until=now()-interval '1 second' WHERE id=$1",[editorId]);
  await page.close();page=await login(editor,emails.editor);
 });
 await check('AUTH-01 concurrent wrong currentPassword attempts share the login lockout and cannot change a locked password',async()=>{
  const before=(await owner.query('SELECT password FROM auth_account WHERE "userId"=$1',[editorId])).rows[0].password;
  const attempts=await Promise.all(Array.from({length:5},(_,i)=>editor.request.post('/api/auth/change-password',{headers:{origin,'x-forwarded-for':`192.0.2.${i+1}`},data:{currentPassword:'synthetic wrong password',newPassword}})));
  assert.deepEqual(attempts.map(r=>r.status()),[401,401,401,401,401]);const state=(await owner.query('SELECT failed_login_count,locked_until>now() AS locked FROM staff_members WHERE id=$1',[editorId])).rows[0];assert.deepEqual(state,{failed_login_count:5,locked:true});
  assert.equal((await editor.request.post('/api/auth/change-password',{headers:{origin},data:{currentPassword:password,newPassword}})).status(),401);
  assert.equal((await editor.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emails.editor,password}})).status(),401);
  assert.ok((await owner.query('SELECT password FROM auth_account WHERE "userId"=$1',[editorId])).rows[0].password===before,'locked attempts must not change the hash');
  const failures=(await owner.query("SELECT count(*)::int AS n FROM staff_audit WHERE event='PASSWORD_CHANGE_FAILED' AND actor_staff_id=$1 AND target_staff_id=$1",[editorId])).rows[0].n;assert.equal(failures,6);
  await owner.query("UPDATE staff_members SET failed_login_count=0,locked_until=now()-interval '1 second' WHERE id=$1",[editorId]);
 });
 await check('password change preserves the library default 3-per-10-second client burst limit',async()=>{
  const results=await Promise.all(Array.from({length:5},()=>editor.request.post('/api/auth/change-password',{headers:{origin,'x-forwarded-for':'192.0.2.99'},data:{currentPassword:'synthetic wrong password',newPassword}})));
  assert.equal(results.filter(r=>r.status()===401).length,3);assert.equal(results.filter(r=>r.status()===429).length,2);
  const state=(await owner.query('SELECT failed_login_count,locked_until>now() AS locked FROM staff_members WHERE id=$1',[editorId])).rows[0];assert.equal(state.failed_login_count,3);assert.equal(Boolean(state.locked),false);
  await owner.query('UPDATE staff_members SET failed_login_count=0,locked_until=NULL WHERE id=$1',[editorId]);
 });
 await check('password change through normal API uses Argon2id, rejects old password, and invalidates all existing sessions',async()=>{
  const second=await context();await login(second,emails.editor);
  assert.equal((await editor.request.post('/api/auth/change-password',{headers:{origin},data:{currentPassword:password,newPassword}})).status(),200);
  assert.equal((await editor.request.get('/api/session')).status(),401);assert.equal((await second.request.get('/api/ledger/assets')).status(),401);await second.close();
  assert.equal((await editor.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emails.editor,password}})).status(),401);
  await page.close();page=await login(editor,emails.editor,newPassword);
 });
 await check('expired session and missing store scope cannot continue; another user sees only its permitted store',async()=>{
  await owner.query(`UPDATE auth_session SET "expiresAt"=now()-interval '1 second' WHERE "userId"=$1`,[editorId]);assert.equal((await editor.request.get('/api/ledger/assets')).status(),401);
  const reader=await context();const rp=await login(reader,emails.reader);await expect(rp.getByRole('heading',{name:'道具の台帳'})).toBeVisible();await expect(rp.getByRole('button',{name:'＋ 登録',exact:true})).toHaveCount(0);
  const rows=(await (await reader.request.get('/api/ledger/assets')).json()).items;assert.ok(rows.length>0);assert.ok(rows.every((r:{storeId:string})=>r.storeId==='ONSEN_BASE'));assert.ok(rows.every((r:{notes:string})=>r.notes!=='E05 再読込確認'));
  await owner.query('DELETE FROM staff_store_access WHERE staff_id=$1',[readerId]);assert.equal((await reader.request.get('/api/ledger/assets')).status(),403);await reader.close();
 });
 await check('library password reset uses hashed expiring single-use tokens, memory-only delivery, and no real email',async()=>{
  let token='';const reset=createStaffAuth(app!.roles.authPool,{origin,secret:randomBytes(32).toString('hex'),resetDelivery:async payload=>{token=payload.token;}});
  await reset.api.requestPasswordReset({body:{email:emails.editor},headers:new Headers({origin})});assert.ok(token.length>=24);
  const stored=(await owner.query('SELECT identifier,value FROM auth_verification')).rows;assert.ok(stored.length);assert.ok(stored.every(r=>!JSON.stringify(r).includes(token)));
  const resetPassword=randomBytes(24).toString('base64url');const result=await editor.request.post('/api/auth/reset-password',{headers:{origin},data:{token,newPassword:resetPassword}});assert.equal(result.status(),200);
  assert.notEqual((await editor.request.post('/api/auth/reset-password',{headers:{origin},data:{token,newPassword}})).status(),200);
  await reset.api.requestPasswordReset({body:{email:emails.editor},headers:new Headers({origin})});const race=await Promise.all([1,2].map(()=>editor.request.post('/api/auth/reset-password',{headers:{origin},data:{token,newPassword}})));assert.equal(race.filter(r=>r.status()===200).length,1);
  await reset.api.requestPasswordReset({body:{email:emails.editor},headers:new Headers({origin})});await owner.query(`UPDATE auth_verification SET "expiresAt"=now()-interval '1 second'`);
  assert.notEqual((await editor.request.post('/api/auth/reset-password',{headers:{origin},data:{token,newPassword}})).status(),200);token='';
  assert.equal((await admin.request.post('/api/auth/request-password-reset',{headers:{origin},data:{email:emails.editor}})).status(),404);
 });
 await check('a credential without an active app staff registration cannot establish a normal session',async()=>{
  const id=randomUUID(),email='synthetic-unregistered@example.invalid';
  await owner.query('INSERT INTO auth_user(id,name,email,"createdAt","updatedAt") VALUES($1,$2,$3,now(),now())',[id,'Synthetic unregistered',email]);
  await owner.query(`INSERT INTO auth_account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,'credential',$2,$3,now(),now())`,[randomUUID(),id,await hashStaffPassword(password)]);
  const unknown=await context();const response=await unknown.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password}});assert.equal(response.status(),401);assert.deepEqual(await response.json(),{error:'LOGIN_REJECTED'});
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM auth_session WHERE "userId"=$1',[id])).rows[0].n,0);assert.equal((await unknown.request.get('/api/ledger/assets')).status(),401);await unknown.close();
 });
 await check('library HTTPS cookie configuration is Secure HttpOnly SameSite Path scoped; no network TLS claim',async()=>{
  const secureOrigin='https://synthetic.example.invalid';const secureAuth=createStaffAuth(app!.roles.authPool,{origin:secureOrigin,secret:randomBytes(32).toString('hex')});
  const handler=authHandler(secureAuth,app!.roles.authPool,secureOrigin,app!.roles.authPool);
  const response=await handler(new Request(secureOrigin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:secureOrigin,'content-type':'application/json'},body:JSON.stringify({email:emails.admin,password})}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});const cookies=response.headers.getSetCookie();
  assert.ok(cookies.some(c=>c.startsWith('__Secure-zao-rental.session_token=')&&/; Secure/i.test(c)&&/; HttpOnly/i.test(c)&&/; SameSite=Lax/i.test(c)&&/; Path=\//i.test(c)));
 });
 await check('required audit events record verified actor and target, never passwords or tokens',async()=>{
  const audit=(await owner.query('SELECT event,actor_staff_id,target_staff_id FROM staff_audit')).rows;
  for(const event of ['LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','PASSWORD_CHANGED','ACCOUNT_CREATED','ACCOUNT_DISABLED','ROLE_CHANGED','PERMISSION_CHANGED','STORE_ACCESS_CHANGED'])assert.ok(audit.some(r=>r.event===event),event);
  assert.ok(audit.some(r=>r.event==='ACCOUNT_CREATED'&&r.actor_staff_id===adminId&&r.target_staff_id===editorId));assert.ok(audit.some(r=>r.event==='PASSWORD_CHANGED'&&r.actor_staff_id===editorId));
  assert.ok(!JSON.stringify(audit).includes(password));assert.ok(!JSON.stringify(audit).includes(newPassword));
 });
 await admin.close();await editor.close();console.log(`PASS ${count} normal email/password/UI/API/real-Postgres checks; synthetic accounts only; no trace/cookie/token artifacts.`);
}catch(error){console.error(`E05_FLOW_FAILED stage=${stage}; ${error instanceof assert.AssertionError?error.message:error instanceof Error?error.name:'unknown'}`);failed=true;}
finally{await browser.close();if(app)await Promise.all([app.stop(),app.stop()]);const ports=worktreeIdentity();await assertPortFree(ports.webPort);await assertPortFree(ports.dbPort);console.log('Owned browser/Web/PostgreSQL closed; worktree ports released.');}

if(failed){process.exit(1);}
