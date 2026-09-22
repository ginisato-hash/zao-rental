// PROD-R3 (integration-corrected): pure SQL-plan generators for the 11 `productionServices`
// application roles, reusing (not duplicating) the exact grant lists already proven locally in
// scripts/application-roles.ts, guest-roles.ts, content-roles.ts, booking-access-role.ts,
// avatar-read-role.ts and operations-roles.ts. No DB access, no password, no CREATE happens
// here — an operator applies this plan once against the real, fully-migrated (all 40 migrations)
// Production database, then separately provisions each role's real LOGIN password out of band.
//
// The local scripts guard several grants behind a runtime `to_regclass`/`to_regprocedure` check
// because a *local test cluster* may be migrated only partway through migrationPlan at the point
// a test runs. A real Production database is always bootstrapped with the complete, current
// migration set (scripts/production-bootstrap.ts), so every one of those guarded objects always
// exists — this file includes those grants unconditionally, not because the check was removed,
// but because the condition it tests is always true for a genuine Production target.
import type {ProductionService} from '../packages/auth/src/production-config';
const IDENTIFIER=/^[a-z][a-z0-9_]{2,62}$/;
const ZR_PATTERN=/^zr_[a-f0-9]{12}$/;
export function assertProductionDatabaseName(databaseName:string):void{if(!IDENTIFIER.test(databaseName)||ZR_PATTERN.test(databaseName))throw new Error('PRODUCTION_DATABASE_NAME_INVALID');}

export function productionAppRoleNames(databaseName:string):Record<ProductionService,string>{
 assertProductionDatabaseName(databaseName);
 return {
  auth:databaseName+'_auth',ledger:databaseName+'_ledger',hold:databaseName+'_hold',transfer:databaseName+'_transfer',
  pricing:databaseName+'_pricing',recommendation:databaseName+'_recommendation',operations:databaseName+'_operations',
  guest:databaseName+'_guest',content_read:databaseName+'_content_read',avatar_read:databaseName+'_avatar_read',booking_access:databaseName+'_booking_access',
 };
}
export function productionAppRoleCreateSql(databaseName:string):string[]{
 const names=productionAppRoleNames(databaseName);
 return Object.values(names).map(role=>`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`);
}

export function productionAppRoleGrantSql(databaseName:string):string[]{
 const n=productionAppRoleNames(databaseName),sql:string[]=[];
 for(const role of Object.values(n))sql.push(`GRANT CONNECT ON DATABASE ${databaseName} TO ${role}`,`GRANT USAGE ON SCHEMA public TO ${role}`);

 // ---- auth (scripts/application-roles.ts) ----
 sql.push(
  `GRANT SELECT,INSERT,UPDATE,DELETE ON auth_user,auth_session,auth_account,auth_verification TO ${n.auth}`,
  `GRANT SELECT,INSERT,UPDATE ON staff_members TO ${n.auth}`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON staff_store_access,staff_permission_overrides TO ${n.auth}`,
  `GRANT SELECT ON staff_role_permissions,ledger_stores,staff_audit TO ${n.auth}`,
  `GRANT EXECUTE ON FUNCTION staff_log(text,text,text) TO ${n.auth}`,
 );
 // ---- ledger ----
 sql.push(
  `GRANT SELECT,INSERT,UPDATE ON ledger_models,ledger_variants,ledger_assets,ledger_poles,ledger_bundles TO ${n.ledger}`,
  `GRANT SELECT ON inventory_claims,transfer_pieces,transfer_batches TO ${n.ledger}`,
  `GRANT SELECT ON ledger_stores,ledger_records,ledger_bundle_components,ledger_history,ledger_locations TO ${n.ledger}`,
  `GRANT SELECT ON rental_inventory_blocks,rental_loan_items,rental_inspection_events TO ${n.ledger}`,
 );
 // ---- hold ----
 sql.push(
  `GRANT EXECUTE ON FUNCTION inventory_clock() TO ${n.hold}`,
  `GRANT SELECT ON transfer_pieces,transfer_batches TO ${n.hold}`,
  `GRANT SELECT ON ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,inventory_constraints,inventory_history,inventory_replans TO ${n.hold}`,
  `GRANT SELECT,INSERT,UPDATE ON inventory_reservations,inventory_holds,inventory_claims,inventory_requests TO ${n.hold}`,
  `GRANT USAGE ON SEQUENCE inventory_claims_id_seq TO ${n.hold}`,
  `GRANT EXECUTE ON FUNCTION inventory_record_replan(jsonb,jsonb) TO ${n.hold}`,
  `GRANT SELECT ON rental_inventory_blocks,rental_loan_items,rental_inspection_events TO ${n.hold}`,
  `GRANT SELECT(id,hold_id) ON rental_bookings TO ${n.hold}`,
  `GRANT SELECT ON wear_pools,wear_claims,wear_loans,wear_receipts,wear_transfers TO ${n.hold}`,
  `GRANT INSERT,UPDATE(active) ON wear_claims TO ${n.hold}`,
  `GRANT USAGE ON SEQUENCE wear_claims_id_seq TO ${n.hold}`,
  `GRANT SELECT ON guest_contexts,booking_actors TO ${n.hold}`,
 );
 // ---- transfer ----
 sql.push(
  `GRANT EXECUTE ON FUNCTION inventory_clock() TO ${n.transfer}`,
  `GRANT SELECT ON ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,inventory_constraints,inventory_history,inventory_replans TO ${n.transfer}`,
  `GRANT SELECT ON inventory_holds,inventory_claims TO ${n.transfer}`,
  `GRANT UPDATE(state,version,transfer_attention) ON inventory_holds TO ${n.transfer}`,
  `GRANT INSERT,UPDATE(active) ON inventory_claims TO ${n.transfer}`,
  `GRANT USAGE ON SEQUENCE inventory_claims_id_seq TO ${n.transfer}`,
  `GRANT EXECUTE ON FUNCTION inventory_record_replan(jsonb,jsonb) TO ${n.transfer}`,
  `GRANT SELECT,INSERT,UPDATE ON transfer_batches,transfer_pieces,transfer_requests TO ${n.transfer}`,
  `GRANT SELECT ON transfer_history TO ${n.transfer}`,
  `GRANT EXECUTE ON FUNCTION transfer_pool(uuid,text,text),transfer_move_stock(uuid,text,timestamptz) TO ${n.transfer}`,
  `GRANT SELECT ON rental_inventory_blocks,rental_loan_items,rental_inspection_events TO ${n.transfer}`,
  `GRANT SELECT ON wear_pools,wear_claims,wear_loans,wear_receipts,wear_transfers TO ${n.transfer}`,
 );
 // ---- pricing ----
 sql.push(
  `GRANT SELECT,INSERT ON price_admin_requests TO ${n.pricing}`,
  `GRANT SELECT ON staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,ledger_stores,ledger_models,ledger_variants,inventory_holds,inventory_claims,transfer_pieces,transfer_batches,pricing_history TO ${n.pricing}`,
  `GRANT SELECT,INSERT,UPDATE ON price_books TO ${n.pricing}`,
  `GRANT SELECT,INSERT ON price_activations,coupon_versions,price_quotes,coupon_reservations TO ${n.pricing}`,
  `GRANT EXECUTE ON FUNCTION inventory_clock() TO ${n.pricing}`,
  `GRANT SELECT ON guest_contexts,booking_actors TO ${n.pricing}`,
 );
 // ---- recommendation ----
 sql.push(
  `GRANT SELECT ON staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,ledger_stores,ledger_variants,recommendation_history TO ${n.recommendation}`,
  `GRANT SELECT,INSERT ON recommendation_previews TO ${n.recommendation}`,
  `GRANT SELECT,INSERT,UPDATE ON recommendation_selections TO ${n.recommendation}`,
  `GRANT SELECT ON guest_contexts,booking_actors TO ${n.recommendation}`,
  `GRANT EXECUTE ON FUNCTION inventory_clock() TO ${n.recommendation}`,
 );
 // ---- guest (scripts/guest-roles.ts) ----
 sql.push(
  `GRANT SELECT,INSERT ON booking_actors,guest_contexts TO ${n.guest}`,
  `GRANT UPDATE(revoked_at,token_sha256,expires_at) ON guest_contexts TO ${n.guest}`,
  `GRANT SELECT,INSERT,UPDATE ON guest_drafts TO ${n.guest}`,
  `GRANT SELECT,INSERT ON guest_policy_versions TO ${n.guest}`,
  `GRANT SELECT,INSERT ON guest_lifecycle TO ${n.guest}`,
  `GRANT UPDATE(revision,recovery_hash,recovery_until,replay_hash,replay_request,replay_until,retained_at) ON guest_lifecycle TO ${n.guest}`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON guest_rate_buckets TO ${n.guest}`,
  `GRANT SELECT,INSERT ON guest_security_audit TO ${n.guest}`,
  `GRANT USAGE ON SEQUENCE guest_security_audit_id_seq TO ${n.guest}`,
  `GRANT EXECUTE ON FUNCTION inventory_clock() TO ${n.guest}`,
 );
 // ---- content_read (scripts/content-roles.ts — read-only half only; productionServices has
 // no separate content-author service, so the write-side `_content` role is out of this plan's
 // scope) ----
 sql.push(
  `GRANT SELECT ON content_workspace,content_model_previews,content_public_policies,ledger_models,ledger_variants,ledger_assets,content_staff_access,content_media_objects TO ${n.content_read}`,
 );
 // ---- avatar_read (scripts/avatar-read-role.ts) ----
 sql.push(
  `GRANT SELECT ON avatar_current_visuals TO ${n.avatar_read}`,
  `GRANT EXECUTE ON FUNCTION avatar_visual_derivative(uuid,text) TO ${n.avatar_read}`,
 );
 // ---- booking_access (scripts/booking-access-role.ts) ----
 sql.push(
  `GRANT USAGE ON SCHEMA booking_access TO ${n.booking_access}`,
  `GRANT EXECUTE ON FUNCTION booking_access.issue(uuid,text,text,uuid,uuid,text,text),booking_access.read(text),booking_access.revoke(text),booking_access.prepare_recovery(uuid,text,text,uuid,uuid,text,text),booking_access.recovery_delivered(text),booking_access.exchange_recovery(text,uuid,text,text),booking_access.revoke_recovery(text) TO ${n.booking_access}`,
  `GRANT EXECUTE ON FUNCTION booking_access.queue_recovery(uuid,text,text,uuid,uuid,text,text,text),booking_access.request_recovery(uuid,text,uuid,text,text,text) TO ${n.booking_access}`,
 );
 // ---- operations (scripts/operations-roles.ts) ----
 sql.push(
  `GRANT SELECT ON ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,ledger_records,ledger_history,ledger_locations,inventory_reservations,inventory_holds,inventory_claims,inventory_constraints,inventory_replans,inventory_history,transfer_pieces,transfer_batches,price_quotes,price_books,price_activations,rental_bookings,rental_payment_attempts,rental_history,rental_no_pickup_events,rental_custody_events,rental_inspection_events,rental_inventory_blocks,rental_actual_custody,ops_history,ops_collected_payments,foundation_migrations TO ${n.operations}`,
  `GRANT SELECT,INSERT ON ops_financial_alerts,ops_amendment_quotes,ops_amendments,ops_import_stages,ops_import_sources,ops_import_commits,ops_stocktake_reconciliations,ops_requests,rental_preparations,rental_loan_items,rental_return_batches,rental_return_candidates,rental_receipts,rental_inspections,rental_requests TO ${n.operations}`,
  `GRANT SELECT,INSERT,UPDATE ON ops_charge_requests,ops_refund_requests,ops_stocktakes TO ${n.operations}`,
  `GRANT UPDATE(conditions,starts_at,due_at,occupancy_start,occupancy_end,allocation_stage,version) ON inventory_holds TO ${n.operations}`,
  `GRANT INSERT,UPDATE(active) ON inventory_claims,wear_claims TO ${n.operations}`,
  `GRANT SELECT ON wear_claims TO ${n.operations}`,
  `GRANT SELECT,INSERT,UPDATE ON wear_pools,wear_loans,wear_receipts,wear_unresolved_returns,wear_transfers,wear_transfer_receipts,wear_return_batches TO ${n.operations}`,
  `GRANT SELECT,INSERT ON wear_requests,wear_history TO ${n.operations}`,
  `GRANT INSERT ON ledger_assets,ledger_poles TO ${n.operations}`,
  `GRANT UPDATE(status) ON ledger_assets TO ${n.operations}`,
  `GRANT UPDATE(quantity,status) ON ledger_poles TO ${n.operations}`,
  `GRANT UPDATE(version) ON rental_return_batches TO ${n.operations}`,
  `GRANT UPDATE(state,outcome) ON rental_return_candidates TO ${n.operations}`,
  `GRANT USAGE ON SEQUENCE inventory_claims_id_seq,wear_claims_id_seq,wear_history_id_seq TO ${n.operations}`,
  `GRANT EXECUTE ON FUNCTION inventory_clock(),inventory_record_replan(jsonb,jsonb),ops_assert_actor(text,text[],text),rental_apply_receipt(uuid),rental_apply_inspection(uuid),rental_complete_no_pickup(uuid),ops_checkout_amendment(uuid),ops_reconcile_poles(uuid,uuid,integer) TO ${n.operations}`,
  `GRANT EXECUTE ON FUNCTION notification_status(text),notification_resend(uuid,uuid,text,text) TO ${n.operations}`,
  `GRANT EXECUTE ON FUNCTION ops_collect_exceptions(text),ops_list_exceptions(text,text,text,integer,text,timestamptz,uuid),ops_acknowledge_exception(uuid,text,text),ops_observe_signal(text,uuid,text) TO ${n.operations}`,
  `GRANT EXECUTE ON FUNCTION field_acceptance_record(uuid,text,text,text,text,text),field_acceptance_status(uuid,text),real_data_accept(uuid,text[]),real_data_acceptance_status() TO ${n.operations}`,
 );
 return sql;
}
