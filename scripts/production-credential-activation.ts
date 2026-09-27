// PROD-R0.8-E: pure, no-I/O contract for the first Production credential tranche.
// No provider call, database connection, password persistence, env read or logging happens here.
// Neon rejects client-derived SCRAM verifiers, and its reset_password API refuses a role that has no
// password yet ("cannot update password for role without password"). Operational roles are created
// NOLOGIN PASSWORD NULL, so the lifecycle is hybrid:
//  1. initial bootstrap: a disposable 43-char base64url password is set through the role manager in
//     one statement that also asserts NOLOGIN, so the password never exists on a LOGIN-capable role;
//  2. exactly one Neon reset_password replaces it; the response is only a pending credential until
//     every returned operation has finished (Neon applies the password after the last one);
//  3. only a completed Neon credential builds the LOGIN SQL (no password clause) or maps to the exact
//     Production sensitive sink. Secrets are never persisted, logged or sunk except the completed
//     Neon password into its sink; application references are dropped after use (JavaScript strings
//     cannot be reliably zeroized, so no erasure is claimed).
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
/** Disposable initial password. Never persisted, logged or sunk; never a final credential. */
export function productionCredentialTemporaryPassword(){
 const bytes=randomBytes(32),value=bytes.toString('base64url');bytes.fill(0);
 assertProductionCredentialTemporaryPassword(value);
 return value;
}
/** Initial bootstrap SQL: manager SET, then NOLOGIN and the temporary password in one statement, so the
 * temporary password can never be present on a LOGIN-capable role regardless of the prior state. */
export function productionCredentialTemporaryPasswordSql(database:string,service:CommercialCredentialService,temporary:string):string[]{
 assertProductionCredentialTemporaryPassword(temporary);
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} NOLOGIN PASSWORD '${temporary}'`];
}

/** The one provider call that mints the final password. Non-idempotent POST: exactly one call per role,
 * never retried; an unknown outcome is contained with the rollback SQL, never by a second reset. The
 * response carries the password; it is parsed in process and never persisted or logged. reveal_password is not used. */
export function productionCredentialResetPasswordRequest(projectId:string,branchId:string,database:string,service:CommercialCredentialService){
 if(!PROJECT_ID.test(projectId)||!BRANCH_ID.test(branchId))throw new Error('PRODUCTION_CREDENTIAL_TARGET_INVALID');
 return Object.freeze({method:'POST' as const,path:`/projects/${projectId}/branches/${branchId}/roles/${roleFor(database,service)}/reset_password`,idempotent:false,maxCalls:1});
}

/** Proofs that a password came from a Neon reset_password response. Only this module can create them.
 * Pending: parsed from the response, not yet usable. Completed: every returned operation finished.
 * LOGIN SQL and the sink accept only a completed credential, so LOGIN before a finished reset is impossible. */
export type PendingNeonResetCredential=Readonly<{role:string;password:string;operationIds:readonly string[]}>;
export type CompletedNeonResetCredential=Readonly<{role:string;password:string;operationIds:readonly string[];completed:true}>;
const neonPending=new WeakSet<object>(),neonCompleted=new WeakSet<object>();
const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Reads the password out of a reset_password response. The temporary bootstrap password is required so a
 * response echoing it is rejected. A response without operations fails closed: completion cannot be proven. */
export function productionCredentialPasswordFromResetResponse(body:unknown,expectedRole:string,temporary:string):PendingNeonResetCredential{
 assertProductionCredentialTemporaryPassword(temporary);
 const b=body as {role?:{name?:unknown;password?:unknown};operations?:Array<{id?:unknown}>}|null;
 if(!b||typeof b!=='object'||!b.role||b.role.name!==expectedRole||typeof b.role.password!=='string'||b.role.password.length<16||b.role.password.length>512||b.role.password===temporary)
  throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 if(!Array.isArray(b.operations)||b.operations.length===0)throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 const operationIds=b.operations.map(o=>o?.id);
 if(operationIds.some(id=>typeof id!=='string'||!OPERATION_ID.test(id))||new Set(operationIds).size!==operationIds.length)throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 const pending=Object.freeze({role:expectedRole,password:b.role.password,operationIds:Object.freeze([...operationIds as string[]])});
 neonPending.add(pending);
 return pending;
}
/** Promotes a pending credential once every returned operation is observed finished (exact id set). */
export function productionCredentialCompleteReset(pending:PendingNeonResetCredential,operationStatus:Readonly<Record<string,string>>):CompletedNeonResetCredential{
 if(typeof pending!=='object'||pending===null||!neonPending.has(pending))throw new Error('PRODUCTION_CREDENTIAL_PENDING_RESET_REQUIRED');
 const ids=Object.keys(operationStatus??{}).sort(),expected=[...pending.operationIds].sort();
 if(JSON.stringify(ids)!==JSON.stringify(expected)||expected.some(id=>operationStatus[id]!=='finished'))throw new Error('PRODUCTION_CREDENTIAL_RESET_NOT_COMPLETED');
 neonPending.delete(pending);
 const completed=Object.freeze({role:pending.role,password:pending.password,operationIds:pending.operationIds,completed:true as const});
 neonCompleted.add(completed);
 return completed;
}
const assertNeonCredential=(database:string,service:CommercialCredentialService,credential:unknown)=>{
 if(typeof credential!=='object'||credential===null||!neonCompleted.has(credential)||(credential as CompletedNeonResetCredential).role!==roleFor(database,service))
  throw new Error('PRODUCTION_CREDENTIAL_COMPLETED_NEON_RESET_REQUIRED');
 return credential as CompletedNeonResetCredential;
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
 initialBootstrap:['temporary password is 32 random bytes as 43-char base64url, generated in process and never persisted, logged or sunk','manager SET, then ALTER ROLE <role> NOLOGIN PASSWORD with the temporary value in one statement; never LOGIN',
  'after commit the role is still NOLOGIN with identical attributes, memberships, grantors, ownership and ACL','the temporary password is never installed in any sink and never used as a final credential'],
 passwordReset:['exactly one reset_password POST (non-idempotent, never retried)','password parsed in process; raw response never logged or stored','a response without operations fails closed','the credential is pending until every returned operation is observed finished',
  'failure or unknown outcome: rollback SQL (NOLOGIN PASSWORD NULL), no second reset, no reveal_password, stop'],
 preLogin:['after reset the role is still NOLOGIN with identical attributes, memberships, grantors, ownership and ACL','application references to the temporary password are dropped; it is never persisted, logged or sunk'],
 activation:['SQL contains no password: manager SET, then ALTER ROLE <role> LOGIN','LOGIN SQL can only be built from a completed Neon reset credential','the only catalog delta is rolcanlogin false -> true'],
 connection:['verify-full TLS authentication with the Neon password succeeds as the exact role','verifyProductionDatabase-equivalent least-privilege posture passes'],
 probes:['one role-specific positive probe succeeds','one role-specific forbidden probe fails with SQLSTATE 42501'],
 sink:['only the completed Neon reset password is installed into the exact Production sensitive sink','only sink metadata is read back; the value is never read back or logged'],
 canary:['content_read first; one endpoint restart, then the same Neon password still authenticates with unchanged posture'],
 rollback:['on any failure after the temporary password: manager sets the role NOLOGIN PASSWORD NULL, the sink is removed if present, and activation stops'],
 futureRotation:['a bootstrapped role rotates with reset_password alone; no SQL plaintext password is used again'],
});

/** LOGIN toggle. Requires the completed Neon reset credential for this exact role. */
export function productionCredentialActivationSql(database:string,service:CommercialCredentialService,credential:CompletedNeonResetCredential):string[]{
 assertNeonCredential(database,service,credential);
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} LOGIN`];
}
export function productionCredentialRollbackSql(database:string,service:CommercialCredentialService):string[]{
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} NOLOGIN PASSWORD NULL`];
}
/** The exact Production sensitive sink. Only a completed Neon reset credential maps to it; a temporary password cannot. */
export function productionCredentialSink(database:string,service:CommercialCredentialService,credential:CompletedNeonResetCredential){
 const c=assertNeonCredential(database,service,credential);
 return Object.freeze({key:`PRODUCTION_DB_PASSWORD_${service.toUpperCase()}`,target:'production' as const,type:'sensitive' as const,value:c.password});
}

/** Secret-free deterministic plan for Owner/TD approval. */
export function productionCredentialActivationPlan(database:string){
 const roles=commercialCredentialRoleNames(database),managerRole=database+'_role_admin';
 const body={version:PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,database,managerRole,
  initialPasswordAuthority:PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,steadyStatePasswordAuthority:PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,
  roleAttributeAuthority:managerRole,temporaryPasswordRoleState:'NOLOGIN' as const,finalPasswordSource:'NEON_RESET_RESPONSE' as const,temporaryPasswordInstalledInVercel:false,
  temporaryPassword:{entropyBytes:32,encoding:'base64url',length:43,pattern:TEMPORARY_PASSWORD.source,sql:'NOLOGIN_PASSWORD_ONE_STATEMENT',handling:'NEVER_PERSISTED_LOGGED_OR_SUNK'},
  sequence:['TEMPORARY_PASSWORD_WITH_NOLOGIN','RESET_PASSWORD_ONCE','ALL_RESET_OPERATIONS_FINISHED','DROP_TEMPORARY_REFERENCES','LOGIN_WITHOUT_PASSWORD_CLAUSE','TLS_AND_PROBES','SINK_NEON_PASSWORD'],
  passwordReset:{method:'POST',path:'/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password',idempotent:false,maxCallsPerRole:1,blindRetry:false,responseHandling:'IN_PROCESS_NEVER_PERSISTED',emptyOperations:'FAIL_CLOSED',usableAfter:'ALL_OPERATIONS_FINISHED',revealPassword:'NOT_USED'},
  futureRotation:'NEON_RESET_PASSWORD_ONLY' as const,
  sinks:Object.fromEntries(COMMERCIAL_CREDENTIAL_SERVICES.map(s=>[s,`PRODUCTION_DB_PASSWORD_${s.toUpperCase()}`])),
  services:[...COMMERCIAL_CREDENTIAL_SERVICES],roles,probes:COMMERCIAL_CREDENTIAL_PROBES,proofContract:PRODUCTION_CREDENTIAL_PROOF_CONTRACT,
  canary:'content_read' as CommercialCredentialService,remainingOperationalRolesStayNoLogin:true};
 return {...body,planSha256:sha256(JSON.stringify(body))};
}
