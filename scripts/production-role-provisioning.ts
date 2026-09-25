// PROD-R0.7-C: pure plan for provisioning the 17 operational Production roles inside the foundation
// bootstrap transaction. No DB access, no password, no LOGIN. Measured on real Neon (PROD-R0.7-A/B):
// a role the database owner creates directly leaves the owner an irrevocable ADMIN membership, so the
// roles are created by a persistent NOLOGIN manager, <db>_role_admin, that the owner can SET to; and
// the five custody functions' EXECUTE can only be granted by their owner, <db>_custody_executor.
import {createHash} from 'node:crypto';
import {productionBackupRoleCreateSql,productionBackupRoleGrantSql} from './production-backup-role';
import {productionPaymentRoleNames,productionPaymentRoleCreateSql,productionPaymentActivationGrants} from './production-payment-roles';
import {productionAppRoleNames,productionAppRoleCreateSql,productionAppRoleGrantPlan,assertProductionDatabaseName} from './production-app-roles';

export const PRODUCTION_ROLE_PROVISIONING_VERSION='production-role-provisioning/1';
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v)||Buffer.byteLength(v,'utf8')>63)throw new Error('PRODUCTION_ROLE_NAME_INVALID '+v);return '"'+v+'"';};

/** Fail-closed pre-COMMIT contract; its digest is bound into the plan. */
export const ROLE_PROVISIONING_PROOF_CONTRACT={
 manager:['exactly one <db>_role_admin: NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  'session_user -> manager aggregate: ADMIN true, SET true, INHERIT false (grantor not fixed)',
  'manager memberships in custody roles 0; manager cannot SET either custody role'],
 operational:['17 roles exist, each NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; INHERIT only for <db>_backup',
  'session_user direct memberships in operational roles 0',
  'manager -> each operational role: exactly one row, ADMIN true, INHERIT false, SET false; no other members',
  'operational roles are members of nothing except <db>_backup IN pg_read_all_data'],
 authority:['after OWNER grants: no ACL entry to an operational role has a custody role as grantor',
  'after CUSTODY_EXECUTOR grants: custody-granted ACL entries to operational roles equal exactly the planned set',
  '<db>_operations holds EXECUTE on each planned custody function without any custody membership'],
};

export type RoleProvisioningPlan=ReturnType<typeof productionRoleProvisioningPlan>;
export function productionRoleProvisioningPlan(database:string){
 assertProductionDatabaseName(database);
 const managerRole=database+'_role_admin',executorRole=database+'_custody_executor',custodyRole=database+'_custody';
 qi(managerRole);
 const pay=productionPaymentRoleNames(database),app=productionAppRoleNames(database);
 const operationalRoleNames=[database+'_backup',...Object.values(pay),...Object.values(app)];
 const operationalCreateSql=[...productionBackupRoleCreateSql(database),...productionPaymentRoleCreateSql(database),...productionAppRoleCreateSql(database)];
 const appPlan=productionAppRoleGrantPlan(database);
 const ownerGrantStatements=[...productionBackupRoleGrantSql(database),...productionPaymentActivationGrants(database),...appPlan.filter(x=>x.authority==='OWNER').map(x=>x.sql)];
 const custodyExecutorGrantStatements=appPlan.filter(x=>x.authority==='CUSTODY_EXECUTOR').map(x=>x.sql);
 if(operationalRoleNames.length!==17||new Set(operationalRoleNames).size!==17||operationalCreateSql.length!==17)throw new Error('PRODUCTION_ROLE_PROVISIONING_PLAN_SHAPE');
 const body={
  version:PRODUCTION_ROLE_PROVISIONING_VERSION,database,managerRole,executorRole,custodyRole,operationalRoleNames,
  managerCreateSql:`CREATE ROLE ${qi(managerRole)} NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
  // Creating the manager already gives the owner ADMIN on it; SET is added explicitly, INHERIT is not.
  ownerManagerMembershipSql:[`GRANT ${qi(managerRole)} TO SESSION_USER WITH SET TRUE, INHERIT FALSE`],
  enterManagerSql:[`SET LOCAL ROLE ${qi(managerRole)}`],
  operationalCreateSql,
  ownerGrantStatements,
  enterCustodyExecutorSql:[`SET LOCAL ROLE ${qi(executorRole)}`],
  custodyExecutorGrantStatements,
  resetRoleSql:'RESET ROLE',
  proofContract:ROLE_PROVISIONING_PROOF_CONTRACT,
 };
 return {...body,planSha256:sha256(JSON.stringify(body))};
}
/** Authority-tagged grants in execution order, the form the foundation digest binds. */
export function authorityTaggedGrants(plan:Pick<RoleProvisioningPlan,'ownerGrantStatements'|'custodyExecutorGrantStatements'>){
 return [...plan.ownerGrantStatements.map(sql=>({authority:'OWNER' as const,sql})),...plan.custodyExecutorGrantStatements.map(sql=>({authority:'CUSTODY_EXECUTOR' as const,sql}))];
}
export const roleProvisioningDigests=(plan:RoleProvisioningPlan)=>({
 roleProvisioningPlanSha256:plan.planSha256,
 proofContractSha256:sha256(JSON.stringify(plan.proofContract)),
 authorityTaggedGrantsSha256:sha256(JSON.stringify(authorityTaggedGrants(plan))),
});
