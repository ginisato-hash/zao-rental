// NO-WRITE operator plan for the attended Production activation. It connects to nothing (no
// database, provider, GitHub or network), reads only committed source and local git, and prints
// one JSON plan with a digest the operator records before any live step. Every credential
// appears by NAME only; no value is read, even when present in the environment.
// There is deliberately no APPLY mode here: each live write stays a separately attended action.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {canonical} from '../packages/contracts/src/hold';
import {migrationPlan} from '../packages/db/src/index';
import {productionFoundationPlan} from './production-bootstrap';
import {productionAppRoleNames,productionAppRoleCreateSql,productionAppRoleGrantSql} from './production-app-roles';
import {productionPaymentRoleNames,productionPaymentRoleCreateSql,productionPaymentActivationGrants} from './production-payment-roles';
import {productionBackupRoleSql} from './production-backup-role';
import {productionCredentialActivationPlan} from './production-credential-activation';
import {EXPECTED_PRODUCTION_DATABASE_NAME,EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256} from '../packages/auth/src/production-identity';
import {WORKER_TICK_ACTIVATION,WORKER_TICK_ENV_KEYS} from '../packages/core/src/payment/worker-tick';
import {COMMERCIAL_ACTIVATION_TOKEN,COMMERCIAL_ALLOWLISTED_KEYS,COMMERCIAL_SECRET_KEYS,commercialGuestConfiguration} from '../packages/core/src/guest/production-commercial-composition';
import {guestConfigurationHash} from '../packages/contracts/src/production-guest';
import {PUBLICATION_ORIGIN} from '../packages/auth/src/publication-authority';

const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const sqlDigest=(sql:string[])=>sha256(sql.join(';\n'));

export async function productionActivationPlan(source:{head:string;tree:string;clean:boolean}){
 const db=EXPECTED_PRODUCTION_DATABASE_NAME,foundation=await productionFoundationPlan(db),bootstrap=foundation.bootstrap,roleProvisioning=foundation.roles,credentialActivation=productionCredentialActivationPlan(db);
 const appCreate=productionAppRoleCreateSql(db),appGrant=productionAppRoleGrantSql(db),payCreate=productionPaymentRoleCreateSql(db),payGrant=productionPaymentActivationGrants(db),backup=productionBackupRoleSql(db);
 const backupWorkflow=readFileSync('.github/workflows/production-backup.yml','utf8');
 const workflowNames=(kind:'secrets'|'vars')=>[...new Set([...backupWorkflow.matchAll(new RegExp(`\\$\\{\\{\\s*${kind}\\.([A-Z0-9_]+)\\s*\\}\\}`,'g'))].map(m=>m[1]!))].sort();
 const plan={
  classification:'PRODUCTION_ACTIVATION_PLAN_NO_WRITE',writes:0,networkRequests:0,valuesRead:0,
  release:{head:source.head,tree:source.tree,worktreeClean:source.clean},
  target:{provider:'NEON',database:db,hostFingerprintSha256:EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,vercelProjectFingerprintSha256:EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256},
  bootstrap:{canonicalMigrations:migrationPlan.length,firstMigration:migrationPlan[0]!.id,lastMigration:migrationPlan.at(-1)!.id,guardsRewritten:bootstrap.guardsRewritten,transformerVersion:bootstrap.transformerVersion,planSha256:bootstrap.planSha256,sourceManifestSha256:bootstrap.manifestSha256},
  roles:{
   app:{names:Object.values(productionAppRoleNames(db)),createSqlSha256:sqlDigest(appCreate),grantSqlSha256:sqlDigest(appGrant),statements:appCreate.length+appGrant.length},
   payment:{names:Object.values(productionPaymentRoleNames(db)),createSqlSha256:sqlDigest(payCreate),grantSqlSha256:sqlDigest(payGrant),statements:payCreate.length+payGrant.length},
   backup:{names:[db+'_backup'],sqlSha256:sqlDigest(backup),statements:backup.length},
   loginState:'ALL_NOLOGIN_BY_PLAN; LOGIN+password is a separate out-of-band attended step per role',
  },
  roleProvisioning:{roleProvisioningVersion:roleProvisioning.version,managerRole:roleProvisioning.managerRole,operationalRoles:roleProvisioning.operationalRoleNames,
   ownerGrantStatements:roleProvisioning.ownerGrantStatements.length,custodyExecutorGrantStatements:roleProvisioning.custodyExecutorGrantStatements.length,
   roleProvisioningPlanSha256:roleProvisioning.planSha256,foundationPlanSha256:foundation.foundationPlanSha256,binding:foundation.binding},
  credentialActivation:{version:credentialActivation.version,managerRole:credentialActivation.managerRole,services:credentialActivation.services,roles:credentialActivation.roles,
   initialPasswordAuthority:credentialActivation.initialPasswordAuthority,steadyStatePasswordAuthority:credentialActivation.steadyStatePasswordAuthority,roleAttributeAuthority:credentialActivation.roleAttributeAuthority,
   temporaryPasswordRoleState:credentialActivation.temporaryPasswordRoleState,finalPasswordSource:credentialActivation.finalPasswordSource,temporaryPasswordInstalledInVercel:credentialActivation.temporaryPasswordInstalledInVercel,
   preFinalizationPasswordLease:credentialActivation.preFinalizationPasswordLease,passwordLeaseMinutes:credentialActivation.passwordLeaseMinutes,sinkOrdering:credentialActivation.sinkOrdering,
   containmentSql:credentialActivation.containmentSql,containmentRetry:credentialActivation.containmentRetry,finalization:credentialActivation.finalization,finalizationFailure:credentialActivation.finalizationFailure,
   canarySequence:credentialActivation.canarySequence,remainingSequence:credentialActivation.remainingSequence,remainingOrder:credentialActivation.remainingOrder,
   passwordReset:credentialActivation.passwordReset,restart:credentialActivation.restart,futureRotation:credentialActivation.futureRotation,
   canary:credentialActivation.canary,probes:credentialActivation.probes,proofContract:credentialActivation.proofContract,planSha256:credentialActivation.planSha256,
   branchProtection:'REQUIRED_BEFORE_FIRST_CREDENTIAL',remainingOperationalRolesStayNoLogin:credentialActivation.remainingOperationalRolesStayNoLogin},
  credentials:{
   webApp:{activationToken:COMMERCIAL_ACTIVATION_TOKEN,alsoRequired:['ZAO_PRODUCTION_RUNTIME'],names:[...COMMERCIAL_ALLOWLISTED_KEYS],secretNames:[...COMMERCIAL_SECRET_KEYS],
    nonSecretDerived:{PRODUCTION_DB_NAME:db,PRODUCTION_GUEST_POLICY_SHA256:guestConfigurationHash(commercialGuestConfiguration()),PRODUCTION_RELEASE_ID:source.head},
    mustBeAbsentUntilPublicationGo:['PRODUCTION_PUBLICATION_APPROVAL'],publicationOrigin:PUBLICATION_ORIGIN},
   webhookIngress:{classification:'PRODUCTION_WEBHOOK_INGRESS_ONLY',names:['PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION','PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL','PRODUCTION_SQUARE_MERCHANT_ID','PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY','PRODUCTION_RECEIVER_DATABASE_URL'],secretNames:['PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY','PRODUCTION_RECEIVER_DATABASE_URL'],receiverRole:productionPaymentRoleNames(db).receiver},
   normalWorker:{scheduler:'VERCEL_CRON',route:'/api/internal/worker-tick',schedule:'* * * * *',names:[...WORKER_TICK_ENV_KEYS],secretNames:['CRON_SECRET','PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER','PRODUCTION_WORKER_DB_PASSWORD_WORKER','PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR'],mustBeAbsentUntilActivation:['PRODUCTION_WORKER_TICK_ACTIVATION'],activationToken:WORKER_TICK_ACTIVATION,fixedLimits:{notificationLimit:0,refundCreateLimit:0,refundBudgetJpy:0},plan:'docs/execution/release-code-closure/NORMAL_WORKER_ROLES_PLAN.md'},
   backupWorkflow:{secretNames:workflowNames('secrets'),variableNames:workflowNames('vars')},
  },
  nextWriteStep:{
   gate:'PRODUCTION_CREDENTIAL_CANARY',
   action:`provision only ${credentialActivation.roles[credentialActivation.canary]}: ${credentialActivation.managerRole} sets a disposable temporary password together with NOLOGIN and VALID UNTIL infinity in one SQL statement, one Neon reset_password POST replaces it (Neon password never persisted or logged), after every returned operation finished ${credentialActivation.managerRole} grants LOGIN with a ${credentialActivation.passwordLeaseMinutes}-minute VALID UNTIL lease from database time, then direct TLS/probes, one endpoint restart and the same proof again; only then the exact Production sensitive sink receives the Neon password, and only a confirmed sink allows VALID UNTIL infinity`,
   preconditions:[
    'Foundation bootstrap and Production promotion are already accepted; read-only schema/security/role baselines still match',
    'Active Production branch and rollback branch are protected before any real credential is minted',
    `Credential activation plan digest equals ${credentialActivation.planSha256}`,
    `The canary ${credentialActivation.roles[credentialActivation.canary]} is NOLOGIN with no password and the foundation least-privilege posture`,
    'Its VALID UNTIL is NULL (READY_PRISTINE) or infinity (READY_NORMALIZED); a finite VALID UNTIL, expired or future, is a STALE_LEASE and not a clean baseline; a STALE_LEASE role is first repaired by separately authorized containment and must read back READY_NORMALIZED before the network gate',
    'The temporary password is 43-char base64url, set with NOLOGIN and VALID UNTIL infinity in one statement (defense in depth from a clean baseline, not a STALE_LEASE repair route; never LOGIN), never persisted, logged or installed in any sink',
    'reset_password is a non-idempotent POST: one call per role, no blind retry, response parsed in process and never persisted, empty operations fail closed, usable only after all returned operations finished, reveal_password not used',
    'After the reset and before LOGIN, the role posture (attributes, memberships, grantors, ownership, ACL) is unchanged',
    'A network stability gate passes before any mutation (3 rounds over at least 60 seconds)',
    'No password reaches the sink before restart persistence is proven; a failed finalization or readback deletes the sink and contains',
   ],
   rollback:`On any failure after the temporary password is set: SET LOCAL ROLE ${credentialActivation.managerRole}; ALTER ROLE ${credentialActivation.roles[credentialActivation.canary]} NOLOGIN PASSWORD NULL VALID UNTIL 'infinity' (idempotent, retried with bounded backoff until a READY_NORMALIZED readback: LOGIN false, no password, VALID UNTIL infinity; LOGIN false alone is not complete), delete the sink if present, never repeat reset_password or restart, stop before any other role`,
   proof:`The canary logs in over verify-full TLS as itself, passes its positive probe, fails its negative probe with 42501, survives one compute restart with the same credential, the sink reports only expected metadata, and the final readback is LOGIN with VALID UNTIL infinity`,
   notIncluded:'The other nine commercial credentials, avatar, payment worker/receiver, backup, Square, Resend, publication, DNS and cleanup remain separate gates',
  },
 };
 return {...plan,planDigestSha256:sha256(canonical(plan))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>2)throw new Error('PLAN_ARGUMENT_REJECTED');
 const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 console.log(JSON.stringify(await productionActivationPlan({head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:git('status','--porcelain').length===0}),null,1));
}
