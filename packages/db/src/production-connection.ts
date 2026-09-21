import {Pool,type PoolClient} from 'pg';
import {TLSSocket,checkServerIdentity} from 'node:tls';
import {ProductionStartupError,type ProductionConfiguration,type ProductionService} from '../../auth/src/production-config';
export type ProductionDatabaseCredential={provider:'NEON';environment:'PRODUCTION';host:string;port:5432;database:string;user:string;password:string;revoked:false};
export function validateProductionCredential(c:ProductionConfiguration,service:ProductionService,v:ProductionDatabaseCredential|undefined){
 if(!v||Object.keys(v).sort().join()!=='database,environment,host,password,port,provider,revoked,user'||v.provider!=='NEON'||v.environment!=='PRODUCTION'||v.host!==c.database.host||v.port!==5432||v.database!==c.database.name||v.user!==c.database.roles[service]||v.revoked!==false||typeof v.password!=='string'||v.password.length<16)throw new ProductionStartupError('DB_CONFIG');
}
/** Default connector has no ambient URL, owner role, credential chain or local fallback.
 * Tests inject an owned local connector; production uses authenticated TLS directly. */
export async function connectProductionDatabase(c:ProductionConfiguration,service:ProductionService,v:ProductionDatabaseCredential){
 validateProductionCredential(c,service,v);
 if(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].some(k=>process.env[k]!==undefined))throw new ProductionStartupError('DB_CONFIG');
 const pool=new Pool({host:v.host,port:v.port,database:v.database,user:v.user,password:v.password,ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000});pool.on('error',()=>{});
 let client:PoolClient|undefined;
 try{client=await pool.connect();const connection=Reflect.get(client,'connection') as {stream?:unknown}|undefined,stream=connection?.stream;
  if(!(stream instanceof TLSSocket)||stream.encrypted!==true||stream.authorized!==true||Reflect.get(stream,'servername')!==v.host||(Reflect.get(stream,'_tlsOptions') as {rejectUnauthorized?:unknown})?.rejectUnauthorized!==true||!['TLSv1.2','TLSv1.3'].includes(stream.getProtocol()??''))throw Error();
  const cert=stream.getPeerCertificate();if(!cert.raw?.length||checkServerIdentity(v.host,cert)!==undefined)throw Error();
  return pool;
 }catch{client?.release(true);client=undefined;await pool.end().catch(()=>{});throw new ProductionStartupError('DB_CONFIG');}finally{client?.release();}
}
/** Verify database identity and absence of ownership/escalation, using the actual
 * authenticated role. Caller-provided labels alone never prove least privilege. */
export async function verifyProductionDatabase(pool:Pool,c:ProductionConfiguration,service:ProductionService){
 const row=(await pool.query(`SELECT current_database() db,current_user role,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
 EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) membership,
 EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid) database_owner,
 EXISTS(SELECT 1 FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND cl.relowner=r.oid) object_owner,
 has_database_privilege(current_user,current_database(),'CREATE') database_create,has_schema_privilege(current_user,'public','CREATE') schema_create
 FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
 if(!row||row.db!==c.database.name||row.role!==c.database.roles[service]||Object.entries(row).some(([k,v])=>!['db','role'].includes(k)&&v!==false))throw new ProductionStartupError('DB_CONFIG');
}
