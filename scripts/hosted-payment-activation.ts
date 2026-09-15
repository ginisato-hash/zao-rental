import {createHash,randomBytes} from 'node:crypto';
import {Pool,type PoolConfig} from 'pg';
import {paymentActivationGrants,paymentActivationRoleNames} from './payment-activation-grants';
import {trackPoolLifecycle} from './pool-lifecycle';
export type HostedDevelopmentIdentity={resourceId:string;hostname:string;namespace:string;classification:'ZAO_RENTAL_SANDBOX_DEVELOPMENT';incrementalCostJpy:0;authority:'P6_R15'};
/** Derived resource namespace is fixed in evidence before migrations, never from a browser DB selector. */
export function hostedNamespace(resourceId:string){return 'zr_'+createHash('sha256').update('P6_R15:'+resourceId).digest('hex').slice(0,12);}
export function validateHostedIdentity(i:HostedDevelopmentIdentity){
 if(i.authority!=='P6_R15'||i.classification!=='ZAO_RENTAL_SANDBOX_DEVELOPMENT'||i.incrementalCostJpy!==0||!/^[-a-zA-Z0-9_]{3,128}$/.test(i.resourceId)||i.namespace!==hostedNamespace(i.resourceId)||!/^ep-[a-z0-9.-]+\.neon\.tech$/.test(i.hostname))throw new Error('R15_HOSTED_IDENTITY_REJECTED');
}
/** Credential stays in memory. No default env, certificate relaxation, logging or connect-on-import. */
export function hostedRoleConfiguration(i:HostedDevelopmentIdentity,role:string,password:string):PoolConfig{
 validateHostedIdentity(i);if(!Object.values(paymentActivationRoleNames(i.namespace)).includes(role)||!password)throw new Error('R15_ROLE_REJECTED');
 return {host:i.hostname,port:5432,database:i.namespace,user:role,password,ssl:{rejectUnauthorized:true},max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,application_name:'zao_rental_r15_development'};
}
/** Explicit provision only, after free-plan + resource metadata readback + original migrations. */
export async function provisionHostedPaymentRoles(owner:Pool,i:HostedDevelopmentIdentity){
 validateHostedIdentity(i);if(process.env.NODE_ENV==='production')throw new Error('R15_SETUP_NOT_RUNTIME');
 if(owner.options.host!==i.hostname||owner.options.database!==i.namespace||typeof owner.options.ssl!=='object'||owner.options.ssl.rejectUnauthorized!==true)throw new Error('R15_OWNER_CONNECTION_REJECTED');
 const actual=(await owner.query('SELECT current_database() AS name,current_user AS owner')).rows[0];
 if(actual?.name!==i.namespace)throw new Error('R15_HOSTED_DATABASE_MISMATCH');
 const names=paymentActivationRoleNames(i.namespace),configs={} as Record<keyof typeof names,PoolConfig>,pools={} as Record<keyof typeof names,Pool>,closed:(()=>Promise<void>)[]=[];
 const c=await owner.connect();
 try{
  await c.query('BEGIN');
  // Ambiguous prior creation never triggers rotation/drop/recreation. Reconcile owned metadata first.
  if((await c.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(names)])).rowCount)throw new Error('R15_ROLES_EXIST_RECONCILE_ONLY');
  for(const [key,user] of Object.entries(names)){
   const password=randomBytes(32).toString('hex');
   await c.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
   await c.query(`GRANT CONNECT ON DATABASE ${i.namespace} TO ${user}`);
   configs[key as keyof typeof names]=hostedRoleConfiguration(i,user,password);
  }
  for(const grant of paymentActivationGrants(i.namespace,'R15_TARGETED'))await c.query(grant);
  await c.query('COMMIT');
  for(const key of Object.keys(names) as (keyof typeof names)[]){const pool=new Pool(configs[key]);pools[key]=pool;closed.push(trackPoolLifecycle(pool));}
  return {names,pools,configs,async close(){await Promise.all(closed.map(f=>f()));}};
 }catch{await c.query('ROLLBACK').catch(()=>{});await Promise.all(closed.map(f=>f()));throw new Error('R15_ROLE_PROVISION_FAILED_RECONCILE_BEFORE_RETRY');}finally{c.release();}
}
