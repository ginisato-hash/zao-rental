import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {trackPoolLifecycle} from './pool-lifecycle';
import {paymentActivationGrants,paymentActivationRoleNames} from './payment-activation-grants';
/** R14: owned loopback development cluster only; passwords stay in memory, no env/file/argv. */
export async function provisionPaymentActivationRoles(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 const n=identity.namespace;
 if(process.env.NODE_ENV==='production'||!/^zr_[a-f0-9]{12}$/.test(n)||identity.database!==n)throw new Error('R14_DEVELOPMENT_ONLY');
 const db=(await owner.query('SELECT current_database() AS name')).rows[0].name;if(db!==n)throw new Error('R14_DATABASE_MISMATCH');
 const names=paymentActivationRoleNames(n);
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
  for(const grant of paymentActivationGrants(n,'R14_LOCAL'))await client.query(grant);
  await client.query('COMMIT');
  return {names,pools,async close(){await Promise.all(closed.map(c=>c()));}};
 }catch(e){await client.query('ROLLBACK');await Promise.all(closed.map(c=>c()));throw e;}finally{client.release();}
}
