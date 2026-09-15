import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {trackPoolLifecycle} from './pool-lifecycle';
/** R14: owned loopback development cluster only; passwords stay in memory, no env/file/argv. */
export async function provisionPaymentActivationRoles(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 const n=identity.namespace;
 if(process.env.NODE_ENV==='production'||!/^zr_[a-f0-9]{12}$/.test(n)||identity.database!==n)throw new Error('R14_DEVELOPMENT_ONLY');
 const db=(await owner.query('SELECT current_database() AS name')).rows[0].name;if(db!==n)throw new Error('R14_DATABASE_MISMATCH');
 const names={receiver:n+'_pay_receipt',dispatcher:n+'_pay_dispatch',worker:n+'_pay_truth',projector:n+'_pay_projection',diagnostic:n+'_pay_diagnostic',publicProbe:n+'_pay_public'};
 const pools={} as Record<keyof typeof names,Pool>,closed:(()=>Promise<void>)[]=[];
 const client=await owner.connect();
 try{
  await client.query('BEGIN');
  for(const [key,user] of Object.entries(names)){
   const password=randomBytes(24).toString('hex');
   await client.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
   await client.query(`GRANT CONNECT ON DATABASE ${n} TO ${user}`);
   const pool=new Pool({host:'127.0.0.1',port:identity.dbPort,database:n,user,password,max:3,connectionTimeoutMillis:2000,idleTimeoutMillis:5000});pools[key as keyof typeof names]=pool;closed.push(trackPoolLifecycle(pool));
  }
  await client.query(`REVOKE ALL ON DATABASE ${n} FROM PUBLIC`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`GRANT USAGE ON SCHEMA square_webhook TO ${names.receiver}`);
  await client.query(`GRANT EXECUTE ON FUNCTION square_webhook.receive(text,text,text,text,text,text) TO ${names.receiver}`);
  await client.query(`GRANT USAGE ON SCHEMA payment_reconciliation TO ${names.dispatcher},${names.worker},${names.diagnostic}`);
  await client.query(`GRANT EXECUTE ON FUNCTION payment_reconciliation.dispatch(text,integer),payment_reconciliation.dispatch_target(text,integer,text,text) TO ${names.dispatcher}`);
  await client.query(`GRANT EXECUTE ON FUNCTION payment_reconciliation.claim(text,text,integer),payment_reconciliation.claim_target(text,text,integer,text,text),payment_reconciliation.finalize(uuid,uuid,bigint,text,text,integer,jsonb),payment_reconciliation.load_context(text,text,text),payment_reconciliation.load_contexts(text,uuid[]) TO ${names.worker}`);
  await client.query(`GRANT EXECUTE ON FUNCTION payment_reconciliation.diagnostics(text,integer) TO ${names.diagnostic}`);
  await client.query(`GRANT USAGE ON SCHEMA public,payment_projection,payment_reconciliation TO ${names.projector}`);
  await client.query(`GRANT SELECT(id,owner_id,hold_id,quote_id,conditions,price_snapshot,price_sha256,mode,state,confirmed_at,version) ON rental_bookings TO ${names.projector}`);
  await client.query(`GRANT SELECT ON rental_payment_attempts,inventory_holds,inventory_claims,wear_claims,wear_pools,ledger_assets,ledger_poles,ledger_variants,ledger_models,transfer_pieces,transfer_batches TO ${names.projector}`);
  await client.query(`GRANT SELECT(id,actor,hold_id,conditions,snapshot,snapshot_sha256,coupon_id) ON price_quotes TO ${names.projector}`);
  await client.query(`GRANT UPDATE(state,confirmed_at,version) ON rental_bookings TO ${names.projector}`);
  await client.query(`GRANT UPDATE(state,provider_id,provider_state,provider_updated_at,completed_at,updated_at) ON rental_payment_attempts TO ${names.projector}`);
  await client.query(`GRANT UPDATE(payment_state,confirmed_at,version) ON inventory_holds TO ${names.projector}`);
  await client.query(`GRANT SELECT,INSERT ON payment_projection.heads,payment_projection.events,payment_projection.job_receipts TO ${names.projector}`);
  await client.query(`GRANT UPDATE(revision,last_observation) ON payment_projection.heads TO ${names.projector}`);
  await client.query(`GRANT USAGE ON SEQUENCE payment_projection.events_id_seq TO ${names.projector}`);
  await client.query(`GRANT EXECUTE ON FUNCTION inventory_clock(),payment_projection.lock_source(uuid),payment_reconciliation.valid_observation(jsonb) TO ${names.projector}`);
  await client.query('COMMIT');
  return {names,pools,async close(){await Promise.all(closed.map(c=>c()));}};
 }catch(e){await client.query('ROLLBACK');await Promise.all(closed.map(c=>c()));throw e;}finally{client.release();}
}
