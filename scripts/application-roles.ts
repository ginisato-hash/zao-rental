import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
// Only called on the owned, fresh local cluster after migrations; never against an ambient URL.
export async function provisionApplicationRoles(owner:Pool,identity:{namespace:string;database:string;dbPort:number}) {
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const hasWear=(await owner.query("SELECT to_regclass('public.wear_pools') IS NOT NULL AND to_regclass('public.wear_claims') IS NOT NULL AS present")).rows[0].present;
 const hasProvisional=(await owner.query("SELECT to_regclass('public.provisional_capacity_buckets') IS NOT NULL AND to_regclass('public.provisional_capacity_claims') IS NOT NULL AS present")).rows[0].present;
 const connections:Connection[]=[];
 for(const suffix of ['auth','ledger','hold','transfer','pricing','recommendation']) {
  const user=`${identity.namespace}_${suffix}`,password=randomBytes(24).toString('hex');
  // Identifiers/password below are generated locally and strictly restricted, not task/user input.
  await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
  const tables=suffix==='auth'?['auth_user','auth_session','auth_account','auth_verification']:['ledger_models','ledger_variants','ledger_assets','ledger_poles','ledger_bundles'];
  if(suffix==='auth'||suffix==='ledger')await owner.query(`GRANT SELECT,INSERT,UPDATE${suffix==='auth'?',DELETE':''} ON ${tables.join(',')} TO ${user}`);
  if(suffix==='ledger')await owner.query(`GRANT SELECT ON inventory_claims,transfer_pieces,transfer_batches TO ${user}`);
  if(suffix==='ledger')await owner.query(`GRANT SELECT ON ledger_stores,ledger_records,ledger_bundle_components,ledger_history,ledger_locations TO ${user}`);
  if(suffix==='auth'){
   await owner.query(`GRANT SELECT,INSERT,UPDATE ON staff_members TO ${user}`);
   await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON staff_store_access,staff_permission_overrides TO ${user}`);
   await owner.query(`GRANT SELECT ON staff_role_permissions,ledger_stores,staff_audit TO ${user}`);
   await owner.query(`GRANT EXECUTE ON FUNCTION staff_log(text,text,text) TO ${user}`);
  }
  if(suffix==='hold'||suffix==='transfer'){
   await owner.query(`GRANT EXECUTE ON FUNCTION inventory_clock() TO ${user}`);
   await owner.query(`GRANT SELECT ON transfer_pieces,transfer_batches TO ${user}`);
   await owner.query(`GRANT SELECT ON ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,inventory_constraints,inventory_history,inventory_replans TO ${user}`);
   if(suffix==='hold')await owner.query(`GRANT SELECT,INSERT,UPDATE ON inventory_reservations,inventory_holds,inventory_claims,inventory_requests TO ${user}`);
   else{await owner.query(`GRANT SELECT ON inventory_holds,inventory_claims TO ${user}`);await owner.query(`GRANT UPDATE(state,version,transfer_attention) ON inventory_holds TO ${user}`);await owner.query(`GRANT INSERT,UPDATE(active) ON inventory_claims TO ${user}`);}
   await owner.query(`GRANT USAGE ON SEQUENCE inventory_claims_id_seq TO ${user}`);
   await owner.query(`GRANT EXECUTE ON FUNCTION inventory_record_replan(jsonb,jsonb) TO ${user}`);
   // 95% public / staff INVENTORY_BUFFER_OVERRIDE audit log (0042_inventory_buffer_override.sql):
   // HoldService is the only caller — never transfer, which never creates/amends a hold under override.
   // Guarded like every other post-0004 function grant in this file: migration-prefix upgrade tests
   // provision this role against a database with only an early subset of migrations applied.
   if(suffix==='hold'&&(await owner.query("SELECT to_regprocedure('inventory_buffer_override_record(uuid,text)') v")).rows[0].v)await owner.query(`GRANT EXECUTE ON FUNCTION inventory_buffer_override_record(uuid,text) TO ${user}`);
  }
  if(suffix==='transfer'){await owner.query(`GRANT SELECT,INSERT,UPDATE ON transfer_batches,transfer_pieces,transfer_requests TO ${user}`);await owner.query(`GRANT SELECT ON transfer_history TO ${user}`);await owner.query(`GRANT EXECUTE ON FUNCTION transfer_pool(uuid,text,text),transfer_move_stock(uuid,text,timestamptz) TO ${user}`);}
  // Quantity-wear adds capacity reads/claims to the existing isolated inventory role.
  // Existing table privileges, user permissions and all role defaults stay unchanged.
  if(hasWear&&(suffix==='hold'||suffix==='transfer')){await owner.query(`GRANT SELECT ON wear_pools,wear_claims,wear_loans,wear_receipts,wear_transfers TO ${user}`);}
  if(hasWear&&suffix==='hold'){await owner.query(`GRANT INSERT,UPDATE(active) ON wear_claims TO ${user}`);await owner.query(`GRANT USAGE ON SEQUENCE wear_claims_id_seq TO ${user}`);}
  // Provisional booking-capacity: HoldService reads bucket capacity and writes/releases its own
  // candidate's claims (create/amend/cancel/expiry); TransferService/reconcileLedgerProtection
  // only ever release claims for already-expired holds via expireInventoryHolds, never plan or
  // insert new ones — narrower than hold's own grant, matching the existing wear_claims split.
  if(hasProvisional&&(suffix==='hold'||suffix==='transfer')){await owner.query(`GRANT SELECT,UPDATE(state,released_at) ON provisional_capacity_claims TO ${user}`);}
  if(hasProvisional&&suffix==='hold'){await owner.query(`GRANT SELECT ON provisional_capacity_buckets TO ${user}`);await owner.query(`GRANT INSERT ON provisional_capacity_claims TO ${user}`);await owner.query(`GRANT USAGE ON SEQUENCE provisional_capacity_claims_id_seq TO ${user}`);await owner.query(`GRANT EXECUTE ON FUNCTION provisional_capacity_effective_quantity(uuid) TO ${user}`);}
  if(['hold','transfer'].includes(suffix)&&(await owner.query("SELECT to_regclass('public.inventory_pole_exemptions') AS t")).rows[0].t)await owner.query(`GRANT EXECUTE ON FUNCTION inventory_sync_pole_exemptions(uuid) TO ${user}`);
  if(suffix==='pricing'){if((await owner.query("SELECT to_regclass('price_admin_requests') AS t")).rows[0].t)await owner.query(`GRANT SELECT,INSERT ON price_admin_requests TO ${user}`);await owner.query(`GRANT SELECT ON staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,ledger_stores,ledger_models,ledger_variants,inventory_holds,inventory_claims,transfer_pieces,transfer_batches,pricing_history TO ${user}`);await owner.query(`GRANT SELECT,INSERT,UPDATE ON price_books TO ${user}`);await owner.query(`GRANT SELECT,INSERT ON price_activations,coupon_versions,price_quotes,coupon_reservations TO ${user}`);await owner.query(`GRANT EXECUTE ON FUNCTION inventory_clock() TO ${user}`);}
  if(suffix==='recommendation'){await owner.query(`GRANT SELECT ON staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,ledger_stores,ledger_variants,recommendation_history TO ${user}`);await owner.query(`GRANT SELECT,INSERT ON recommendation_previews TO ${user}`);await owner.query(`GRANT SELECT,INSERT,UPDATE ON recommendation_selections TO ${user}`);}
  if((await owner.query("SELECT to_regclass('public.rental_inspection_events') IS NOT NULL AS present")).rows[0].present&&['ledger','hold','transfer'].includes(suffix))await owner.query(`GRANT SELECT ON rental_inventory_blocks,rental_loan_items,rental_inspection_events TO ${user}`);
  if(suffix==='hold'&&(await owner.query("SELECT to_regclass('public.rental_inspection_events') IS NOT NULL AS present")).rows[0].present)await owner.query(`GRANT SELECT(id,hold_id) ON rental_bookings TO ${user}`);
  if(['hold','pricing','recommendation'].includes(suffix)&&(await owner.query("SELECT to_regclass('public.guest_contexts') IS NOT NULL AS present")).rows[0].present){await owner.query(`GRANT SELECT ON guest_contexts,booking_actors TO ${user}`);await owner.query(`GRANT EXECUTE ON FUNCTION inventory_clock() TO ${user}`);}
  connections.push({host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password});
 }
 await owner.query(`REVOKE ALL ON DATABASE ${identity.database} FROM PUBLIC`);
 const authDb=connections[0]!,ledgerDb=connections[1]!,holdDb=connections[2]!,transferDb=connections[3]!,pricingDb=connections[4]!,recommendationDb=connections[5]!;
 const recommendationPool=new Pool({...recommendationDb,max:4,connectionTimeoutMillis:2000});const closeRecommendation=trackPoolLifecycle(recommendationPool);
 const pricingPool=new Pool({...pricingDb,max:4,connectionTimeoutMillis:2000});const closePricing=trackPoolLifecycle(pricingPool);
 const transferPool=new Pool({...transferDb,max:4,connectionTimeoutMillis:2000});const closeTransfer=trackPoolLifecycle(transferPool);
 const holdPool=new Pool({...holdDb,max:4,connectionTimeoutMillis:2000});
 const authPool=new Pool({...authDb,max:4}),ledgerPool=new Pool({...ledgerDb,max:4});
 const closeAuth=trackPoolLifecycle(authPool),closeLedger=trackPoolLifecycle(ledgerPool),closeHold=trackPoolLifecycle(holdPool);
 return {recommendationDb,recommendationPool,pricingDb,pricingPool,authDb,ledgerDb,holdDb,transferDb,authPool,ledgerPool,holdPool,transferPool,async close(){await Promise.all([closeAuth(),closeLedger(),closeHold(),closeTransfer(),closePricing(),closeRecommendation()]);}};
}
