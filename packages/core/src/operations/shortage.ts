import type {PoolClient} from 'pg';
import {HoldError,isWear,parseConditions,type HoldConditions} from '../../../contracts/src/hold';
import {planMixedAllocation} from '../inventory/allocation';

// With shortage (Issue #47 #7008569703 §5.3, TD FB #7010252887 §5). A read-only judgement, never a resolution: no HOLD,
// claim, re-allocation, transfer or purchase is created here. It reuses the existing mixed allocation authority
// (planMixedAllocation) on the order's CURRENT conditions (the live HOLD, so amendments count), restricted to what has not
// been handed out yet, ignoring the order's own HOLD (so its own claims are not counted against it) and with the reserve
// condition saved on that HOLD. Items already out are custody, which the planner already treats as occupied; they are not
// demanded again. The result keeps the planner's distinct meanings:
//   INSUFFICIENT            — stock for the period cannot cover the remaining demand
//   TRANSFER_PLAN_REQUIRED  — stock exists only at the other station: a transfer has to be arranged (a different reason)
//   INDETERMINATE           — could not be decided (planner bounds, lock/time limits, or this read's own budget);
//                             never shown as "no shortage" and never counted as zero
// A missing or inactive HOLD, or remaining demand that cannot be re-planned (the return time has already passed) is not a
// shortage by this definition: such orders are covered by Late / payment reconciliation, not here.
export type ShortageState='INSUFFICIENT'|'TRANSFER_PLAN_REQUIRED'|'INDETERMINATE';
export type ShortageCandidate={id:string;hold_id:string|null;hold_state:string|null;buffer_override:boolean|null;cond:HoldConditions;loaned:string[];wear_loaned:string[]};
/** Orders the read evaluates: live (not draft/cancelled/completed/no-show), with something still to hand out. */
export const SHORTAGE_STATUS_SQL="s.status IN ('RESERVED','PAYMENT_PENDING','PAYMENT_REVIEW','PARTIALLY_PICKED_UP')";
/** Extra columns the evaluator needs, selected from the shared ORDER_BASE_SQL `s` relation. */
export const SHORTAGE_COLUMNS_SQL=`s.id,s.cond,h.id hold_id,h.state hold_state,h.buffer_override,
 ARRAY(SELECT DISTINCT l.requirement_key FROM rental_loan_items l WHERE l.booking_id=s.id) loaned,
 ARRAY(SELECT DISTINCT w.requirement_key FROM wear_loans w WHERE w.booking_id=s.id) wear_loaned`;
export const SHORTAGE_JOIN_SQL='LEFT JOIN rental_bookings rb ON rb.id=s.id LEFT JOIN inventory_holds h ON h.id=rb.hold_id';
/** Budget of planner runs per read; anything beyond it is INDETERMINATE (reported, never rounded to zero). */
export const SHORTAGE_BUDGET={orders:150,millis:20000};

/** The order's demand that has not been handed out yet (member/item level), or null when nothing remains. */
export function remainingDemand(cond:HoldConditions,loaned:readonly string[],wearLoaned:readonly string[]):HoldConditions|null{
 const gear=new Set(loaned),wear=new Set(wearLoaned);
 const members=cond.members.map(m=>({...m,items:m.items.filter(i=>{const key=m.key+':'+i.family;return isWear(i.family)?!wear.has(key)&&!wear.has(m.key):!gear.has(key);})})).filter(m=>m.items.length>0);
 return members.length?{...cond,members}:null;
}

/** Evaluate in the caller's single READ ONLY snapshot. Returns a state per order id; orders without a shortage are absent. */
export async function evaluateShortage(c:Pick<PoolClient,'query'>,rows:ShortageCandidate[],now:Date,budget=SHORTAGE_BUDGET):Promise<Map<string,ShortageState>>{
 const out=new Map<string,ShortageState>(),started=Date.now();let runs=0;
 for(const r of rows){
  if(!r.hold_id||r.hold_state!=='ACTIVE')continue;
  const demand=remainingDemand(r.cond,r.loaned,r.wear_loaned);if(!demand)continue;
  if(runs>=budget.orders||Date.now()-started>budget.millis){out.set(r.id,'INDETERMINATE');continue;}
  runs++;
  let conditions:HoldConditions;try{conditions=parseConditions(demand);}catch{out.set(r.id,'INDETERMINATE');continue;}
  try{
   await c.query('SAVEPOINT shortage_eval');
   const plan=await planMixedAllocation(c,conditions,now,r.hold_id,undefined,r.buffer_override===true);
   await c.query('RELEASE SAVEPOINT shortage_eval');
   if(plan.result!=='FEASIBLE')out.set(r.id,plan.result);
  }catch(e){
   await c.query('ROLLBACK TO SAVEPOINT shortage_eval').catch(()=>{});
   // The return time already passed: Late, not shortage.
   if(e instanceof HoldError&&e.code==='PERIOD_ENDED')continue;
   out.set(r.id,'INDETERMINATE');
  }
 }
 return out;
}
