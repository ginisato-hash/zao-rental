import {createHash,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {migrate,migrationPlan} from '../packages/db/src/index';
import {trackPoolLifecycle} from './pool-lifecycle';
/** Local synthetic logical drill only. This is not a Production backup product and
 * proves no provider PITR, RPO or RTO. It runs against an owned loopback cluster and
 * never accepts an ambient connection string. */
export const BACKUP_LABEL='LOCAL_SYNTHETIC_ONLY';
// Durable contract: rows a restored database must contain to keep its promises.
export const RESTORE_REQUIRED=[
 'public.auth_user','public.staff_members','public.staff_role_permissions','public.staff_store_access','public.staff_permission_overrides','public.staff_audit','public.booking_actors',
 'public.ledger_stores','public.ledger_models','public.ledger_variants','public.ledger_bundles','public.ledger_locations','public.ledger_assets','public.ledger_poles','public.ledger_history','public.ledger_import_receipts',
 'public.inventory_reservations','public.inventory_holds','public.inventory_claims','public.inventory_constraints','public.inventory_history','public.inventory_replans','public.inventory_requests',
 'public.price_books','public.price_activations','public.price_quotes','public.pricing_history','public.coupon_versions','public.coupon_reservations',
 'public.rental_bookings','public.rental_payment_attempts','public.rental_provider_events','public.rental_notifications','public.rental_history','public.rental_requests',
 'public.rental_preparations','public.rental_loan_items','public.rental_receipts','public.rental_inspections','public.rental_inspection_events','public.rental_custody_events','public.rental_no_pickup_events','public.rental_return_batches','public.rental_return_candidates',
 'public.transfer_batches','public.transfer_pieces','public.transfer_history','public.transfer_requests',
 'public.wear_pools','public.wear_claims','public.wear_loans','public.wear_receipts','public.wear_return_batches','public.wear_transfers','public.wear_transfer_receipts','public.wear_unresolved_returns','public.wear_history','public.wear_requests',
 'public.ops_amendments','public.ops_amendment_quotes','public.ops_charge_requests','public.ops_refund_requests','public.ops_financial_alerts','public.ops_history','public.ops_stocktakes','public.ops_stocktake_reconciliations','public.ops_receipt_terms','public.ops_exceptions','public.field_acceptance_records','public.ops_import_sources','public.ops_import_stages','public.ops_import_commits','public.real_inventory_sources','public.real_data_acceptance',
 'public.booking_notification_outbox',
 'square_webhook.inbox','payment_reconciliation.streams','payment_reconciliation.jobs','payment_reconciliation.events','payment_reconciliation.audit','payment_reconciliation.provider_stops',
] as const;
/** Deliberately not restored. Each entry names why the row cannot or must not come back. */
export const NOT_RESTORED:Record<string,string>={
 'public.auth_account':'CREDENTIAL_MATERIAL_REVOKED_AND_REISSUED','public.auth_session':'SESSION_REVOKED_STAFF_SIGN_IN_AGAIN','public.auth_verification':'EPHEMERAL_VERIFICATION_REISSUED',
 'booking_access.capabilities':'BEARER_PROOF_REVOKED','booking_access.recoveries':'RECOVERY_PROOF_REVOKED_GUEST_REQUESTS_AGAIN','booking_access.audit':'REFERENCES_REVOKED_PROOFS','booking_access.recovery_audit':'REFERENCES_REVOKED_PROOFS',
 'public.guest_contexts':'EPHEMERAL_GUEST_SESSION','public.guest_drafts':'EPHEMERAL_GUEST_DRAFT','public.guest_lifecycle':'EPHEMERAL_GUEST_SESSION','public.guest_rate_buckets':'EPHEMERAL_RATE_WINDOW','public.guest_security_audit':'REFERENCES_EPHEMERAL_GUEST_SESSION','public.guest_policy_versions':'RECREATED_BY_MIGRATION',
 'public.recommendation_previews':'REGENERATED_FROM_CATALOG','public.recommendation_selections':'REGENERATED_FROM_CATALOG','public.recommendation_history':'REGENERATED_FROM_CATALOG',
 'public.ops_requests':'IDEMPOTENCY_CACHE_REGENERATED','public.price_admin_requests':'IDEMPOTENCY_CACHE_REGENERATED','public.telemetry_events':'OBSERVABILITY_ONLY',
 'public.content_workspace':'CONTENT_PIPELINE_OUT_OF_SCOPE','public.content_revision_records':'CONTENT_PIPELINE_OUT_OF_SCOPE','public.content_audit_records':'CONTENT_PIPELINE_OUT_OF_SCOPE','public.content_media_objects':'RAW_OBJECT_STORE_OUT_OF_SCOPE','public.content_model_previews':'CONTENT_PIPELINE_OUT_OF_SCOPE','public.content_outbox':'CONTENT_PIPELINE_OUT_OF_SCOPE','public.content_public_policies':'CONTENT_PIPELINE_OUT_OF_SCOPE','public.content_staff_access':'CONTENT_PIPELINE_OUT_OF_SCOPE',
 'public.avatar_visuals':'MEDIA_DERIVATIVE_REBUILT','public.sandbox_activation_calls':'ACTIVATION_EVIDENCE_OUT_OF_SCOPE','public.sandbox_activation_runs':'ACTIVATION_EVIDENCE_OUT_OF_SCOPE',
 'public.foundation_metadata':'RECREATED_BY_MIGRATION','public.foundation_migrations':'RECREATED_BY_MIGRATION',
 'rental_internal.effects':'IN_TRANSACTION_EFFECT_ONLY','rental_internal.amendment_effects':'IN_TRANSACTION_EFFECT_ONLY','rental_internal.stocktake_effects':'IN_TRANSACTION_EFFECT_ONLY',
 'payment_projection.events':'REDERIVED_FROM_RECONCILIATION','payment_projection.heads':'REDERIVED_FROM_RECONCILIATION','payment_projection.job_receipts':'REDERIVED_FROM_RECONCILIATION',
 'r15_activation.manifest':'ACTIVATION_EVIDENCE_OUT_OF_SCOPE','r15_activation.operations':'ACTIVATION_EVIDENCE_OUT_OF_SCOPE',
};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const owned=(identity:{namespace:string;database:string})=>/^zr_[a-f0-9]{12}$/.test(identity.namespace)&&identity.database===identity.namespace;
async function tables(pool:Pool){return (await pool.query<{t:string}>("SELECT table_schema||'.'||table_name t FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1")).rows.map(r=>r.t);}
export type BackupEnvelope={label:string;sourceIdentity:string;migrations:{id:string;checksum:string}[];tables:{name:string;rows:unknown[]}[];excluded:Record<string,string>;sha256:string};
/** Exports the durable contract from an owned database. Every existing table must be
 * classified, so a new table is never silently carried or silently dropped. */
export async function exportOwnedDatabase(pool:Pool,identity:{namespace:string;database:string}):Promise<BackupEnvelope>{
 if(!owned(identity))throw new Error('UNOWNED_SOURCE_REFUSED');
 const present=await tables(pool),classified=new Set<string>([...RESTORE_REQUIRED,...Object.keys(NOT_RESTORED)]);
 const unclassified=present.filter(t=>!classified.has(t));
 if(unclassified.length)throw new Error('BACKUP_SCOPE_UNCLASSIFIED '+unclassified.join(','));
 const missing=RESTORE_REQUIRED.filter(t=>!present.includes(t));
 if(missing.length)throw new Error('BACKUP_SCOPE_MISSING '+missing.join(','));
 const registry=(await pool.query<{id:string;checksum:string}>('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
 if(registry.length!==migrationPlan.length||registry.some((r,i)=>r.id!==migrationPlan[i]!.id))throw new Error('BACKUP_MIGRATION_REGISTRY_UNEXPECTED');
 // An active reconciliation lease is contractual state; never reset it silently.
 if(Number((await pool.query("SELECT count(*)::int n FROM payment_reconciliation.jobs WHERE lease_token IS NOT NULL")).rows[0].n))throw new Error('BACKUP_ACTIVE_LEASE_REFUSED');
 if(Number((await pool.query("SELECT count(*)::int n FROM booking_notification_outbox WHERE status='SENDING'")).rows[0].n))throw new Error('BACKUP_ACTIVE_DELIVERY_REFUSED');
 const out:{name:string;rows:unknown[]}[]=[];
 for(const name of RESTORE_REQUIRED){
  // Recovery deliveries depend on proofs this drill deliberately revokes.
  const predicate=name==='public.booking_notification_outbox'?" WHERE event_type<>'BOOKING_RECOVERY'":'';
  out.push({name,rows:(await pool.query(`SELECT to_jsonb(t) v FROM ${name} t${predicate} ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.v)});
 }
 const body={label:BACKUP_LABEL,sourceIdentity:identity.database,migrations:registry,tables:out,excluded:NOT_RESTORED};
 return {...body,sha256:hash(JSON.stringify(body))};
}
export function verifyEnvelope(envelope:BackupEnvelope){
 const {sha256,...body}=envelope;
 if(envelope.label!==BACKUP_LABEL||hash(JSON.stringify(body))!==sha256)throw new Error('BACKUP_INTEGRITY_REFUSED');
 if(envelope.migrations.length!==migrationPlan.length||envelope.migrations.some((m,i)=>m.id!==migrationPlan[i]!.id))throw new Error('BACKUP_MIGRATION_DRIFT_REFUSED');
 if(envelope.tables.some(t=>!(RESTORE_REQUIRED as readonly string[]).includes(t.name)))throw new Error('BACKUP_SCOPE_REFUSED');
 return true;
}
/** Restores into a brand new empty database in the same owned cluster. */
export async function restoreIntoFreshDatabase(owner:Pool,identity:{namespace:string;database:string;dbPort:number;user:string},envelope:BackupEnvelope){
 if(!owned(identity))throw new Error('UNOWNED_SOURCE_REFUSED');
 verifyEnvelope(envelope);
 if(envelope.sourceIdentity===identity.database+'_restored')throw new Error('RESTORE_TARGET_CONFLICT');
 const target='zr_'+randomBytes(6).toString('hex');
 await owner.query(`CREATE DATABASE ${target}`);
 // Same owned loopback cluster and credentials as the source; no ambient URL is read.
 const source=owner.options as {password?:string};
 const pool=new Pool({host:'127.0.0.1',port:identity.dbPort,user:identity.user,password:source.password,database:target,max:4});
 const close=trackPoolLifecycle(pool);
 try{
  await migrate(pool);
  const registry=(await pool.query<{id:string;checksum:string}>('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  if(registry.length!==envelope.migrations.length||registry.some((r,i)=>r.id!==envelope.migrations[i]!.id||r.checksum!==envelope.migrations[i]!.checksum))throw new Error('RESTORE_MIGRATION_MISMATCH');
  // Stored generated columns are recomputed by the schema; ALWAYS identity columns need
  // an explicit override so restored keys keep their original values.
  const meta=new Map<string,{generated:Set<string>;json:Set<string>;identity:boolean}>();
  for(const col of (await pool.query<{t:string;column_name:string;data_type:string;is_generated:string;is_identity:string;identity_generation:string|null}>("SELECT table_schema||'.'||table_name t,column_name,data_type,is_generated,is_identity,identity_generation FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows){
   const entry=meta.get(col.t)??{generated:new Set<string>(),json:new Set<string>(),identity:false};
   if(col.is_generated==='ALWAYS')entry.generated.add(col.column_name);
   // A jsonb column holding a primitive must still arrive as JSON text, not bare text.
   if(col.data_type==='jsonb'||col.data_type==='json')entry.json.add(col.column_name);
   if(col.is_identity==='YES'&&col.identity_generation==='ALWAYS')entry.identity=true;
   meta.set(col.t,entry);
  }
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   // Owned local transaction only: suppress operator triggers so immutable/audit rows
   // are restored exactly as captured rather than re-derived.
   await c.query("SET LOCAL session_replication_role='replica'");
   // The envelope is authoritative for everything in restore scope, so migration-seeded
   // rows are replaced rather than merged. Relationship checks are re-proved after commit.
   for(const {name} of [...envelope.tables].reverse())await c.query(`DELETE FROM ${name}`);
   for(const {name,rows} of envelope.tables)for(const row of rows){
    const record=row as Record<string,unknown>,shape=meta.get(name)??{generated:new Set<string>(),json:new Set<string>(),identity:false};
    const keys=Object.keys(record).filter(k=>!shape.generated.has(k));
    const columns=keys.map(k=>'"'+k.replace(/"/g,'""')+'"').join(','),placeholders=keys.map((_,i)=>'$'+(i+1)).join(',');
    await c.query(`INSERT INTO ${name}(${columns})${shape.identity?' OVERRIDING SYSTEM VALUE':''} VALUES(${placeholders})`,keys.map(k=>shape.json.has(k)&&record[k]!==null&&record[k]!==undefined?JSON.stringify(record[k]):record[k]));
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await validateRestored(pool);
  return {database:target,pool,async stop(){await close();}};
 }catch(e){await close();await owner.query(`DROP DATABASE IF EXISTS ${target}`);throw e;}
}
/** Explicit relationship proof: VALIDATE CONSTRAINT is not enough for constraints the
 * catalogue already considers valid, so every foreign key is re-checked by anti-join. */
export async function validateRestored(pool:Pool){
 const constraints=(await pool.query<{name:string;child:string;parent:string;childcols:string[];parentcols:string[]}>(`
  SELECT c.conname name,cn.nspname||'.'||cl.relname child,pn.nspname||'.'||pr.relname parent,
   (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(att,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.att) childcols,
   (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(att,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.att) parentcols
  FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=cl.relnamespace
  JOIN pg_class pr ON pr.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=pr.relnamespace
  WHERE c.contype='f' AND cn.nspname NOT IN ('pg_catalog','information_schema')`)).rows;
 let checked=0;
 for(const k of constraints){
  const on=k.childcols.map((col,i)=>`p."${k.parentcols[i]}"=ch."${col}"`).join(' AND ');
  const notNull=k.childcols.map(col=>`ch."${col}" IS NOT NULL`).join(' AND ');
  const orphans=Number((await pool.query(`SELECT count(*)::int n FROM ${k.child} ch WHERE ${notNull} AND NOT EXISTS(SELECT 1 FROM ${k.parent} p WHERE ${on})`)).rows[0].n);
  if(orphans)throw new Error('RESTORE_FOREIGN_KEY_ORPHAN '+k.name);
  checked++;
 }
 // Identity/serial columns must continue past restored rows instead of colliding.
 const sequences=(await pool.query<{seq:string;tbl:string;col:string}>(`
  SELECT n.nspname||'.'||s.relname seq,tn.nspname||'.'||t.relname tbl,a.attname col
  FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass
  JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace tn ON tn.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
  WHERE s.relkind='S' AND tn.nspname NOT IN ('pg_catalog','information_schema')`)).rows;
 let advanced=0;
 for(const s of sequences){
  const max=(await pool.query(`SELECT max("${s.col}") m FROM ${s.tbl}`)).rows[0].m;
  if(max===null||max===undefined)continue;
  await pool.query(`SELECT setval('${s.seq}',GREATEST((SELECT last_value FROM ${s.seq}),$1::bigint))`,[max]);
  const next=Number((await pool.query(`SELECT nextval('${s.seq}') v`)).rows[0].v);
  if(next<=Number(max))throw new Error('RESTORE_SEQUENCE_COLLISION '+s.seq);
  advanced++;
 }
 return {foreignKeys:checked,sequences:advanced};
}
/** Contract-critical rows compared verbatim between source and restored database. */
export const CRITICAL=['public.rental_bookings','public.price_quotes','public.rental_payment_attempts','public.inventory_holds','public.inventory_claims','public.rental_loan_items','public.rental_receipts','public.transfer_batches','public.transfer_pieces','public.ops_amendments','public.ops_refund_requests','public.ops_exceptions','public.field_acceptance_records','public.real_data_acceptance','public.booking_notification_outbox','public.rental_history','public.ops_history'] as const;
export async function criticalFingerprint(pool:Pool){
 const out:Record<string,{rows:number;sha256:string}>={};
 for(const name of CRITICAL){
  const rows=(await pool.query(`SELECT to_jsonb(t) v FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.v);
  out[name]={rows:rows.length,sha256:hash(JSON.stringify(rows))};
 }
 return out;
}
