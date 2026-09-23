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
import {bootstrapPlan} from './production-bootstrap';
import {productionAppRoleNames,productionAppRoleCreateSql,productionAppRoleGrantSql} from './production-app-roles';
import {productionPaymentRoleNames,productionPaymentRoleCreateSql,productionPaymentActivationGrants} from './production-payment-roles';
import {productionBackupRoleSql} from './production-backup-role';
import {EXPECTED_PRODUCTION_DATABASE_NAME,EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256} from '../packages/auth/src/production-identity';
import {COMMERCIAL_ACTIVATION_TOKEN,COMMERCIAL_ALLOWLISTED_KEYS,COMMERCIAL_SECRET_KEYS,commercialGuestConfiguration} from '../packages/core/src/guest/production-commercial-composition';
import {guestConfigurationHash} from '../packages/contracts/src/production-guest';
import {PUBLICATION_ORIGIN} from '../packages/auth/src/publication-authority';

const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const sqlDigest=(sql:string[])=>sha256(sql.join(';\n'));

export async function productionActivationPlan(source:{head:string;tree:string;clean:boolean}){
 const db=EXPECTED_PRODUCTION_DATABASE_NAME,bootstrap=await bootstrapPlan(db);
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
  credentials:{
   webApp:{activationToken:COMMERCIAL_ACTIVATION_TOKEN,alsoRequired:['ZAO_PRODUCTION_RUNTIME'],names:[...COMMERCIAL_ALLOWLISTED_KEYS],secretNames:[...COMMERCIAL_SECRET_KEYS],
    nonSecretDerived:{PRODUCTION_DB_NAME:db,PRODUCTION_GUEST_POLICY_SHA256:guestConfigurationHash(commercialGuestConfiguration()),PRODUCTION_RELEASE_ID:source.head},
    mustBeAbsentUntilPublicationGo:['PRODUCTION_PUBLICATION_APPROVAL'],publicationOrigin:PUBLICATION_ORIGIN},
   webhookIngress:{classification:'PRODUCTION_WEBHOOK_INGRESS_ONLY',names:['PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION','PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL','PRODUCTION_SQUARE_MERCHANT_ID','PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY','PRODUCTION_RECEIVER_DATABASE_URL'],secretNames:['PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY','PRODUCTION_RECEIVER_DATABASE_URL'],receiverRole:productionPaymentRoleNames(db).receiver},
   backupWorkflow:{secretNames:workflowNames('secrets'),variableNames:workflowNames('vars')},
  },
  nextWriteStep:{
   gate:'PHASE_B_PRODUCTION_SCHEMA_BOOTSTRAP',
   action:`bootstrapProductionSchema(ownerPool,'${db}') applying ${migrationPlan.length} migrations in one transaction`,
   preconditions:[
    'Separate attended TD/Owner authorization for this exact planSha256',
    'Read-only Neon readback: exact project/branch/database, PostgreSQL 18, only the owner role present',
    `sha256(lowercased PGHOST) equals ${EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256} (bootstrap itself does not check the host)`,
    `current_database() is ${db} and contains no application objects (bootstrap refuses a non-empty database)`,
    'Neon point-in-time restore window (retention 7 days) confirmed before the write',
   ],
   rollback:'A failure rolls the single transaction back. After a successful commit, undo is Neon branch point-in-time restore to the recorded pre-bootstrap timestamp; there is no scripted down-migration.',
   proof:'Returned applied/guardsRewritten/planSha256/manifestSha256 equal this plan; foundation_migrations holds exactly the canonical rows',
  },
 };
 return {...plan,planDigestSha256:sha256(canonical(plan))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>2)throw new Error('PLAN_ARGUMENT_REJECTED');
 const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 console.log(JSON.stringify(await productionActivationPlan({head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:git('status','--porcelain').length===0}),null,1));
}
