import {FlowError,flowId} from '../../../contracts/src/rental-flow';
import {OperationsContext} from './context';

export type ProvisionalFamily = 'SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'WEAR_JACKET'|'WEAR_PANTS';
const FAMILIES: readonly ProvisionalFamily[] = ['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','WEAR_JACKET','WEAR_PANTS'];

export type ProvisionalCapacityBucketInput = {
  family: ProvisionalFamily;
  age: 'ADULT'|'KIDS';
  sourceSize: string;
  bookingSize: string|null;
  quantity: number;
  provenance: string;
};

/** A distinct, explicitly non-REAL_DATA source registration. Never touches
 * real_inventory_sources/real_data_acceptance — see provisional_capacity_sources in migration
 * 0041. Owner-approved provisional-capacity classification and LOWER_BOUND_MAY_INCREASE count
 * semantics are fixed by the DB schema itself, not chosen here. */
export class ProvisionalCapacitySourceOperations {
  constructor(private ctx: OperationsContext) {}

  async register(key: string, value: unknown) {
    flowId(key);
    if (!value || typeof value !== 'object') throw new FlowError('INVALID_INPUT', 422);
    const v = value as {sourceSha256?: unknown; originalFilename?: unknown; buckets?: unknown};
    if (typeof v.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceSha256)) throw new FlowError('PROVISIONAL_SOURCE_SHA256_INVALID', 422);
    if (typeof v.originalFilename !== 'string' || v.originalFilename.length < 1 || v.originalFilename.length > 300) throw new FlowError('PROVISIONAL_SOURCE_FILENAME_INVALID', 422);
    if (!Array.isArray(v.buckets) || v.buckets.length === 0) throw new FlowError('PROVISIONAL_SOURCE_EMPTY', 422);
    const buckets = v.buckets.map(validateBucket);
    const p = await this.ctx.authorize('INVENTORY_EDIT');
    if (p.scope !== 'ALL') throw new FlowError('FORBIDDEN', 403);
    return this.ctx.transaction('INVENTORY_EDIT', [], 'PROVISIONAL_CAPACITY_SOURCE_REGISTER', (c) => this.ctx.idempotent(c, key, v, async () => {
      // V2 (TD correction): the function is now SECURITY DEFINER and reads the actor from the
      // already-authenticated zao.actor session setting (set by ctx.transaction() below) — no
      // caller-supplied actor parameter exists anymore.
      const row = (await c.query<{provisional_capacity_register_source: string}>(
        'SELECT provisional_capacity_register_source($1,$2,$3::jsonb) AS provisional_capacity_register_source',
        [v.sourceSha256, v.originalFilename, JSON.stringify(buckets.map((b) => ({family: b.family, age: b.age, source_size: b.sourceSize, booking_size: b.bookingSize, size_mapping_status: b.bookingSize ? 'MAPPED' : 'UNRESOLVED', quantity: b.quantity, provenance: b.provenance})))],
      )).rows[0]!;
      return {sourceId: row.provisional_capacity_register_source, buckets: buckets.length, totalQuantity: buckets.reduce((sum, b) => sum + b.quantity, 0)};
    }));
  }
}

function validateBucket(input: unknown): ProvisionalCapacityBucketInput {
  if (!input || typeof input !== 'object') throw new FlowError('PROVISIONAL_BUCKET_INVALID', 422);
  const b = input as Record<string, unknown>;
  if (typeof b.family !== 'string' || !FAMILIES.includes(b.family as ProvisionalFamily)) throw new FlowError('PROVISIONAL_BUCKET_FAMILY_INVALID', 422);
  if (b.age !== 'ADULT' && b.age !== 'KIDS') throw new FlowError('PROVISIONAL_BUCKET_AGE_INVALID', 422);
  if (typeof b.sourceSize !== 'string' || b.sourceSize.length < 1 || b.sourceSize.length > 32) throw new FlowError('PROVISIONAL_BUCKET_SOURCE_SIZE_INVALID', 422);
  if (b.bookingSize !== null && (typeof b.bookingSize !== 'string' || b.bookingSize.length < 1 || b.bookingSize.length > 32)) throw new FlowError('PROVISIONAL_BUCKET_BOOKING_SIZE_INVALID', 422);
  if (!Number.isInteger(b.quantity) || (b.quantity as number) < 1 || (b.quantity as number) > 100000) throw new FlowError('PROVISIONAL_BUCKET_QUANTITY_INVALID', 422);
  if (typeof b.provenance !== 'string' || b.provenance.length < 1 || b.provenance.length > 300) throw new FlowError('PROVISIONAL_BUCKET_PROVENANCE_INVALID', 422);
  return {family: b.family as ProvisionalFamily, age: b.age, sourceSize: b.sourceSize, bookingSize: b.bookingSize as string|null, quantity: b.quantity as number, provenance: b.provenance};
}
