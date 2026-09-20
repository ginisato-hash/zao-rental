import type {Pool,PoolClient} from 'pg';
import {loadStaff,type Permission,type StaffPrincipal} from '../../../auth/src/staff-auth';
import {FlowError,flowObject,flowStore} from '../../../contracts/src/rental-flow';
import {isWear,type HoldConditions} from '../../../contracts/src/hold';
import {pickupTiming} from '../../../contracts/src/pickup';
type Identity={subject:string;sessionId:string};
type Section='pickup'|'return'|'all';
const DATE_RE=/^20\d{2}-\d{2}-\d{2}$/;
const CURSOR_VERSION=1;
type CursorContext={v:number;store:string;date:string;section:Section;lastKey:string};
// Row identity is never bare bookingId: an actual-store-only custody/inspection task
// (CUSTODY_ONLY) must not carry a key a client could mistake for a full booking card.
const bookingKey=(id:string)=>'B:'+id,loanItemKey=(id:string)=>'E:'+id,wearReceiptKey=(id:string)=>'W:'+id;
function decodeCursor(raw:string):CursorContext{
 let parsed:unknown;
 try{parsed=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));}catch{throw new FlowError('MANIFEST_CURSOR_INVALID',422);}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new FlowError('MANIFEST_CURSOR_INVALID',422);
 const p=parsed as Record<string,unknown>;
 if(p.v!==CURSOR_VERSION||typeof p.store!=='string'||typeof p.date!=='string'||typeof p.section!=='string'||typeof p.lastKey!=='string')throw new FlowError('MANIFEST_CURSOR_INVALID',422);
 return {v:p.v,store:p.store,date:p.date,section:p.section as Section,lastKey:p.lastKey};
}
const encodeCursor=(ctx:CursorContext)=>Buffer.from(JSON.stringify(ctx)).toString('base64url');
const jstDate=(d:Date)=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
const severityRank={INFO:0,WARN:1,ERROR:2} as const;
function equipmentRequirementKeys(conditions:HoldConditions){return new Set(conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).map(i=>m.key+':'+i.family)));}
function bookingWearRequired(conditions:HoldConditions){return conditions.members.some(m=>m.items.some(i=>isWear(i.family)));}
type BookingRow={id:string;conditions:HoldConditions;contact:{displayName:string};price_snapshot:{totalJpy?:number}|null;state:string;version:number};
type HoldRow={booking_id:string;pickup_store:string;due_at:Date;transfer_attention:string|null};
type LoanItemRow={id:string;booking_id:string;requirement_key:string;family:string;state:'OUT'|'RECEIVED';due_at:Date};
type CustodyRow={loan_item_id:string;receipt_id:string;source_store:string;actual_store:string;applied_at:Date;inspected:boolean;requirement_key:string;family:string;version:number;asset_id:string|null;pole_id:string|null;booking_id:string};
type WearLoanRow={id:string;booking_id:string;requirement_key:string;quantity:number;returned:number;planned_return_store:string};
type WearReceiptRow={id:string;loan_id:string;booking_id:string;quantity:number;state:'RETURNED_PENDING'|'CLEANING'|'TODAY_BLOCKED'|'READY'|'UNAVAILABLE';actual_store:string;received_at:Date;source_store:string;family:string;size:string;age:string};
type NoPickupRow={booking_id:string;completed_at:Date};
type KeyEntry={kind:'B'|'E'|'W';bookingId?:string;loanItemId?:string;wearReceiptId?:string};
/** Read-only Staff Daily Manifest surface (UX-5C). Never mutates a business, exception
 * or history row; the one REPEATABLE READ transaction per page is the only consistency
 * guarantee this endpoint makes — see STAFF_MANIFEST_DESIGN.md. Not literal Postgres
 * READ ONLY mode: ops_list_exceptions needs a row lock internally (see manifest()). */
export class ManifestService{
 constructor(private pool:Pool,private authPool:Pool,private identity:Identity){}
 private async principal(store:string):Promise<StaffPrincipal>{
  const a=await this.authPool.connect();try{
   const live=(await a.query('SELECT 1 FROM auth_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()',[this.identity.sessionId,this.identity.subject])).rowCount;
   const p=live?await loadStaff(a,this.identity.subject):null;if(!p)throw new FlowError('UNAUTHENTICATED',401);
   if(!p.permissions.includes('BOOKING_VIEW')||!p.storeIds.includes(store as never))throw new FlowError('FORBIDDEN',403);
   return p;
  }finally{a.release();}
 }
 async manifest(input:unknown){
  const v=flowObject(input,['store','date','section','cursor','pageSize']),store=flowStore(v.store);
  const principal=await this.principal(store);
  if(v.date!==null&&(typeof v.date!=='string'||!DATE_RE.test(v.date)))throw new FlowError('MANIFEST_DATE_INVALID',422);
  const section=(v.section??'all') as Section;if(!['pickup','return','all'].includes(section))throw new FlowError('MANIFEST_SECTION_INVALID',422);
  const pageSize=(v.pageSize??100) as number;if(!Number.isInteger(pageSize)||pageSize<1||pageSize>300)throw new FlowError('MANIFEST_PAGE_SIZE_INVALID',422);
  if(v.cursor!==null&&typeof v.cursor!=='string')throw new FlowError('MANIFEST_CURSOR_INVALID',422);
  const cursorCtx=v.cursor!==null?decodeCursor(v.cursor as string):null;
  const c=await this.pool.connect();
  try{
   // Not literal Postgres READ ONLY mode: ops_list_exceptions (required by §5.4/TD Clarification 2)
   // calls ops_assert_actor, which does `SELECT ... FOR SHARE` on auth_session for its session-liveness
   // check (0033_launch_operations.sql:48) — Postgres forbids any row-locking clause inside a READ ONLY
   // transaction outright, regardless of the function's own privileges. REPEATABLE READ alone still gives
   // the one-snapshot-per-page consistency guarantee; this service issues no INSERT/UPDATE/DELETE itself.
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   const now=(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const date=(v.date as string|null)??jstDate(now);
   if(cursorCtx&&(cursorCtx.store!==store||cursorCtx.date!==date||cursorCtx.section!==section))throw new FlowError('MANIFEST_CURSOR_CONTEXT_MISMATCH',422);
   const result=await this.read(c,principal,store,date,section,pageSize,cursorCtx,now);
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');
   if(e instanceof FlowError)throw e;const code=(e as {code?:string}).code;
   if(['55P03','57014','40001','40P01'].includes(code??''))throw new FlowError('INDETERMINATE',503);throw new FlowError('MANIFEST_READ_FAILED',500);
  }finally{c.release();}
 }
 // Candidate branches (§9.1) are queried once per store/date/section here; every branch
 // is skipped entirely, not merely filtered afterwards, when the composed permission it
 // requires is absent — a BOOKING_VIEW-only caller must never learn candidacy exists.
 private async candidateKeys(c:PoolClient,principal:StaffPrincipal,store:string,date:string,section:Section,checkout:boolean,ret:boolean){
  const keys=new Map<string,KeyEntry>(),pickupToday=new Set<string>(),equipmentReturnDueToday=new Set<string>(),wearReturnDueToday=new Set<string>();
  const wantPickup=section!=='return',wantReturn=section!=='pickup';
  const scoped=(pickupStore:string,returnStore:string)=>principal.storeIds.includes(pickupStore as never)||principal.storeIds.includes(returnStore as never);
  if(checkout&&wantPickup){
   // Excludes a booking that already has a no-pickup completion event: for a MULTIDAY
   // booking that event's date is occupancy_end's, not occupancy_start's (§3/Branch D),
   // so without this exclusion a completed booking would keep reappearing on its stale
   // start-date query forever instead of only on its one completion date below.
   for(const r of (await c.query<{booking_id:string}>("SELECT b.id AS booking_id FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE h.pickup_store=$1 AND h.occupancy_start=$2::date AND NOT EXISTS(SELECT 1 FROM rental_no_pickup_events n WHERE n.booking_id=b.id)",[store,date])).rows){keys.set(bookingKey(r.booking_id),{kind:'B',bookingId:r.booking_id});pickupToday.add(r.booking_id);}
   for(const r of (await c.query<{booking_id:string}>("SELECT n.booking_id FROM rental_no_pickup_events n JOIN rental_bookings b ON b.id=n.booking_id JOIN inventory_holds h ON h.id=b.hold_id WHERE h.pickup_store=$1 AND (n.completed_at AT TIME ZONE 'Asia/Tokyo')::date=$2::date",[store,date])).rows)keys.set(bookingKey(r.booking_id),{kind:'B',bookingId:r.booking_id});
  }
  if(ret&&wantReturn){
   for(const r of (await c.query<{booking_id:string}>("SELECT DISTINCT b.id AS booking_id FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id JOIN rental_loan_items l ON l.booking_id=b.id WHERE h.return_store=$1 AND l.state='OUT' AND (l.due_at AT TIME ZONE 'Asia/Tokyo')::date=$2::date",[store,date])).rows){keys.set(bookingKey(r.booking_id),{kind:'B',bookingId:r.booking_id});equipmentReturnDueToday.add(r.booking_id);}
   for(const r of (await c.query<{booking_id:string}>("SELECT DISTINCT wl.booking_id FROM wear_loans wl JOIN rental_bookings b ON b.id=wl.booking_id WHERE wl.planned_return_store=$1 AND wl.returned<wl.quantity AND (b.conditions->'period'->>'endDate')::date=$2::date",[store,date])).rows){keys.set(bookingKey(r.booking_id),{kind:'B',bookingId:r.booking_id});wearReturnDueToday.add(r.booking_id);}
   for(const r of (await c.query<{loan_item_id:string;booking_id:string;pickup_store:string;return_store:string}>("SELECT l.id AS loan_item_id,l.booking_id,b.conditions->>'pickupStore' AS pickup_store,b.conditions->>'returnStore' AS return_store FROM rental_custody_events e JOIN rental_loan_items l ON l.id=e.loan_item_id JOIN rental_bookings b ON b.id=l.booking_id WHERE e.actual_store=$1 AND ((e.applied_at AT TIME ZONE 'Asia/Tokyo')::date=$2::date OR NOT EXISTS(SELECT 1 FROM rental_inspection_events i WHERE i.loan_item_id=l.id))",[store,date])).rows){
    if(scoped(r.pickup_store,r.return_store))keys.set(bookingKey(r.booking_id),{kind:'B',bookingId:r.booking_id});
    else if(!keys.has(loanItemKey(r.loan_item_id)))keys.set(loanItemKey(r.loan_item_id),{kind:'E',loanItemId:r.loan_item_id});
   }
   for(const r of (await c.query<{wear_receipt_id:string;booking_id:string;pickup_store:string;return_store:string}>("SELECT wr.id AS wear_receipt_id,wl.booking_id,b.conditions->>'pickupStore' AS pickup_store,b.conditions->>'returnStore' AS return_store FROM wear_receipts wr JOIN wear_loans wl ON wl.id=wr.loan_id JOIN rental_bookings b ON b.id=wl.booking_id WHERE wr.actual_store=$1 AND ((wr.received_at AT TIME ZONE 'Asia/Tokyo')::date=$2::date OR wr.state<>'READY')",[store,date])).rows){
    if(scoped(r.pickup_store,r.return_store))keys.set(bookingKey(r.booking_id),{kind:'B',bookingId:r.booking_id});
    else if(!keys.has(wearReceiptKey(r.wear_receipt_id)))keys.set(wearReceiptKey(r.wear_receipt_id),{kind:'W',wearReceiptId:r.wear_receipt_id});
   }
  }
  return {keys,pickupToday,equipmentReturnDueToday,wearReturnDueToday};
 }
 private async read(c:PoolClient,principal:StaffPrincipal,store:string,date:string,section:Section,pageSize:number,cursorCtx:CursorContext|null,now:Date){
  const checkout=principal.permissions.includes('RENTAL_CHECKOUT' as Permission),ret=principal.permissions.includes('RENTAL_RETURN' as Permission),ops=principal.permissions.includes('OPERATIONS_VIEW' as Permission);
  const {keys,pickupToday,equipmentReturnDueToday,wearReturnDueToday}=await this.candidateKeys(c,principal,store,date,section,checkout,ret);
  const sortedKeys=[...keys.keys()].sort(),afterCursor=cursorCtx?sortedKeys.filter(k=>k>cursorCtx.lastKey):sortedKeys;
  const page=afterCursor.slice(0,pageSize),hasMore=afterCursor.length>pageSize,lastKey=page.at(-1);
  const nextCursor=hasMore&&lastKey?encodeCursor({v:CURSOR_VERSION,store,date,section,lastKey}):null;
  const pageBookingIds=page.filter(k=>keys.get(k)!.kind==='B').map(k=>keys.get(k)!.bookingId!);
  const pageLoanItemIds=page.filter(k=>keys.get(k)!.kind==='E').map(k=>keys.get(k)!.loanItemId!);
  const pageWearReceiptIds=page.filter(k=>keys.get(k)!.kind==='W').map(k=>keys.get(k)!.wearReceiptId!);
  const bookingsById=new Map((pageBookingIds.length?(await c.query<BookingRow>('SELECT id,conditions,contact,price_snapshot,state,version FROM rental_bookings WHERE id=ANY($1)',[pageBookingIds])).rows:[]).map(b=>[b.id,b]));
  const holdsByBooking=new Map((pageBookingIds.length?(await c.query<HoldRow>('SELECT b.id AS booking_id,h.pickup_store,h.due_at,h.transfer_attention FROM inventory_holds h JOIN rental_bookings b ON b.hold_id=h.id WHERE b.id=ANY($1)',[pageBookingIds])).rows:[]).map(h=>[h.booking_id,h]));
  const preparedByBooking=new Map((pageBookingIds.length?(await c.query<{id:string;prepared_at:Date|null}>('SELECT id,prepared_at FROM rental_preparations WHERE id=ANY($1)',[pageBookingIds])).rows:[]).map(r=>[r.id,r.prepared_at!==null]));
  const loanItems=pageBookingIds.length?(await c.query<LoanItemRow>('SELECT id,booking_id,requirement_key,family,state,due_at FROM rental_loan_items WHERE booking_id=ANY($1)',[pageBookingIds])).rows:[];
  const loanItemsByBooking=new Map<string,LoanItemRow[]>();for(const l of loanItems){const arr=loanItemsByBooking.get(l.booking_id)??[];arr.push(l);loanItemsByBooking.set(l.booking_id,arr);}
  const custodyLoanItemIds=[...new Set([...loanItems.map(l=>l.id),...pageLoanItemIds])];
  const custody=custodyLoanItemIds.length?(await c.query<CustodyRow>("SELECT e.loan_item_id,e.receipt_id,e.source_store,e.actual_store,e.applied_at,(i.inspection_id IS NOT NULL) AS inspected,l.requirement_key,l.family,l.version,l.asset_id,l.pole_id,l.booking_id FROM rental_custody_events e JOIN rental_loan_items l ON l.id=e.loan_item_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=e.loan_item_id WHERE e.loan_item_id=ANY($1)",[custodyLoanItemIds])).rows:[];
  const custodyByLoanItem=new Map(custody.map(r=>[r.loan_item_id,r]));
  const custodyByBooking=new Map<string,CustodyRow[]>();for(const r of custody){const arr=custodyByBooking.get(r.booking_id)??[];arr.push(r);custodyByBooking.set(r.booking_id,arr);}
  const noPickup=new Map((pageBookingIds.length?(await c.query<NoPickupRow>('SELECT booking_id,completed_at FROM rental_no_pickup_events WHERE booking_id=ANY($1)',[pageBookingIds])).rows:[]).map(r=>[r.booking_id,r]));
  const wearLoans=pageBookingIds.length?(await c.query<WearLoanRow>('SELECT id,booking_id,requirement_key,quantity,returned,planned_return_store FROM wear_loans WHERE booking_id=ANY($1)',[pageBookingIds])).rows:[];
  const wearLoansByBooking=new Map<string,WearLoanRow[]>();for(const w of wearLoans){const arr=wearLoansByBooking.get(w.booking_id)??[];arr.push(w);wearLoansByBooking.set(w.booking_id,arr);}
  const wearLoanIds=wearLoans.map(w=>w.id);
  const wearReceiptsRaw=wearLoanIds.length||pageWearReceiptIds.length?(await c.query<WearReceiptRow>('SELECT wr.id,wr.loan_id,wl.booking_id,wr.quantity,wr.state,wr.actual_store,wr.received_at,wl.planned_pickup_store AS source_store,v.family,v.size,v.age FROM wear_receipts wr JOIN wear_loans wl ON wl.id=wr.loan_id JOIN ledger_variants v ON v.id=wl.variant_id WHERE wr.loan_id=ANY($1) OR wr.id=ANY($2)',[wearLoanIds,pageWearReceiptIds])).rows:[];
  const wearReceiptsByBooking=new Map<string,WearReceiptRow[]>();for(const r of wearReceiptsRaw){const arr=wearReceiptsByBooking.get(r.booking_id)??[];arr.push(r);wearReceiptsByBooking.set(r.booking_id,arr);}
  const wearReceiptsById=new Map(wearReceiptsRaw.map(r=>[r.id,r]));
  const exceptionsByBooking=ops&&pageBookingIds.length?await this.exceptions(c,store,pageBookingIds):new Map<string,{count:number;topSeverity:'INFO'|'WARN'|'ERROR'}>();
  const rows=page.map(key=>{
   const entry=keys.get(key)!;
   if(entry.kind==='B')return this.bookingRow(entry.bookingId!,{checkout,ret,ops,store,date,now,bookingsById,holdsByBooking,preparedByBooking,loanItemsByBooking,custodyByLoanItem,custodyByBooking,noPickup,wearLoansByBooking,wearReceiptsByBooking,pickupToday,equipmentReturnDueToday,wearReturnDueToday,exceptionsByBooking});
   if(entry.kind==='E')return this.custodyOnlyEquipmentRow(entry.loanItemId!,custodyByLoanItem);
   return this.custodyOnlyWearRow(entry.wearReceiptId!,wearReceiptsById);
  });
  return {store,date,section,generatedAt:now.toISOString(),pageSize,nextCursor,hasMore,rows};
 }
 // Walks ops_list_exceptions's own (occurredAt,id) cursor to exhaustion inside the same
 // read-only transaction, so an exact per-booking count/topSeverity never reports a
 // partial page as the total (UX-5C Implementation Clarification 2).
 private async exceptions(c:PoolClient,store:string,pageBookingIds:string[]){
  // ops_assert_actor's session-liveness check reads zao.session, not just zao.actor
  // (0033_launch_operations.sql:48); OperationsContext.transaction() sets both for the
  // same reason before any ops_* call.
  await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.session',$2,true)",[this.identity.subject,this.identity.sessionId]);
  const wanted=new Set(pageBookingIds),tally=new Map<string,{count:number;topSeverity:'INFO'|'WARN'|'ERROR'}>();
  let beforeTime:string|null=null,beforeId:string|null=null;
  for(;;){
   const rows=(await c.query('SELECT ops_list_exceptions($1,$2,$3,$4,$5,$6,$7) v',[store,null,null,0,'UNACKNOWLEDGED',beforeTime,beforeId])).rows[0].v as {id:string;bookingId:string|null;severity:'INFO'|'WARN'|'ERROR';occurredAt:string}[];
   for(const e of rows){
    if(!e.bookingId||!wanted.has(e.bookingId))continue;
    const prior=tally.get(e.bookingId);
    tally.set(e.bookingId,{count:(prior?.count??0)+1,topSeverity:!prior||severityRank[e.severity]>severityRank[prior.topSeverity]?e.severity:prior.topSeverity});
   }
   if(rows.length<51)break;const last=rows.at(-1)!;beforeTime=last.occurredAt;beforeId=last.id;
  }
  return tally;
 }
 private bookingRow(bookingId:string,ctx:{checkout:boolean;ret:boolean;ops:boolean;store:string;date:string;now:Date;bookingsById:Map<string,BookingRow>;holdsByBooking:Map<string,HoldRow>;preparedByBooking:Map<string,boolean>;loanItemsByBooking:Map<string,LoanItemRow[]>;custodyByLoanItem:Map<string,CustodyRow>;custodyByBooking:Map<string,CustodyRow[]>;noPickup:Map<string,NoPickupRow>;wearLoansByBooking:Map<string,WearLoanRow[]>;wearReceiptsByBooking:Map<string,WearReceiptRow[]>;pickupToday:Set<string>;equipmentReturnDueToday:Set<string>;wearReturnDueToday:Set<string>;exceptionsByBooking:Map<string,{count:number;topSeverity:'INFO'|'WARN'|'ERROR'}>}){
  const b=ctx.bookingsById.get(bookingId)!,hold=ctx.holdsByBooking.get(bookingId);
  const conditions=b.conditions,equipmentReq=equipmentRequirementKeys(conditions),equipmentIsRequired=equipmentReq.size>0,wearIsRequired=bookingWearRequired(conditions);
  const loans=ctx.loanItemsByBooking.get(bookingId)??[],outCount=loans.filter(l=>l.state==='OUT').length,equipmentCheckedOut=outCount>0;
  const receivedNotInspectedAnywhere=loans.filter(l=>l.state==='RECEIVED').filter(l=>!ctx.custodyByLoanItem.get(l.id)?.inspected).length;
  const allHere=(ctx.custodyByBooking.get(bookingId)??[]).filter(r=>r.actual_store===ctx.store);
  const inspectionPendingHereCount=allHere.filter(r=>!r.inspected).length,receivedHereCount=allHere.filter(r=>!r.inspected||jstDate(r.applied_at)===ctx.date).length;
  const wl=ctx.wearLoansByBooking.get(bookingId)??[],wearCheckedOut=wl.length>0,wearOutstandingQuantity=wl.reduce((n,w)=>n+(w.quantity-w.returned),0);
  const wr=ctx.wearReceiptsByBooking.get(bookingId)??[];
  const sumState=(s:WearReceiptRow['state'])=>wr.filter(r=>r.state===s).reduce((n,r)=>n+r.quantity,0);
  const wearReturnedPendingQuantity=sumState('RETURNED_PENDING'),wearCleaningQuantity=sumState('CLEANING'),wearTodayBlockedQuantity=sumState('TODAY_BLOCKED'),wearUnavailableQuantity=sumState('UNAVAILABLE'),wearReadyQuantity=sumState('READY');
  const hasNoPickup=ctx.noPickup.has(bookingId);
  const timing=pickupTiming(conditions.period,ctx.now);
  const equipmentDueToday=ctx.equipmentReturnDueToday.has(bookingId),wearDueToday=ctx.wearReturnDueToday.has(bookingId);
  const totalJpy=typeof b.price_snapshot?.totalJpy==='number'?b.price_snapshot.totalJpy:undefined;
  const pickupObj=ctx.checkout?{isPickupToday:ctx.pickupToday.has(bookingId),equipmentRequired:equipmentIsRequired,equipmentPrepared:ctx.preparedByBooking.get(bookingId)??false,equipmentCheckedOut,noPickup:hasNoPickup,timing,wearRequired:wearIsRequired,wearCheckedOut}:undefined;
  const returnObj=ctx.ret?{equipmentReturnDueToday:equipmentDueToday,outCount,receivedHereCount,inspectionPendingHereCount,wearReturnDueToday:wearDueToday,wearOutstandingQuantity,wearReturnedPendingQuantity,wearCleaningQuantity,wearTodayBlockedQuantity,wearUnavailableQuantity,wearReadyQuantity}:undefined;
  const exceptionObj=ctx.ops?(()=>{const e=ctx.exceptionsByBooking.get(bookingId);return {attention:!!e&&e.count>0,count:e?.count??0,topSeverity:e?.topSeverity??null};})():undefined;
  // "Done" means the domain actually went through pickup+return+inspection, not merely
  // "nothing outstanding" — a never-checked-out booking also has outCount=0/wl.length=0
  // and must not be mistaken for COMPLETE.
  const equipmentDone=!equipmentIsRequired||(loans.length>0&&outCount===0&&receivedNotInspectedAnywhere===0);
  const wearDone=!wearIsRequired||(wl.length>0&&wearOutstandingQuantity===0&&wearReturnedPendingQuantity===0&&wearCleaningQuantity===0&&wearTodayBlockedQuantity===0&&wearUnavailableQuantity===0);
  // pickup.equipmentCheckedOut (state='OUT', per the documented response field) resets to
  // false once returned, unlike wear's wearCheckedOut (a loan row that persists forever) —
  // classify() needs a signal that stays true after a full cycle, so CHECKOUT never wins
  // back over COMPLETE for an already-returned-and-inspected booking.
  const equipmentEverCheckedOut=loans.length>0;
  const nextAction=this.classify(b.state,ctx.checkout,ctx.ret,pickupObj,returnObj,hold?.transfer_attention??null,equipmentDone,wearDone,equipmentEverCheckedOut);
  const row:Record<string,unknown>={rowKind:'BOOKING_SCOPED',key:bookingKey(bookingId),bookingId,displayName:b.contact.displayName,period:conditions.period,pickupStore:conditions.pickupStore,returnStore:conditions.returnStore,bookingState:b.state,equipmentCount:equipmentReq.size,nextAction};
  if(totalJpy!==undefined)row.totalJpy=totalJpy;
  if(pickupObj)row.pickup=pickupObj;if(returnObj)row.return=returnObj;if(exceptionObj)row.exception=exceptionObj;
  return row;
 }
 // First-match-wins, in the exact §7.1 order. Each class is only ever reachable through
 // the composition it requires; a composition missing that requirement falls through.
 private classify(bookingState:string,checkout:boolean,ret:boolean,
  pickup:{equipmentRequired:boolean;equipmentPrepared:boolean;equipmentCheckedOut:boolean;noPickup:boolean;timing:string;wearRequired:boolean;wearCheckedOut:boolean}|undefined,
  r:{equipmentReturnDueToday:boolean;outCount:number;inspectionPendingHereCount:number;wearReturnDueToday:boolean;wearOutstandingQuantity:number;wearReturnedPendingQuantity:number;wearCleaningQuantity:number;wearTodayBlockedQuantity:number;wearUnavailableQuantity:number}|undefined,
  transferAttention:string|null,equipmentDone:boolean,wearDone:boolean,equipmentEverCheckedOut:boolean){
  if(bookingState==='DRAFT')return 'NO_ACTION';
  if(bookingState==='PAYMENT_PENDING'||bookingState==='PAYMENT_REVIEW')return 'CHECK_PAYMENT_OR_EXCEPTION';
  if(checkout&&transferAttention)return 'CHECK_PAYMENT_OR_EXCEPTION';
  const timingOk=!!pickup&&(pickup.timing==='PICKUP_WINDOW'||pickup.timing==='LATE_PICKUP_ELIGIBLE');
  if(checkout&&pickup&&bookingState==='CONFIRMED_DEV'&&pickup.equipmentRequired&&!pickup.equipmentPrepared&&timingOk)return 'PREPARE_EQUIPMENT';
  if(checkout&&pickup&&bookingState==='CONFIRMED_DEV'&&(!pickup.equipmentRequired||pickup.equipmentPrepared)&&((pickup.equipmentRequired&&!equipmentEverCheckedOut)||(pickup.wearRequired&&!pickup.wearCheckedOut))&&timingOk)return 'CHECKOUT';
  if(checkout&&ret&&pickup&&r){
   const eqWait=!r.equipmentReturnDueToday&&(pickup.equipmentCheckedOut||!pickup.equipmentRequired)&&r.outCount>0;
   const wearWait=!r.wearReturnDueToday&&(pickup.wearCheckedOut||!pickup.wearRequired)&&r.wearOutstandingQuantity>0;
   if(eqWait||wearWait)return 'OUT_WAIT_RETURN';
  }
  if(ret&&r){
   if((r.equipmentReturnDueToday&&r.outCount>0)||(r.wearReturnDueToday&&r.wearOutstandingQuantity>0))return 'RECEIVE_RETURN';
   if(r.inspectionPendingHereCount>0)return 'INSPECTION_PENDING';
   if((r.wearReturnedPendingQuantity>0||r.wearCleaningQuantity>0||r.wearTodayBlockedQuantity>0)&&r.wearUnavailableQuantity===0)return 'WEAR_CARE_IN_PROGRESS';
  }
  if(checkout&&ret&&pickup&&((equipmentDone&&wearDone)||pickup.noPickup))return 'COMPLETE';
  if(ret&&!checkout)return r&&r.wearUnavailableQuantity>0?'NEEDS_DETAIL_REVIEW':'NO_ACTION';
  if(checkout&&!ret)return 'NO_ACTION';
  return 'NEEDS_DETAIL_REVIEW';
 }
 private custodyOnlyEquipmentRow(loanItemId:string,byLoanItem:Map<string,CustodyRow>){
  const r=byLoanItem.get(loanItemId)!,inspectionPending=!r.inspected;
  return {rowKind:'CUSTODY_ONLY',key:loanItemKey(loanItemId),receiptId:r.receipt_id,loanItemId,sourceStore:r.source_store,actualStore:r.actual_store,family:r.family,requirementKey:r.requirement_key,version:r.version,appliedAt:r.applied_at.toISOString(),inspectionPending,assetId:r.asset_id,poleId:r.pole_id,taskState:inspectionPending?'INSPECTION_PENDING':'READY',taskAction:inspectionPending?'INSPECT':'NO_ACTION'};
 }
 private custodyOnlyWearRow(wearReceiptId:string,byId:Map<string,WearReceiptRow>){
  const r=byId.get(wearReceiptId)!;
  const taskAction=r.state==='READY'?'NO_ACTION':r.state==='UNAVAILABLE'?'NEEDS_DETAIL_REVIEW':'CARE_IN_PROGRESS';
  return {rowKind:'CUSTODY_ONLY',key:wearReceiptKey(wearReceiptId),receiptId:wearReceiptId,loanId:r.loan_id,sourceStore:r.source_store,actualStore:r.actual_store,family:r.family,size:r.size,age:r.age,quantity:r.quantity,receivedAt:r.received_at.toISOString(),taskState:r.state,taskAction};
 }
}
