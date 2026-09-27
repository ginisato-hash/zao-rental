// PROD-R0.8-E: pure, no-I/O contract for the first Production credential tranche.
// No provider call, database connection, password persistence, env read or logging happens here.
// Neon rejects client-derived SCRAM verifiers, and its reset_password API refuses a role that has no
// password yet ("cannot update password for role without password"). Operational roles are created
// NOLOGIN PASSWORD NULL, so the lifecycle is hybrid:
//  1. initial bootstrap: a disposable 43-char base64url password is set through the role manager in
//     SQL while the role stays NOLOGIN, so it can never authenticate;
//  2. exactly one Neon reset_password replaces it; the Neon-generated password is the only final
//     credential, held in memory and installed into its exact Production sensitive sink;
//  3. only then the role manager toggles LOGIN in SQL with no password clause.
// Once bootstrapped, every future rotation is reset_password alone; no SQL plaintext is used again.
import {createHash,randomBytes} from 'node:crypto';
import {productionAppRoleNames,assertProductionDatabaseName} from './production-app-roles';
import {COMMERCIAL_DB_SERVICES} from '../packages/core/src/guest/production-commercial-composition';

export const PRODUCTION_CREDENTIAL_ACTIVATION_VERSION='production-credential-activation/3';
export const PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY='SQL_TEMPORARY_PLAINTEXT_NOLOGIN';
export const PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY='NEON_ROLE_RESET_PASSWORD_API';
export const COMMERCIAL_CREDENTIAL_SERVICES=COMMERCIAL_DB_SERVICES;
export type CommercialCredentialService=typeof COMMERCIAL_CREDENTIAL_SERVICES[number];
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v)||Buffer.byteLength(v,'utf8')>63)throw new Error('PRODUCTION_CREDENTIAL_ROLE_NAME_INVALID');return '"'+v+'"';};
const PROJECT_ID=/^[a-z0-9-]{1,60}$/,BRANCH_ID=/^br-[a-z0-9-]{1,60}$/;
/** 32 random bytes as unpadded base64url: exactly 43 characters with no quote, backslash or whitespace,
 * so the SQL literal needs no escaping. */
const TEMPORARY_PASSWORD=/^[A-Za-z0-9_-]{43}$/;

export function commercialCredentialRoleNames(database:string):Record<CommercialCredentialService,string>{
 assertProductionDatabaseName(database);
 const all=productionAppRoleNames(database),out={} as Record<CommercialCredentialService,string>;
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES)out[service]=all[service];
 return out;
}
const roleFor=(database:string,service:CommercialCredentialService)=>{const role=commercialCredentialRoleNames(database)[service];if(!role)throw new Error('PRODUCTION_CREDENTIAL_SERVICE_INVALID');return role;};
const managerSet=(database:string)=>`SET LOCAL ROLE ${qi(database+'_role_admin')}`;

export function assertProductionCredentialTemporaryPassword(value:unknown):asserts value is string{
 if(typeof value!=='string'||!TEMPORARY_PASSWORD.test(value))throw new Error('PRODUCTION_CREDENTIAL_TEMPORARY_PASSWORD_INVALID');
}
/** Disposable initial password. Memory only; it is never a final credential and never reaches a sink. */
export function productionCredentialTemporaryPassword(){
 const bytes=randomBytes(32),value=bytes.toString('base64url');bytes.fill(0);
 assertProductionCredentialTemporaryPassword(value);
 return value;
}
/** Initial bootstrap SQL: manager SET, then the temporary password. It never contains LOGIN; the role
 * stays NOLOGIN for the whole lifetime of the temporary password. */
export function productionCredentialTemporaryPasswordSql(database:string,service:CommercialCredentialService,temporary:string):string[]{
 assertProductionCredentialTemporaryPassword(temporary);
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} PASSWORD '${temporary}'`];
}

/** The one provider call that mints the final password. Non-idempotent POST: exactly one call per role,
 * never retried; an unknown outcome is contained with the rollback SQL, never by a second reset. The
 * response carries the password and must be parsed in memory only. reveal_password is not part of it. */
export function productionCredentialResetPasswordRequest(projectId:string,branchId:string,database:string,service:CommercialCredentialService){
 if(!PROJECT_ID.test(projectId)||!BRANCH_ID.test(branchId))throw new Error('PRODUCTION_CREDENTIAL_TARGET_INVALID');
 return Object.freeze({method:'POST' as const,path:`/projects/${projectId}/branches/${branchId}/roles/${roleFor(database,service)}/reset_password`,idempotent:false,maxCalls:1});
}

/** Proof that a password came from a Neon reset_password response. Only this module can create one,
 * so LOGIN SQL and the sink are unreachable without a successful reset. */
export type NeonResetCredential=Readonly<{role:string;password:string;operationIds:readonly string[]}>;
const neonMinted=new WeakSet<object>();
/** Reads the password out of a reset_password response held in memory. The temporary bootstrap password
 * is required so a response echoing it is rejected: it must never become the final credential. */
export function productionCredentialPasswordFromResetResponse(body:unknown,expectedRole:string,temporary:string):NeonResetCredential{
 assertProductionCredentialTemporaryPassword(temporary);
 const b=body as {role?:{name?:unknown;password?:unknown};operations?:Array<{id?:unknown}>}|null;
 if(!b||typeof b!=='object'||!b.role||b.role.name!==expectedRole||typeof b.role.password!=='string'||b.role.password.length<16||b.role.password.length>512||b.role.password===temporary)
  throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 const operationIds=(Array.isArray(b.operations)?b.operations:[]).map(o=>o?.id);
 if(operationIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 const credential=Object.freeze({role:expectedRole,password:b.role.password,operationIds:Object.freeze([...operationIds as string[]])});
 neonMinted.add(credential);
 return credential;
}
const assertNeonCredential=(database:string,service:CommercialCredentialService,credential:unknown)=>{
 if(typeof credential!=='object'||credential===null||!neonMinted.has(credential)||(credential as NeonResetCredential).role!==roleFor(database,service))
  throw new Error('PRODUCTION_CREDENTIAL_NEON_RESET_REQUIRED');
 return credential as NeonResetCredential;
};

export const COMMERCIAL_CREDENTIAL_PROBES:Readonly<Record<CommercialCredentialService,Readonly<{positive:string;negative:string;negativeSqlState:'42501'}>>>=Object.freeze({
 auth:{positive:'SELECT count(*) FROM staff_role_permissions',negative:'SELECT 1 FROM guest_contexts LIMIT 1',negativeSqlState:'42501'},
 ledger:{positive:'SELECT count(*) FROM ledger_models',negative:'SELECT 1 FROM auth_user LIMIT 1',negativeSqlState:'42501'},
 hold:{positive:'SELECT count(*) FROM inventory_holds',negative:'SELECT 1 FROM auth_session LIMIT 1',negativeSqlState:'42501'},
 transfer:{positive:'SELECT count(*) FROM inventory_claims',negative:'SELECT 1 FROM auth_account LIMIT 1',negativeSqlState:'42501'},
 pricing:{positive:'SELECT count(*) FROM price_books',negative:'SELECT 1 FROM ledger_assets LIMIT 1',negativeSqlState:'42501'},
 recommendation:{positive:'SELECT count(*) FROM recommendation_selections',negative:'SELECT 1 FROM price_books LIMIT 1',negativeSqlState:'42501'},
 operations:{positive:'SELECT count(*) FROM ledger_stores',negative:'SELECT 1 FROM auth_user LIMIT 1',negativeSqlState:'42501'},
 guest:{positive:'SELECT count(*) FROM guest_policy_versions',negative:'SELECT 1 FROM staff_members LIMIT 1',negativeSqlState:'42501'},
 content_read:{positive:'SELECT count(*) FROM content_public_policies',negative:'SELECT 1 FROM ledger_poles LIMIT 1',negativeSqlState:'42501'},
 booking_access:{positive:"SELECT booking_access.read('nonexistent')",negative:'SELECT 1 FROM guest_contexts LIMIT 1',negativeSqlState:'42501'},
});

export const PRODUCTION_CREDENTIAL_PROOF_CONTRACT=Object.freeze({
 pre:['exact role is NOLOGIN, has no password and has the foundation role posture','role is registered in the Neon role API','manager SET succeeds','no Production password sink exists yet'],
 initialBootstrap:['temporary password is 32 random bytes as 43-char base64url, generated and held in memory only','manager SET, then ALTER ROLE <role> PASSWORD with the temporary value; no LOGIN clause',
  'after commit the role is still NOLOGIN with identical attributes, memberships, grantors, ownership and ACL','the temporary password is never installed in any sink and never used as a final credential'],
 passwordReset:['exactly one reset_password POST (non-idempotent, never retried)','password parsed in memory only; raw response never logged or stored','returned operations finished before use',
  'failure or unknown outcome: rollback SQL (NOLOGIN PASSWORD NULL), no second reset, no reveal_password, stop'],
 preLogin:['after reset the role is still NOLOGIN with identical attributes, memberships, grantors, ownership and ACL','the temporary password is erased from memory'],
 activation:['SQL contains no password: manager SET, then ALTER ROLE <role> LOGIN','LOGIN SQL can only be built from a Neon reset credential','the only catalog delta is rolcanlogin false -> true'],
 connection:['verify-full TLS authentication with the Neon password succeeds as the exact role','verifyProductionDatabase-equivalent least-privilege posture passes'],
 probes:['one role-specific positive probe succeeds','one role-specific forbidden probe fails with SQLSTATE 42501'],
 sink:['only the Neon reset password is installed into the exact Production sensitive sink','only sink metadata is read back; the value is never read back or logged'],
 canary:['content_read first; one endpoint restart, then the same in-memory Neon password still authenticates with unchanged posture'],
 rollback:['on any failure after the temporary password: manager sets the role NOLOGIN PASSWORD NULL, the sink is removed if present, and activation stops'],
 futureRotation:['a bootstrapped role rotates with reset_password alone; no SQL plaintext password is used again'],
});

/** LOGIN toggle. Requires the Neon reset credential for this exact role, so LOGIN before reset is impossible. */
export function productionCredentialActivationSql(database:string,service:CommercialCredentialService,credential:NeonResetCredential):string[]{
 assertNeonCredential(database,service,credential);
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} LOGIN`];
}
export function productionCredentialRollbackSql(database:string,service:CommercialCredentialService):string[]{
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} NOLOGIN PASSWORD NULL`];
}
/** The exact Production sensitive sink. Only a Neon reset credential maps to it; a temporary password cannot. */
export function productionCredentialSink(database:string,service:CommercialCredentialService,credential:NeonResetCredential){
 const c=assertNeonCredential(database,service,credential);
 return Object.freeze({key:`PRODUCTION_DB_PASSWORD_${service.toUpperCase()}`,target:'production' as const,type:'sensitive' as const,value:c.password});
}

/** Secret-free deterministic plan for Owner/TD approval. */
export function productionCredentialActivationPlan(database:string){
 const roles=commercialCredentialRoleNames(database),managerRole=database+'_role_admin';
 const body={version:PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,database,managerRole,
  initialPasswordAuthority:PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,steadyStatePasswordAuthority:PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,
  roleAttributeAuthority:managerRole,temporaryPasswordRoleState:'NOLOGIN' as const,finalPasswordSource:'NEON_RESET_RESPONSE' as const,temporaryPasswordInstalledInVercel:false,
  temporaryPassword:{entropyBytes:32,encoding:'base64url',length:43,pattern:TEMPORARY_PASSWORD.source,handling:'MEMORY_ONLY'},
  sequence:['TEMPORARY_PASSWORD_WHILE_NOLOGIN','RESET_PASSWORD_ONCE','ERASE_TEMPORARY','LOGIN_WITHOUT_PASSWORD_CLAUSE','TLS_AND_PROBES','SINK_NEON_PASSWORD'],
  passwordReset:{method:'POST',path:'/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password',idempotent:false,maxCallsPerRole:1,blindRetry:false,responseHandling:'MEMORY_ONLY',revealPassword:'NOT_USED'},
  futureRotation:'NEON_RESET_PASSWORD_ONLY' as const,
  sinks:Object.fromEntries(COMMERCIAL_CREDENTIAL_SERVICES.map(s=>[s,`PRODUCTION_DB_PASSWORD_${s.toUpperCase()}`])),
  services:[...COMMERCIAL_CREDENTIAL_SERVICES],roles,probes:COMMERCIAL_CREDENTIAL_PROBES,proofContract:PRODUCTION_CREDENTIAL_PROOF_CONTRACT,
  canary:'content_read' as CommercialCredentialService,remainingOperationalRolesStayNoLogin:true};
 return {...body,planSha256:sha256(JSON.stringify(body))};
}
