// R67 deterministic catalog/pole activation operator (Production use only under TD direction).
//   R67_OWNER_DATABASE_URL=… R67_ACTOR=<staff_members.id> node --import tsx scripts/r67-catalog-activate.ts plan
//   … apply
// plan  = runs the exact activation inside one transaction and ROLLS BACK (prints the report + invariants).
// apply = same transaction, COMMIT only if every invariant holds. Idempotent: a second apply inserts nothing.
// Never creates ledger_assets/ledger_poles, never edits a source bucket, binds no Premium model (Owner 2026-10-15).
import {Client} from 'pg';
import {activateProvisionalCatalog,SOURCE_A_SHA256,SOURCE_B_SHA256} from '../packages/core/src/operations/provisional-catalog-bridge';

const mode=process.argv[2];if(mode!=='plan'&&mode!=='apply')throw new Error('USAGE: plan|apply');
const url=process.env.R67_OWNER_DATABASE_URL,actor=process.env.R67_ACTOR;if(!url||!actor)throw new Error('R67_OWNER_DATABASE_URL and R67_ACTOR are required');
const c=new Client({connectionString:url});await c.connect();
const snapshot=async()=>(await c.query(`SELECT (SELECT max(id) FROM foundation_migrations) latest,(SELECT count(*)::int FROM foundation_migrations) registry,
 (SELECT count(*)::int FROM ledger_assets) assets,(SELECT count(*)::int FROM ledger_poles) poles,
 (SELECT count(*)::int FROM ledger_variants WHERE family IN ('WEAR_JACKET','WEAR_PANTS')) wear_variants,
 (SELECT count(*)::int FROM rental_bookings) bookings,(SELECT count(*)::int FROM provisional_capacity_claims) claims,
 (SELECT coalesce(sum(provisional_capacity_effective_quantity(b.id)),0)::int FROM provisional_capacity_buckets b JOIN provisional_capacity_sources s ON s.id=b.source_id WHERE s.source_sha256=ANY($1::text[])) source_ab_quantity`,[[SOURCE_A_SHA256,SOURCE_B_SHA256]])).rows[0];
try{
 const before=await snapshot();if(before.latest!=='0058')throw new Error('REGISTRY_NOT_AT_0058 '+before.latest);
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='60000ms'");
 await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','R67 provisional catalog bridge activation',true)",[actor]);
 const report=await activateProvisionalCatalog(c);
 const after=await snapshot();
 const invariants={fakeAssets:after.assets===before.assets,fakePoles:after.poles===before.poles,wearUnchanged:after.wear_variants===before.wear_variants,
  sourceABUnchanged:after.source_ab_quantity===before.source_ab_quantity,bookingsUnchanged:after.bookings===before.bookings,claimsUnchanged:after.claims===before.claims,noPremiumBinding:report.bindingsCreated===0};
 const ok=Object.values(invariants).every(Boolean);
 console.log(JSON.stringify({mode,before,after,report:{...report,bindings:report.bindings.length},invariants,ok},null,1));
 if(mode==='apply'&&ok)await c.query('COMMIT');else await c.query('ROLLBACK');
 if(!ok)process.exitCode=1;
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
