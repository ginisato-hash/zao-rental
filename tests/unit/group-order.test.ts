import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GROUP_TRANSITIONS,GROUP_STATUSES,GroupError,MAX_MEMBERS,PART_SIZE,allocateExact,canTransition,computeGroupTotals,groupDedupeKey,partitionMembers,settlementOf,validateAdminMessage,type Adjustment,type MemberBase} from '../../packages/contracts/src/group-order';

const bases=(amounts:number[]):MemberBase[]=>amounts.map((a,i)=>({memberId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,ordinal:i+1,baseJpy:a}));
const idOf=(i:number)=>bases([0])[0]!.memberId.slice(0,-12)+String(i).padStart(12,'0');

test('partition: 1/20/21/50/100 members -> <=5 parts of <=20, order preserved; 0 and 101 refused',()=>{
 for(const [n,parts] of [[1,1],[20,1],[21,2],[50,3],[100,5]] as const){const p=partitionMembers(Array.from({length:n},(_,i)=>i+1));assert.equal(p.length,parts);assert.ok(p.every(x=>x.length<=PART_SIZE));assert.deepEqual(p.flat(),Array.from({length:n},(_,i)=>i+1));}
 assert.throws(()=>partitionMembers(Array.from({length:MAX_MEMBERS+1},(_,i)=>i)),{code:'GROUP_TOO_LARGE'});assert.throws(()=>partitionMembers([]),{code:'GROUP_EMPTY'});
});
test('state machine: no expiry state, terminal states are final, only legal edges',()=>{
 assert.ok(!(GROUP_STATUSES as readonly string[]).some(s=>/EXPIR/.test(s)));
 for(const t of ['RELEASED','CANCELLED'] as const)assert.deepEqual(GROUP_TRANSITIONS[t],[]);
 assert.ok(canTransition('QUOTED','REVIEW_HELD'));assert.ok(canTransition('REVIEW_HELD','CONFIRMED'));assert.ok(canTransition('REVIEW_HELD','RELEASED'));
 assert.ok(!canTransition('CONFIRMED','RELEASED'),'a confirmed group is cancelled formally, never "hold-released"');
 assert.ok(!canTransition('DRAFT','REVIEW_HELD'));assert.ok(!canTransition('CONFIRMED','REVIEW_HELD'));
});
test('dedupe key is group + event + revision',()=>{assert.equal(groupDedupeKey('g','GROUP_CONFIRMED',4),'g:GROUP_CONFIRMED:4');});
test('largest remainder allocation is exact and stable',()=>{
 assert.deepEqual(allocateExact(10,[100,100,100]),[4,3,3]);assert.deepEqual(allocateExact(1,[5,5]),[1,0]);
 for(const [total,w] of [[0,[3,4]],[7,[3,4]],[100,[33,33,34]],[999,[1000,2000,3000,4000,5000,6000,7000]]] as const){const a=allocateExact(total,w);assert.equal(a.reduce((x,y)=>x+y,0),total);a.forEach((v,i)=>assert.ok(v<=w[i]!));}
 assert.throws(()=>allocateExact(11,[5,5]),{code:'ADJUSTMENT_EXCEEDS_REMAINDER'});
});
test('discounts: participant first, then group-wide; exact totals; remainder-proportional; no negative',()=>{
 const b=bases([5000,3333,1]);
 const none=computeGroupTotals(b,[]);assert.equal(none.totalJpy,8334);
 const adj:Adjustment[]=[{target:'MEMBER',memberId:b[0]!.memberId,method:'FIXED_JPY',value:1000,reason:'r'},{target:'MEMBER',memberId:b[1]!.memberId,method:'PERCENT_BPS',value:1000,reason:'r'},{target:'GROUP',method:'PERCENT_BPS',value:500,reason:'g'}];
 const t=computeGroupTotals(b,adj);
 assert.equal(t.members[0]!.memberDiscountJpy,1000);assert.equal(t.members[1]!.memberDiscountJpy,333);// halfUp(3333*10%)=333
 const rem=4000+3000+1;assert.equal(t.groupDiscountJpy,Math.round(rem*0.05));
 assert.equal(t.members.reduce((n,m)=>n+m.finalJpy,0),t.totalJpy);assert.equal(t.baseJpy-t.memberDiscountJpy-t.groupDiscountJpy,t.totalJpy);
 assert.ok(t.members.every(m=>m.finalJpy>=0&&m.groupDiscountJpy<=m.afterMemberJpy));
 assert.deepEqual(t.audit.map(a=>a.target),['MEMBER','MEMBER','GROUP']);
});
test('discounts: over-large, two methods on one target, zero/negative/unknown target and missing reason are refused',()=>{
 const b=bases([1000,1000]);const m0=b[0]!.memberId;
 const bad=(a:Adjustment[],code:string)=>assert.throws(()=>computeGroupTotals(b,a),(e:unknown)=>e instanceof GroupError&&e.code===code);
 bad([{target:'MEMBER',memberId:m0,method:'FIXED_JPY',value:1001,reason:'r'}],'ADJUSTMENT_EXCEEDS_REMAINDER');
 bad([{target:'GROUP',method:'FIXED_JPY',value:2001,reason:'r'}],'ADJUSTMENT_EXCEEDS_REMAINDER');
 bad([{target:'MEMBER',memberId:m0,method:'FIXED_JPY',value:1,reason:'r'},{target:'MEMBER',memberId:m0,method:'PERCENT_BPS',value:10,reason:'r'}],'ADJUSTMENT_ONE_METHOD_PER_TARGET');
 bad([{target:'GROUP',method:'FIXED_JPY',value:0,reason:'r'}],'ADJUSTMENT_INVALID');bad([{target:'GROUP',method:'FIXED_JPY',value:-5,reason:'r'}],'ADJUSTMENT_INVALID');
 bad([{target:'GROUP',method:'PERCENT_BPS',value:10001,reason:'r'}],'ADJUSTMENT_INVALID');bad([{target:'GROUP',method:'FIXED_JPY',value:1.5,reason:'r'}],'ADJUSTMENT_INVALID');
 bad([{target:'MEMBER',memberId:idOf(99),method:'FIXED_JPY',value:1,reason:'r'}],'ADJUSTMENT_TARGET_UNKNOWN');
 bad([{target:'GROUP',method:'FIXED_JPY',value:1,reason:' '}],'ADJUSTMENT_REASON_REQUIRED');
});
test('full discount reaches exactly 0 (no negative); a member already at 0 receives no group share',()=>{
 const b=bases([1000,1000,1000]);
 const t=computeGroupTotals(b,[{target:'MEMBER',memberId:b[2]!.memberId,method:'PERCENT_BPS',value:10000,reason:'r'},{target:'GROUP',method:'PERCENT_BPS',value:10000,reason:'g'}]);
 assert.equal(t.totalJpy,0);assert.equal(t.members[2]!.groupDiscountJpy,0);assert.ok(t.members.every(m=>m.finalJpy===0));
});
test('group-wide fixed yen is distributed to the exact yen over 100 members',()=>{
 const b=bases(Array.from({length:100},(_,i)=>1000+i*7));const total=b.reduce((n,m)=>n+m.baseJpy,0);
 const t=computeGroupTotals(b,[{target:'GROUP',method:'FIXED_JPY',value:12345,reason:'g'}]);assert.equal(t.groupDiscountJpy,12345);assert.equal(t.totalJpy,total-12345);
 assert.equal(t.members.reduce((n,m)=>n+m.groupDiscountJpy,0),12345);
});
test('settlement is derived from real on-site receipts only',()=>{
 assert.equal(settlementOf(null,[]).status,'NOT_APPLICABLE');assert.equal(settlementOf(10000,[]).status,'UNPAID');
 assert.equal(settlementOf(10000,[{kind:'RECEIPT',amountJpy:4000}]).status,'PARTIALLY_PAID');
 assert.equal(settlementOf(10000,[{kind:'RECEIPT',amountJpy:10000}]).status,'PAID');
 assert.equal(settlementOf(10000,[{kind:'RECEIPT',amountJpy:10000},{kind:'REVERSAL',amountJpy:10000}]).status,'UNPAID');
 assert.equal(settlementOf(0,[]).status,'NO_CHARGE');assert.equal(settlementOf(10000,[]).paymentMethod,'PAY_ON_SITE');
});
test('admin message: plain text only, bounded, no control characters',()=>{
 assert.equal(validateAdminMessage(undefined),null);assert.equal(validateAdminMessage('<b>x</b>\nok'),'<b>x</b>\nok');
 assert.throws(()=>validateAdminMessage('a'.repeat(2001)));assert.throws(()=>validateAdminMessage('a\u0000b'));
});
test('superseded group specification is absent from group code, tests and docs',()=>{
 const files=['packages/db/migrations/0064_group_order_core.sql','packages/contracts/src/group-order.ts','packages/core/src/group/group-service.ts','scripts/group-role.ts','tests/group/fixture.ts','tests/group/core.ts','docs/execution/GROUP_INVITE_CORE.md'];
 const banned=[/14\s*日/,/\b48\s*h/i,/\b96\s*h/i,/\b14\s*days?\b/i,/GROUP_HOLD_EXPIRED/,/GROUP_HOLD_EXTENDED/,/HOLD_EXTEND/,/原則現地/,/group_invites/,/one-time exchange/i,/'EXPIRED'/,/\bEXPIRED\b/];
 for(const f of files){let text:string;try{text=readFileSync(f,'utf8');}catch{continue;}for(const re of banned)assert.ok(!re.test(text),`${f} still mentions ${re}`);}
});
