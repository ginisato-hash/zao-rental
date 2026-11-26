import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderGroupNotification,normalizeAdminMessage,GROUP_NOTIFICATION_EVENTS,type GroupNotificationMaterial} from '../../packages/core/src/group/notification-template';
import {groupNotificationRoleDelta,GROUP_NOTIFICATION_DELIVERY_COLUMNS} from '../../scripts/group-notification-role';
import {groupReportCsv,type GroupReport} from '../../packages/core/src/group/read-model';

const ORIGIN='https://rental.example.test';
const FORBIDDEN=/期限|延長|expire|expiry|expiration|deadline|extend|extension/i;
const base={groupId:'11111111-2222-4333-8444-555555555555',groupNumber:'G-000042',memberCount:8,period:{startDate:'2035-02-10',endDate:'2035-02-11'},pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE'};
const mat=(event:GroupNotificationMaterial['event'],locale:'ja'|'en',x:Partial<GroupNotificationMaterial>={}):GroupNotificationMaterial=>({...base,event,locale,...(event==='GROUP_CONFIRMED'?{confirmed:{subtotalJpy:90000,discountJpy:9000,totalJpy:81000}}:{}),...(event==='GROUP_REVIEW_HELD'?{estimateJpy:90000}:{}),...x});

test('all five events x ja/en render, never mention an expiry or extension, never carry a token or query in the link',()=>{
 for(const locale of ['ja','en'] as const)for(const event of GROUP_NOTIFICATION_EVENTS){
  const r=renderGroupNotification(mat(event,locale,{adminMessage:'msg'}),ORIGIN);
  assert.ok(!FORBIDDEN.test(r.subject+r.text+r.html),event+locale);assert.ok(r.subject.includes('G-000042'));assert.ok(!/[\r\n]/.test(r.subject));
  const links=r.text.match(/https?:\/\/\S+/g)!;assert.equal(links.length,1);assert.equal(links[0],`${ORIGIN}/${locale}/group/${base.groupId}`);
 }
});
test('review-held subject and confirmed subject are clearly different; held copy states the three facts',()=>{
 const h=renderGroupNotification(mat('GROUP_REVIEW_HELD','ja'),ORIGIN),c=renderGroupNotification(mat('GROUP_CONFIRMED','ja'),ORIGIN);
 assert.notEqual(h.subject,c.subject);assert.match(h.subject,/確認待ち/);assert.match(c.subject,/ご予約確定/);assert.ok(!/ご予約確定/.test(h.subject));
 for(const s of ['現在仮押さえ中','管理者確認待ち','まだ予約確定ではありません'])assert.ok(h.text.includes(s));
 assert.ok(!/ご予約確定|が確定しました/.test(h.text),'the held mail never claims confirmation');
});
test('administrator message: plain text block, HTML-escaped, 2000 chars max, control characters refused, never in subject',()=>{
 const m=renderGroupNotification(mat('GROUP_CONFIRMED','ja',{adminMessage:'<img src=x onerror=alert(1)>\r\nSubject: spoof\r\n'}),ORIGIN);
 assert.ok(!m.html.includes('<img'));assert.ok(m.html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!m.subject.includes('spoof'));assert.ok(m.text.includes('---- 管理者からのメッセージ ----'));assert.ok(!m.text.includes('\r'));
 assert.equal(normalizeAdminMessage('x'.repeat(2000))!.length,2000);assert.throws(()=>normalizeAdminMessage('x'.repeat(2001)));assert.throws(()=>normalizeAdminMessage('a\u0000b'));assert.equal(normalizeAdminMessage('   '),null);assert.equal(normalizeAdminMessage(null),null);
});
test('confirmed amounts must add up; invalid snapshot or origin refuses to render (no partial mail)',()=>{
 assert.throws(()=>renderGroupNotification(mat('GROUP_CONFIRMED','ja',{confirmed:{subtotalJpy:100,discountJpy:1,totalJpy:100}}),ORIGIN),{code:'NOTIFICATION_SNAPSHOT_INVALID'});
 assert.throws(()=>renderGroupNotification(mat('GROUP_CONFIRMED','ja',{groupNumber:'G-1\r\nBcc: x'}),ORIGIN),{code:'NOTIFICATION_SNAPSHOT_INVALID'});
 assert.throws(()=>renderGroupNotification(mat('GROUP_RELEASED','ja'),'http://evil.example'),{code:'NOTIFICATION_CONFIGURATION_INVALID'});
 assert.throws(()=>renderGroupNotification(mat('GROUP_RELEASED','ja'),ORIGIN,()=>ORIGIN+'/x?token=abc'),{code:'NOTIFICATION_CONFIGURATION_INVALID'});
 assert.throws(()=>renderGroupNotification(mat('GROUP_RELEASED','ja'),ORIGIN,()=>'https://other.example/x'),{code:'NOTIFICATION_CONFIGURATION_INVALID'});
 assert.throws(()=>renderGroupNotification({...mat('GROUP_RELEASED','ja'),event:'GROUP_HOLD_EXPIRED' as never},ORIGIN),{code:'NOTIFICATION_SNAPSHOT_INVALID'});
});
test('zero-yen confirmation says no payment is due; cancelled with on-site receipts defers to the station, never promises a refund',()=>{
 const z=renderGroupNotification(mat('GROUP_CONFIRMED','en',{confirmed:{subtotalJpy:5000,discountJpy:5000,totalJpy:0}}),ORIGIN);assert.ok(/no payment is due/i.test(z.text));
 const c=renderGroupNotification(mat('GROUP_CANCELLED','ja',{receivedJpyNeedsManual:3000}),ORIGIN);assert.ok(c.text.includes('店舗よりあらためてご案内'));assert.ok(!/返金します|refund/i.test(c.text));
});
test('customer-copy sources (template, read model) contain no expiry/extension wording (worker lease/batch deadlines are technical and excluded)',()=>{
 for(const f of ['notification-template.ts','read-model.ts']){
  const src=readFileSync(new URL('../../packages/core/src/group/'+f,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/ご利用期間/g,'');
  assert.ok(!FORBIDDEN.test(src),f);
 }
});
test('role delta grants only delivery bookkeeping columns, never message content',()=>{
 const sql=groupNotificationRoleDelta('zr_0123456789ab_group');
 for(const col of ['status','claim_id','claim_until','attempt_count','next_attempt_at','sent_at','provider_message_id','last_safe_failure_code'])assert.ok(sql.includes(col));
 for(const col of ['admin_message','event_type','dedupe_key','group_id','event_id','locale','template_version'])assert.ok(!GROUP_NOTIFICATION_DELIVERY_COLUMNS.includes(col as never),col);
 assert.throws(()=>groupNotificationRoleDelta('x; DROP TABLE y'));
});
test('group report CSV: parent rows only, spreadsheet-safe, no address or body data',()=>{
 const r:GroupReport={stores:['MOUNTAIN_BASE'],from:'2035-02-01',to:'2035-02-28',asOf:'2035-02-01T00:00:00Z',totals:{groups:1,confirmedJpy:1,receivedJpy:0,outstandingJpy:1},rows:[{groupId:base.groupId,groupNumber:'G-000042',status:'CONFIRMED',label:'=HYPERLINK("http://x")',period:{startDate:'2035-02-10',endDate:'2035-02-10'},pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',memberCount:8,parts:1,confirmedJpy:1,receivedJpy:0,outstandingJpy:1,settlement:'UNPAID',partsSumJpy:1,partsMatchParent:true}]};
 const csv=groupReportCsv(r);assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));assert.equal(csv.trim().split('\r\n').length,2);assert.ok(!csv.includes(base.groupId));
});
