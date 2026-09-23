import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
// New purpose-specific DEVELOPMENT role; existing auth/ledger/HOLD roles gain no grants.
export async function provisionFlowRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_flow',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
 await owner.query(`GRANT SELECT ON inventory_reservations,inventory_holds,inventory_claims,inventory_constraints,price_quotes,ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,transfer_pieces,transfer_batches,rental_history TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT,UPDATE ON rental_bookings,rental_payment_attempts TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON rental_provider_events,rental_notifications,rental_requests TO ${user}`);
 await owner.query(`GRANT UPDATE(payment_state,confirmed_at,version) ON inventory_holds TO ${user}`);
 // Owner-adopted quantity-wear development tables only. No additional writes to
 // equipment ledger, old custody tables, authentication tables or production roles.
 await owner.query(`GRANT SELECT,INSERT,UPDATE ON wear_loans,wear_receipts,wear_unresolved_returns,wear_transfers,wear_transfer_receipts,wear_return_batches TO ${user}`);
 await owner.query(`GRANT SELECT ON wear_pools TO ${user}`);
 if((await owner.query("SELECT to_regprocedure('wear_pool_apply(uuid,text,integer,uuid)') IS NOT NULL AS present")).rows[0].present)await owner.query(`GRANT EXECUTE ON FUNCTION wear_pool_create(uuid,uuid,text,text),wear_pool_apply(uuid,text,integer,uuid) TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON wear_requests,wear_history TO ${user}`);
 await owner.query(`GRANT SELECT ON wear_claims TO ${user}`);
 // verifyClaims()/verifyPhysicalHandoff() (booking-service.ts) read provisional_capacity_claims
 // to accept a provisional-backed reservation at booking time and fail closed at handoff.
 if((await owner.query("SELECT to_regclass('public.provisional_capacity_claims') IS NOT NULL AS present")).rows[0].present)await owner.query(`GRANT SELECT ON provisional_capacity_claims TO ${user}`);
 await owner.query(`GRANT USAGE ON SEQUENCE wear_history_id_seq TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION inventory_clock() TO ${user}`);
 if((await owner.query("SELECT to_regprocedure('notification_enqueue_confirmed(uuid)') v")).rows[0].v)await owner.query(`GRANT EXECUTE ON FUNCTION notification_enqueue_confirmed(uuid) TO ${user}`);
 for(const table of ['provisional_capacity_buckets','inventory_pole_exemptions']){
  if((await owner.query('SELECT to_regclass($1) IS NOT NULL AS present',['public.'+table])).rows[0].present)await owner.query(`GRANT SELECT ON ${table} TO ${user}`);
 }
 if((await owner.query("SELECT to_regprocedure('booking_cancel(uuid,uuid,jsonb)') v")).rows[0].v)await owner.query(`GRANT EXECUTE ON FUNCTION booking_cancellation_preview(uuid),booking_cancellation_status(uuid),booking_cancellation_payment_observed(uuid),booking_cancel(uuid,uuid,jsonb),cancellation_refund_row(uuid),cancellation_refund_claim(uuid),cancellation_refund_observe(uuid,jsonb) TO ${user}`);
 const flowDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};const flowPool=new Pool({...flowDb,max:4,connectionTimeoutMillis:2000});const close=trackPoolLifecycle(flowPool);return {flowDb,flowPool,close};
}
