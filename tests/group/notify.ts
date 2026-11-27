import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {groupFixture,PERIOD} from './fixture';
import {CaptureDelivery} from './capture-delivery';
import {grantGroupNotificationDelta} from '../../scripts/group-notification-role';
import {GroupNotificationWorker,GroupNotificationStatus} from '../../packages/core/src/group/notification-worker';
import {GroupReadModel,groupReportCsv} from '../../packages/core/src/group/read-model';
import type {Adjustment} from '../../packages/contracts/src/group-order';

// Isolated real PostgreSQL, synthetic data only. The capture adapter never leaves the process: no real mail is sent.
let stage='setup',failed=false,count=0;const x=await groupFixture(150);const q=(s:string,p:unknown[]=[])=>x.db.pool.query(s,p);
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
const rejects=(p:Promise<unknown>,code:string)=>assert.rejects(p,(e:unknown)=>(e as {code?:string}).code===code||(console.error('expected',code,'got',(e as Error).message),false));
const ORIGIN='http://127.0.0.1:3000';
const FORBIDDEN_COPY=/期限|延長|有効期限|expire|expiry|expiration|deadline|extend|extension|until\s+\d|48\s*(hours|時間)|96\s*(hours|時間)/i;
await grantGroupNotificationDelta(x.db.pool,x.db.identity.database);
const mail=new CaptureDelivery();const worker=new GroupNotificationWorker(x.groupPool,ORIGIN,mail);
const all:{subject:string;text:string;html?:string}[]=[];
const numberOf=async(id:string)=>(await q('SELECT group_number n FROM group_orders WHERE id=$1',[id])).rows[0].n as string;
const ob=async(id:string)=>(await q('SELECT o.*,e.revision FROM group_notification_outbox o JOIN group_events e ON e.id=o.event_id WHERE o.group_id=$1 ORDER BY o.event_id',[id])).rows;
const sentFor=async(id:string,from=0)=>{const n=await numberOf(id);return mail.sent.slice(from).filter(m=>m.subject.includes(n));};
const drain=async()=>{let t=0;for(let i=0;i<6;i++){const r=await worker.runBatch(50);t+=r.processed;if(!r.processed)break;}return t;};
const soon=(id:string)=>q("UPDATE group_notification_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE group_id=$1 AND status IN ('RETRYABLE_FAILURE','UNKNOWN')",[id]);
const bookingSnap=async()=>JSON.stringify(await Promise.all(['rental_bookings','rental_payment_attempts','rental_provider_events','booking_notification_outbox','staff_notification_outbox'].map(async t=>(await q('SELECT to_regclass($1) r',[t])).rows[0].r?Number((await q(`SELECT count(*) n FROM ${t}`)).rows[0].n):-1)));
try{
 const token=await x.entrance();
 const bookingBefore=await bookingSnap();

 await check('no connected adapter: nothing is claimed or sent, rows stay PENDING',async()=>{
  const g=await x.held(token,2,'SYNTHETIC unconnected');
  const idle=new GroupNotificationWorker(x.groupPool,ORIGIN);assert.equal(idle.status(),'GROUP_DELIVERY_UNCONNECTED');
  assert.deepEqual(await idle.runBatch(10),{state:'UNCONNECTED',processed:0});assert.equal((await ob(g.groupId))[0].status,'PENDING');assert.equal((await ob(g.groupId))[0].attempt_count,0);
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});
  await drain();
 });

 await check('REVIEW_HELD: exactly one mail, "currently held / awaiting review / not yet confirmed", safe link, no expiry copy, never before the state commit',async()=>{
  const g=await x.held(token,3,'SYNTHETIC held mail');const n=await numberOf(g.groupId);
  const seen:string[]=[];
  mail.onSend=async()=>{ // at the moment of the provider call the state commit and its event are durable and the row is leased
   const st=(await q('SELECT g.status,(SELECT count(*) FROM group_events e WHERE e.group_id=g.id AND e.event_type=\'GROUP_REVIEW_HELD\') ev,(SELECT status FROM group_notification_outbox o WHERE o.group_id=g.id) os FROM group_orders g WHERE g.id=$1',[g.groupId])).rows[0];seen.push(`${st.status}/${st.ev}/${st.os}`);};
  const before=mail.sent.length;await drain();mail.onSend=undefined;
  const sent=await sentFor(g.groupId,before);assert.equal(sent.length,1);assert.deepEqual(seen,['REVIEW_HELD/1/SENDING']);
  const m=sent[0]!;all.push(m);
  assert.match(m.subject,/確認待ち/);assert.match(m.subject,/まだ予約確定ではありません/);assert.ok(!/ご予約確定/.test(m.subject));
  for(const s of ['現在仮押さえ中','管理者確認待ち','まだ予約確定ではありません'])assert.ok(m.text.includes(s),s);
  assert.ok(m.text.includes(n)&&m.text.includes('2035-02-10')&&m.text.includes('Mountain Station')&&m.text.includes('3名'));
  const est=(await q("SELECT total_jpy FROM group_quotes WHERE group_id=$1 AND kind='ESTIMATE' ORDER BY version DESC LIMIT 1",[g.groupId])).rows[0].total_jpy;
  assert.ok(m.text.includes('¥'+Number(est).toLocaleString('en-US')),'provisional tax-included amount');
  assert.equal(m.recipient,'synthetic-rep@example.invalid');assert.equal(m.locale,'ja');
  assert.ok(!FORBIDDEN_COPY.test(m.subject+m.text+m.html),'no expiry / extension wording');
  const link=/http:\/\/127\.0\.0\.1:3000\/ja\/group\/g\/[^\s"]+/.exec(m.text)![0];assert.equal(link,`${ORIGIN}/ja/group/g/${g.groupId}`);
  assert.ok(!link.includes(g.owner.secret)&&!m.text.includes(g.owner.secret)&&!m.html!.includes(g.owner.secret),'the owner secret is never in a mail');
  assert.ok(!/[?#]/.test(link),'no token or query in the link');
  const row=(await ob(g.groupId))[0];assert.equal(row.status,'SENT');assert.match(row.provider_message_id,/^msg_/);
  assert.equal(await drain(),0,'a second pass sends nothing (dedupe key group+event+revision)');assert.equal((await sentFor(g.groupId,before)).length,1);
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});await drain();
 });

 await check('CONFIRMED (45 members = 3 parts): ONE parent mail, amounts, admin message as separate escaped plain text, no header injection, no per-part mail',async()=>{
  const g=await x.held(token,45,'SYNTHETIC confirm mail');
  assert.equal(Number((await q('SELECT count(*) n FROM group_order_parts WHERE group_id=$1 AND active',[g.groupId])).rows[0].n),3);
  const before=mail.sent.length;await drain();
  const adj:Adjustment[]=[{target:'MEMBER',memberId:g.memberIds[0]!,method:'FIXED_JPY',value:500,reason:'SYNTHETIC internal reason SECRET-NOTE'},{target:'GROUP',method:'PERCENT_BPS',value:1000,reason:'SYNTHETIC group discount'}];
  const set=await x.svc.setAdjustments(x.admin,g.groupId,g.revision,adj);
  const msg='<script>alert(1)</script> & "q"\r\nBcc: attacker@example.invalid\nご案内: 当日は現地でお支払いください。';
  const res=await x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:set.revision,message:msg});
  await drain();const sent=(await sentFor(g.groupId,before));
  assert.equal(sent.length,2,'one REVIEW_HELD + one CONFIRMED for the whole parent; zero per-part mails');
  const c=sent[1]!;all.push(sent[0]!,c);
  assert.match(c.subject,/ご予約確定/);assert.ok(!/確認待ち/.test(c.subject));assert.ok(!c.subject.includes('Bcc')&&!/[\r\n]/.test(c.subject),'the message never reaches a header');
  const ev=(await q("SELECT payload FROM group_events WHERE group_id=$1 AND event_type='GROUP_CONFIRMED'",[g.groupId])).rows[0].payload;
  const yen=(v:number)=>'¥'+v.toLocaleString('en-US');
  assert.ok(c.text.includes(yen(res.totalJpy))&&c.text.includes(yen(ev.subtotalJpy))&&c.text.includes('-'+yen(ev.discountJpy)),'before-discount, discount, confirmed total');
  assert.equal(ev.subtotalJpy-ev.discountJpy,res.totalJpy);
  assert.ok(c.text.includes('現地精算（まだお支払いは完了していません）'));
  assert.ok(c.text.includes('---- 管理者からのメッセージ ----')&&c.text.includes('<script>alert(1)</script>'),'plain text keeps the characters');
  assert.ok(c.html!.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;')&&!c.html!.includes('<script>'),'HTML is escaped');
  assert.ok(c.html!.includes('white-space:pre-wrap')&&c.html!.includes('border-left:4px solid'),'message block is visually separate from the template');
  assert.ok(!/SECRET-NOTE/.test(c.text+c.html+c.subject),'internal adjustment reasons are not sent');
  assert.ok(!/profile|heightCm|footCm|\.csv|添付|attachment/i.test(c.text+c.html),'no body data, no CSV');
  assert.ok(!FORBIDDEN_COPY.test(c.subject+c.text+c.html));
  assert.equal(sent.filter(m=>m.recipient!=='synthetic-rep@example.invalid').length,0,'single recipient: the representative');
  assert.equal((await ob(g.groupId)).filter(r=>r.event_type==='GROUP_CONFIRMED').length,1);
  await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:res.revision,reason:'SYNTHETIC cleanup',message:'ご都合により取消しました'});
  const b2=mail.sent.length;await drain();const cx=(await sentFor(g.groupId,b2));assert.equal(cx.length,1);all.push(cx[0]!);assert.match(cx[0]!.subject,/ご予約取消/);assert.ok(cx[0]!.text.includes('ご都合により取消しました'));assert.ok(!/返金しました|refunded/.test(cx[0]!.text));
 });

 await check('release before delivery: the stale "currently held" notice is SUPPRESSED, never sent late; one RELEASED mail',async()=>{
  const g=await x.held(token,2,'SYNTHETIC release before send');const before=mail.sent.length;
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC internal release reason',message:'空きが無くなったため解除しました'});
  const rows=await ob(g.groupId);assert.deepEqual(rows.map(r=>[r.event_type,r.status]),[['GROUP_REVIEW_HELD','SUPPRESSED'],['GROUP_RELEASED','PENDING']]);
  assert.equal(rows[0].last_safe_failure_code,'NONE');
  // even a direct dispatch of the superseded row cannot send
  assert.equal((await worker.dispatch(rows[0].id)).state,'NOT_CLAIMED');
  await drain();const sent=await sentFor(g.groupId,before);assert.equal(sent.length,1);all.push(sent[0]!);
  assert.match(sent[0]!.subject,/仮押さえ解除/);assert.ok(sent[0]!.text.includes('空きが無くなったため解除しました'));assert.ok(!/現在仮押さえ中/.test(sent[0]!.text),'a released group is never described as held');
  assert.ok(!sent[0]!.text.includes('internal release reason'),'the internal reason is not sent');assert.ok(!FORBIDDEN_COPY.test(sent[0]!.text+sent[0]!.html));
 });

 await check('release while the older notice is leased: the older text is not delivered after the newer one; release after lease but before the provider call is detected',async()=>{
  const g=await x.held(token,2,'SYNTHETIC in-flight');const before=mail.sent.length;
  // (a) the older notice is in flight (blocked inside the provider call) when the release commits
  let open!:()=>void;mail.gate=new Promise(r=>{open=r;});
  const first=(await ob(g.groupId))[0]!;const inflight=worker.dispatch(first.id);
  await new Promise(r=>setTimeout(r,150));
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC mid-flight'});
  const rel=(await ob(g.groupId)).find(r=>r.event_type==='GROUP_RELEASED')!;
  assert.equal((await worker.dispatch(rel.id)).state,'NOT_CLAIMED','the newer notice waits while an older one is in flight');
  open();mail.gate=undefined;await inflight;await drain();
  const sent=await sentFor(g.groupId,before);assert.deepEqual(sent.map(m=>/仮押さえ解除/.test(m.subject)?'RELEASED':'HELD'),['HELD','RELEASED'],'delivered in state order');
  // (b) leased, then the release commits before materialization: the leased notice is stale and is suppressed unsent
  const h=await x.held(token,2,'SYNTHETIC lease then release');const b2=mail.sent.length;
  const w=worker as unknown as {claim:(id:string)=>Promise<{claimId:string}|null>;material:(id:string,c:string)=>Promise<unknown>;settle:(id:string,c:string,r:unknown)=>Promise<boolean>};
  const id=(await ob(h.groupId))[0]!.id;const lease=(await w.claim(id))!;assert.ok(lease.claimId);
  await x.svc.release(x.admin,h.groupId,{requestKey:randomUUID(),expectedRevision:h.revision,reason:'SYNTHETIC between lease and send'});
  assert.deepEqual(await w.material(id,lease.claimId),{stale:true});
  assert.equal(await w.settle(id,lease.claimId,{state:'SUPPRESSED',code:'NONE'}),true);assert.equal((await ob(h.groupId))[0].status,'SUPPRESSED');
  await drain();const s2=await sentFor(h.groupId,b2);assert.equal(s2.length,1);assert.match(s2[0]!.subject,/仮押さえ解除/);
  all.push(...sent,...s2);
 });

 await check('CHANGES_REQUESTED mail carries the administrator message; hold stays and is not described as confirmed',async()=>{
  const g=await x.held(token,2,'SYNTHETIC changes');const before=mail.sent.length;await drain();
  const r=await x.svc.requestChanges(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,message:'3番目の方のブーツサイズをご確認ください'});await drain();
  const sent=await sentFor(g.groupId,before);assert.equal(sent.length,2);const c=sent[1]!;all.push(...sent);
  assert.match(c.subject,/ご確認のお願い/);assert.ok(c.text.includes('3番目の方のブーツサイズをご確認ください')&&c.text.includes('まだ予約確定ではありません'));
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:r.revision,reason:'SYNTHETIC cleanup'});await drain();
 });

 await check('English templates: all five events, same safety properties',async()=>{
  const {renderGroupNotification}=await import('../../packages/core/src/group/notification-template');
  const base={locale:'en' as const,groupId:randomUUID(),groupNumber:'G-000123',memberCount:12,period:PERIOD,pickupStore:'MOUNTAIN_BASE',returnStore:'ONSEN_BASE'};
  const held=renderGroupNotification({...base,event:'GROUP_REVIEW_HELD',estimateJpy:120000},ORIGIN);
  assert.match(held.subject,/Pending review - not yet confirmed/);assert.ok(/currently on hold/i.test(held.text)&&/not yet a confirmed reservation/i.test(held.text));
  assert.ok(held.text.includes('Pickup Mountain Station / return Central Station'));
  const conf=renderGroupNotification({...base,event:'GROUP_CONFIRMED',confirmed:{subtotalJpy:120000,discountJpy:20000,totalJpy:100000},adminMessage:'See you'},ORIGIN);
  assert.match(conf.subject,/\[Confirmed\]/);assert.ok(conf.text.includes('¥100,000')&&conf.text.includes('-¥20,000')&&conf.text.includes('See you'));
  assert.throws(()=>renderGroupNotification({...base,event:'GROUP_CONFIRMED',confirmed:{subtotalJpy:100,discountJpy:20,totalJpy:99}},ORIGIN),{code:'NOTIFICATION_SNAPSHOT_INVALID'});
  assert.throws(()=>renderGroupNotification({...base,event:'GROUP_CONFIRMED',confirmed:{subtotalJpy:100,discountJpy:0,totalJpy:100},adminMessage:'x'.repeat(2001)},ORIGIN),{code:'NOTIFICATION_SNAPSHOT_INVALID'});
  for(const event of ['GROUP_CHANGES_REQUESTED','GROUP_RELEASED','GROUP_CANCELLED'] as const){const r=renderGroupNotification({...base,event,adminMessage:'msg'},ORIGIN);all.push(r);assert.ok(!FORBIDDEN_COPY.test(r.subject+r.text+r.html));}
  all.push(held,conf);
  assert.throws(()=>renderGroupNotification({...base,event:'GROUP_RELEASED'},'https://user:pw@example.com'),{code:'NOTIFICATION_CONFIGURATION_INVALID'});
 });

 await check('delivery failures: retry only on authoritative NOT_ACCEPTED (backoff, exhaustion), reject is permanent, the state commit is untouched',async()=>{
  const g=await x.held(token,2,'SYNTHETIC failures');const before=mail.sent.length;
  mail.script.push({state:'NOT_ACCEPTED',code:'RATE_LIMITED'});await drain();
  let r=(await ob(g.groupId))[0];assert.equal(r.status,'RETRYABLE_FAILURE');assert.equal(r.attempt_count,1);assert.equal(r.last_safe_failure_code,'RATE_LIMITED');assert.ok(new Date(r.next_attempt_at)>new Date());
  assert.equal(await drain(),0,'not retried before the backoff elapses');
  await soon(g.groupId);mail.script.push({state:'NOT_ACCEPTED',code:'PROVIDER_UNAVAILABLE'});await drain();
  await soon(g.groupId);mail.script.push({state:'NOT_ACCEPTED',code:'PROVIDER_UNAVAILABLE'});await drain();
  r=(await ob(g.groupId))[0];assert.equal(r.status,'PERMANENT_FAILURE');assert.equal(r.last_safe_failure_code,'RETRY_EXHAUSTED');assert.equal(r.attempt_count,3);
  await soon(g.groupId);assert.equal(await drain(),0);assert.equal((await sentFor(g.groupId,before)).length,3);
  assert.equal((await q('SELECT status FROM group_orders WHERE id=$1',[g.groupId])).rows[0].status,'REVIEW_HELD','delivery failure never rolls back the reservation');
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1 AND h.state='ACTIVE'",[g.groupId])).rows[0].n),1);
  const st=new GroupNotificationStatus(x.groupPool);
  const hist=await st.forGroup(x.admin,g.groupId);assert.equal(hist.items[0]!.status,'PERMANENT_FAILURE');assert.equal(hist.items[0]!.lastSafeFailureCode,'RETRY_EXHAUSTED');assert.equal(hist.items[0]!.needsReconcile,false);
  assert.ok(!JSON.stringify(hist).includes('@')&&!JSON.stringify(hist).includes('synthetic-rep'),'no address in the status API');
  const att=await st.needingAttention(x.admin,['MOUNTAIN_BASE']);assert.ok(att.some(a=>a.groupId===g.groupId&&a.status==='PERMANENT_FAILURE'));
  await rejects(st.forGroup(x.manager,g.groupId),'FORBIDDEN');await rejects(st.needingAttention(x.manager,['MOUNTAIN_BASE']),'FORBIDDEN');
  await rejects(st.forGroup(x.admin,randomUUID()),'NOT_FOUND');
  // a permanent reject
  const h=await x.held(token,2,'SYNTHETIC reject');mail.script.push({state:'REJECTED',code:'PERMANENT_REJECT'});const b2=mail.sent.length;await drain();
  assert.equal((await ob(h.groupId))[0].status,'PERMANENT_FAILURE');assert.equal((await ob(h.groupId))[0].last_safe_failure_code,'PERMANENT_REJECT');await soon(h.groupId);await drain();assert.equal((await sentFor(h.groupId,b2)).length,1);
  for(const id of [g.groupId,h.groupId])await x.svc.release(x.admin,id,{requestKey:randomUUID(),expectedRevision:id===g.groupId?g.revision:h.revision,reason:'SYNTHETIC cleanup'});await drain();
 });

 await check('unknown outcome is never re-sent: lookup finds an accepted-but-lost message; without lookup it stays UNKNOWN; hang and throw are UNKNOWN',async()=>{
  const g=await x.held(token,2,'SYNTHETIC unknown lost');const before=mail.sent.length;
  mail.script.push('LOST_AFTER_ACCEPT');await drain();
  let r=(await ob(g.groupId))[0];assert.equal(r.status,'UNKNOWN');assert.equal(r.last_safe_failure_code,'ACCEPTANCE_UNKNOWN');
  const st=new GroupNotificationStatus(x.groupPool);assert.equal((await st.forGroup(x.admin,g.groupId)).items[0]!.needsReconcile,true);assert.ok((await st.needingAttention(x.admin,['MOUNTAIN_BASE'])).some(a=>a.groupId===g.groupId&&a.needsReconcile));
  assert.equal(await drain(),0);await soon(g.groupId);await drain();
  r=(await ob(g.groupId))[0];assert.equal(r.status,'SENT');assert.match(r.provider_message_id,/^msg_lost_/);assert.equal((await sentFor(g.groupId,before)).length,1,'exactly one provider call');
  // no lookup capability: stays UNKNOWN forever, still exactly one call
  const blind=new CaptureDelivery(false),bw=new GroupNotificationWorker(x.groupPool,ORIGIN,blind);const h=await x.held(token,2,'SYNTHETIC unknown blind');
  blind.script.push('THROW');await bw.runBatch(50);assert.equal((await ob(h.groupId))[0].status,'UNKNOWN');
  for(let i=0;i<3;i++){await soon(h.groupId);await bw.runBatch(50);}assert.equal(blind.sent.length,1);assert.equal((await ob(h.groupId))[0].status,'UNKNOWN');
  // timeout (hang)
  const slow=new CaptureDelivery(),sw=new GroupNotificationWorker(x.groupPool,ORIGIN,slow,50);const k=await x.held(token,2,'SYNTHETIC hang');slow.script.push('HANG');
  const t0=Date.now();await sw.runBatch(50);assert.ok(Date.now()-t0<3000);assert.equal((await ob(k.groupId))[0].status,'UNKNOWN');
  // expired lease (worker died mid-send) becomes lookup-only UNKNOWN, never a second send
  const d=await x.held(token,2,'SYNTHETIC dead worker');const w=worker as unknown as {claim:(id:string)=>Promise<unknown>};await w.claim((await ob(d.groupId))[0]!.id);
  await q("UPDATE group_notification_outbox SET claim_until=clock_timestamp()-interval '1 second' WHERE group_id=$1 AND status='SENDING'",[d.groupId]);
  const b3=mail.sent.length;await drain();assert.equal((await sentFor(d.groupId,b3)).length,0,'the dead lease is looked up, not re-sent');assert.equal((await ob(d.groupId))[0].status,'UNKNOWN');
  for(const [id,rev] of [[g.groupId,g.revision],[h.groupId,h.revision],[k.groupId,k.revision],[d.groupId,d.revision]] as const)await x.svc.release(x.admin,id,{requestKey:randomUUID(),expectedRevision:rev,reason:'SYNTHETIC cleanup'});await drain();
 });

 await check('duplicate lease: concurrent workers on the same row produce exactly one provider call',async()=>{
  const g=await x.held(token,2,'SYNTHETIC duplicate lease');const before=mail.sent.length;const id=(await ob(g.groupId))[0]!.id;
  const w2=new GroupNotificationWorker(x.groupPool,ORIGIN,mail),w3=new GroupNotificationWorker(x.groupPool,ORIGIN,mail);
  const res=await Promise.all([worker.dispatch(id),w2.dispatch(id),w3.dispatch(id),worker.runBatch(50),w2.runBatch(50)]);void res;
  assert.equal((await sentFor(g.groupId,before)).length,1);assert.equal((await ob(g.groupId))[0].status,'SENT');assert.equal((await ob(g.groupId))[0].attempt_count,1);
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});await drain();
 });

 await check('worker role cannot rewrite what a notice says: delivery columns only',async()=>{
  const g=await x.held(token,2,'SYNTHETIC column grant');
  await assert.rejects(x.groupPool.query("UPDATE group_notification_outbox SET admin_message='forged' WHERE group_id=$1",[g.groupId]),(e:{code?:string})=>e.code==='42501');
  await assert.rejects(x.groupPool.query("UPDATE group_notification_outbox SET event_type='GROUP_CONFIRMED' WHERE group_id=$1",[g.groupId]),(e:{code?:string})=>e.code==='42501');
  await assert.rejects(x.groupPool.query("DELETE FROM group_notification_outbox WHERE group_id=$1",[g.groupId]),(e:{code?:string})=>e.code==='42501');
  await x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC cleanup'});await drain();
 });

 await check('state commit never depends on notification: a rolled-back submit leaves no outbox row and no mail',async()=>{
  const before=mail.sent.length,rows=Number((await q('SELECT count(*) n FROM group_notification_outbox')).rows[0].n);
  const g=await x.quoted(token,60,'SYNTHETIC rollback');
  await q("CREATE FUNCTION group_notify_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.part_no=3 THEN RAISE EXCEPTION 'INJECTED_FAILURE' USING ERRCODE='23514';END IF;RETURN NEW;END$$");
  await q('CREATE TRIGGER group_notify_fail BEFORE INSERT ON group_order_parts FOR EACH ROW EXECUTE FUNCTION group_notify_fail()');
  await assert.rejects(x.svc.submit(g.owner,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,quoteId:g.quote.quoteId}));
  await q('DROP TRIGGER group_notify_fail ON group_order_parts');await q('DROP FUNCTION group_notify_fail()');
  assert.equal(Number((await q('SELECT count(*) n FROM group_notification_outbox WHERE group_id=$1',[g.groupId])).rows[0].n),0);assert.equal(await drain(),0);assert.equal(mail.sent.length,before);
  assert.equal(Number((await q('SELECT count(*) n FROM group_notification_outbox')).rows[0].n),rows);
 });

 await check('parent-level staff read side: inbox, calendar, item bars, hold labels, report, CSV, receivables; no double counting',async()=>{
  const rm=new GroupReadModel(x.groupPool),S=['MOUNTAIN_BASE'];
  const a=await x.held(token,45,'=SYNTHETIC cmd("x")'),b=await x.held(token,3,'SYNTHETIC unpaid'),c=await x.held(token,2,'SYNTHETIC released'),d=await x.held(token,4,'SYNTHETIC paid');
  const inbox=await rm.inbox(x.admin,{stores:S});
  for(const g of [a,b,c,d])assert.equal(inbox.items.filter(i=>i.groupId===g.groupId).length,1,'one inbox item per parent, whatever the part count');
  assert.equal(inbox.items.find(i=>i.groupId===a.groupId)!.parts,3);assert.equal(inbox.attention,inbox.items.length);
  const cal=await rm.calendar(x.admin,{store:'MOUNTAIN_BASE',from:'2035-02-01',to:'2035-02-28'});
  for(const g of [a,b,c,d])assert.equal(cal.filter(e=>e.groupId===g.groupId).length,1,'one calendar entry per parent');
  assert.equal(cal.find(e=>e.groupId===a.groupId)!.activeClaims,45*3);assert.equal(cal.find(e=>e.groupId===a.groupId)!.kind,'GROUP_HOLD');
  const holds=(await q('SELECT hold_id FROM group_order_parts WHERE group_id=$1',[a.groupId])).rows.map(r=>r.hold_id as string);
  const labels=await rm.holdParents(x.admin,{stores:S,holdIds:holds});assert.equal(labels.size,3);assert.deepEqual([...new Set([...labels.values()].map(v=>v.groupId))],[a.groupId]);
  const asset=(await q('SELECT cl.asset_id FROM inventory_claims cl JOIN group_order_parts p ON p.hold_id=cl.hold_id WHERE p.group_id=$1 AND cl.asset_id IS NOT NULL LIMIT 1',[b.groupId])).rows[0]?.asset_id as string|undefined;
  assert.ok(asset,'a group claim names a physical asset');{const bars=await rm.itemBars(x.admin,{stores:S,assetIds:[asset!],from:'2035-02-10',to:'2035-02-10'});assert.equal(bars.length,1);assert.equal(bars[0]!.groupId,b.groupId);}

  // confirm: b unpaid, d paid in two receipts, a with an admin discount; release c; then cancel nothing
  const confirm=async(g:typeof a)=>{await drain();return x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision});};
  const ra=await (async()=>{const set=await x.svc.setAdjustments(x.admin,a.groupId,a.revision,[{target:'GROUP',method:'FIXED_JPY',value:1234,reason:'SYNTHETIC'}]);return x.svc.confirm(x.admin,a.groupId,{requestKey:randomUUID(),expectedRevision:set.revision});})();
  const rb=await confirm(b),rd=await confirm(d);
  await x.svc.release(x.admin,c.groupId,{requestKey:randomUUID(),expectedRevision:c.revision,reason:'SYNTHETIC'});
  await x.svc.recordReceipt(x.admin,d.groupId,{requestKey:randomUUID(),amountJpy:1000,method:'CASH',receivedAt:x.now().toISOString()});
  await x.svc.recordReceipt(x.admin,d.groupId,{requestKey:randomUUID(),amountJpy:rd.totalJpy-1000,method:'CARD_AT_COUNTER',receivedAt:x.now().toISOString()});
  await drain();
  const rep=await rm.report(x.admin,{stores:S,from:'2035-02-01',to:'2035-02-28'});
  const row=(g:typeof a)=>rep.rows.find(r=>r.groupId===g.groupId)!;
  assert.equal(rep.rows.filter(r=>r.groupId===a.groupId).length,1);
  assert.equal(row(a).confirmedJpy,ra.totalJpy);assert.equal(row(a).partsSumJpy,ra.totalJpy);assert.equal(row(a).partsMatchParent,true,'sum of the parts equals the parent confirmed amount');assert.equal(row(a).parts,3);
  assert.equal(row(b).confirmedJpy,rb.totalJpy);assert.equal(row(b).receivedJpy,0);assert.equal(row(b).outstandingJpy,rb.totalJpy);assert.equal(row(b).settlement,'UNPAID');
  assert.equal(row(d).receivedJpy,rd.totalJpy);assert.equal(row(d).outstandingJpy,0);assert.equal(row(d).settlement,'PAID');
  assert.equal(row(c).confirmedJpy,0);assert.equal(row(c).outstandingJpy,0);assert.equal(row(c).settlement,'NOT_APPLICABLE');
  assert.equal(rep.totals.confirmedJpy,ra.totalJpy+rb.totalJpy+rd.totalJpy,'revenue side counts each parent once, released counts 0');
  assert.equal(rep.totals.receivedJpy,rd.totalJpy,'received = recorded on-site receipts only');assert.equal(rep.totals.outstandingJpy,ra.totalJpy+rb.totalJpy,'confirmed-unpaid is a receivable');
  assert.equal(rep.rows.reduce((s,r)=>s+r.confirmedJpy,0),rep.totals.confirmedJpy);
  const csv=groupReportCsv(rep);assert.ok(csv.startsWith('﻿')&&csv.includes('\r\n'));assert.ok(!/@|synthetic-rep|heightCm|footCm/.test(csv));
  assert.ok(csv.includes(`"'=SYNTHETIC cmd(""x"")"`),'spreadsheet formula injection neutralized');
  assert.equal(csv.trim().split('\r\n').length,1+rep.rows.length);
  // scope / permission
  await rejects(rm.report(x.manager,{stores:S,from:'2035-02-01',to:'2035-02-28'}),'FORBIDDEN');await rejects(rm.inbox(x.manager,{stores:S}),'FORBIDDEN');await rejects(rm.report(x.admin,{stores:['NOPE'],from:'2035-02-01',to:'2035-02-28'}),'INVALID_STORE');
  await rejects(rm.report(x.admin,{stores:S,from:'2035-02-01',to:'2036-02-28'}),'INVALID_INPUT');
  // confirmed groups leave the inbox; confirmed shows as GROUP_CONFIRMED on the calendar
  const inbox2=await rm.inbox(x.admin,{stores:S});assert.ok(!inbox2.items.some(i=>[a,b,d].some(g=>g.groupId===i.groupId)));
  assert.equal((await rm.calendar(x.admin,{store:'MOUNTAIN_BASE',from:'2035-02-01',to:'2035-02-28'})).find(e=>e.groupId===b.groupId)!.kind,'GROUP_CONFIRMED');
  // the CONFIRMED mail of a paid group still says what was confirmed (not "paid"): mail is the confirming event, not today's cash state
  const mailD=mail.sent.filter(m=>m.subject.includes('ご予約確定')&&m.subject.includes('G-')).pop()!;assert.ok(!/お支払い済み|Paid/.test(mailD.text));
  for(const g of [a,b,d]){const cur=(await x.svc.get(x.admin,g.groupId)).group.revision;await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:cur,reason:'SYNTHETIC cleanup'});}
  await drain();
  const rep2=await rm.report(x.admin,{stores:S,from:'2035-02-01',to:'2035-02-28'});assert.equal(rep2.totals.confirmedJpy,0,'cancelled groups are not revenue');assert.equal(rep2.totals.outstandingJpy,0);
  assert.equal(rep2.rows.find(r=>r.groupId===d.groupId)!.receivedJpy,rd.totalJpy,'recorded receipts of a cancelled group stay visible for manual refund handling');assert.equal(rep2.totals.receivedJpy,0,'but are not counted as revenue received');
 });

 await check('no expiry / extension wording in any rendered mail or in the template source; no part-level or expiry events exist',async()=>{
  assert.ok(all.length>=10);for(const m of all)assert.ok(!FORBIDDEN_COPY.test(m.subject+'\n'+m.text+'\n'+(m.html??'')),m.subject);
  const src=readFileSync(new URL('../../packages/core/src/group/notification-template.ts',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
  assert.ok(!FORBIDDEN_COPY.test(src.replace(/ご利用期間/g,'')),'template source');
  const types=(await q('SELECT DISTINCT event_type FROM group_notification_outbox')).rows.map(r=>r.event_type).sort();
  assert.ok(types.every(t=>['GROUP_REVIEW_HELD','GROUP_CONFIRMED','GROUP_CHANGES_REQUESTED','GROUP_RELEASED','GROUP_CANCELLED'].includes(t)),String(types));
  assert.equal(Number((await q("SELECT count(*) n FROM group_events WHERE event_type ~* 'EXPIR|EXTEND'")).rows[0].n),0);
 });

 await check('ordinary bookings untouched: group notifications and read models created no booking, payment, booking notice or staff notice rows',async()=>{
  assert.equal(await bookingSnap(),bookingBefore);
 });

 console.log(`Group notifications: ${count} checks passed.`);
}catch(e){failed=true;console.error('GROUP_NOTIFY_FAILED '+stage);console.error(e);}finally{await x.close();}
if(failed)process.exit(1);
