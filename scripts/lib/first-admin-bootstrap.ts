import {createHash,randomBytes} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,realpathSync,writeFileSync,fchmodSync,fsyncSync} from 'node:fs';
import {dirname,isAbsolute,relative} from 'node:path';
import {TLSSocket,checkServerIdentity} from 'node:tls';
import type {PoolClient} from 'pg';
import {insertAccount,parseAccount,type NewAccount} from '../../packages/auth/src/accounts';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {canonicalEmail,verifyStaffPassword} from '../../packages/auth/src/password';
import {EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,productionHostFingerprint} from '../../packages/auth/src/production-identity';

export type FirstAdminInput=Pick<NewAccount,'email'|'displayName'|'password'>;
const prefix='PRODUCTION_STAFF_BOOTSTRAP_';
function stop(suffix:string):never{throw new Error(prefix+suffix);}
// Owner-fixed canonical identity, fingerprinted to keep the address out of source/evidence.
export function assertFirstAdminOwnerEmail(email:string){
 let fingerprint:string;try{fingerprint=createHash('sha256').update(canonicalEmail(email)).digest('hex');}catch{stop('OWNER_EMAIL_REJECTED');}
 if(fingerprint!=='95b26d91fdaaa06112be39dcda9918d72f029317f5da9a5c038241c8a2c3a3c0')stop('OWNER_EMAIL_REJECTED');
}
const account=(input:FirstAdminInput):NewAccount=>({...input,active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{PRICE_EDIT:true}});
export function firstAdminInput(raw:unknown):FirstAdminInput{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join()!=='displayName,email,password')stop('INPUT_REJECTED');
 try{parseAccount(account(raw as FirstAdminInput),true);}catch{stop('INPUT_REJECTED');}
 const value=raw as FirstAdminInput;
 // Otherwise a password copied into a profile field would be stored as plaintext.
 if(value.email.includes(value.password)||value.displayName.includes(value.password))stop('INPUT_REJECTED');
 return {email:value.email,displayName:value.displayName,password:value.password};
}
/** Attended preparation helper: identity comes from Owner, never guessed or argv.
 * The generated 256-bit password has exactly one persistent destination. No value is returned.
 * Production admission independently binds the Owner email; tests use synthetic identities. */
export function writeFirstAdminInput(path:string,repository:string,identity:Pick<FirstAdminInput,'email'|'displayName'>):void{
 let fd:number|undefined;
 try{
  const uid=process.getuid?.();if(!isAbsolute(path)||uid===undefined)stop('SECURE_INPUT_REQUIRED');
  const parent=realpathSync(dirname(path)),rel=relative(realpathSync(repository),parent);
  if(!(rel==='..'||rel.startsWith('../')))stop('SECURE_INPUT_REQUIRED');
  const input=firstAdminInput({...identity,password:randomBytes(32).toString('base64url')});
  fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.uid!==uid)stop('SECURE_INPUT_REQUIRED');
  fchmodSync(fd,0o600);writeFileSync(fd,JSON.stringify(input)+'\n');fsyncSync(fd);
 }catch(error){if(error instanceof Error&&error.message===prefix+'INPUT_REJECTED')throw error;stop('SECURE_INPUT_REQUIRED');}
 finally{if(fd!==undefined)closeSync(fd);}
}
export function readFirstAdminInput(path:string,repository:string):FirstAdminInput{
 let fd:number|undefined;const buffer=Buffer.alloc(16385);
 try{
  const uid=process.getuid?.();if(!isAbsolute(path)||uid===undefined)stop('SECURE_INPUT_REQUIRED');
  const resolved=realpathSync(path),rel=relative(realpathSync(repository),resolved);
  if(!(rel==='..'||rel.startsWith('../')))stop('SECURE_INPUT_REQUIRED');
  // Open the original path without following its final symlink; inspect/read the same fd.
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=fstatSync(fd);
  if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o7777)!==0o600||stat.size<1||stat.size>16384)stop('SECURE_INPUT_REQUIRED');
  let size=0,n=0;do{n=readSync(fd,buffer,size,buffer.length-size,null);size+=n;}while(n&&size<buffer.length);
  if(size!==stat.size||size>16384)stop('SECURE_INPUT_REQUIRED');
  return firstAdminInput(JSON.parse(buffer.subarray(0,size).toString('utf8')));
 }catch(error){if(error instanceof Error&&error.message===prefix+'INPUT_REJECTED')throw error;return stop('SECURE_INPUT_REQUIRED');}
 finally{buffer.fill(0);if(fd!==undefined)closeSync(fd);}
}
export function assertFirstAdminRelease(facts:{origin:string;head:string;main:string;clean:boolean}){
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ginisato-hash\/zao-rental(?:\.git)?$/.test(facts.origin)||!facts.clean||!/^[a-f0-9]{40}$/.test(facts.head)||facts.head!==facts.main)stop('RELEASE_REJECTED');
}
export function firstAdminDatabaseConfig(raw:string|undefined){
 try{
  const u=new URL(raw??'');
  if(u.protocol!=='postgresql:'||productionHostFingerprint(u.hostname)!==EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256||u.pathname!=='/neondb'||decodeURIComponent(u.username)!=='neondb_owner'||decodeURIComponent(u.password).length<16||(u.port&&u.port!=='5432')||u.hash||u.search!=='?sslmode=verify-full')stop('DATABASE_REJECTED');
  return {host:u.hostname,port:5432,database:'neondb',user:'neondb_owner',password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:1,connectionTimeoutMillis:10000,idleTimeoutMillis:1000,statement_timeout:10000,application_name:'zao_production_first_admin_bootstrap'};
 }catch{return stop('DATABASE_REJECTED');}
}
export function assertFirstAdminTls(client:PoolClient,host:string){
 const connection=Reflect.get(client,'connection') as {stream?:unknown}|undefined,stream=connection?.stream;
 if(!(stream instanceof TLSSocket)||!stream.encrypted||!stream.authorized||Reflect.get(stream,'servername')!==host||(Reflect.get(stream,'_tlsOptions') as {rejectUnauthorized?:unknown})?.rejectUnauthorized!==true||!['TLSv1.2','TLSv1.3'].includes(stream.getProtocol()??''))stop('TLS_REJECTED');
 const cert=stream.getPeerCertificate();if(!cert.raw?.length||checkServerIdentity(host,cert)!==undefined)stop('TLS_REJECTED');
}
export async function assertFirstAdminDatabaseOwner(client:PoolClient){
 const r=(await client.query(`SELECT current_database() AS db,current_user AS role,session_user AS login,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()`)).rows[0];
 if(!r||r.db!=='neondb'||r.role!=='neondb_owner'||r.login!=='neondb_owner'||r.owner!=='neondb_owner')stop('DATABASE_OWNER_REJECTED');
}
async function counts(client:PoolClient){
 return (await client.query<{staff_members:number;auth_user:number;auth_account:number}>(`SELECT (SELECT count(*)::int FROM staff_members) staff_members,(SELECT count(*)::int FROM auth_user) auth_user,(SELECT count(*)::int FROM auth_account) auth_account`)).rows[0]!;
}
async function readback(client:PoolClient,id:string,input:FirstAdminInput){
 const n=await counts(client);
 const row=(await client.query(`SELECT m.active,m.role,m.scope,a.password,a."providerId",u.email,u.name FROM staff_members m JOIN auth_user u ON u.id=m.id JOIN auth_account a ON a."userId"=m.id WHERE m.id=$1`,[id])).rows[0];
 const details=(await client.query(`SELECT (SELECT count(*)::int FROM auth_session) sessions,(SELECT count(*)::int FROM staff_store_access) stores,(SELECT count(*)::int FROM staff_permission_overrides) overrides,(SELECT count(*)::int FROM staff_permission_overrides WHERE staff_id=$1 AND permission='PRICE_EDIT' AND allowed) price_edit,(SELECT count(*)::int FROM staff_audit WHERE event='ACCOUNT_CREATED') created,(SELECT count(*)::int FROM staff_audit WHERE event='ACCOUNT_CREATED' AND target_staff_id=$1 AND actor_staff_id='production-first-admin-bootstrap') own_created`,[id])).rows[0];
 const principal=await loadStaff(client,id);
 if(n.staff_members!==1||n.auth_user!==1||n.auth_account!==1||!row||row.active!==true||row.role!=='ADMIN'||row.scope!=='ALL'||row.providerId!=='credential'||!row.password.startsWith('$argon2id$')||row.email!==canonicalEmail(input.email)||row.name!==input.displayName||!await verifyStaffPassword({hash:row.password,password:input.password})||details.sessions!==0||details.stores!==0||details.overrides!==1||details.price_edit!==1||details.created!==1||details.own_created!==1||!['INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','PRICE_EDIT'].every(p=>principal?.permissions.includes(p as never)))stop('READBACK_FAILED');
 // Examine only the rows written by this operation, in memory. Never send plaintext to SQL.
 const persisted=(await client.query(`SELECT to_jsonb(t) AS data FROM auth_user t UNION ALL SELECT to_jsonb(t) FROM auth_account t UNION ALL SELECT to_jsonb(t) FROM staff_members t UNION ALL SELECT to_jsonb(t) FROM staff_store_access t UNION ALL SELECT to_jsonb(t) FROM staff_permission_overrides t UNION ALL SELECT to_jsonb(t) FROM staff_audit t WHERE target_staff_id=$1 UNION ALL SELECT to_jsonb(t) FROM booking_actors t WHERE id=$1`,[id])).rows;
 if(persisted.some(r=>Object.values(r.data as Record<string,unknown>).some(v=>typeof v==='string'&&v.includes(input.password))))stop('READBACK_FAILED');
 return {...n,credential_account:1,email_unique:true,active:true,role:'ADMIN',scope:'ALL',PRICE_EDIT:true,argon2id:true,plaintext_password_absent:true,ACCOUNT_CREATED:1,auth_session:0};
}
/** Internal transaction primitive, shared with disposable PostgreSQL tests. The only
 * operator entrypoint must first admit Git, secure input, fixed Production URI/TLS/owner.
 * No identity overrides, runtime route, login or session insertion are provided. */
export async function firstAdminTransaction(client:PoolClient,raw:FirstAdminInput){
 const input=firstAdminInput(raw);let committing=false,committed=false;
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='10000ms'; SET LOCAL statement_timeout='10000ms'; SET LOCAL idle_in_transaction_session_timeout='15000ms'; SET LOCAL search_path=public,pg_catalog");
  await client.query('SELECT pg_advisory_xact_lock(7080501)');
  const n=await counts(client);
  if(n.staff_members!==0)stop('ALREADY_COMPLETED');
  if(n.auth_user!==0||n.auth_account!==0)stop('RECONCILIATION_REQUIRED');
  const id=await insertAccount(client,account(input),'production-first-admin-bootstrap');
  await readback(client,id,input);
  committing=true;await client.query('COMMIT');committed=true;
  return await readback(client,id,input);
 }catch(error){
  if(committed)stop('COMMITTED_READBACK_REQUIRED');
  if(committing)stop('COMMIT_UNKNOWN_READBACK_REQUIRED');
  await client.query('ROLLBACK').catch(()=>{});throw error;
 }
}
export function firstAdminSafeError(error:unknown){
 const allowed=['INPUT_REJECTED','OWNER_EMAIL_REJECTED','SECURE_INPUT_REQUIRED','RELEASE_REJECTED','DATABASE_REJECTED','DATABASE_OWNER_REJECTED','TLS_REJECTED','ALREADY_COMPLETED','RECONCILIATION_REQUIRED','READBACK_FAILED','COMMITTED_READBACK_REQUIRED','COMMIT_UNKNOWN_READBACK_REQUIRED','ARGUMENTS_REJECTED'];
 return error instanceof Error&&allowed.some(c=>error.message===prefix+c)?error.message:prefix+'OPERATION_FAILED';
}
