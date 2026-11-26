import type {Pool,PoolClient} from 'pg';
import {loadStaff} from '../../../auth/src/staff-auth';
import {GROUP_HELD,GroupError,settlementOf,type GroupStatus} from '../../../contracts/src/group-order';
import {csvCell} from '../operations/exports';

/** Parent-level read side of the group order for the staff surfaces that already exist (inbox, calendar, item detail, order
 * list, reports/CSV, receivable totals). Groups create no rental booking, so every booking-based consumer stays fail-closed and
 * blind to groups; these functions are how a group appears there, ALWAYS as one parent (never once per part, never once per
 * member), and always read-only. ADMIN + GROUP_VIEW + store scope are re-read in the same transaction (group application role).
 * Amounts: the parent's confirmed total is the only revenue-side figure; money received is only what `group_payments` recorded.
 * A confirmed-but-unpaid group is a receivable, never "payment unknown" and never collected money. */
export type StaffRef={subject:string;revision:number};
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'];
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const n=(v:unknown)=>Number(v);
const jst=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);

export type GroupInboxItem={groupId:string;groupNumber:string;kind:'GROUP_REVIEW_REQUEST'|'GROUP_CHANGE_REQUEST';status:GroupStatus;label:string;memberCount:number;parts:number;
 period:{startDate:string;endDate:string;slot?:string};pickupStore:string;returnStore:string;since:string;estimateJpy:number|null;openRequests:number;attention:'START_DATE_PASSED'|null};
export type GroupCalendarEntry={groupId:string;groupNumber:string;kind:'GROUP_HOLD'|'GROUP_CONFIRMED';status:GroupStatus;label:string;start:string;end:string;memberCount:number;parts:number;activeClaims:number;pickupStore:string;returnStore:string};
export type GroupReportRow={groupId:string;groupNumber:string;status:GroupStatus;label:string;period:{startDate:string;endDate:string};pickupStore:string;returnStore:string;memberCount:number;parts:number;
 confirmedJpy:number;receivedJpy:number;outstandingJpy:number;settlement:string;partsSumJpy:number|null;partsMatchParent:boolean|null};
export type GroupReport={stores:string[];from:string;to:string;asOf:string;rows:GroupReportRow[];totals:{groups:number;confirmedJpy:number;receivedJpy:number;outstandingJpy:number}};

export class GroupReadModel{
 constructor(private pool:Pool,private clock?:()=>Date){}
 private async read<T>(staff:StaffRef,stores:string[],fn:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  if(!stores.length||stores.length>2||stores.some(s=>!STORES.includes(s))||new Set(stores).size!==stores.length)throw new GroupError('INVALID_STORE',422);
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const p=await loadStaff(c,staff.subject);
   if(!p||p.revision!==staff.revision||p.role!=='ADMIN'||!(p.permissions as string[]).includes('GROUP_VIEW')||stores.some(s=>!(p.storeIds as string[]).includes(s)))throw new GroupError('FORBIDDEN',403);
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const v=await fn(c,now);await c.query('COMMIT');return v;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }

 /** New confirmation requests (and customer change requests) for the staff inbox, one item per parent group. A group leaves the
  * inbox only by its state changing (confirm / request changes / release); there is no separate acknowledgement table. */
 async inbox(staff:StaffRef,input:{stores:string[];limit?:number}):Promise<{attention:number;items:GroupInboxItem[]}>{
  const limit=Math.max(1,Math.min(50,Math.trunc(input.limit??20)));
  return this.read(staff,input.stores,async(c,now)=>{
   const rows=(await c.query(`SELECT g.id,g.group_number,g.status,g.group_label,g.member_count,g.period,g.pickup_store,g.return_store,g.held_at,
     (SELECT count(*) FROM group_order_parts p WHERE p.group_id=g.id AND p.active) parts,
     (SELECT total_jpy FROM group_quotes q WHERE q.group_id=g.id AND q.kind='ESTIMATE' ORDER BY version DESC LIMIT 1) estimate,
     (SELECT count(*) FROM group_change_requests r WHERE r.group_id=g.id AND r.status='OPEN' AND r.kind IN ('CHANGE','DECLINE')) open_requests
    FROM group_orders g WHERE g.pickup_store=ANY($1::text[]) AND g.return_store=ANY($1::text[]) AND g.status IN ('REVIEW_HELD','CHANGES_REQUESTED')
    ORDER BY g.held_at DESC,g.id LIMIT $2`,[input.stores,limit])).rows;
   const today=jst(now);
   const items:GroupInboxItem[]=rows.filter(r=>r.status==='REVIEW_HELD'||n(r.open_requests)>0).map(r=>({groupId:r.id,groupNumber:r.group_number,kind:n(r.open_requests)>0?'GROUP_CHANGE_REQUEST':'GROUP_REVIEW_REQUEST',status:r.status,label:r.group_label,memberCount:r.member_count,parts:n(r.parts),period:r.period,
    pickupStore:r.pickup_store,returnStore:r.return_store,since:new Date(r.held_at).toISOString(),estimateJpy:r.estimate===null?null:n(r.estimate),openRequests:n(r.open_requests),attention:r.period.startDate<today?'START_DATE_PASSED':null}));
   const attention=n((await c.query(`SELECT count(*) n FROM group_orders g WHERE g.pickup_store=ANY($1::text[]) AND g.return_store=ANY($1::text[]) AND (g.status='REVIEW_HELD' OR (g.status='CHANGES_REQUESTED' AND EXISTS(SELECT 1 FROM group_change_requests r WHERE r.group_id=g.id AND r.status='OPEN' AND r.kind IN ('CHANGE','DECLINE'))))`,[input.stores])).rows[0].n);
   return {attention,items};
  });
 }

 /** Calendar: one entry per parent group overlapping [from,to] at the station (never one per part or per item). */
 async calendar(staff:StaffRef,input:{store:string;from:string;to:string}):Promise<GroupCalendarEntry[]>{
  if(!DATE.test(input.from)||!DATE.test(input.to)||input.from>input.to||(Date.parse(input.to)-Date.parse(input.from))/86400000>92)throw new GroupError('INVALID_INPUT',422);
  return this.read(staff,[input.store],async c=>(await c.query(`SELECT g.id,g.group_number,g.status,g.group_label,g.period,g.member_count,g.pickup_store,g.return_store,
    (SELECT count(*) FROM group_order_parts p WHERE p.group_id=g.id AND p.active) parts,
    (SELECT coalesce(sum(p.claim_count),0) FROM group_order_parts p WHERE p.group_id=g.id AND p.active) claims
   FROM group_orders g WHERE g.status=ANY($4::text[]) AND (g.pickup_store=$1 OR g.return_store=$1) AND g.period->>'startDate'<=$3 AND g.period->>'endDate'>=$2 ORDER BY g.period->>'startDate',g.group_number`,[input.store,input.from,input.to,[...GROUP_HELD]])).rows.map(r=>({
    groupId:r.id,groupNumber:r.group_number,kind:r.status==='CONFIRMED'?'GROUP_CONFIRMED' as const:'GROUP_HOLD' as const,status:r.status,label:r.group_label,start:r.period.startDate,end:r.period.endDate,memberCount:r.member_count,parts:n(r.parts),activeClaims:n(r.claims),pickupStore:r.pickup_store,returnStore:r.return_store})));
 }

 /** Item detail / calendar bars: which parent group holds each item on which days. Replaces the unlabeled per-hold bar. */
 async itemBars(staff:StaffRef,input:{stores:string[];assetIds:string[];from:string;to:string}){
  if(!DATE.test(input.from)||!DATE.test(input.to)||input.from>input.to||input.assetIds.length>200)throw new GroupError('INVALID_INPUT',422);
  return this.read(staff,input.stores,async c=>(await c.query(`SELECT cl.asset_id,g.id group_id,g.group_number,g.status,min(cl.day)::text start,max(cl.day)::text "end"
   FROM inventory_claims cl JOIN group_order_parts p ON p.hold_id=cl.hold_id AND p.active JOIN group_orders g ON g.id=p.group_id
   WHERE cl.active AND cl.asset_id=ANY($1::uuid[]) AND cl.day BETWEEN $2::date AND $3::date AND g.status=ANY($4::text[]) AND g.pickup_store=ANY($5::text[]) AND g.return_store=ANY($5::text[])
   GROUP BY cl.asset_id,g.id,g.group_number,g.status ORDER BY cl.asset_id,min(cl.day)`,[input.assetIds,input.from,input.to,[...GROUP_HELD],input.stores])).rows.map(r=>({assetId:r.asset_id as string,groupId:r.group_id as string,groupNumber:r.group_number as string,status:r.status as GroupStatus,start:r.start as string,end:r.end as string})));
 }
 /** Hold -> parent mapping, so the ordinary hold bars/list rows of the existing screens can be labeled and collapsed to the parent. */
 async holdParents(staff:StaffRef,input:{stores:string[];holdIds:string[]}){
  if(input.holdIds.length>500)throw new GroupError('INVALID_INPUT',422);
  return this.read(staff,input.stores,async c=>new Map((await c.query(`SELECT p.hold_id,g.id group_id,g.group_number,g.status FROM group_order_parts p JOIN group_orders g ON g.id=p.group_id WHERE p.hold_id=ANY($1::uuid[]) AND g.pickup_store=ANY($2::text[]) AND g.return_store=ANY($2::text[])`,[input.holdIds,input.stores])).rows.map(r=>[r.hold_id as string,{groupId:r.group_id as string,groupNumber:r.group_number as string,status:r.status as GroupStatus}])));
 }

 /** Order-list rows / report: one row per parent. Revenue side = confirmed parent total of CONFIRMED groups only (a released or
  * cancelled group counts 0); money side = recorded on-site receipts only. `partsSumJpy` re-adds the confirmed quote's member
  * lines by part and must equal the parent (reported, never silently adjusted). Contains no member body data and no e-mail. */
 async report(staff:StaffRef,input:{stores:string[];from:string;to:string}):Promise<GroupReport>{
  if(!DATE.test(input.from)||!DATE.test(input.to)||input.from>input.to||(Date.parse(input.to)-Date.parse(input.from))/86400000>92)throw new GroupError('INVALID_INPUT',422);
  return this.read(staff,input.stores,async(c,now)=>{
   const gs=(await c.query(`SELECT g.id,g.group_number,g.status,g.group_label,g.period,g.pickup_store,g.return_store,g.member_count,g.confirmed_total_jpy,g.confirmed_quote_id,
     (SELECT count(*) FROM group_order_parts p WHERE p.group_id=g.id AND p.active) parts
    FROM group_orders g WHERE g.status NOT IN ('DRAFT','QUOTED') AND g.pickup_store=ANY($1::text[]) AND g.return_store=ANY($1::text[]) AND g.period->>'startDate'<=$3 AND g.period->>'endDate'>=$2 ORDER BY g.period->>'startDate',g.group_number`,[input.stores,input.from,input.to])).rows;
   const ids=gs.map(g=>g.id as string);
   const pays=ids.length?(await c.query('SELECT group_id,kind,amount_jpy FROM group_payments WHERE group_id=ANY($1::uuid[])',[ids])).rows:[];
   const quotes=ids.length?(await c.query("SELECT q.id,q.lines FROM group_quotes q WHERE q.id=ANY($1::uuid[])",[gs.map(g=>g.confirmed_quote_id).filter(Boolean)])).rows:[];
   const parts=ids.length?(await c.query('SELECT group_id,id,part_no FROM group_members WHERE group_id=ANY($1::uuid[])',[ids])).rows.map(r=>({g:r.group_id as string,m:r.id as string,p:r.part_no as number})):[];
   const rows:GroupReportRow[]=gs.map(g=>{
    const confirmed=g.status==='CONFIRMED'?n(g.confirmed_total_jpy):0;
    // A cancelled group's recorded receipts stay visible (manual refund pending) but are not revenue.
    const s=settlementOf(g.status==='CONFIRMED'||g.status==='CANCELLED'?(g.confirmed_total_jpy===null?null:n(g.confirmed_total_jpy)):null,pays.filter(p=>p.group_id===g.id).map(p=>({kind:p.kind,amountJpy:n(p.amount_jpy)})));
    let sum:number|null=null;
    if(g.status==='CONFIRMED'){const q=quotes.find(x=>x.id===g.confirmed_quote_id);
     if(q){const byMember=new Map<string,number>((q.lines as {memberId:string;finalJpy:number}[]).map(l=>[l.memberId,n(l.finalJpy)]));const perPart=new Map<number,number>();
      for(const m of parts.filter(p=>p.g===g.id))perPart.set(m.p,(perPart.get(m.p)??0)+(byMember.get(m.m)??0));sum=[...perPart.values()].reduce((a,b)=>a+b,0);}}
    return {groupId:g.id,groupNumber:g.group_number,status:g.status,label:g.group_label,period:g.period,pickupStore:g.pickup_store,returnStore:g.return_store,memberCount:g.member_count,parts:n(g.parts),
     confirmedJpy:confirmed,receivedJpy:g.status==='CONFIRMED'||g.status==='CANCELLED'?s.receivedJpy:0,outstandingJpy:g.status==='CONFIRMED'?s.outstandingJpy:0,settlement:g.status==='CONFIRMED'?s.status:g.status==='CANCELLED'?'CANCELLED':'NOT_APPLICABLE',
     partsSumJpy:sum,partsMatchParent:sum===null?null:sum===confirmed};
   });
   return {stores:input.stores,from:input.from,to:input.to,asOf:now.toISOString(),rows,totals:{groups:rows.length,confirmedJpy:rows.reduce((a,r)=>a+r.confirmedJpy,0),receivedJpy:rows.reduce((a,r)=>a+(r.status==='CONFIRMED'?r.receivedJpy:0),0),outstandingJpy:rows.reduce((a,r)=>a+r.outstandingJpy,0)}};
  });
 }
}

const HEAD=['団体番号','状態','団体名','開始日','終了日','受取店舗','返却店舗','人数','確定総額(税込)','現地受領額','未収額','精算'];
/** Same rows as the screen, spreadsheet-safe cells (csvCell), UTF-8 BOM + CRLF like the other exports. Parent rows only. */
export function groupReportCsv(r:GroupReport):string{
 const lines=[HEAD.map(csvCell).join(','),...r.rows.map(x=>[x.groupNumber,x.status,x.label,x.period.startDate,x.period.endDate,x.pickupStore,x.returnStore,x.memberCount,x.confirmedJpy,x.receivedJpy,x.outstandingJpy,x.settlement].map(csvCell).join(','))];
 return '﻿'+lines.join('\r\n')+'\r\n';
}
