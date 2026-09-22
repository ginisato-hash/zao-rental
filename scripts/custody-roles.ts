import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
export async function provisionCustodyRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_custody',password=randomBytes(24).toString('hex');
 await owner.query(`ALTER ROLE ${user} LOGIN PASSWORD '${password}'`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);
 await owner.query(`GRANT SELECT ON rental_bookings,rental_payment_attempts,rental_history,inventory_holds,inventory_claims,inventory_constraints,ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,transfer_pieces,transfer_batches,wear_claims,rental_custody_events,rental_inspection_events,rental_inventory_blocks,rental_actual_custody TO ${user}`);
 // verifyClaims()/verifyPhysicalHandoff() (booking-service.ts, extended by custody-service.ts's
 // prepare()/checkout()) read provisional_capacity_claims — accept a provisional-backed
 // reservation, fail closed at physical handoff while any claim here is still ACTIVE.
 if((await owner.query("SELECT to_regclass('public.provisional_capacity_claims') IS NOT NULL AS present")).rows[0].present)await owner.query(`GRANT SELECT ON provisional_capacity_claims TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON rental_preparations,rental_loan_items,rental_return_batches,rental_return_candidates,rental_receipts,rental_inspections,rental_requests TO ${user}`);
 await owner.query(`GRANT UPDATE(version) ON rental_return_batches TO ${user}`);
 await owner.query(`GRANT UPDATE(state,outcome) ON rental_return_candidates TO ${user}`);
 await owner.query(`GRANT UPDATE(allocation_stage,version) ON inventory_holds TO ${user}`);
 const custodyDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};const custodyPool=new Pool({...custodyDb,max:4,connectionTimeoutMillis:2000});return {custodyDb,custodyPool,close:trackPoolLifecycle(custodyPool)};
}
