import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
// Only called on the owned, fresh local cluster after migrations; never against an ambient URL.
export async function provisionApplicationRoles(owner:Pool,identity:{namespace:string;database:string;dbPort:number}) {
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const connections:Connection[]=[];
 for(const suffix of ['auth','ledger','hold']) {
  const user=`${identity.namespace}_${suffix}`,password=randomBytes(24).toString('hex');
  // Identifiers/password below are generated locally and strictly restricted, not task/user input.
  await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
  const tables=suffix==='auth'?['auth_user','auth_session','auth_account','auth_verification']:['ledger_models','ledger_variants','ledger_assets','ledger_poles','ledger_bundles'];
  if(suffix!=='hold')await owner.query(`GRANT SELECT,INSERT,UPDATE${suffix==='auth'?',DELETE':''} ON ${tables.join(',')} TO ${user}`);
  if(suffix==='ledger')await owner.query(`GRANT SELECT ON ledger_stores,ledger_records,ledger_bundle_components,ledger_history,ledger_locations TO ${user}`);
  if(suffix==='auth'){
   await owner.query(`GRANT SELECT,INSERT,UPDATE ON staff_members TO ${user}`);
   await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON staff_store_access,staff_permission_overrides TO ${user}`);
   await owner.query(`GRANT SELECT ON staff_role_permissions,ledger_stores,staff_audit TO ${user}`);
   await owner.query(`GRANT EXECUTE ON FUNCTION staff_log(text,text,text) TO ${user}`);
  }
  if(suffix==='hold'){
   await owner.query(`GRANT SELECT ON ledger_stores,ledger_models,ledger_variants,ledger_assets,ledger_poles,staff_members,staff_store_access,staff_role_permissions,staff_permission_overrides,inventory_constraints,inventory_history,inventory_replans TO ${user}`);
   await owner.query(`GRANT SELECT,INSERT,UPDATE ON inventory_reservations,inventory_holds,inventory_claims,inventory_requests TO ${user}`);
   await owner.query(`GRANT USAGE ON SEQUENCE inventory_claims_id_seq TO ${user}`);
   await owner.query(`GRANT EXECUTE ON FUNCTION inventory_record_replan(jsonb,jsonb) TO ${user}`);
  }
  connections.push({host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password});
 }
 await owner.query(`REVOKE ALL ON DATABASE ${identity.database} FROM PUBLIC`);
 const authDb=connections[0]!,ledgerDb=connections[1]!,holdDb=connections[2]!;
 const holdPool=new Pool({...holdDb,max:4,connectionTimeoutMillis:2000});
 const authPool=new Pool({...authDb,max:4}),ledgerPool=new Pool({...ledgerDb,max:4});
 const closeAuth=trackPoolLifecycle(authPool),closeLedger=trackPoolLifecycle(ledgerPool),closeHold=trackPoolLifecycle(holdPool);
 return {authDb,ledgerDb,holdDb,authPool,ledgerPool,holdPool,async close(){await Promise.all([closeAuth(),closeLedger(),closeHold()]);}};
}
