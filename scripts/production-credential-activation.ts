// PROD-R0.8-F: contract for the first Production credential tranche.
// The clock adapter performs one read through an operator-owned PostgreSQL client; all other helpers
// remain no-I/O. No provider call, connection creation, password persistence, env read or logging happens here.
// Neon rejects client-derived SCRAM verifiers, and its reset_password API refuses a role that has no
// password yet. Operational roles are created NOLOGIN PASSWORD NULL, so the lifecycle is hybrid:
//  1. initial bootstrap: a disposable 43-char base64url password is set through the role manager in
//     one statement that also asserts NOLOGIN and VALID UNTIL 'infinity', so it never exists on a LOGIN-capable
//     role and no finite VALID UNTIL left by an earlier lease (Neon refuses a password on an expired role) survives;
//  2. exactly one Neon reset_password replaces it; the response is only a pending credential until
//     every returned operation has finished;
//  3. LOGIN is granted with a bounded VALID UNTIL lease derived from database time, so losing operator
//     connectivity cannot leave an indefinitely usable credential. Expiry is proven by rejecting a NEW
//     connection; existing sessions are not assumed to be terminated;
//  4. the final password reaches its Production sensitive sink only after direct TLS and probe proof
//     and, for the canary, after restart persistence proof. Only a confirmed sink allows VALID UNTIL
//     'infinity', once: issuing it consumes the confirmation, and a failed finalization or its one readback is a
//     terminal activation failure (delete sink, contain, stop) with no proof left to retry with.
// Containment (NOLOGIN PASSWORD NULL VALID UNTIL 'infinity', sink deletion) is idempotent and retried with bounded
// backoff; it also clears the finite lease, so no stale VALID UNTIL is carried into a later lifecycle;
// reset_password and restart are non-idempotent and never resent. Secrets are never persisted, logged or
// sunk except the proven Neon password into its sink; references are dropped (no zeroization is claimed).
// Future live rotation of a bootstrapped role is out of scope and requires separate coordination.
import {createHash,randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {productionAppRoleNames,assertProductionDatabaseName} from './production-app-roles';
import {COMMERCIAL_DB_SERVICES} from '../packages/core/src/guest/production-commercial-composition';

export const PRODUCTION_CREDENTIAL_ACTIVATION_VERSION='production-credential-activation/5';
export const PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY='SQL_TEMPORARY_PLAINTEXT_NOLOGIN';
export const PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY='NEON_ROLE_RESET_PASSWORD_API';
export const COMMERCIAL_CREDENTIAL_SERVICES=COMMERCIAL_DB_SERVICES;
export type CommercialCredentialService=typeof COMMERCIAL_CREDENTIAL_SERVICES[number];
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v)||Buffer.byteLength(v,'utf8')>63)throw new Error('PRODUCTION_CREDENTIAL_ROLE_NAME_INVALID');return '"'+v+'"';};
const PROJECT_ID=/^[a-z0-9-]{1,60}$/,BRANCH_ID=/^br-[a-z0-9-]{1,60}$/,ENDPOINT_ID=/^ep-[a-z0-9-]{1,60}$/;
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
/** Initial bootstrap SQL: manager SET, then NOLOGIN, the temporary password and VALID UNTIL 'infinity' in one
 * statement, so the temporary password can never be present on a LOGIN-capable role regardless of the prior state,
 * and a stale finite VALID UNTIL is normalized. The role stays NOLOGIN; the 20-minute lease is only set by LOGIN. */
export function productionCredentialTemporaryPasswordSql(database:string,service:CommercialCredentialService,temporary:string):string[]{
 assertProductionCredentialTemporaryPassword(temporary);
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} NOLOGIN PASSWORD '${temporary}' VALID UNTIL 'infinity'`];
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

export const PRODUCTION_CREDENTIAL_CANARY='content_read' satisfies CommercialCredentialService;
/** The nine non-canary roles, activated strictly one after another only after the canary passes. */
export const PRODUCTION_CREDENTIAL_REMAINING_ORDER=Object.freeze(['booking_access','recommendation','pricing','guest','ledger','hold','transfer','auth','operations'] as const satisfies readonly CommercialCredentialService[]);
export const PRODUCTION_CREDENTIAL_PASSWORD_LEASE_MINUTES=20;
const LEASE_DEADLINE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
/** Containment is the idempotent safety operation: retried with bounded backoff until LOGIN=false is read back.
 * It also normalizes VALID UNTIL to 'infinity', so a contained role returns to READY_NORMALIZED, not STALE_LEASE. */
export const PRODUCTION_CREDENTIAL_CONTAINMENT=Object.freeze({sql:'NOLOGIN_PASSWORD_NULL_VALID_UNTIL_INFINITY_IDEMPOTENT' as const,retry:'BOUNDED_UNTIL_CONFIRMED' as const,
 backoffSeconds:Object.freeze([5,10,20,30]),maxWindowSeconds:600,confirmation:'LOGIN_FALSE_READBACK' as const,sinkDeletion:'IDEMPOTENT_ABSENT_IS_SUCCESS' as const,
 neverRepeated:Object.freeze(['reset_password','endpoint_restart'])});
/** Delays in seconds for successive containment attempts: 5, 10, 20, then 30 repeatedly, never beyond the window. */
export function productionCredentialContainmentSchedule():number[]{
 const out:number[]=[];let total=0;
 for(let i=0;;i++){const d=PRODUCTION_CREDENTIAL_CONTAINMENT.backoffSeconds[Math.min(i,PRODUCTION_CREDENTIAL_CONTAINMENT.backoffSeconds.length-1)]!;if(total+d>PRODUCTION_CREDENTIAL_CONTAINMENT.maxWindowSeconds)break;out.push(d);total+=d;}
 return out;
}

type Stage='COMPLETED'|'PROBE_PROVEN'|'RESTART_PROVEN'|'SINK_CONFIRMED'|'FINALIZATION_ATTEMPT';
export type ProbeProvenNeonCredential=Readonly<{role:string;password:string;stage:'PROBE_PROVEN'}>;
export type RestartProvenNeonCredential=Readonly<{role:string;password:string;stage:'RESTART_PROVEN'}>;
export type SinkConfirmedNeonCredential=Readonly<{role:string;stage:'SINK_CONFIRMED';sinkKey:string}>;
/** One issued VALID UNTIL 'infinity' statement awaiting its one readback. Exists only after its sink confirmation was consumed. */
export type FinalizationAttemptNeonCredential=Readonly<{role:string;stage:'FINALIZATION_ATTEMPT';sinkKey:string;sql:readonly string[]}>;
const neonStage=new WeakMap<object,Stage>();
const stageOf=(credential:unknown):Stage|undefined=>typeof credential==='object'&&credential!==null?(neonCompleted.has(credential)?'COMPLETED':neonStage.get(credential)):undefined;
const requireStage=(database:string,service:CommercialCredentialService,credential:unknown,allowed:readonly Stage[],error:string)=>{
 const stage=stageOf(credential);
 if(!stage||!allowed.includes(stage)||(credential as {role:string}).role!==roleFor(database,service))throw new Error(error);
 return credential as {role:string;password:string};
};
const sinkKeyFor=(service:CommercialCredentialService)=>`PRODUCTION_DB_PASSWORD_${service.toUpperCase()}`;

/** Clock provenance is established at the I/O boundary, never by accepting a timestamp or query-result object.
 * The operator owns the connected pg client and its transport; in-process replacement of that trusted adapter
 * is outside this capability boundary. The fixed query also verifies the actual database identity. */
export type DatabaseClockProof=Readonly<{database:string;service:CommercialCredentialService;role:string;databaseNow:string}>;
export type LeaseDeadlineProof=DatabaseClockProof&Readonly<{deadline:string;leaseMinutes:20}>;
const databaseClockProofs=new WeakSet<object>(),leaseProofs=new WeakSet<object>();
export async function productionCredentialReadDatabaseClock(database:string,service:CommercialCredentialService,client:Client):Promise<DatabaseClockProof>{
 const role=roleFor(database,service);
 if(!(client instanceof Client))throw new Error('PRODUCTION_CREDENTIAL_DATABASE_CLIENT_REQUIRED');
 const result=await client.query<{database:string;database_now:string}>('SELECT current_database() AS database, clock_timestamp()::text AS database_now');
 if(result.rows.length!==1||result.rows[0]?.database!==database||typeof result.rows[0].database_now!=='string')throw new Error('PRODUCTION_CREDENTIAL_DATABASE_CLOCK_READ_INVALID');
 const proof=Object.freeze({database,service,role,databaseNow:result.rows[0].database_now});
 databaseClockProofs.add(proof);
 return proof;
}
/** Consumes one actual DB read for this database/role. Add exactly 20 minutes, retaining PostgreSQL's
 * fractional seconds while normalizing the timezone; neither a caller deadline nor local time is accepted. */
export function productionCredentialLeaseDeadline(database:string,service:CommercialCredentialService,clock:DatabaseClockProof):LeaseDeadlineProof{
 if(typeof clock!=='object'||clock===null||!databaseClockProofs.has(clock)||clock.database!==database||clock.service!==service||clock.role!==roleFor(database,service))throw new Error('PRODUCTION_CREDENTIAL_DATABASE_CLOCK_PROOF_REQUIRED');
 databaseClockProofs.delete(clock);
 const parts=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,6})?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(clock.databaseNow);
 if(!parts)throw new Error('PRODUCTION_CREDENTIAL_DATABASE_TIME_INVALID');
 const t=Date.parse(`${parts[1]}T${parts[2]}${parts[4]!.replace(/^([+-]\d{2})$/,'$1:00')}`);
 if(!Number.isFinite(t))throw new Error('PRODUCTION_CREDENTIAL_DATABASE_TIME_INVALID');
 const deadline=new Date(t+PRODUCTION_CREDENTIAL_PASSWORD_LEASE_MINUTES*60000).toISOString().replace('.000Z',`${parts[3]??''}Z`);
 const proof=Object.freeze({...clock,deadline,leaseMinutes:PRODUCTION_CREDENTIAL_PASSWORD_LEASE_MINUTES});
 leaseProofs.add(proof);
 return proof;
}
/** LOGIN with the bounded lease. Requires the completed Neon reset credential for this exact role and an unspent lease
 * proof, which this call consumes. No password clause. */
export function productionCredentialActivationSql(database:string,service:CommercialCredentialService,credential:CompletedNeonResetCredential,lease:LeaseDeadlineProof):string[]{
 requireStage(database,service,credential,['COMPLETED'],'PRODUCTION_CREDENTIAL_COMPLETED_NEON_RESET_REQUIRED');
 if(typeof lease!=='object'||lease===null||!leaseProofs.has(lease)||lease.database!==database||lease.service!==service||lease.role!==roleFor(database,service)||!LEASE_DEADLINE.test(lease.deadline))throw new Error('PRODUCTION_CREDENTIAL_LEASE_PROOF_REQUIRED');
 leaseProofs.delete(lease);
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} LOGIN VALID UNTIL '${lease.deadline}'`];
}
export type ProductionCredentialProbeEvidence=Readonly<{currentUser:string;sessionUser:string;tlsVerifyFull:boolean;positive:'PASS'|string;negativeSqlState:string|null;postureUnchanged:boolean}>;
const assertProbeEvidence=(role:string,service:CommercialCredentialService,e:ProductionCredentialProbeEvidence|null|undefined)=>{
 if(!e||e.currentUser!==role||e.sessionUser!==role||e.tlsVerifyFull!==true||e.positive!=='PASS'||e.negativeSqlState!==COMMERCIAL_CREDENTIAL_PROBES[service].negativeSqlState||e.postureUnchanged!==true)
  throw new Error('PRODUCTION_CREDENTIAL_PROBE_EVIDENCE_INVALID');
};
/** Direct TLS login and probes passed with the leased LOGIN. For non-canary roles this is the pre-sink proof. */
export function productionCredentialProbeProven(database:string,service:CommercialCredentialService,credential:CompletedNeonResetCredential,evidence:ProductionCredentialProbeEvidence):ProbeProvenNeonCredential{
 const c=requireStage(database,service,credential,['COMPLETED'],'PRODUCTION_CREDENTIAL_COMPLETED_NEON_RESET_REQUIRED');
 assertProbeEvidence(c.role,service,evidence);
 neonCompleted.delete(credential);
 const proven=Object.freeze({role:c.role,password:c.password,stage:'PROBE_PROVEN' as const});neonStage.set(proven,'PROBE_PROVEN');return proven;
}
export type NeonRestartOperationClass='TERMINAL_SUCCESS'|'TERMINAL_FAILURE'|'PENDING'|'ANOMALOUS';
/** Endpoint restart readiness only, never reset completion or credential persistence proof.
 * A skipped provider operation is immediately terminal, but requires explicit zero failures and no error. */
export function productionCredentialRestartOperationClass(status:unknown,error?:unknown,failuresCount?:unknown):NeonRestartOperationClass{
 switch(status){
  case 'finished':return 'TERMINAL_SUCCESS';
  case 'skipped':return failuresCount===0&&(error===undefined||error===null||error==='')?'TERMINAL_SUCCESS':'ANOMALOUS';
  case 'failed':case 'error':case 'cancelled':return 'TERMINAL_FAILURE';
  case 'scheduling':case 'running':case 'cancelling':return 'PENDING';
  default:return 'ANOMALOUS';
 }
}

/** The one endpoint restart of the canary. Non-idempotent: never resent after an unknown outcome. */
export function productionCredentialRestartRequest(projectId:string,endpointId:string){
 if(!PROJECT_ID.test(projectId)||!ENDPOINT_ID.test(endpointId))throw new Error('PRODUCTION_CREDENTIAL_TARGET_INVALID');
 return Object.freeze({method:'POST' as const,path:`/projects/${projectId}/endpoints/${endpointId}/restart`,idempotent:false,maxCalls:1,blindResendAfterUnknown:false});
}
/** Restart persistence: a proven restart, then the SAME credential (object identity, hence the same role and
 * password) authenticates again over verify-full TLS and passes both probes with unchanged posture. Canary only. */
export function productionCredentialRestartProven(database:string,service:CommercialCredentialService,credential:ProbeProvenNeonCredential,
 evidence:ProductionCredentialProbeEvidence&Readonly<{restartProven:boolean;authenticatedWith:unknown}>):RestartProvenNeonCredential{
 if(service!==PRODUCTION_CREDENTIAL_CANARY)throw new Error('PRODUCTION_CREDENTIAL_RESTART_IS_CANARY_ONLY');
 const c=requireStage(database,service,credential,['PROBE_PROVEN'],'PRODUCTION_CREDENTIAL_PROBE_PROOF_REQUIRED');
 if(!evidence||evidence.restartProven!==true||evidence.authenticatedWith!==credential)throw new Error('PRODUCTION_CREDENTIAL_RESTART_EVIDENCE_INVALID');
 assertProbeEvidence(c.role,service,evidence);
 neonStage.delete(credential);
 const proven=Object.freeze({role:c.role,password:c.password,stage:'RESTART_PROVEN' as const});neonStage.set(proven,'RESTART_PROVEN');return proven;
}
/** The exact Production sensitive sink. The canary needs restart persistence proof first; every other role needs
 * its probe proof. A temporary password, a pending or a merely completed credential can never map to it. */
export function productionCredentialSink(database:string,service:CommercialCredentialService,credential:ProbeProvenNeonCredential|RestartProvenNeonCredential){
 const c=requireStage(database,service,credential,service===PRODUCTION_CREDENTIAL_CANARY?['RESTART_PROVEN']:['PROBE_PROVEN'],'PRODUCTION_CREDENTIAL_SINK_PROOF_REQUIRED');
 return Object.freeze({key:sinkKeyFor(service),target:'production' as const,type:'sensitive' as const,value:c.password});
}
/** Metadata-only sink proof (the value is never read back). Consumes the password-bearing proof. */
export function productionCredentialSinkConfirmed(database:string,service:CommercialCredentialService,credential:ProbeProvenNeonCredential|RestartProvenNeonCredential,
 metadata:ReadonlyArray<Readonly<{key:string;type:string;target:readonly string[]}>>):SinkConfirmedNeonCredential{
 const c=requireStage(database,service,credential,service===PRODUCTION_CREDENTIAL_CANARY?['RESTART_PROVEN']:['PROBE_PROVEN'],'PRODUCTION_CREDENTIAL_SINK_PROOF_REQUIRED');
 const key=sinkKeyFor(service),rows=(metadata??[]).filter(m=>m.key===key);
 if(rows.length!==1||rows[0]!.type!=='sensitive'||JSON.stringify(rows[0]!.target)!==JSON.stringify(['production']))throw new Error('PRODUCTION_CREDENTIAL_SINK_NOT_CONFIRMED');
 neonStage.delete(credential);
 const confirmed=Object.freeze({role:c.role,stage:'SINK_CONFIRMED' as const,sinkKey:key});neonStage.set(confirmed,'SINK_CONFIRMED');return confirmed;
}
/** Lease removal, one shot: SinkConfirmed -> FinalizationAttempt. Issuing the infinity SQL consumes the sink
 * confirmation, so it can never be issued twice from the same proof. */
export function productionCredentialFinalizationSql(database:string,service:CommercialCredentialService,confirmed:SinkConfirmedNeonCredential):FinalizationAttemptNeonCredential{
 requireStage(database,service,confirmed,['SINK_CONFIRMED'],'PRODUCTION_CREDENTIAL_SINK_CONFIRMATION_REQUIRED');
 neonStage.delete(confirmed);
 const sql=Object.freeze([managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} VALID UNTIL 'infinity'`]);
 const attempt=Object.freeze({role:confirmed.role,stage:'FINALIZATION_ATTEMPT' as const,sinkKey:confirmed.sinkKey,sql});
 neonStage.set(attempt,'FINALIZATION_ATTEMPT');return attempt;
}
/** The attempt's one readback: FinalizationAttempt -> Finalized, or terminal failure. The attempt is consumed before the
 * readback is judged, so a failed readback leaves no proof to retry with; containment (rollback SQL, sink deletion,
 * stop) is the only next step. */
export function productionCredentialFinalized(database:string,service:CommercialCredentialService,attempt:FinalizationAttemptNeonCredential,readback:Readonly<{rolcanlogin:unknown;rolvaliduntil:unknown}>|null|undefined){
 requireStage(database,service,attempt,['FINALIZATION_ATTEMPT'],'PRODUCTION_CREDENTIAL_FINALIZATION_ATTEMPT_REQUIRED');
 neonStage.delete(attempt);
 if(!readback||readback.rolcanlogin!==true||readback.rolvaliduntil!=='infinity')throw new Error('PRODUCTION_CREDENTIAL_FINALIZATION_FAILED');
 return Object.freeze({role:attempt.role,sinkKey:attempt.sinkKey,result:'ACTIVE' as const});
}
export function productionCredentialRollbackSql(database:string,service:CommercialCredentialService):string[]{
 return [managerSet(database),`ALTER ROLE ${qi(roleFor(database,service))} NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`];
}
/** Pre-lifecycle role baseline from a catalog readback (rolvaliduntil as text). NULL is an untouched role; 'infinity'
 * is a role that already passed a lifecycle (finalized or contained). Any finite VALID UNTIL, expired or future, is a
 * STALE_LEASE and never a clean baseline. */
export type ProductionCredentialBaseline='READY_PRISTINE'|'READY_NORMALIZED'|'STALE_LEASE'|'NOT_READY';
export const PRODUCTION_CREDENTIAL_CLEAN_BASELINES=Object.freeze(['READY_PRISTINE','READY_NORMALIZED'] as const);
export function productionCredentialBaseline(readback:Readonly<{rolcanlogin:unknown;passwordIsNull:unknown;rolvaliduntil:unknown}>|null|undefined):ProductionCredentialBaseline{
 if(!readback||readback.rolcanlogin!==false||readback.passwordIsNull!==true)return 'NOT_READY';
 if(readback.rolvaliduntil===null)return 'READY_PRISTINE';
 if(readback.rolvaliduntil==='infinity')return 'READY_NORMALIZED';
 return typeof readback.rolvaliduntil==='string'&&readback.rolvaliduntil!==''?'STALE_LEASE':'NOT_READY';
}

export const PRODUCTION_CREDENTIAL_PROOF_CONTRACT=Object.freeze({
 pre:['network stability gate: 3 successful rounds over at least 60 seconds of Neon API, endpoint DNS, owner read-only DB, Neon operation list and Vercel metadata; no mutation','exact role is NOLOGIN, has no password and has the foundation role posture','role baseline is READY_PRISTINE (VALID UNTIL NULL) or READY_NORMALIZED (VALID UNTIL infinity); a finite VALID UNTIL, expired or future, is STALE_LEASE and not a clean baseline','role is registered in the Neon role API','manager SET succeeds','no Production password sink exists yet'],
 initialBootstrap:['temporary password is 32 random bytes as 43-char base64url, generated in process and never persisted, logged or sunk','manager SET, then ALTER ROLE <role> NOLOGIN PASSWORD <temporary> VALID UNTIL infinity in one statement; never LOGIN, no lease','after commit VALID UNTIL is infinity: any stale finite VALID UNTIL is normalized while the role stays NOLOGIN',
  'after commit the role is still NOLOGIN with identical attributes (VALID UNTIL aside), memberships, grantors, ownership and ACL','the temporary password is never installed in any sink and never used as a final credential'],
 passwordReset:['exactly one reset_password POST (non-idempotent, never retried)','password parsed in process; raw response never logged or stored','a response without operations fails closed','the credential is pending until every returned operation is observed finished',
  'failure or unknown outcome: containment, no second reset, no reveal_password, stop'],
 preLogin:['after reset the role is still NOLOGIN with identical attributes, memberships, grantors, ownership and ACL','application references to the temporary password are dropped'],
 lease:['the operator-owned PostgreSQL client executes the fixed clock_timestamp() query and verifies current_database(); no timestamp or query-result input can mint a clock proof','deadline is database clock_timestamp() plus exactly 20 minutes, preserving fractional seconds and normalizing to UTC','clock and lease capabilities are bound to the exact database and service/role and each consumed once','LOGIN SQL accepts only the unspent lease proof derived from the registered database-clock proof, never a raw timestamp','manager SET, then ALTER ROLE <role> LOGIN VALID UNTIL <deadline>; no password clause','readback: LOGIN true and rolvaliduntil equals the deadline',
  'lease enforcement is proven by a NEW connection being rejected after expiry; existing sessions are not assumed to be terminated'],
 connection:['verify-full TLS authentication with the Neon password succeeds as the exact role','verifyProductionDatabase-equivalent least-privilege posture passes'],
 probes:['one role-specific positive probe succeeds','one role-specific forbidden probe fails with SQLSTATE 42501'],
 canary:['content_read first; exactly one endpoint restart, never resent','after the restart the same credential authenticates again with both probes and unchanged posture','only then may the canary password reach its sink'],
 sink:['only a probe-proven (canary: restart-proven) Neon password is installed into the exact Production sensitive sink','only sink metadata is read back; the value is never read back or logged'],
 finalization:['only a confirmed sink allows ALTER ROLE <role> VALID UNTIL infinity','issuing that SQL consumes the sink confirmation: one finalization attempt, one readback','readback must be LOGIN true with VALID UNTIL infinity','a failed finalization or readback is an activation failure: delete the sink, contain, stop','after a failed readback neither the sink confirmation nor the attempt can be used again; containment is the only next step'],
 containment:['NOLOGIN PASSWORD NULL VALID UNTIL infinity is idempotent and retried with 5/10/20/30-second backoff for at most 10 minutes until LOGIN false is read back','after containment the role is READY_NORMALIZED: LOGIN false, no password, VALID UNTIL infinity; no finite lease survives','sink deletion is idempotent: absent counts as success','reset_password and restart are never repeated','no other role is touched after a failure'],
 remaining:['the nine other commercial roles run strictly serially after the canary passes, without restarts; any failure contains that role and stops the tranche'],
 futureRotation:['live rotation of a bootstrapped credential used by the public runtime is out of scope and requires a separate coordinated contract'],
});

/** Secret-free deterministic plan for Owner/TD approval. */
export function productionCredentialActivationPlan(database:string){
 const roles=commercialCredentialRoleNames(database),managerRole=database+'_role_admin';
 const body={version:PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,database,managerRole,
  initialPasswordAuthority:PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,steadyStatePasswordAuthority:PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,
  roleAttributeAuthority:managerRole,temporaryPasswordRoleState:'NOLOGIN' as const,finalPasswordSource:'NEON_RESET_RESPONSE' as const,temporaryPasswordInstalledInVercel:false,
  temporaryPassword:{entropyBytes:32,encoding:'base64url',length:43,pattern:TEMPORARY_PASSWORD.source,sql:'NOLOGIN_PASSWORD_VALID_UNTIL_INFINITY_ONE_STATEMENT',handling:'NEVER_PERSISTED_LOGGED_OR_SUNK'},
  cleanBaselines:[...PRODUCTION_CREDENTIAL_CLEAN_BASELINES],staleLeaseBaseline:'NOT_CLEAN' as const,
  preFinalizationPasswordLease:'REQUIRED' as const,passwordLeaseMinutes:PRODUCTION_CREDENTIAL_PASSWORD_LEASE_MINUTES,leaseClock:'DATABASE_CLOCK_TIMESTAMP' as const,
  leaseEnforcementProof:'NEW_CONNECTION_REJECTED_AFTER_EXPIRY' as const,existingSessionsTerminatedByExpiry:'NOT_ASSUMED' as const,
  sinkOrdering:'AFTER_RESTART_PERSISTENCE' as const,containmentSql:PRODUCTION_CREDENTIAL_CONTAINMENT.sql,containmentRetry:PRODUCTION_CREDENTIAL_CONTAINMENT.retry,containment:PRODUCTION_CREDENTIAL_CONTAINMENT,
  finalization:'SINK_CONFIRMED_THEN_VALID_UNTIL_INFINITY' as const,finalizationAttempts:'ONE_SHOT' as const,finalizationFailure:'DELETE_SINK_CONTAIN_STOP' as const,
  canarySequence:['TEMPORARY_PASSWORD_WHILE_NOLOGIN','RESET_PASSWORD_ONCE','WAIT_RESET_OPERATIONS','DROP_TEMP_REFERENCE','LOGIN_WITH_BOUNDED_VALID_UNTIL','TLS_AND_PROBES','RESTART_ONCE_IF_CANARY','TLS_AND_PROBES_AFTER_RESTART','SINK_NEON_PASSWORD','VERIFY_SINK_METADATA','VALID_UNTIL_INFINITY'],
  remainingSequence:['TEMPORARY_PASSWORD_WHILE_NOLOGIN','RESET_PASSWORD_ONCE','WAIT_RESET_OPERATIONS','DROP_TEMP_REFERENCE','LOGIN_WITH_BOUNDED_VALID_UNTIL','TLS_AND_PROBES','SINK_NEON_PASSWORD','VERIFY_SINK_METADATA','VALID_UNTIL_INFINITY'],
  passwordReset:{method:'POST',path:'/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password',idempotent:false,maxCallsPerRole:1,blindRetry:false,responseHandling:'IN_PROCESS_NEVER_PERSISTED',emptyOperations:'FAIL_CLOSED',usableAfter:'ALL_OPERATIONS_FINISHED',revealPassword:'NOT_USED'},
  restart:{method:'POST',path:'/projects/{project_id}/endpoints/{endpoint_id}/restart',idempotent:false,maxCalls:1,blindResendAfterUnknown:false,scope:'CANARY_ONLY'},
  futureRotation:'FUTURE_LIVE_ROTATION_REQUIRES_SEPARATE_COORDINATION' as const,
  sinks:Object.fromEntries(COMMERCIAL_CREDENTIAL_SERVICES.map(s=>[s,sinkKeyFor(s)])),
  remainingOrder:[...PRODUCTION_CREDENTIAL_REMAINING_ORDER],remainingExecution:'SERIAL_STOP_ON_FIRST_FAILURE' as const,
  services:[...COMMERCIAL_CREDENTIAL_SERVICES],roles,probes:COMMERCIAL_CREDENTIAL_PROBES,proofContract:PRODUCTION_CREDENTIAL_PROOF_CONTRACT,
  canary:PRODUCTION_CREDENTIAL_CANARY as CommercialCredentialService,remainingOperationalRolesStayNoLogin:true};
 return {...body,planSha256:sha256(JSON.stringify(body))};
}
