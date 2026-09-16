import {randomBytes} from 'node:crypto';
import type {Pool,PoolConfig} from 'pg';
import {phase6Services,phase6Role,phase6Database,phase6Endpoint,type Phase6Service} from '../packages/auth/src/hosted-preview-config';
/** Narrow subset of canonical guest/application/content role grants. Phase6 does not
 * checkout, create HOLD/quotes or write inventory. Those canonical write grants are omitted. */
export function avatarHostedGrants(role:(s:Phase6Service)=>string){
 const g=role('guest'),h=role('hold'),p=role('pricing'),r=role('recommendation'),c=role('content_read'),a=role('avatar_read');
 return [
 `GRANT SELECT,INSERT ON booking_actors,guest_contexts TO ${g}`,
 `GRANT UPDATE(revoked_at,token_sha256,expires_at) ON guest_contexts TO ${g}`,
 `GRANT SELECT,INSERT,UPDATE ON guest_drafts TO ${g}`,
 `GRANT SELECT,INSERT ON guest_policy_versions,guest_lifecycle,guest_security_audit TO ${g}`,
 `GRANT UPDATE(revision,recovery_hash,recovery_until,replay_hash,replay_request,replay_until,retained_at) ON guest_lifecycle TO ${g}`,
 `GRANT SELECT,INSERT,UPDATE,DELETE ON guest_rate_buckets TO ${g}`,
 `GRANT USAGE ON SEQUENCE guest_security_audit_id_seq TO ${g}`,
 ...[g,h,p,r].map(x=>`GRANT EXECUTE ON FUNCTION inventory_clock() TO ${x}`),
 ...[h,p,r].map(x=>`GRANT SELECT ON guest_contexts,booking_actors,staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,ledger_stores,ledger_variants TO ${x}`),
 `GRANT SELECT ON ledger_models,ledger_assets,ledger_poles,transfer_pieces,transfer_batches,inventory_constraints,inventory_history,inventory_replans,inventory_reservations,inventory_holds,inventory_claims,inventory_requests,wear_pools,wear_claims,wear_loans,wear_receipts,wear_transfers,rental_inventory_blocks,rental_loan_items,rental_inspection_events TO ${h}`,
 `GRANT SELECT(id,hold_id) ON rental_bookings TO ${h}`,
 `GRANT SELECT ON ledger_models,inventory_holds,inventory_claims,transfer_pieces,transfer_batches,pricing_history,price_books,price_activations,coupon_versions,price_quotes,coupon_reservations TO ${p}`,
 `GRANT SELECT ON recommendation_history,recommendation_selections TO ${r}`,
 `GRANT SELECT,INSERT ON recommendation_previews TO ${r}`,
 `GRANT SELECT ON content_workspace,content_model_previews,content_public_policies,ledger_models,ledger_variants,ledger_assets,content_media_objects TO ${c}`,
 `GRANT SELECT ON avatar_current_visuals TO ${a}`,
 `GRANT EXECUTE ON FUNCTION avatar_visual_derivative(uuid,text) TO ${a}`,
 ];
}
export async function provisionHostedAvatarRoles(owner:Pool){
 if(process.env.NODE_ENV==='production'||owner.options.database!==phase6Database||owner.options.user!=='neondb_owner'||!owner.options.host?.startsWith(phase6Endpoint+'.')||typeof owner.options.ssl!=='object'||owner.options.ssl.rejectUnauthorized!==true)throw Error('PHASE6_SETUP_OWNER_REQUIRED');
 const actual=(await owner.query('SELECT current_database() db,current_user role')).rows[0];if(actual.db!==phase6Database||actual.role!=='neondb_owner')throw Error('PHASE6_SETUP_IDENTITY');
 const c=await owner.connect(),configs={} as Record<Phase6Service,PoolConfig>;
 try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");
  await c.query('SELECT pg_advisory_xact_lock(71820606)');
  if((await c.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[phase6Services.map(phase6Role)])).rowCount)throw Error('PHASE6_EXISTING_ROLES_RECONCILE');
  for(const service of phase6Services){const user=phase6Role(service),password=randomBytes(32).toString('hex');
   await c.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
   await c.query(`GRANT CONNECT ON DATABASE ${phase6Database} TO ${user}`);await c.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
   configs[service]={host:owner.options.host,port:5432,database:phase6Database,user,password,ssl:{rejectUnauthorized:true}};
  }
  for(const grant of avatarHostedGrants(phase6Role))await c.query(grant);
  await c.query('COMMIT');return configs;
 }catch{await c.query('ROLLBACK').catch(()=>{});throw Error('PHASE6_ROLE_SETUP_FAILED_RECONCILE');}finally{c.release();}
}
