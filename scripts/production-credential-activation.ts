// PROD-R0.8-B: pure, no-I/O contract for the first Production credential tranche.
// No provider call, database connection, password persistence, env read or logging happens here.
// The live operator generates one password in memory, sends only its SCRAM verifier through
// ALTER ROLE, verifies the credential over TLS, then installs the plaintext into its exact secret sink.
import {createHash,createHmac,pbkdf2Sync,randomBytes} from 'node:crypto';
import {productionAppRoleNames,assertProductionDatabaseName} from './production-app-roles';
import {COMMERCIAL_DB_SERVICES} from '../packages/core/src/guest/production-commercial-composition';
import type {ProductionService} from '../packages/auth/src/production-config';

export const PRODUCTION_CREDENTIAL_ACTIVATION_VERSION='production-credential-activation/1';
export const COMMERCIAL_CREDENTIAL_SERVICES=COMMERCIAL_DB_SERVICES;
export type CommercialCredentialService=typeof COMMERCIAL_CREDENTIAL_SERVICES[number];
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v)||Buffer.byteLength(v,'utf8')>63)throw new Error('PRODUCTION_CREDENTIAL_ROLE_NAME_INVALID');return '"'+v+'"';};
const SCRAM=/^SCRAM-SHA-256\$([1-9][0-9]*):([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

export function commercialCredentialRoleNames(database:string):Record<CommercialCredentialService,string>{
 assertProductionDatabaseName(database);
 const all=productionAppRoleNames(database),out={} as Record<CommercialCredentialService,string>;
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES)out[service]=all[service];
 return out;
}

/** 256 bits of entropy, encoded as URL-safe ASCII so SCRAM has no Unicode/SASLprep ambiguity. */
export function generateProductionCredentialPassword():string{
 const bytes=randomBytes(32);
 try{return bytes.toString('base64url');}finally{bytes.fill(0);}
}
export function productionCredentialPasswordFromEntropy(entropy:Uint8Array):string{
 const bytes=Buffer.from(entropy);
 if(bytes.length!==32)throw new Error('PRODUCTION_CREDENTIAL_ENTROPY_INVALID');
 try{return bytes.toString('base64url');}finally{bytes.fill(0);}
}

/** PostgreSQL SCRAM-SHA-256 verifier. The plaintext stays client-side; only this verifier belongs
 * in ALTER ROLE. iterations must be read from the target server's scram_iterations immediately
 * before activation, never guessed from a historical default. */
export function buildScramSha256Verifier(password:string,iterations:number,salt:Uint8Array=randomBytes(16)):string{
 if(!/^[A-Za-z0-9_-]{43}$/.test(password))throw new Error('PRODUCTION_CREDENTIAL_PASSWORD_INVALID');
 if(!Number.isInteger(iterations)||iterations<4096||iterations>10_000_000)throw new Error('PRODUCTION_CREDENTIAL_SCRAM_ITERATIONS_INVALID');
 const saltBytes=Buffer.from(salt);
 if(saltBytes.length<16||saltBytes.length>64)throw new Error('PRODUCTION_CREDENTIAL_SCRAM_SALT_INVALID');
 const salted=pbkdf2Sync(Buffer.from(password,'ascii'),saltBytes,iterations,32,'sha256');
 const clientKey=createHmac('sha256',salted).update('Client Key','ascii').digest();
 const storedKey=createHash('sha256').update(clientKey).digest();
 const serverKey=createHmac('sha256',salted).update('Server Key','ascii').digest();
 try{return `SCRAM-SHA-256$${iterations}:${saltBytes.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;}
 finally{salted.fill(0);clientKey.fill(0);storedKey.fill(0);serverKey.fill(0);saltBytes.fill(0);}
}
export function assertScramSha256Verifier(verifier:string):void{
 const m=SCRAM.exec(verifier);if(!m)throw new Error('PRODUCTION_CREDENTIAL_SCRAM_VERIFIER_INVALID');
 const iterations=Number(m[1]),salt=Buffer.from(m[2]!,'base64'),stored=Buffer.from(m[3]!,'base64'),server=Buffer.from(m[4]!,'base64');
 if(!Number.isInteger(iterations)||iterations<4096||iterations>10_000_000||salt.length<16||salt.length>64||stored.length!==32||server.length!==32)
  throw new Error('PRODUCTION_CREDENTIAL_SCRAM_VERIFIER_INVALID');
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
 pre:['exact role is NOLOGIN and has the foundation role posture','server scram_iterations is read from the target','manager SET succeeds'],
 activation:['password has 256 bits of fresh entropy and never enters SQL','ALTER ROLE receives only a validated SCRAM-SHA-256 verifier','exact role becomes LOGIN'],
 connection:['verify-full TLS authentication succeeds as the exact role','verifyProductionDatabase-equivalent least-privilege posture passes'],
 probes:['one role-specific positive probe succeeds','one role-specific forbidden probe fails with SQLSTATE 42501'],
 sink:['secret is installed into the exact Production sensitive sink','only sink metadata is read back; secret value is never read back or logged'],
 rollback:['if connection/probe/sink fails: manager sets role back to NOLOGIN PASSWORD NULL and activation stops'],
});

export function productionCredentialActivationSql(database:string,service:CommercialCredentialService,verifier:string):string[]{
 const roles=commercialCredentialRoleNames(database),role=roles[service];if(!role)throw new Error('PRODUCTION_CREDENTIAL_SERVICE_INVALID');
 assertScramSha256Verifier(verifier);
 return [`SET LOCAL ROLE ${qi(database+'_role_admin')}`,`ALTER ROLE ${qi(role)} LOGIN PASSWORD '${verifier}'`];
}
export function productionCredentialRollbackSql(database:string,service:CommercialCredentialService):string[]{
 const roles=commercialCredentialRoleNames(database),role=roles[service];if(!role)throw new Error('PRODUCTION_CREDENTIAL_SERVICE_INVALID');
 return [`SET LOCAL ROLE ${qi(database+'_role_admin')}`,`ALTER ROLE ${qi(role)} NOLOGIN PASSWORD NULL`];
}

/** Secret-free deterministic plan for Owner/TD approval. */
export function productionCredentialActivationPlan(database:string){
 const roles=commercialCredentialRoleNames(database);
 const body={version:PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,database,managerRole:database+'_role_admin',
  services:[...COMMERCIAL_CREDENTIAL_SERVICES],roles,probes:COMMERCIAL_CREDENTIAL_PROBES,proofContract:PRODUCTION_CREDENTIAL_PROOF_CONTRACT,
  canary:'content_read' as CommercialCredentialService,remainingOperationalRolesStayNoLogin:true};
 return {...body,planSha256:sha256(JSON.stringify(body))};
}
