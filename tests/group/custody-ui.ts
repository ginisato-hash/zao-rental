import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {provisionGroupRole} from '../../scripts/group-role';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff,permissions} from '../../packages/auth/src/staff-auth';
import {seedRecommendation} from '../recommendation/fixture';
import {fid,variants} from '../inventory/fixture';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {GroupOrderService,type StaffActor} from '../../packages/core/src/group/group-service';
import {skiMember,secret,PERIOD} from './fixture';

// Real browser against the built staff app (isolated PostgreSQL, synthetic data only): the floor staff finds a confirmed, unsettled
// group by its group number, sees the breakdown, records the physical preparation (incl. the in-store fit of a manual-fit member) and hands it out.
const app=await startDevelopmentApp({built:true,operations:true}),browser=await chromium.launch();let group:Awaited<ReturnType<typeof provisionGroupRole>>|undefined,stage='setup';
try{
 await seedRecommendation(app.db.pool,true);let now=new Date('2035-01-01T10:00:00+09:00');
 async function clock(value:string){now=new Date(value);await app.db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);}
 await clock(now.toISOString());
 const password=randomBytes(24).toString('base64url'),email='group-custody-ui@example.invalid',subject=await bootstrapDevelopmentAdmin(app.db.pool,{email,password,displayName:'SYNTHETIC Group Staff'});
 for(const permission of permissions)await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true) ON CONFLICT DO NOTHING',[subject,permission]);
 // a few more claimable pairs/boots so the group is not limited by the seed
 {const c=await app.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC group ui stock',true)",[subject]);
  for(const [family,variant,base] of [['SKI',variants.ski,30000],['SKI_BOOT',variants.boot,31000]] as const)for(let n=0;n<4;n++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,'','','SYNTHETIC','tests/group/custody-ui.ts',$5)`,[fid(base+n),variant,family,family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','GUI-'+family+'-'+n]);
  await c.query('UPDATE ledger_poles SET quantity=quantity+6,version=version+1 WHERE id=$1',[fid(1301)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const principal=(await loadStaff(app.db.pool,subject))!,quotes=new QuoteService(app.roles.pricingPool,principal,()=>now);await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 group=await provisionGroupRole(app.db.pool,app.db.identity);const svc=new GroupOrderService(group.groupPool,()=>now);
 const admin:StaffActor={kind:'STAFF',subject,revision:principal.revision};
 const profile={heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,skierType:'TYPE_I'}};
 const token=(await svc.rotateEntrance(admin,'SYNTHETIC ui entrance')).token,ownerSecret=secret();
 const started=await svc.startApplication(token,randomUUID(),ownerSecret,{groupLabel:'SYNTHETIC UI group',contactName:'SYNTHETIC Rep',contactEmail:'synthetic-rep@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',contractVersion:'INTEGRATED_V1_4',period:PERIOD});
 const owner={kind:'OWNER' as const,groupId:started.groupId,secret:ownerSecret};
 const saved=await svc.saveMembers(owner,started.groupId,started.revision,[{...skiMember('UI-1'),profile},{...skiMember('UI-2'),profile,fit:{status:'MANUAL_FIT_REQUIRED'}}]);
 const quote=await svc.quote(owner,started.groupId,saved.revision);await svc.consent(owner,started.groupId,{quoteId:quote.quoteId,digest:quote.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});
 const held=await svc.submit(owner,started.groupId,{requestKey:randomUUID(),expectedRevision:quote.revision,quoteId:quote.quoteId});
 const number=(await app.db.pool.query('SELECT group_number FROM group_orders WHERE id=$1',[started.groupId])).rows[0].group_number as string;
 await clock('2035-02-10T10:00:00+09:00');

 const ctx=await browser.newContext({baseURL:app.origin,viewport:{width:1280,height:1100}});ctx.setDefaultTimeout(30000);const p=await ctx.newPage();
 await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});
 const panel=()=>p.getByTestId('group-custody'),work=()=>p.locator('.prep-workbench');

 stage='not yet approved: found by number, shown, but cannot be opened';
 await p.goto('/staff/rentals');await panel().getByLabel('団体番号').fill(number);await panel().getByRole('button',{name:'団体と内訳を確認'}).click();
 await expect(panel()).toContainText(number);await expect(panel()).toContainText('貸出できません');await expect(panel().getByRole('button',{name:'このパートを開く'})).toHaveCount(0);

 // approved by the administrator (on-site settlement, unsettled)
 const manualIds=[saved.memberIds[1]!];
 const confirmed=await svc.confirm(admin,started.groupId,{requestKey:randomUUID(),expectedRevision:held.revision,fitAcknowledgedMemberIds:manualIds});assert.equal(confirmed.status,'CONFIRMED');
 stage='confirmed + unsettled: breakdown with group number, on-site/unsettled, fit flag';
 await panel().getByRole('button',{name:'団体と内訳を確認'}).click();
 await expect(panel()).toContainText('現地精算');await expect(panel()).toContainText('未精算');await expect(panel()).toContainText('店舗確認が必要');await expect(panel().getByRole('button',{name:'このパートを開く'})).toBeVisible();
 await panel().getByRole('button',{name:'このパートを開く'}).click();await expect(work()).toBeVisible();
 stage='manual fit gate: cannot mark ready before the in-store fit is recorded';
 const ready=()=>work().getByRole('button',{name:'準備完了にする'});
 for(const n of [0,1]){const person=work().locator('.prep-person').nth(n);await person.getByLabel('刻印・実測したソール長（mm）').fill('314');for(const label of ['ブーツとビンディングの適合を確認した','ビンディング調整・現物検査済み','割当用品・サイズ・モデルを現物と照合した'])await person.getByLabel(label).check();}
 await expect(ready()).toBeDisabled();
 await panel().getByRole('checkbox').first().check();await panel().getByLabel('確認の記録').fill('SYNTHETIC tried on in store');
 await expect(ready()).toBeEnabled();
 const prepared=p.waitForResponse(r=>r.url().endsWith('/api/custody/group-prepare')&&r.request().method()==='POST');await ready().click();assert.equal((await prepared).status(),200);
 await expect(work()).toContainText('準備完了');
 stage='hand out';
 const out=p.waitForResponse(r=>r.url().endsWith('/api/custody/group-checkout')&&r.request().method()==='POST');await panel().getByRole('button',{name:'このパートの道具を貸出'}).click();assert.equal((await out).status(),200);
 await expect(panel()).toContainText('OUT');
 stage='database facts';
 const loans=(await app.db.pool.query("SELECT l.state,l.booking_id,l.group_part_id FROM rental_loan_items l JOIN group_order_parts p ON p.id=l.group_part_id WHERE p.group_id=$1",[started.groupId])).rows;
 assert.equal(loans.length,6);assert.ok(loans.every(l=>l.state==='OUT'&&l.booking_id===null));
 assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM rental_bookings')).rows[0].n,0);assert.equal((await app.db.pool.query("SELECT h.allocation_stage,h.payment_state FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1",[started.groupId])).rows[0].allocation_stage,'RENTAL_FIXED');
 stage='overview after hand-out shows lent equipment and still unsettled';
 await panel().getByRole('button',{name:'団体と内訳を確認'}).click();await expect(panel()).toContainText('貸出中 6');await expect(panel()).toContainText('未精算');
 console.log('PASS group custody UI: number search -> breakdown (on-site/unsettled, fit flag) -> manual-fit gate -> preparation -> hand-out; no booking, hold payment_state NONE');
}catch(e){console.error('GROUP_CUSTODY_UI_FAILED '+stage);throw e;}finally{await browser.close();await group?.close();await app.stop();}
