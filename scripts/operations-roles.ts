import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
// Local launcher only, after migration0033. Does not alter the six existing roles,
// the flow role, or any hosted credential. The web child never receives owner access.
export async function provisionOperationsRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace||!Number.isInteger(identity.dbPort)||identity.dbPort<20000||identity.dbPort>29000)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_operations',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
 await owner.query(`GRANT SELECT ON ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,ledger_records,ledger_history,ledger_locations,inventory_reservations,inventory_holds,inventory_claims,inventory_constraints,inventory_replans,inventory_history,transfer_pieces,transfer_batches,price_quotes,price_books,price_activations,rental_bookings,rental_payment_attempts,rental_history,rental_no_pickup_events,rental_custody_events,rental_inspection_events,rental_inventory_blocks,rental_actual_custody,ops_history,ops_collected_payments TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON ops_financial_alerts,ops_amendment_quotes,ops_amendments,ops_import_stages,ops_import_sources,ops_import_commits,ops_stocktake_reconciliations,ops_requests,rental_preparations,rental_loan_items,rental_return_batches,rental_return_candidates,rental_receipts,rental_inspections,rental_requests TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT,UPDATE ON ops_charge_requests,ops_refund_requests,ops_stocktakes TO ${user}`);
 await owner.query(`GRANT UPDATE(conditions,starts_at,due_at,occupancy_start,occupancy_end,allocation_stage,version) ON inventory_holds TO ${user}`);
 await owner.query(`GRANT INSERT,UPDATE(active) ON inventory_claims,wear_claims TO ${user}`);
 await owner.query(`GRANT SELECT ON wear_claims TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT,UPDATE ON wear_pools,wear_loans,wear_receipts,wear_unresolved_returns,wear_transfers,wear_transfer_receipts,wear_return_batches TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON wear_requests,wear_history TO ${user}`);
 await owner.query(`GRANT INSERT ON ledger_assets,ledger_poles TO ${user}`);
 await owner.query(`GRANT UPDATE(status) ON ledger_assets TO ${user}`);
 await owner.query(`GRANT UPDATE(quantity,status) ON ledger_poles TO ${user}`);
 await owner.query(`GRANT UPDATE(version) ON rental_return_batches TO ${user}`);
 await owner.query(`GRANT UPDATE(state,outcome) ON rental_return_candidates TO ${user}`);
 await owner.query(`GRANT USAGE ON SEQUENCE inventory_claims_id_seq,wear_claims_id_seq,wear_history_id_seq TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION inventory_clock(),inventory_record_replan(jsonb,jsonb),ops_assert_actor(text,text[],text),rental_apply_receipt(uuid),rental_apply_inspection(uuid),rental_complete_no_pickup(uuid),ops_checkout_amendment(uuid),ops_reconcile_poles(uuid,uuid,integer) TO ${user}`);
 if((await owner.query("SELECT to_regprocedure('notification_status(text)') v")).rows[0].v)await owner.query(`GRANT EXECUTE ON FUNCTION notification_status(text),notification_resend(uuid,uuid,text,text) TO ${user}`);
 // The console functions are SECURITY DEFINER, so the role needs execute rights only
 // and never direct access to ops_exceptions or the source projection.
 if((await owner.query("SELECT to_regprocedure('ops_list_exceptions(text,text,text,integer,text,timestamptz,uuid)') v")).rows[0].v)await owner.query(`GRANT EXECUTE ON FUNCTION ops_collect_exceptions(text),ops_list_exceptions(text,text,text,integer,text,timestamptz,uuid),ops_acknowledge_exception(uuid,text,text),ops_observe_signal(text,uuid,text) TO ${user}`);
 const operationsDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};const operationsPool=new Pool({...operationsDb,max:4,connectionTimeoutMillis:2000});
 return {operationsDb,operationsPool,close:trackPoolLifecycle(operationsPool)};
}
