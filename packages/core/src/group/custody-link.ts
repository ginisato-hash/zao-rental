// Group custody link (migration 0065) activation, read from the database itself (never from an environment variable).
//
// Production may run on 0064 (group order core) alone: 0065 touches objects owned by the custody executor role and is applied only after a
// privileged path exists. Everything that reads or writes a group loan (the loan subject columns of rental_loan_items, group_part_preparations,
// the group loan validator) therefore asks this question first and closes with GROUP_CUSTODY_NOT_ACTIVATED when the link is absent. Ordinary
// (booking) custody never depends on the answer except to leave group-only columns out of its SQL.
//
// The check reads the catalog only (no table privilege needed, any application role may run it): the loan subject column, the preparation
// table, the group loan validator function and its ENABLED trigger must ALL exist. A partial or disabled link counts as not activated.
export const GROUP_CUSTODY_NOT_ACTIVATED='GROUP_CUSTODY_NOT_ACTIVATED';
import type {PoolClient} from 'pg';
type Queryable=Pick<PoolClient,'query'>;
const ACTIVE_SQL=`SELECT (
  EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.rental_loan_items') AND a.attname='group_part_id' AND NOT a.attisdropped)
  AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.rental_loan_items') AND a.attname='hold_id' AND NOT a.attisdropped)
  AND to_regclass('public.group_part_preparations') IS NOT NULL
  AND to_regprocedure('public.rental_validate_group_loan()') IS NOT NULL
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.rental_loan_items') AND t.tgname='rental_validate_group_loan' AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal)
 ) AS active`;
// 0065 is forward-only and never removed, so a positive answer is final for a connection pool (a transaction client is never cached: it goes back to
// its pool). A negative answer is asked again every time (one catalog read), so a release that applies 0065 starts working without a restart.
const positive=new WeakSet<object>();
const isPool=(q:object)=>typeof (q as {totalCount?:unknown}).totalCount==='number';
export async function groupCustodyLinkActive(q:Queryable):Promise<boolean>{
 if(positive.has(q))return true;
 const active=(await q.query<{active:boolean}>(ACTIVE_SQL)).rows[0]?.active===true;
 if(active&&isPool(q))positive.add(q);
 return active;
}
