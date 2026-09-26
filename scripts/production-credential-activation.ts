// PROD-R0.8-C: pure, no-I/O contract for the first Production credential tranche.
// No provider call, database connection, password persistence, env read or logging happens here.
// Neon rejects client-derived SCRAM verifiers ("Neon only supports being given plaintext passwords"),
// so the password is minted by Neon's reset_password API and never enters SQL. SQL only toggles LOGIN,
// through the role manager. The live operator holds the returned password in memory, proves the role
// over TLS, then installs the password into its exact Production sensitive sink.
import {createHash} from 'node:crypto';
import {productionAppRoleNames,assertProductionDatabaseName} from './production-app-roles';
import {COMMERCIAL_DB_SERVICES} from '../packages/core/src/guest/production-commercial-composition';

export const PRODUCTION_CREDENTIAL_ACTIVATION_VERSION='production-credential-activation/2';
export const PRODUCTION_CREDENTIAL_PASSWORD_AUTHORITY='NEON_ROLE_RESET_PASSWORD_API';
export const COMMERCIAL_CREDENTIAL_SERVICES=COMMERCIAL_DB_SERVICES;
export type CommercialCredentialService=typeof COMMERCIAL_CREDENTIAL_SERVICES[number];
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v)||Buffer.byteLength(v,'utf8')>63)throw new Error('PRODUCTION_CREDENTIAL_ROLE_NAME_INVALID');return '"'+v+'"';};
const PROJECT_ID=/^[a-z0-9-]{1,60}$/,BRANCH_ID=/^br-[a-z0-9-]{1,60}$/;

export function commercialCredentialRoleNames(database:string):Record<CommercialCredentialService,string>{
 assertProductionDatabaseName(database);
 const all=productionAppRoleNames(database),out={} as Record<CommercialCredentialService,string>;
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES)out[service]=all[service];
 return out;
}
const roleFor=(database:string,service:CommercialCredentialService)=>{const role=commercialCredentialRoleNames(database)[service];if(!role)throw new Error('PRODUCTION_CREDENTIAL_SERVICE_INVALID');return role;};

/** The one provider call that mints a password. Non-idempotent POST: exactly one call per role, never
 * retried; an unknown outcome is resolved by read-only state inspection, never by a second reset. The
 * response carries the password and must be parsed in memory only. reveal_password is not part of it. */
export function productionCredentialResetPasswordRequest(projectId:string,branchId:string,database:string,service:CommercialCredentialService){
 if(!PROJECT_ID.test(projectId)||!BRANCH_ID.test(branchId))throw new Error('PRODUCTION_CREDENTIAL_TARGET_INVALID');
 return Object.freeze({method:'POST' as const,path:`/projects/${projectId}/branches/${branchId}/roles/${roleFor(database,service)}/reset_password`,idempotent:false,maxCalls:1});
}
/** Reads the password out of a reset_password response held in memory. Nothing else in it is secret. */
export function productionCredentialPasswordFromResetResponse(body:unknown,expectedRole:string):{password:string;operationIds:string[]}{
 const b=body as {role?:{name?:unknown;password?:unknown};operations?:Array<{id?:unknown}>}|null;
 if(!b||typeof b!=='object'||!b.role||b.role.name!==expectedRole||typeof b.role.password!=='string'||b.role.password.length<16||b.role.password.length>512)
  throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 const operationIds=(Array.isArray(b.operations)?b.operations:[]).map(o=>o?.id);
 if(operationIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new Error('PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID');
 return {password:b.role.password,operationIds:operationIds as string[]};
}

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
 pre:['exact role is NOLOGIN and has the foundation role posture','role is registered in the Neon role API','manager SET succeeds','no Production password sink exists yet'],
 passwordReset:['exactly one reset_password POST (non-idempotent, never retried)','password parsed in memory only; raw response never logged or stored','final returned operation finished before use',
  'unknown outcome: read-only inspection, no second reset, no reveal_password; role stays NOLOGIN'],
 preLogin:['after reset the role is still NOLOGIN with identical attributes, memberships, grantors, ownership and ACL'],
 activation:['SQL contains no password and no verifier: manager SET, then ALTER ROLE <role> LOGIN','the only catalog delta is rolcanlogin false -> true'],
 connection:['verify-full TLS authentication succeeds as the exact role','verifyProductionDatabase-equivalent least-privilege posture passes'],
 probes:['one role-specific positive probe succeeds','one role-specific forbidden probe fails with SQLSTATE 42501'],
 sink:['password is installed into the exact Production sensitive sink','only sink metadata is read back; the value is never read back or logged'],
 canary:['content_read first; one endpoint restart, then the same in-memory password still authenticates with unchanged posture'],
 rollback:['on any failure after reset: manager sets the role NOLOGIN PASSWORD NULL, the sink is removed if present, and activation stops'],
});

export function productionCredentialActivationSql(database:string,service:CommercialCredentialService):string[]{
 return [`SET LOCAL ROLE ${qi(database+'_role_admin')}`,`ALTER ROLE ${qi(roleFor(database,service))} LOGIN`];
}
export function productionCredentialRollbackSql(database:string,service:CommercialCredentialService):string[]{
 return [`SET LOCAL ROLE ${qi(database+'_role_admin')}`,`ALTER ROLE ${qi(roleFor(database,service))} NOLOGIN PASSWORD NULL`];
}

/** Secret-free deterministic plan for Owner/TD approval. */
export function productionCredentialActivationPlan(database:string){
 const roles=commercialCredentialRoleNames(database);
 const body={version:PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,database,managerRole:database+'_role_admin',
  passwordAuthority:PRODUCTION_CREDENTIAL_PASSWORD_AUTHORITY,roleAttributeAuthority:database+'_role_admin',passwordSqlTransport:'NONE' as const,
  passwordReset:{method:'POST',path:'/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password',idempotent:false,maxCallsPerRole:1,blindRetry:false,responseHandling:'MEMORY_ONLY',revealPassword:'NOT_USED'},
  services:[...COMMERCIAL_CREDENTIAL_SERVICES],roles,probes:COMMERCIAL_CREDENTIAL_PROBES,proofContract:PRODUCTION_CREDENTIAL_PROOF_CONTRACT,
  canary:'content_read' as CommercialCredentialService,remainingOperationalRolesStayNoLogin:true};
 return {...body,planSha256:sha256(JSON.stringify(body))};
}
