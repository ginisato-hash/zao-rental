import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {groupFixture,skiMember,PERIOD} from './fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {syntheticPreparation} from '../custody/preparation-fixture';
import {skiSet} from '../inventory/fixture';
import {writeAccount} from '../../packages/auth/src/accounts';
import type {GroupMemberInput} from '../../packages/contracts/src/group-order';

// Isolated real PostgreSQL, synthetic data only. Group custody connection (Issue #47 B4):
// a CONFIRMED group that is still unsettled (PAY_ON_SITE / UNPAID) is prepared, lent and returned part by part through the existing
// physical rules, while the ordinary booking gate (payment_state=SUCCESS) stays exactly as strict as before.
let stage='setup',count=0;const x=await groupFixture(150);const q=(s:string,p:unknown[]=[])=>x.db.pool.query(s,p);
const role=await provisionCustodyRole(x.db.pool,x.db.identity);
const svc=new CustodyService(role.custodyPool,x.roles.authPool,x.signed.identity);
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
const rejects=(p:Promise<unknown>,code:string)=>assert.rejects(p,(e:unknown)=>(e as {code?:string}).code===code||(console.error('expected',code,'got',(e as Error).message),false));
const DAY1='2035-02-10T10:00:00+09:00';
const profile={heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,skierType:'TYPE_I'},synthetic:true};
const member=(label:string,fit?:Record<string,unknown>):GroupMemberInput=>({...skiMember(label),profile,...(fit?{fit}:{})});
/** application -> members -> quote -> consent -> submit (REVIEW_HELD); optionally confirm (CONFIRMED, unsettled). */
async function build(token:string,members:GroupMemberInput[],opts:{confirm?:boolean;label?:string}={}){
 const a=await x.start(token,opts.label??'SYNTHETIC custody group');const m=await x.svc.saveMembers(a.owner,a.groupId,a.revision,members);
 const qt=await x.svc.quote(a.owner,a.groupId,m.revision);await x.svc.consent(a.owner,a.groupId,{quoteId:qt.quoteId,digest:qt.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});
 const s=await x.svc.submit(a.owner,a.groupId,{requestKey:randomUUID(),expectedRevision:qt.revision,quoteId:qt.quoteId});
 let revision=s.revision,status:string=s.status;
 if(opts.confirm){const manual=members.map((mm,i)=>mm.fit?m.memberIds[i]!:null).filter((v):v is string=>v!==null);
  const c=await x.svc.confirm(x.admin,a.groupId,{requestKey:randomUUID(),expectedRevision:s.revision,fitAcknowledgedMemberIds:manual});revision=c.revision;status=c.status;}
 return {...a,revision,status,memberIds:m.memberIds};
}
const part=async(groupId:string,n=1)=>(await q('SELECT * FROM group_order_parts WHERE group_id=$1 AND part_no=$2 AND active',[groupId,n])).rows[0];
const holdOf=async(partId:string)=>(await q('SELECT h.* FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.id=$1',[partId])).rows[0];
const traces=async()=>JSON.stringify(await Promise.all(['rental_bookings','rental_payment_attempts','rental_provider_events','rental_notifications','booking_notification_outbox','payment_projection_events','booking_cancellation_refunds','ops_refund_requests'].map(async t=>(await q('SELECT to_regclass($1) r',[t])).rows[0].r?Number((await q(`SELECT count(*) n FROM ${t}`)).rows[0].n):-1)));
async function prepareInput(partId:string,over:{manualFit?:{memberKey:string;confirmed:boolean;note:string}[];mutate?:(e:ReturnType<typeof syntheticPreparation>)=>void}={}){
 const v=await svc.groupCheckoutView(partId);const ev=syntheticPreparation(v);over.mutate?.(ev);
 return {view:v,input:{partId,expectedGroupRevision:v.groupRevision,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:ev,manualFit:over.manualFit??[]}};
}
/** A direct SQL attempt as the dedicated custody role (as another client of that role could issue). */
async function custodySql(sql:string,values:unknown[]=[]){
 const c=await role.custodyPool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.session',$2,true),set_config('zao.reason','Synthetic group custody test',true)",[x.signed.identity.subject,x.signed.identity.sessionId]);
  let err:unknown;try{await c.query(sql,values);}catch(e){err=e;}await c.query('ROLLBACK');return err as {code?:string;message:string}|undefined;}
 finally{c.release();}
}
/** Owner-level fixture edit (simulates the evidence disappearing behind the service's back), audited like any write. */
async function asOwner(sql:string,params:unknown[]=[]){const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Synthetic fixture edit',true)",[x.signed.identity.subject]);await c.query(sql,params);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function rawLoan(partId:string,over:Record<string,unknown>={}){
 const h=await holdOf(partId);
 const cl=(await q(`SELECT DISTINCT ON(requirement_key) cl.*,coalesce(a.variant_id,po.variant_id) AS variant_id,v.family FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles po ON po.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,po.variant_id) WHERE cl.hold_id=$1 AND cl.active AND cl.asset_id IS NOT NULL ORDER BY requirement_key,day LIMIT 1`,[h.id])).rows[0];
 const row={id:randomUUID(),cycle_id:partId,booking_id:null,group_part_id:partId,hold_id:h.id,requirement_key:cl.requirement_key,asset_id:cl.asset_id,pole_id:null,pole_slot:null,family:cl.family,variant_id:cl.variant_id,unit:'PAIR',quantity:1,pickup_store:h.pickup_store,checked_out_at:new Date(),checked_out_by:x.signed.identity.subject,due_at:h.due_at,state:'OUT',...over};
 const cols=Object.keys(row);return custodySql(`INSERT INTO rental_loan_items(${cols.join(',')}) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
}
let token='',G:Awaited<ReturnType<typeof build>>,HELD:Awaited<ReturnType<typeof build>>,MANUAL:Awaited<ReturnType<typeof build>>,PREP:Awaited<ReturnType<typeof build>>,CANC:Awaited<ReturnType<typeof build>>,REL:Awaited<ReturnType<typeof build>>;
try{
 token=await x.entrance();
 // all applications are made and decided at the planning date; the clock then moves to the day of use
 G=await build(token,[member('a1'),member('a2')],{confirm:true,label:'SYNTHETIC lend and return'});
 HELD=await build(token,[member('h1')],{label:'SYNTHETIC still waiting for approval'});
 MANUAL=await build(token,[member('m1'),member('m2',{status:'MANUAL_FIT_REQUIRED'})],{confirm:true,label:'SYNTHETIC manual fit'});
 PREP=await build(token,[member('p1')],{confirm:true,label:'SYNTHETIC prepared then cancelled'});
 CANC=await build(token,[member('c1')],{confirm:true,label:'SYNTHETIC cancelled before preparation'});
 REL=await build(token,[member('r1')],{label:'SYNTHETIC released'});
 await x.svc.release(x.admin,REL.groupId,{requestKey:randomUUID(),expectedRevision:REL.revision,reason:'SYNTHETIC release before custody'});
 let before=await traces();
 await x.clock(DAY1);

 await check('confirmed + unsettled group shows under its group number with members, equipment sizes, fit flags and an honest on-site/unpaid settlement; no booking exists',async()=>{
  const ov=await svc.groupOverview(G.groupId);
  assert.match(ov.groupNumber,/^G-\d{6}$/);assert.equal(ov.status,'CONFIRMED');assert.equal(ov.confirmationBasis,'GROUP_ADMIN_APPROVED');assert.equal(ov.lendable,true);
  assert.equal(ov.settlement.paymentMethod,'PAY_ON_SITE');assert.equal(ov.settlement.status,'UNPAID');assert.equal(ov.settlement.receivedJpy,0);
  assert.equal(ov.parts.length,1);assert.deepEqual(ov.parts[0]!.members.map(m=>m.memberKey),['p001','p002']);
  assert.equal(JSON.stringify(ov).includes('synthetic-rep@example.invalid'),false,'no contact data on the custody view');
  assert.equal((await svc.groupByNumber(ov.groupNumber)).groupId,G.groupId);
  const p=await part(G.groupId);const v=await svc.groupCheckoutView(p.id);
  assert.equal(v.kind,'GROUP_PART');assert.equal(v.groupNumber,ov.groupNumber);assert.equal(v.holdStage,'GROUP_RESERVED');assert.equal(v.items.length,6);
  assert.ok(v.items.every(i=>typeof i.size==='string'&&i.size.length>0),'sizes of the assigned equipment are shown');
  assert.deepEqual(v.manualFitMemberKeys,[]);assert.equal(v.preparationValid,false);
  const h=await holdOf(p.id);assert.equal(h.payment_state,'NONE');assert.equal(h.confirmed_at,null);
  assert.deepEqual((await q('SELECT count(*)::int n FROM rental_bookings')).rows[0].n,0);
 });

 await check('before approval (REVIEW_HELD) and after release (RELEASED) nothing can be prepared or lent; the overview says so',async()=>{
  for(const g of [HELD,REL])assert.equal((await svc.groupOverview(g.groupId)).lendable,false);
  const rp=await part(REL.groupId);const rv=await svc.groupCheckoutView(rp.id);
  await rejects(svc.groupPrepare(randomUUID(),{partId:rp.id,expectedGroupRevision:rv.groupRevision,expectedHoldVersion:rv.holdVersion,selections:[],fitEvidence:{},manualFit:[]}),'GROUP_CUSTODY_NOT_ALLOWED');
  const hp=await part(HELD.groupId);const v=await svc.groupCheckoutView(hp.id);
  await rejects(svc.groupPrepare(randomUUID(),{partId:hp.id,expectedGroupRevision:v.groupRevision,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(v),manualFit:[]}),'GROUP_CUSTODY_NOT_ALLOWED');
  await rejects(svc.groupCheckout(randomUUID(),{partId:hp.id,expectedPreparationVersion:1}),'CHECKOUT_NOT_ALLOWED');
  // SQL door: a direct loan on a not-yet-confirmed part is refused by the database as well
  const e=await rawLoan(hp.id);assert.ok(e&&/CUSTODY_CHECKOUT_INVALID/.test(e.message),String(e?.message));
  // and a stage change by the custody role on an unconfirmed group part is refused
  const e2=await custodySql("UPDATE inventory_holds SET allocation_stage='PREPARATION_FIXED',version=version+1 WHERE id=$1",[(await holdOf(hp.id)).id]);assert.ok(e2&&/CUSTODY_STAGE_INVALID/.test(e2.message),String(e2?.message));
  assert.equal((await holdOf(hp.id)).allocation_stage,'GROUP_RESERVED');
 });

 await check('physical checkout is refused without a prepared record, with wrong equipment, or without physical confirmation',async()=>{
  const p=await part(G.groupId);const {view,input}=await prepareInput(p.id);
  await rejects(svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:1}),'STALE_PREPARATION');
  const wrong=structuredClone(input);wrong.selections.find(s=>s.assetId)!.assetId=randomUUID();await rejects(svc.groupPrepare(randomUUID(),wrong),'EXACT_FULL_PERIOD_ASSIGNMENT_REQUIRED');
  const unconfirmed=await prepareInput(p.id,{mutate:e=>{e.members[0]!.equipmentConfirmed=false;}});await rejects(svc.groupPrepare(randomUUID(),unconfirmed.input),'PHYSICAL_CONFIRMATION_REQUIRED');
  await rejects(svc.groupPrepare(randomUUID(),{...input,expectedGroupRevision:view.groupRevision+1}),'STALE_VERSION');
  await rejects(svc.groupPrepare(randomUUID(),{...input,manualFit:[{memberKey:'p001',confirmed:true,note:'not needed'}]}),'MANUAL_FIT_CONFIRMATION_REQUIRED');
  assert.equal((await holdOf(p.id)).allocation_stage,'GROUP_RESERVED');assert.equal((await q('SELECT count(*)::int n FROM group_part_preparations')).rows[0].n,0);
  const e=await rawLoan(p.id);assert.ok(e&&/CUSTODY_CHECKOUT_INVALID/.test(e.message),'not prepared => stage is not PREPARATION_FIXED: '+e?.message);
 });

 let loans:{id:string;asset_id:string|null;pole_id:string|null;family:string;version:number;state:string}[]=[];
 await check('confirmed unsettled group: exact preparation -> checkout of every part item -> replay is the same result; group stays CONFIRMED/UNPAID; no payment artefact appears',async()=>{
  const p=await part(G.groupId);const {input}=await prepareInput(p.id);
  const prepared=await svc.groupPrepare(randomUUID(),input);assert.equal(prepared.preparation.version,1);assert.equal(prepared.holdStage,'PREPARATION_FIXED');assert.equal(prepared.preparationValid,true);
  const key=randomUUID(),value={partId:p.id,expectedPreparationVersion:1};
  const out=await svc.groupCheckout(key,value);const again=await svc.groupCheckout(key,value);
  assert.deepEqual(JSON.parse(JSON.stringify(again.loans)),JSON.parse(JSON.stringify(out.loans)));
  loans=out.loans;assert.equal(loans.length,6);assert.ok(loans.every(l=>l.state==='OUT'&&l.version===1));
  assert.equal((await holdOf(p.id)).allocation_stage,'RENTAL_FIXED');assert.equal((await holdOf(p.id)).payment_state,'NONE');
  await rejects(svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:1}),'ALREADY_CHECKED_OUT');
  const l0=(await q('SELECT * FROM rental_loan_items WHERE group_part_id=$1 LIMIT 1',[p.id])).rows[0];assert.equal(l0.booking_id,null);assert.equal(l0.cycle_id,p.id);assert.equal(l0.hold_id,p.hold_id);
  const g=(await q('SELECT status,confirmation_basis,confirmed_total_jpy FROM group_orders WHERE id=$1',[G.groupId])).rows[0];assert.equal(g.status,'CONFIRMED');assert.equal(g.confirmation_basis,'GROUP_ADMIN_APPROVED');
  const ov=await svc.groupOverview(G.groupId);assert.equal(ov.settlement.status,'UNPAID');assert.equal(ov.parts[0]!.loansOut,6);
  assert.ok(ov.parts[0]!.members.every(m=>m.equipment.length===3&&m.equipment.every(e=>e.state==='OUT')),'each member shows its three lent items');
  assert.equal(await traces(),before,'no booking, payment attempt, provider event, notification or refund row was created by custody');
 });

 await check('a confirmed group cannot be cancelled while an item is out (service and database); return first',async()=>{
  await rejects(x.svc.cancelConfirmed(x.admin,G.groupId,{requestKey:randomUUID(),expectedRevision:G.revision,reason:'SYNTHETIC cancel while out'}),'GROUP_LOANS_OUT');
  const e=await custodySql("SELECT 1");assert.equal(e,undefined);
  const c=await x.groupPool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.group_op','on',true),set_config('zao.actor',$1,true)",[x.admin.subject]);
   let err:{message:string}|undefined;try{await c.query("UPDATE group_orders SET status='CANCELLED',revision=revision+1,cancelled_at=clock_timestamp(),cancelled_by=$2,last_action='{\"event\":\"GROUP_CANCELLED\"}' WHERE id=$1",[G.groupId,x.admin.subject]);}catch(e2){err=e2 as {message:string};}
   await c.query('ROLLBACK');assert.ok(err&&/GROUP_LOANS_OUT/.test(err.message),String(err?.message));}finally{c.release();}
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[G.groupId])).rows[0].status,'CONFIRMED');
 });

 await check('protection after confirmation is released only by the normal custody rules: no stray release, hold stays RENTAL_FIXED while items are out',async()=>{
  const p=await part(G.groupId),h=await holdOf(p.id);
  const claimsBefore=Number((await q('SELECT count(*) n FROM inventory_claims WHERE hold_id=$1 AND active',[h.id])).rows[0].n);assert.ok(claimsBefore>0);
  for(const sql of ["UPDATE inventory_holds SET state='RELEASED' WHERE id=$1","UPDATE inventory_claims SET active=false WHERE hold_id=$1","UPDATE inventory_holds SET allocation_stage='GROUP_RESERVED' WHERE id=$1"]){
   const e=await custodySql(sql,[h.id]);assert.ok(e,'custody role cannot do: '+sql);
  }
  assert.equal(Number((await q('SELECT count(*) n FROM inventory_claims WHERE hold_id=$1 AND active',[h.id])).rows[0].n),claimsBefore);
  // the loan row's identity is immutable and a duplicate item for the same part/requirement is impossible
  const e=await rawLoan(p.id);assert.ok(e&&/duplicate key|CUSTODY_CHECKOUT_INVALID/.test(e.message),String(e?.message));
 });

 await check('ordinary booking regression: an unsettled ordinary booking can still not be prepared or lent; a group hold can never become a booking; subject columns are exclusive',async()=>{
  const d=await x.draft(undefined,skiSet('2035-02-20'),{reason:'SYNTHETIC ordinary regression'});
  const view=await svc.checkoutView(d.booking.id);
  await rejects(svc.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)}),'PREPARATION_NOT_ALLOWED');
  await rejects(svc.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:1}),'CHECKOUT_NOT_ALLOWED');
  assert.equal((await q('SELECT payment_state FROM inventory_holds WHERE id=$1',[d.holdId])).rows[0].payment_state,'NONE');
  // custody cannot be reached for a booking through the group door and vice versa
  await rejects(svc.groupPrepare(randomUUID(),{partId:d.booking.id,expectedGroupRevision:1,expectedHoldVersion:1,selections:[],fitEvidence:{},manualFit:[]}),'NOT_FOUND');
  const gp=await part(G.groupId);
  const e1=await rawLoan(gp.id,{booking_id:d.booking.id});assert.ok(e1&&/rental_loan_subject|CUSTODY_CHECKOUT_INVALID/.test(e1.message),String(e1?.message));
  before=await traces();// the one ordinary draft booking made above is this check's own, not custody's
  const e2=await rawLoan(gp.id,{group_part_id:null,hold_id:null,booking_id:d.booking.id,cycle_id:d.booking.id});assert.ok(e2&&/CUSTODY_CHECKOUT_INVALID/.test(e2.message),'ordinary validator still needs SUCCESS: '+e2?.message);
 });

 await check('manual fit: a size outside what can be fitted online is lent only after the in-store fit is recorded for exactly that member; a refused fit blocks; the database repeats it',async()=>{
  const p=await part(MANUAL.groupId);const ov=await svc.groupOverview(MANUAL.groupId);assert.deepEqual(ov.parts[0]!.members.map(m=>m.manualFitRequired),[false,true]);
  const v=await svc.groupCheckoutView(p.id);assert.deepEqual(v.manualFitMemberKeys,['p002']);
  const base=(await prepareInput(p.id)).input;
  await rejects(svc.groupPrepare(randomUUID(),{...base,manualFit:[]}),'MANUAL_FIT_CONFIRMATION_REQUIRED');
  await rejects(svc.groupPrepare(randomUUID(),{...base,manualFit:[{memberKey:'p001',confirmed:true,note:'wrong member'}]}),'MANUAL_FIT_CONFIRMATION_REQUIRED');
  await rejects(svc.groupPrepare(randomUUID(),{...base,manualFit:[{memberKey:'p002',confirmed:false,note:'does not fit'}]}),'FIT_NOT_CONFIRMED');
  assert.equal((await holdOf(p.id)).allocation_stage,'GROUP_RESERVED');
  const ok=await svc.groupPrepare(randomUUID(),{...base,manualFit:[{memberKey:'p002',confirmed:true,note:'SYNTHETIC tried on in store'}]});assert.equal(ok.preparationValid,true);
  // evidence removed behind the service's back: service and database both refuse the loan
  await asOwner("UPDATE group_part_preparations SET fit_evidence=fit_evidence-'manualFit' WHERE id=$1",[p.id]);
  await rejects(svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:1}),'MANUAL_FIT_CONFIRMATION_REQUIRED');
  const h=await holdOf(p.id);
  const cl=(await q(`SELECT DISTINCT ON(requirement_key) cl.*,coalesce(a.variant_id,po.variant_id) AS variant_id,v.family FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles po ON po.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,po.variant_id) WHERE cl.hold_id=$1 AND cl.active AND cl.asset_id IS NOT NULL AND cl.requirement_key LIKE 'p002:%' ORDER BY requirement_key,day`,[h.id])).rows[0];
  const e=await custodySql(`INSERT INTO rental_loan_items(id,cycle_id,booking_id,group_part_id,hold_id,requirement_key,asset_id,family,variant_id,unit,quantity,pickup_store,checked_out_at,checked_out_by,due_at,state) VALUES($1,$2,NULL,$2,$3,$4,$5,$6,$7,'PAIR',1,$8,clock_timestamp(),$9,$10,'OUT')`,[randomUUID(),p.id,h.id,cl.requirement_key,cl.asset_id,cl.family,cl.variant_id,h.pickup_store,x.signed.identity.subject,h.due_at]);
  assert.ok(e&&/CUSTODY_MANUAL_FIT_REQUIRED/.test(e.message),'database refuses a manual-fit member without recorded in-store fit: '+e?.message);
  assert.equal((await q('SELECT count(*)::int n FROM rental_loan_items WHERE group_part_id=$1',[p.id])).rows[0].n,0);
  // re-prepare with the confirmation, then lend
  const again=(await prepareInput(p.id)).input;const re=await svc.groupPrepare(randomUUID(),{...again,manualFit:[{memberKey:'p002',confirmed:true,note:'SYNTHETIC tried on in store'}]});
  const out=await svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:re.preparation.version});assert.equal(out.loans.length,6);
 });

 await check('cancellation: prepared-but-not-lent and never-prepared confirmed groups cancel through the formal path; zero real receipts => refund 0 and no refund/provider artefact; protection ends in one transaction',async()=>{
  const p=await part(PREP.groupId);const {input}=await prepareInput(p.id);await svc.groupPrepare(randomUUID(),input);assert.equal((await holdOf(p.id)).allocation_stage,'PREPARATION_FIXED');
  const claimsBefore=Number((await q('SELECT count(*) n FROM inventory_claims WHERE hold_id=$1 AND active',[(await holdOf(p.id)).id])).rows[0].n);assert.ok(claimsBefore>0);
  const r=await x.svc.cancelConfirmed(x.admin,PREP.groupId,{requestKey:randomUUID(),expectedRevision:PREP.revision,reason:'SYNTHETIC customer cancelled before pickup'});
  assert.equal(r.refundJpy,0);assert.equal(r.receivedJpyNeedsManualRefund,0);
  assert.equal((await holdOf(p.id)).state,'RELEASED');assert.equal(Number((await q('SELECT count(*) n FROM inventory_claims WHERE hold_id=$1 AND active',[(await holdOf(p.id)).id])).rows[0].n),0);
  assert.equal((await q('SELECT count(*)::int n FROM group_payments WHERE group_id=$1',[PREP.groupId])).rows[0].n,0);
  const fresh=await svc.groupCheckoutView(p.id);await rejects(svc.groupPrepare(randomUUID(),{...input,expectedGroupRevision:fresh.groupRevision,expectedHoldVersion:fresh.holdVersion}),'GROUP_CUSTODY_NOT_ALLOWED');
  const p2=await part(CANC.groupId);const r2=await x.svc.cancelConfirmed(x.admin,CANC.groupId,{requestKey:randomUUID(),expectedRevision:CANC.revision,reason:'SYNTHETIC cancel unprepared'});assert.equal(r2.refundJpy,0);
  assert.equal((await svc.groupOverview(CANC.groupId)).lendable,false);assert.equal((await holdOf(p2.id)).state,'RELEASED');
  assert.equal(await traces(),before,'cancellation created no refund, provider or booking artefact');
 });

 await check('authorization and store boundary: custody needs RENTAL_CHECKOUT for the pickup store, re-read per call; a store-scoped terminal cannot touch the other store',async()=>{
  const p=await part(MANUAL.groupId);
  const mk=async(email:string,perms:Record<string,boolean>,scope:'ALL'|'ASSIGNED',storeIds:('MOUNTAIN_BASE'|'ONSEN_BASE')[])=>{const id=(await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC '+email,active:true,role:'MANAGER',scope,storeIds,permissions:perms})).id!;const s=await x.login(email);return {id,svc:new CustodyService(role.custodyPool,x.roles.authPool,s.identity)};};
  const viewOnly=await mk('group-cust-view@example.invalid',{BOOKING_VIEW:true},'ALL',[]);
  await rejects(viewOnly.svc.groupOverview(MANUAL.groupId),'FORBIDDEN');await rejects(viewOnly.svc.groupCheckoutView(p.id),'FORBIDDEN');
  const onsen=await mk('group-cust-onsen@example.invalid',{BOOKING_VIEW:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true},'ASSIGNED',['ONSEN_BASE']);
  await rejects(onsen.svc.groupOverview(MANUAL.groupId),'FORBIDDEN');await rejects(onsen.svc.groupCheckoutView(p.id),'FORBIDDEN');
  await rejects(onsen.svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:1}),'FORBIDDEN');
  const mountain=await mk('group-cust-mtn@example.invalid',{BOOKING_VIEW:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true},'ASSIGNED',['MOUNTAIN_BASE']);
  assert.equal((await mountain.svc.groupOverview(MANUAL.groupId)).groupId,MANUAL.groupId);
  // permission revoked after login: refused on the very next call
  await q("UPDATE staff_members SET revision=revision+1 WHERE id=$1",[mountain.id]);await q("DELETE FROM staff_permission_overrides WHERE staff_id=$1 AND permission='RENTAL_CHECKOUT'",[mountain.id]);
  await q("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'RENTAL_CHECKOUT',false) ON CONFLICT(staff_id,permission) DO UPDATE SET allowed=false",[mountain.id]);
  await rejects(mountain.svc.groupOverview(MANUAL.groupId),'FORBIDDEN');
 });

 await check('cross-store return keeps the store boundary: the item is located where it was received and stays blocked until inspected there',async()=>{
  const p=await part(MANUAL.groupId);const ls=(await q("SELECT id,asset_id,pole_id,version FROM rental_loan_items WHERE group_part_id=$1 AND asset_id IS NOT NULL AND family='SKI' ORDER BY requirement_key LIMIT 1",[p.id])).rows[0];
  let b=await svc.createBatch(randomUUID(),'ONSEN_BASE');b=await svc.scan(randomUUID(),{batchId:b.id,expectedVersion:b.version,assetId:ls.asset_id,poleLoanId:null});b=await svc.confirm(randomUUID(),{batchId:b.id,expectedVersion:b.version});
  assert.equal((await q('SELECT store_id FROM ledger_assets WHERE id=$1',[ls.asset_id])).rows[0].store_id,'ONSEN_BASE');
  assert.equal((await q("SELECT count(*)::int n FROM rental_loan_items WHERE group_part_id=$1 AND state='OUT'",[p.id])).rows[0].n,5,'only the scanned item left custody');
  assert.equal((await q("SELECT count(*)::int n FROM rental_inventory_blocks WHERE id=$1 AND reason='INSPECTION_PENDING'",[ls.id])).rows[0].n,1);
  const e=await svc.inspection(randomUUID(),{loanItemId:ls.id,expectedVersion:2,store:'MOUNTAIN_BASE',evidence:'SYNTHETIC wrong store'}).catch(e=>e);assert.ok(e instanceof Error,'inspection at a store that did not receive it is refused');
 });
 await check('return: scan -> confirm at the lending store; each item is received once under the group number; pairs are conserved; uninspected items block the allocator',async()=>{
  const p=await part(G.groupId),polesBefore=(await q("SELECT coalesce(sum(quantity),0)::int n FROM ledger_poles")).rows[0].n;
  const outPairs=async()=>Number((await q("SELECT coalesce(sum(out_pairs),0)::int n FROM rental_pole_custody")).rows[0].n),outBefore=await outPairs();
  assert.equal(outBefore,Number((await q("SELECT count(*)::int n FROM rental_loan_items WHERE pole_id IS NOT NULL AND state='OUT'")).rows[0].n),'every lent group pole pair is counted as out, not lost');
  let b=await svc.createBatch(randomUUID(),'MOUNTAIN_BASE');
  for(const l of loans){b=await svc.scan(randomUUID(),{batchId:b.id,expectedVersion:b.version,assetId:l.asset_id,poleLoanId:l.asset_id?null:l.id});}
  assert.equal(b.candidates.length,6);assert.ok(b.candidates.every(c=>c.group_part_id===p.id&&/^G-\d{6}$/.test(c.group_number!)&&c.booking_id===null),'candidates are labelled with the group number');
  const done=await svc.confirm(randomUUID(),{batchId:b.id,expectedVersion:b.version});assert.equal(done.candidates.filter(c=>c.state==='RECEIVED').length,6);
  assert.equal((await q("SELECT count(*)::int n FROM rental_loan_items WHERE group_part_id=$1 AND state='RECEIVED'",[p.id])).rows[0].n,6);
  assert.equal(await outPairs(),outBefore-2,'the two returned pole pairs leave the out count');
  assert.equal((await q("SELECT coalesce(sum(quantity),0)::int n FROM ledger_poles")).rows[0].n,polesBefore,'PAIR conservation: pole pairs are only moved to the inspection pool, never created or lost');
  assert.equal((await q('SELECT count(*)::int n FROM rental_inventory_blocks x JOIN rental_loan_items l ON l.id=x.id WHERE l.group_part_id=$1 AND x.reason=$2',[p.id,'INSPECTION_PENDING'])).rows[0].n,6,'returned but uninspected group items block reuse');
  const allocatorSees=(await q(`SELECT count(*)::int n FROM rental_inventory_blocks x JOIN rental_loan_items l ON l.id=x.id LEFT JOIN rental_bookings b ON b.id=l.booking_id WHERE coalesce(b.hold_id,l.hold_id) IS NOT NULL AND l.group_part_id=$1`,[p.id])).rows[0].n;assert.equal(allocatorSees,6,'allocator custody query resolves the hold of a group loan');
  const again=await svc.confirm(randomUUID(),{batchId:b.id,expectedVersion:done.version});assert.equal(again.candidates.filter(c=>c.state==='RECEIVED').length,6);
  assert.equal((await q('SELECT count(*)::int n FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id WHERE l.group_part_id=$1',[p.id])).rows[0].n,6,'a replayed confirmation receives nothing twice');
  const ret=await svc.returns('MOUNTAIN_BASE');assert.equal(ret.received.filter(r=>r.group_part_id===p.id&&/^G-\d{6}$/.test(String(r.group_number))).length,6);
  for(const l of loans.filter(l=>l.asset_id)){const r=(await q('SELECT l.id,l.version FROM rental_loan_items l WHERE l.id=$1',[l.id])).rows[0];
   await svc.inspection(randomUUID(),{loanItemId:r.id,expectedVersion:r.version,store:'MOUNTAIN_BASE',evidence:'SYNTHETIC inspected'});}
  assert.equal((await q("SELECT count(*)::int n FROM rental_inventory_blocks x JOIN rental_loan_items l ON l.id=x.id WHERE l.group_part_id=$1 AND x.reason='INSPECTION_PENDING' AND x.asset_id IS NOT NULL",[p.id])).rows[0].n,0);
  assert.equal(await traces(),before,'return created no booking/payment/refund artefact');
  // existing custody semantics: a returned pole pair flags every other promise on that pool for reconciliation; this must also work for a held group promise, without releasing it
  const hp=await part(HELD.groupId);assert.equal((await holdOf(hp.id)).transfer_attention,'CUSTODY_RECONCILIATION_REQUIRED');assert.equal((await holdOf(hp.id)).allocation_stage,'GROUP_RESERVED');assert.equal((await holdOf(hp.id)).state,'ACTIVE');
 });
 console.log('Group custody: '+count+' checks passed.');
}catch(e){console.error('FAILED at stage: '+stage);console.error(e);process.exitCode=1;}
finally{await role.close();await x.close();}
