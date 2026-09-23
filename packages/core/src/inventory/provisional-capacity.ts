import type {PoolClient} from 'pg';
import {HoldError} from '../../../contracts/src/hold';
import type {ProvisionalFamily} from '../operations/provisional-capacity-source';
type Conn = Pick<PoolClient, 'query'>;

export type ProvisionalRequirement = {key: string; family: ProvisionalFamily; age: 'ADULT'|'KIDS'; bookingSize: string};
export type ProvisionalPlan = {feasible: true; rows: {key: string; bucket: string; day: string}[]} | {feasible: false; rows: []};

// F8-style deliberate scope boundary: this module is a complete, independently real-PG-tested
// quantity-pool mechanism (mirrors packages/core/src/inventory/wear-capacity.ts's pattern, not
// the per-unit ledger_assets/inventory_claims pattern), but it is NOT wired into
// HoldService.command()'s live allocation path this pass — see RESULT.md's disclosed scope note.
// One row per (family,age,bookingSize) requirement can be satisfied by ANY currently-ACTIVE,
// MAPPED bucket with room that day, oldest source first, so a later source (a fresh row, never an
// edit to an earlier one) transparently adds capacity without this function's callers needing to
// know which source a unit came from.
// V5 (release-code-closure, 95% public / staff INVENTORY_BUFFER_OVERRIDE): `bufferOverride`
// (default false — every existing caller keeps the strict public ceiling unless it explicitly
// opts in) mirrors wearCapacityDetailed()'s own two-ceiling design exactly: a non-override
// request may never push public usage of a compatible family/age/size/day pool past
// floor(sum(effective bucket quantities)*0.95); an override
// request may use up to the full effective `quantity`, which the hard per-slot check always
// enforces regardless of override status, so public+override usage can never together exceed
// true bucket capacity.
export async function provisionalCapacity(c: Conn, requirements: ProvisionalRequirement[], days: string[], now: Date, ignore: string|null, bufferOverride = false): Promise<ProvisionalPlan> {
  if (!requirements.length) return {feasible: true, rows: []};
  const families = [...new Set(requirements.map((r) => r.family))];
  // V2 (TD correction): bookable quantity is derived (base + adjustments - materializations), never
  // the raw immutable `quantity` column directly — see provisional_capacity_effective_quantity() in
  // migration 0041.
  const buckets = (await c.query<{id: string; family: string; age: string; booking_size: string; quantity: number}>(
    `SELECT id,family,age,booking_size,provisional_capacity_effective_quantity(id) AS quantity FROM provisional_capacity_buckets WHERE active AND size_mapping_status='MAPPED' AND family=ANY($1::text[]) ORDER BY created_at ASC`,
    [families],
  )).rows;
  const claims = buckets.length ? (await c.query<{bucket_id: string; day: string; quantity_all: number; quantity_public: number}>(
    `SELECT c.bucket_id,c.day::text,sum(c.quantity)::int AS quantity_all,coalesce(sum(c.quantity) FILTER(WHERE NOT h.buffer_override),0)::int AS quantity_public FROM provisional_capacity_claims c JOIN inventory_holds h ON h.id=c.hold_id
     WHERE c.state='ACTIVE' AND c.bucket_id=ANY($1::uuid[]) AND c.day=ANY($2::date[]) AND ($3::uuid IS NULL OR h.id<>$3) AND h.state='ACTIVE'
       AND (h.expires_at>$4 OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL')
     GROUP BY c.bucket_id,c.day`,
    [buckets.map((b) => b.id), days, ignore, now],
  )).rows : [];
  const ownUsage = new Map<string, number>();
  const rows: {key: string; bucket: string; day: string}[] = [];
  for (const r of requirements) {
    const candidates = buckets.filter((b) => b.family === r.family && b.age === r.age && b.booking_size === r.bookingSize);
    if (!candidates.length) return {feasible: false, rows: []};
    for (const day of days) {
      let placed = false;
      for (const b of candidates) {
        const claim = claims.find((x) => x.bucket_id === b.id && x.day === day);
        const usedByOthersAll = claim?.quantity_all ?? 0;
        const groupIds=new Set(candidates.map(x=>x.id));
        const usedByOthersPublic=claims.filter(x=>x.day===day&&groupIds.has(x.bucket_id)).reduce((n,x)=>n+x.quantity_public,0);
        const plannedPublic=candidates.reduce((n,x)=>n+(ownUsage.get(x.id+'/'+day)??0),0);
        const slotKey = b.id + '/' + day;
        const usedByThisPlan = ownUsage.get(slotKey) ?? 0;
        const publicCap = Math.floor(candidates.reduce((n,x)=>n+x.quantity,0) * 0.95);
        const withinHardCeiling = usedByOthersAll + usedByThisPlan + 1 <= b.quantity;
        const withinPublicCeiling = bufferOverride || usedByOthersPublic + plannedPublic + 1 <= publicCap;
        if (withinHardCeiling && withinPublicCeiling) {
          ownUsage.set(slotKey, usedByThisPlan + 1);
          rows.push({key: r.key, bucket: b.id, day});
          placed = true;
          break;
        }
      }
      if (!placed) return {feasible: false, rows: []};
    }
  }
  return {feasible: true, rows};
}

/** Deactivate-and-reinsert, exactly matching writeWearClaims'/writeAllocationClaims' shape: never
 * a partial update, always a full replan for this hold's requirement set. Re-checks feasibility
 * once more at the write boundary, after every prior awaited SQL in the caller's transaction. */
export async function writeProvisionalClaims(c: Conn, holdId: string, requirements: ProvisionalRequirement[], days: string[], now: Date, bufferOverride = false): Promise<ProvisionalPlan> {
  const plan = await provisionalCapacity(c, requirements, days, now, holdId, bufferOverride);
  if (!plan.feasible) throw new HoldError('PROVISIONAL_CAPACITY_CHANGED', 409);
  await c.query(`UPDATE provisional_capacity_claims SET state='RELEASED',released_at=clock_timestamp() WHERE hold_id=$1 AND state='ACTIVE'`, [holdId]);
  if (plan.rows.length) {
    await c.query(
      `INSERT INTO provisional_capacity_claims(hold_id,requirement_key,bucket_id,day,quantity) SELECT $1,x.key,x.bucket::uuid,x.day::date,1 FROM jsonb_to_recordset($2::jsonb) AS x(key text,bucket uuid,day date)`,
      [holdId, JSON.stringify(plan.rows)],
    );
  }
  return plan;
}

/** Explicit release, for cancel/expiry — a caller-invoked primitive (this pass does not wire it
 * into HoldService.command()'s cancel/expire branches; see the module-level scope note above).
 * Eager state transition (RELEASED, not merely excluded by a liveness predicate at query time),
 * matching inventory_claims'/ledger_poles' existing release style rather than wear_claims' own
 * query-time-only exclusion — easier to audit, and consistent with the F1–F14 branch's own
 * preference for explicit state over implicit predicate duplication. */
export async function releaseProvisionalClaims(c: Conn, holdId: string): Promise<void> {
  await c.query(`UPDATE provisional_capacity_claims SET state='RELEASED',released_at=clock_timestamp() WHERE hold_id=$1 AND state='ACTIVE'`, [holdId]);
}
