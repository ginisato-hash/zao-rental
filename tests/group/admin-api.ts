/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP JSON bodies are inspected loosely in this test */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {groupFixture,skiMember} from './fixture';
import {skiSet,variants,fid} from '../inventory/fixture';
import {staffGroupHandler} from '../../apps/web/src/lib/staff-group-http';
import {writeAccount} from '../../packages/auth/src/accounts';
import {loadStaff,type StaffState} from '../../packages/auth/src/staff-auth';
import {createHash} from 'node:crypto';

// Real PostgreSQL, synthetic data only. The administrator HTTP layer (/api/staff/groups) over the real service: every state-changing route is
// ADMIN only, same-origin, session-stamped and idempotent; releases free exactly the group's claims; races end in one consistent outcome.
let stage='setup',failed=false,count=0;const x=await groupFixture(20);const q=(s:string,p:unknown[]=[])=>x.db.pool.query(s,p);
const ORIGIN='http://127.0.0.1:34567',STAMP='synthetic-stamp';
const stampHash=createHash('sha256').update(STAMP).digest('hex');
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
const stateFor=(principal:Awaited<ReturnType<typeof loadStaff>>):((h:Headers)=>Promise<StaffState>)=>async()=>principal?{status:'authorized',principal,stamp:STAMP}:{status:'anonymous',principal:null,stamp:null};
const handlerFor=(principal:Awaited<ReturnType<typeof loadStaff>>)=>staffGroupHandler(stateFor(principal),()=>x.svc,ORIGIN);
const call=async(h:ReturnType<typeof handlerFor>,method:'GET'|'POST',path:string,body?:unknown,opts:{origin?:string|null;stamp?:string|null}={})=>{
 const headers:Record<string,string>={'content-type':'application/json'};if(opts.origin!==null)headers.origin=opts.origin??ORIGIN;if(opts.stamp!==null)headers['x-zao-session']=opts.stamp??stampHash;
 const r=await h(new Request('http://127.0.0.1:34567/api/staff/groups'+path,{method,headers,...(method==='POST'?{body:JSON.stringify(body??{})}:{})}));
 return {status:r.status,body:await r.json() as Record<string,any>};};
const claims=async(groupId:string)=>Number((await q("SELECT count(*) n FROM inventory_claims c JOIN group_order_parts p ON p.hold_id=c.hold_id WHERE p.group_id=$1 AND c.active",[groupId])).rows[0].n);
const outbox=async(id:string,type:string)=>Number((await q('SELECT count(*) n FROM group_notification_outbox WHERE group_id=$1 AND event_type=$2',[id,type])).rows[0].n);
const status=async(id:string)=>(await q('SELECT status FROM group_orders WHERE id=$1',[id])).rows[0].status as string;
try{
 const token=await x.entrance();
 const adminP=(await loadStaff(x.db.pool,x.admin.subject))!,mgrP=(await loadStaff(x.db.pool,x.manager.subject))!;
 const admin2=(await writeAccount(x.roles.authPool,x.bp,undefined,{email:'group-admin2@example.invalid',password:x.password,displayName:'SYNTHETIC Admin Two',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{}} as never)).id!;
 const admin2P=(await loadStaff(x.db.pool,admin2))!;
 const A=handlerFor(adminP),M=handlerFor(mgrP),A2=handlerFor(admin2P),anon=handlerFor(null);
 const held=async(day:string,count:number,label:string)=>{const a=await x.start(token,label,{startDate:day,endDate:day,slot:'DAY'});const m=await x.svc.saveMembers(a.owner,a.groupId,a.revision,Array.from({length:count},(_,i)=>skiMember('m'+(i+1))));
  const qq=await x.svc.quote(a.owner,a.groupId,m.revision);await x.svc.consent(a.owner,a.groupId,{quoteId:qq.quoteId,digest:qq.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});
  const s=await x.svc.submit(a.owner,a.groupId,{requestKey:randomUUID(),expectedRevision:qq.revision,quoteId:qq.quoteId});return {...a,revision:s.revision,memberIds:m.memberIds};};
 const upd=async(id:string,p:{role?:'ADMIN'|'MANAGER';scope?:'ALL'|'ASSIGNED';storeIds?:string[];permissions?:Record<string,boolean>})=>{const cur=(await loadStaff(x.db.pool,id))!;
  return writeAccount(x.roles.authPool,x.bp,id,{displayName:'SYNTHETIC Admin Two',active:true,role:p.role??'ADMIN',scope:p.scope??cur.scope,storeIds:(p.scope??cur.scope)==='ALL'?[]:(p.storeIds??cur.storeIds),permissions:p.permissions??{},expectedRevision:cur.revision} as never);};
 const rev=async(id:string)=>(await q('SELECT revision FROM group_orders WHERE id=$1',[id])).rows[0].revision as number;

 await check('authorization: anonymous 401, non-ADMIN 403 on every route, ADMIN reads list/detail; only the documented fields are accepted',async()=>{
  const g=await held('2035-03-01',2,'SYNTHETIC auth');
  assert.equal((await call(anon,'GET','')).status,401);
  for(const [m,p] of [['GET',''],['GET','/'+g.groupId],['GET','/entrance'],['GET','/'+g.groupId+'/variants'],['POST','/'+g.groupId+'/release'],['POST','/'+g.groupId+'/confirm'],['POST','/'+g.groupId+'/receipt'],['POST','/entrance/rotate']] as const)assert.equal((await call(M,m,p)).status,403,m+' '+p);
  const list=await call(A,'GET','');assert.equal(list.status,200);assert.ok(list.body.groups.some((r:any)=>r.id===g.groupId));
  const d=await call(A,'GET','/'+g.groupId);assert.equal(d.status,200);assert.equal(d.body.group.status,'REVIEW_HELD');assert.equal(d.body.members.length,2);assert.equal(d.body.pricing.members.length,2);
  assert.equal((await call(A,'GET','?status=NOPE')).status,422);assert.equal((await call(A,'GET','/not-a-uuid')).status,422);
  const r=await call(A,'POST','/'+g.groupId+'/release',{requestKey:randomUUID(),expectedRevision:g.revision,reason:'x',extra:1});assert.equal(r.status,422);assert.equal(await status(g.groupId),'REVIEW_HELD');
  const one=await call(A,'GET','?number='+(await q('SELECT group_number FROM group_orders WHERE id=$1',[g.groupId])).rows[0].group_number);assert.equal(one.body.groups.length,1);
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('CSRF and session: foreign origin 403, missing/foreign stamp 409, nothing written',async()=>{
  const g=await held('2035-03-02',2,'SYNTHETIC csrf');const body={requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC csrf'};
  assert.equal((await call(A,'POST','/'+g.groupId+'/release',body,{origin:'https://evil.example'})).status,403);
  assert.equal((await call(A,'POST','/'+g.groupId+'/release',body,{origin:null})).status,403);
  assert.equal((await call(A,'POST','/'+g.groupId+'/release',body,{stamp:null})).status,409);assert.equal((await call(A,'POST','/'+g.groupId+'/release',body,{stamp:'f'.repeat(64)})).status,409);
  assert.equal(await status(g.groupId),'REVIEW_HELD');assert.ok(await claims(g.groupId)>0);
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('release frees exactly the group claims at once: a scarce date is unavailable to an ordinary hold before and available right after; response loss replays; one notice',async()=>{
  const day='2035-03-05',g=await held(day,19,'SYNTHETIC scarce'),other=await held('2035-03-06',2,'SYNTHETIC other date');
  const blocked=await x.holds.command('create',randomUUID(),skiSet(day),undefined,undefined);assert.notEqual(blocked.result,'CREATED','the group hold occupies the date');
  const key=randomUUID(),body={requestKey:key,expectedRevision:g.revision,reason:'SYNTHETIC withdrew',message:'SYNTHETIC note'};
  const r1=await call(A,'POST','/'+g.groupId+'/release',body);assert.equal(r1.status,200,JSON.stringify(r1.body));assert.equal(r1.body.status,'RELEASED');assert.equal(r1.body.releasedParts,1);
  const r2=await call(A,'POST','/'+g.groupId+'/release',body);assert.equal(r2.status,200);assert.equal(r2.body.replayed,true,'lost response: same request replays');
  const mismatch=await call(A,'POST','/'+g.groupId+'/release',{...body,reason:'a different reason'});assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'IDEMPOTENCY_MISMATCH');
  assert.equal(await claims(g.groupId),0);assert.equal(await outbox(g.groupId,'GROUP_RELEASED'),1);
  const ok=await x.holds.command('create',randomUUID(),skiSet(day),undefined,undefined);assert.equal(ok.result,'CREATED','the same date is now bookable by an ordinary booking');
  assert.ok(await claims(other.groupId)>0,'only this group was released');assert.equal(await status(other.groupId),'REVIEW_HELD');
  const again=await call(A,'POST','/'+g.groupId+'/release',{requestKey:randomUUID(),expectedRevision:g.revision+1,reason:'SYNTHETIC second'});assert.equal(again.status,409,'terminal state cannot be released again');
  await x.svc.release(x.admin,other.groupId,{requestKey:randomUUID(),expectedRevision:other.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('confirm versus release (two administrators, same revision): exactly one wins, state and claims are consistent, one notice',async()=>{
  for(let i=0;i<3;i++){
   const g=await held('2035-03-0'+(7+i),3,'SYNTHETIC race '+i),rv=g.revision;
   const [c,r]=await Promise.all([call(A,'POST','/'+g.groupId+'/confirm',{requestKey:randomUUID(),expectedRevision:rv}),call(A2,'POST','/'+g.groupId+'/release',{requestKey:randomUUID(),expectedRevision:rv,reason:'SYNTHETIC race'})]);
   const wins=[c,r].filter(v=>v.status===200).length;assert.equal(wins,1,JSON.stringify([c.body,r.body]));
   const s=await status(g.groupId);assert.ok(s==='CONFIRMED'||s==='RELEASED');
   if(s==='CONFIRMED'){assert.ok(await claims(g.groupId)>0);assert.equal(await outbox(g.groupId,'GROUP_CONFIRMED'),1);assert.equal(await outbox(g.groupId,'GROUP_RELEASED'),0);assert.ok([409].includes(r.status));}
   else{assert.equal(await claims(g.groupId),0);assert.equal(await outbox(g.groupId,'GROUP_RELEASED'),1);assert.equal(await outbox(g.groupId,'GROUP_CONFIRMED'),0);assert.equal(c.status,409);}
   const rel=(await q('SELECT status FROM group_orders WHERE id=$1',[g.groupId])).rows[0].status;if(rel==='CONFIRMED')await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:await rev(g.groupId),reason:'SYNTHETIC cleanup'});
  }
 });

 await check('discount rules over HTTP: member fixed + group percent, exact sum, over-large/invalid refused, preview writes nothing, 100% needs explicit no-charge confirmation',async()=>{
  const g=await held('2035-03-12',3,'SYNTHETIC discounts');const ids=g.memberIds as string[];
  const prev=await call(A,'POST','/'+g.groupId+'/preview-adjustments',{adjustments:[{target:'MEMBER',memberId:ids[0],method:'FIXED_JPY',value:300,reason:'SYNTHETIC m'},{target:'GROUP',method:'PERCENT_BPS',value:1234,reason:'SYNTHETIC g'}]});
  assert.equal(prev.status,200,JSON.stringify(prev.body));assert.equal(prev.body.members.reduce((n:number,m:any)=>n+m.finalJpy,0),prev.body.totalJpy,'per-member amounts add up exactly (1 yen remainders allocated)');
  assert.equal(Number((await q('SELECT count(*) n FROM group_adjustments WHERE group_id=$1',[g.groupId])).rows[0].n),0,'preview wrote nothing');
  for(const [adj,code] of [
   [[{target:'MEMBER',memberId:ids[0],method:'FIXED_JPY',value:99999999,reason:'SYNTHETIC'}],'ADJUSTMENT_EXCEEDS_REMAINDER'],
   [[{target:'GROUP',method:'PERCENT_BPS',value:10001,reason:'SYNTHETIC'}],'ADJUSTMENT_INVALID'],
   [[{target:'GROUP',method:'FIXED_JPY',value:0,reason:'SYNTHETIC'}],'ADJUSTMENT_INVALID'],
   [[{target:'GROUP',method:'FIXED_JPY',value:100,reason:'  '}],'ADJUSTMENT_REASON_REQUIRED'],
   [[{target:'MEMBER',memberId:ids[0],method:'FIXED_JPY',value:100,reason:'a'},{target:'MEMBER',memberId:ids[0],method:'PERCENT_BPS',value:100,reason:'b'}],'ADJUSTMENT_ONE_METHOD_PER_TARGET'],
   [[{target:'MEMBER',memberId:randomUUID(),method:'FIXED_JPY',value:100,reason:'a'}],'ADJUSTMENT_TARGET_UNKNOWN']] as const){
   const r=await call(A,'POST','/'+g.groupId+'/adjustments',{expectedRevision:g.revision,adjustments:adj});assert.equal(r.status,422,code+' '+JSON.stringify(r.body));assert.equal(r.body.error,code);}
  assert.equal((await call(M,'POST','/'+g.groupId+'/adjustments',{expectedRevision:g.revision,adjustments:[]})).status,403);
  const s=await call(A,'POST','/'+g.groupId+'/adjustments',{expectedRevision:g.revision,adjustments:[{target:'GROUP',method:'PERCENT_BPS',value:10000,reason:'SYNTHETIC full'}]});assert.equal(s.status,200);assert.equal(s.body.totalJpy,0);
  const stale=await call(A,'POST','/'+g.groupId+'/adjustments',{expectedRevision:g.revision,adjustments:[]});assert.equal(stale.status,409);assert.equal(stale.body.error,'STALE_REVISION');
  const rv=s.body.revision;
  const no=await call(A,'POST','/'+g.groupId+'/confirm',{requestKey:randomUUID(),expectedRevision:rv});assert.equal(no.status,409);assert.equal(no.body.error,'NO_CHARGE_CONFIRMATION_REQUIRED');assert.equal(await status(g.groupId),'REVIEW_HELD');
  const yes=await call(A,'POST','/'+g.groupId+'/confirm',{requestKey:randomUUID(),expectedRevision:rv,noChargeConfirmed:true,message:'SYNTHETIC zero'});assert.equal(yes.status,200,JSON.stringify(yes.body));assert.equal(yes.body.settlement,'NO_CHARGE');assert.equal(yes.body.totalJpy,0);
  const d=await call(A,'GET','/'+g.groupId);assert.equal(d.body.settlement.status,'NO_CHARGE');assert.equal((await call(A,'POST','/'+g.groupId+'/receipt',{requestKey:randomUUID(),amountJpy:100,method:'CASH',receivedAt:new Date().toISOString()})).status>=400,true,'no receipt against a zero total');
  await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:await rev(g.groupId),reason:'SYNTHETIC cleanup'});
 });

 await check('member edit over HTTP: stale revision refused, unknown member 404, wrong-family variant refused, valid size change re-reserves and needs re-consent; old reservation kept on failure',async()=>{
  const g=await held('2035-03-14',2,'SYNTHETIC edit');const before=await claims(g.groupId);
  const edit=(rv:number,mid:string,vid:string)=>({requestKey:randomUUID(),expectedRevision:rv,changeRequestId:null,edits:[{memberId:mid,items:[{family:'SKI',variantIds:[vid]}]}]});
  assert.equal((await call(A,'POST','/'+g.groupId+'/members',edit(g.revision-1,g.memberIds[0]!,variants.skiAlt))).body.error,'STALE_REVISION');
  assert.equal((await call(A,'POST','/'+g.groupId+'/members',edit(g.revision,randomUUID(),variants.skiAlt))).status,404);
  const wrong=await call(A,'POST','/'+g.groupId+'/members',edit(g.revision,g.memberIds[0]!,variants.boot));assert.ok(wrong.status>=400);assert.equal(await claims(g.groupId),before);assert.equal(await status(g.groupId),'REVIEW_HELD');
  assert.equal((await call(M,'POST','/'+g.groupId+'/members',edit(g.revision,g.memberIds[0]!,variants.skiAlt))).status,403);
  // the alternative size has no stock yet: the change fails as a whole and the old reservation is untouched
  const short=await call(A,'POST','/'+g.groupId+'/members',edit(g.revision,g.memberIds[0]!,variants.skiAlt));assert.equal(short.status,409);assert.equal(short.body.error,'INSUFFICIENT_STOCK');
  assert.equal(await claims(g.groupId),before);assert.equal(await status(g.groupId),'REVIEW_HELD');assert.equal(await rev(g.groupId),g.revision);
  const c0=await x.db.pool.connect();try{await c0.query('BEGIN');await c0.query("SELECT set_config('zao.actor','synthetic-group-admin-seed',true),set_config('zao.reason','SYNTHETIC alt size stock',true)");
   for(let i=0;i<30;i++)await c0.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','tests/group/admin-api.ts',$3)`,[fid(40000+i),variants.skiAlt,'GROUP-ALT-'+i]);await c0.query('COMMIT');}catch(e){await c0.query('ROLLBACK');throw e;}finally{c0.release();}
  const ok=await call(A,'POST','/'+g.groupId+'/members',edit(g.revision,g.memberIds[0]!,variants.skiAlt));assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal(ok.body.consentRequired,true);
  assert.equal(await claims(g.groupId),before);const d=await call(A,'GET','/'+g.groupId);assert.equal(d.body.consent,null,'estimate must be accepted again');
  const noConsent=await call(A,'POST','/'+g.groupId+'/confirm',{requestKey:randomUUID(),expectedRevision:d.body.group.revision});assert.equal(noConsent.body.error,'CONSENT_REQUIRED');
  const fit=d.body.members.find((m:any)=>m.id===g.memberIds[0]).fit;assert.equal(fit.status,'ADMIN_SELECTED');
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:d.body.group.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('receipts over HTTP: ADMIN only, actual amounts, overpayment refused, reversal once, idempotent replay; unconfirmed group refused',async()=>{
  const g=await held('2035-03-16',2,'SYNTHETIC receipts');
  assert.equal((await call(A,'POST','/'+g.groupId+'/receipt',{requestKey:randomUUID(),amountJpy:100,method:'CASH',receivedAt:new Date().toISOString()})).status>=400,true,'not confirmed yet');
  const c=await call(A,'POST','/'+g.groupId+'/confirm',{requestKey:randomUUID(),expectedRevision:g.revision});assert.equal(c.status,200);const total=c.body.totalJpy as number;
  const k=randomUUID(),b={requestKey:k,amountJpy:1000,method:'CASH',receivedAt:new Date().toISOString(),note:'SYNTHETIC'};
  assert.equal((await call(M,'POST','/'+g.groupId+'/receipt',b)).status,403);
  const r1=await call(A,'POST','/'+g.groupId+'/receipt',b);assert.equal(r1.status,200);assert.equal(r1.body.settlement.status,'PARTIALLY_PAID');const r2=await call(A,'POST','/'+g.groupId+'/receipt',b);assert.equal(r2.body.replayed,true);
  assert.equal(Number((await q("SELECT count(*) n FROM group_payments WHERE group_id=$1",[g.groupId])).rows[0].n),1,'replay did not record twice');
  assert.equal((await call(A,'POST','/'+g.groupId+'/receipt',{...b,requestKey:randomUUID(),amountJpy:total})).status>=400,true,'over the total');
  const rv=await call(A,'POST','/'+g.groupId+'/reverse-receipt',{requestKey:randomUUID(),paymentId:r1.body.paymentId,reason:'SYNTHETIC wrong'});assert.equal(rv.status,200);assert.equal(rv.body.settlement.status,'UNPAID');
  assert.equal((await call(A,'POST','/'+g.groupId+'/reverse-receipt',{requestKey:randomUUID(),paymentId:r1.body.paymentId,reason:'twice'})).body.error,'GROUP_REVERSAL_INVALID');
  const d=await call(A,'GET','/'+g.groupId);assert.equal(d.body.payments.length,2);assert.equal(d.body.settlement.outstandingJpy,total);
  const cc=await call(A,'POST','/'+g.groupId+'/cancel',{requestKey:randomUUID(),expectedRevision:d.body.group.revision,reason:'SYNTHETIC cleanup'});assert.equal(cc.status,200);assert.equal(cc.body.refundJpy,0);assert.equal(await claims(g.groupId),0);
 });

 await check('permission revoked or store changed after the screen loaded: the next write is refused and changes nothing',async()=>{
  const g=await held('2035-03-18',2,'SYNTHETIC revoke');
  // The role is lowered (ADMIN -> MANAGER) after the session principal was read: the transaction re-reads the database and refuses the write
  await upd(admin2,{role:'MANAGER'});
  const stale=await call(A2,'POST','/'+g.groupId+'/release',{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC'});assert.equal(stale.status,403,'service re-authorization, not only the HTTP gate');
  assert.equal(await status(g.groupId),'REVIEW_HELD');assert.ok(await claims(g.groupId)>0);
  const lowered=(await loadStaff(x.db.pool,admin2))!;assert.equal((await call(handlerFor(lowered),'POST','/'+g.groupId+'/release',{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC'})).status,403);assert.equal(await status(g.groupId),'REVIEW_HELD');
  await upd(admin2,{role:'ADMIN'});
  // scope narrowed to the other station
  await upd(admin2,{scope:'ASSIGNED',storeIds:['ONSEN_BASE']});const a3=(await loadStaff(x.db.pool,admin2))!;
  assert.equal((await call(handlerFor(a3),'GET','/'+g.groupId)).status,403);assert.equal((await call(handlerFor(a3),'GET','')).body.groups.length,0);
  assert.equal((await call(handlerFor(a3),'POST','/'+g.groupId+'/release',{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC'})).status,403);assert.equal(await status(g.groupId),'REVIEW_HELD');
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('entrance management over HTTP: ADMIN only, rotate returns the token once, stop/resume, status holds no token',async()=>{
  assert.equal((await call(M,'POST','/entrance/rotate',{reason:'x'})).status,403);
  const r=await call(A,'POST','/entrance/rotate',{reason:'SYNTHETIC rotate'});assert.equal(r.status,200);assert.match(r.body.token,/^[A-Za-z0-9_-]{43}$/);
  const st=await call(A,'GET','/entrance');assert.equal(st.body.enabled,true);assert.equal(JSON.stringify(st.body).includes(r.body.token),false);
  assert.equal(await x.svc.entranceOpen(r.body.token),true);assert.equal(await x.svc.entranceOpen(token),false);
  assert.equal((await call(A,'POST','/entrance/disable',{reason:'SYNTHETIC stop'})).status,200);assert.equal(await x.svc.entranceOpen(r.body.token),false);
  assert.equal((await call(A,'POST','/entrance/enable',{reason:'SYNTHETIC resume'})).status,200);assert.equal(await x.svc.entranceOpen(r.body.token),true);
  assert.equal((await call(A,'POST','/entrance/rotate',{reason:''})).status,422);
 });

 await check('nothing here created a booking, payment attempt or provider event',async()=>{
  for(const t of ['rental_bookings','rental_payment_attempts','rental_provider_events'])assert.equal(Number((await q(`SELECT count(*) n FROM ${t} WHERE hold_id IN (SELECT hold_id FROM group_order_parts)`).catch(()=>({rows:[{n:0}]}))).rows[0].n),0,t);
 });
}catch(e){failed=true;console.error('FAILED at: '+stage);console.error(e instanceof Error?e.stack:e);}
finally{await x.close();}
if(failed)process.exit(1);console.log(`group-admin-api: ${count} checks passed`);
