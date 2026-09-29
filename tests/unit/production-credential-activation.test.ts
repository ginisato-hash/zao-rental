import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {COMMERCIAL_ALLOWLISTED_KEYS,COMMERCIAL_DB_SERVICES,COMMERCIAL_SECRET_KEYS} from '../../packages/core/src/guest/production-commercial-composition';
import {productionAppRoleNames} from '../../scripts/production-app-roles';
import * as contract from '../../scripts/production-credential-activation';
import {
 COMMERCIAL_CREDENTIAL_PROBES,COMMERCIAL_CREDENTIAL_SERVICES,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,
 PRODUCTION_CREDENTIAL_CONTAINMENT,PRODUCTION_CREDENTIAL_REMAINING_ORDER,type CommercialCredentialService,
 assertProductionCredentialTemporaryPassword,commercialCredentialRoleNames,productionCredentialActivationPlan,productionCredentialActivationSql,productionCredentialRollbackSql,
 productionCredentialResetPasswordRequest,productionCredentialPasswordFromResetResponse,productionCredentialCompleteReset,productionCredentialSink,productionCredentialTemporaryPassword,productionCredentialTemporaryPasswordSql,
 productionCredentialReadDatabaseClock,productionCredentialLeaseDeadline,productionCredentialProbeProven,productionCredentialRestartRequest,productionCredentialRestartProven,productionCredentialSinkConfirmed,
 productionCredentialFinalizationSql,productionCredentialFinalized,productionCredentialContainmentSchedule,productionCredentialRestartOperationClass,
 productionCredentialBaseline,PRODUCTION_CREDENTIAL_CLEAN_BASELINES,
} from '../../scripts/production-credential-activation';

const TEMP='A'.repeat(21)+'_'+'b'.repeat(20)+'-',OP='054c34ce-9b64-46f4-9aad-4093067f640f',LEASE='2026-09-28T04:38:25.912345Z';
/** Unit-only replacement of the trusted DB transport; the real PostgreSQL path is covered in production-role-plans. */
const clockClient=(rows:unknown[])=>{
 const client=new Client();
 Object.defineProperty(client,'query',{value:async(sql:string)=>{
  assert.equal(sql,'SELECT current_database() AS database, clock_timestamp()::text AS database_now');
  return {rows};
 }});
 return client;
};
const clock=(service:CommercialCredentialService='content_read',database='neondb',now='2026-09-28 04:18:25.912345+00')=>
 productionCredentialReadDatabaseClock(database,service,clockClient([{database,database_now:now}]));
const lease=async(service:CommercialCredentialService='content_read',database='neondb')=>productionCredentialLeaseDeadline(database,service,await clock(service,database));
const roleOf=(service:CommercialCredentialService)=>commercialCredentialRoleNames('neondb')[service];
const reset=(role:string,password='n'.repeat(32))=>({role:{name:role,password,branch_id:'br-a'},operations:[{id:OP,action:'apply_config'}]});
const pending=(service:CommercialCredentialService)=>productionCredentialPasswordFromResetResponse(reset(roleOf(service)),roleOf(service),TEMP);
const neon=(service:CommercialCredentialService)=>productionCredentialCompleteReset(pending(service),{[OP]:'finished'});
const evidence=(service:CommercialCredentialService,over:Record<string,unknown>={})=>({currentUser:roleOf(service),sessionUser:roleOf(service),tlsVerifyFull:true,positive:'PASS',negativeSqlState:'42501',postureUnchanged:true,...over});
const probed=(service:CommercialCredentialService)=>productionCredentialProbeProven('neondb',service,neon(service),evidence(service));
const restarted=()=>{const p=probed('content_read');return productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:true,authenticatedWith:p});};
const META=(service:CommercialCredentialService)=>[{key:`PRODUCTION_DB_PASSWORD_${service.toUpperCase()}`,type:'sensitive',target:['production']}];

test('credential tranche is exactly the ten commercial DB services and excludes avatar/payment/backup',()=>{
 assert.deepEqual([...COMMERCIAL_CREDENTIAL_SERVICES],[...COMMERCIAL_DB_SERVICES]);
 assert.deepEqual([...COMMERCIAL_CREDENTIAL_SERVICES],['auth','ledger','hold','transfer','pricing','recommendation','operations','guest','content_read','booking_access']);
 const roles=commercialCredentialRoleNames('neondb');
 assert.deepEqual(Object.values(roles),[
  'neondb_auth','neondb_ledger','neondb_hold','neondb_transfer','neondb_pricing',
  'neondb_recommendation','neondb_operations','neondb_guest','neondb_content_read','neondb_booking_access',
 ]);
 for(const forbidden of ['neondb_avatar_read','neondb_pay_receipt','neondb_pay_dispatch','neondb_pay_truth','neondb_pay_projection','neondb_pay_diagnostic','neondb_backup','neondb_role_admin','neondb_custody','neondb_custody_executor'])
  assert.ok(!Object.values(roles).includes(forbidden as never),forbidden);
});

test('the other seven operational roles stay excluded from every credential step',()=>{
 const excluded=Object.values(productionAppRoleNames('neondb')).filter(r=>!Object.values(commercialCredentialRoleNames('neondb')).includes(r));
 const plan=productionCredentialActivationPlan('neondb');
 assert.ok(excluded.includes('neondb_avatar_read'));
 for(const role of excluded)assert.ok(!Object.values(plan.roles).includes(role),role);
 assert.deepEqual(Object.keys(plan.sinks),[...COMMERCIAL_CREDENTIAL_SERVICES]);
 assert.throws(()=>productionCredentialTemporaryPasswordSql('neondb','avatar_read' as never,TEMP),/SERVICE_INVALID/);
 assert.throws(()=>productionCredentialRollbackSql('neondb','backup' as never),/SERVICE_INVALID/);
});

test('temporary password is strict 43-char base64url; anything else is refused before SQL is built',()=>{
 for(let i=0;i<50;i++){const t=productionCredentialTemporaryPassword();assert.match(t,/^[A-Za-z0-9_-]{43}$/);}
 assert.notEqual(productionCredentialTemporaryPassword(),productionCredentialTemporaryPassword());
 for(const bad of ['','x'.repeat(42),'x'.repeat(44),'x'.repeat(42)+"'",'x'.repeat(42)+'=','x'.repeat(42)+' ','x'.repeat(42)+'\\','x'.repeat(42)+'+','x'.repeat(42)+'é',null,43])
  assert.throws(()=>assertProductionCredentialTemporaryPassword(bad),/TEMPORARY_PASSWORD_INVALID/);
 assert.throws(()=>productionCredentialTemporaryPasswordSql('neondb','content_read',"x'); ALTER ROLE neondb_owner LOGIN; --".padEnd(43,'x')),/TEMPORARY_PASSWORD_INVALID/);
});

test('temporary password remains NOLOGIN: bootstrap SQL asserts NOLOGIN and VALID UNTIL infinity in the same statement and can never grant LOGIN or a lease',()=>{
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const sql=productionCredentialTemporaryPasswordSql('neondb',service,TEMP);
  assert.deepEqual(sql,['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "${roleOf(service)}" NOLOGIN PASSWORD '${TEMP}' VALID UNTIL 'infinity'`]);
  assert.doesNotMatch(sql.join('\n'),/(?<!NO)LOGIN\b|SCRAM/i);
  assert.deepEqual(sql.join('\n').match(/VALID UNTIL '[^']*'/g),["VALID UNTIL 'infinity'"],'no finite lease on the temporary password');
 }
});

test('reset completion proof remains mandatory; a response without operations fails closed',async()=>{
 const c=productionCredentialPasswordFromResetResponse(reset('neondb_content_read'),'neondb_content_read',TEMP);
 assert.deepEqual({...c,operationIds:[...c.operationIds]},{role:'neondb_content_read',password:'n'.repeat(32),operationIds:[OP]});
 const role={name:'neondb_content_read',password:'n'.repeat(32)};
 for(const bad of [null,{},reset('neondb_guest'),reset('neondb_content_read','short'),reset('neondb_content_read',TEMP),{role,operations:[{id:'not-an-op'}]},
  {role},{role,operations:[]},{role,operations:null},{role,operations:[{id:OP},{id:OP}]}])
  assert.throws(()=>productionCredentialPasswordFromResetResponse(bad,'neondb_content_read',TEMP),/RESET_RESPONSE_INVALID/);
 const OP2='9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
 const two=()=>productionCredentialPasswordFromResetResponse({role,operations:[{id:OP},{id:OP2}]},'neondb_content_read',TEMP);
 for(const status of [{},{[OP]:'finished'},{[OP]:'finished',[OP2]:'running'},{[OP]:'finished',[OP2]:'finished','00000000-0000-0000-0000-000000000000':'finished'}])
  assert.throws(()=>productionCredentialCompleteReset(two(),status),/RESET_NOT_COMPLETED/,JSON.stringify(status));
 const p=two();productionCredentialCompleteReset(p,{[OP]:'finished',[OP2]:'finished'});
 assert.throws(()=>productionCredentialCompleteReset(p,{[OP]:'finished',[OP2]:'finished'}),/PENDING_RESET_REQUIRED/,'a pending credential completes once');
 const freshLease=await lease();
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',pending('content_read') as never,freshLease),/COMPLETED_NEON_RESET_REQUIRED/,'pending cannot LOGIN');
});

test('clock provenance requires a PostgreSQL client and the fixed database clock read, never a timestamp or result object',async()=>{
 for(const bad of ['2099-12-31T23:40:00Z',null,{databaseNow:'2099-12-31T23:40:00Z'},
  {rows:[{database:'neondb',database_now:'2099-12-31T23:40:00Z'}]},{query:async()=>({rows:[]})}])
  await assert.rejects(productionCredentialReadDatabaseClock('neondb','content_read',bad as never),/DATABASE_CLIENT_REQUIRED/);
 for(const rows of [[],[{database:'anotherdb',database_now:'2026-09-28T04:18:25Z'}],[{database:'neondb',database_now:null}],
  [{database:'neondb',database_now:'2026-09-28T04:18:25Z'},{database:'neondb',database_now:'2026-09-28T04:18:25Z'}]])
  await assert.rejects(productionCredentialReadDatabaseClock('neondb','content_read',clockClient(rows)),/DATABASE_CLOCK_READ_INVALID/);
 const failed=new Client();
 Object.defineProperty(failed,'query',{value:async()=>{throw new Error('DB_READ_FAILED');}});
 await assert.rejects(productionCredentialReadDatabaseClock('neondb','content_read',failed),/DB_READ_FAILED/);
});

test('only a registered database clock proof mints a lease; invented far-future strings and forged clock proofs fail',async()=>{
 // @ts-expect-error The old timestamp-only entry point is no longer callable.
 assert.throws(()=>productionCredentialLeaseDeadline('2099-12-31T23:40:00Z'),/DATABASE_CLOCK_PROOF_REQUIRED/);
 const real=await clock();
 for(const bad of ['2099-12-31T23:40:00Z','2026-09-28T04:18:25Z',null,undefined,{},
  {...real},{...real,databaseNow:'2099-12-31T23:40:00Z'},Object.freeze({...real})])
  assert.throws(()=>productionCredentialLeaseDeadline('neondb','content_read',bad as never),/DATABASE_CLOCK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialLeaseDeadline('neondb','guest',real),/DATABASE_CLOCK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialLeaseDeadline('anotherdb','content_read',real),/DATABASE_CLOCK_PROOF_REQUIRED/);
 assert.throws(()=>{(real as {databaseNow:string}).databaseNow='2099-12-31T23:40:00Z';},TypeError);
 assert.equal(productionCredentialLeaseDeadline('neondb','content_read',real).deadline,LEASE);
 assert.throws(()=>productionCredentialLeaseDeadline('neondb','content_read',real),/DATABASE_CLOCK_PROOF_REQUIRED/,'one lease per DB clock read');
});

test('activation grants LOGIN with exactly DB clock plus 20 minutes, retaining fractional seconds and no password clause',async()=>{
 for(const [now,deadline] of [
  ['2026-09-28 04:18:25.912345+00',LEASE],
  ['2026-09-28T13:18:25.912345+09:00',LEASE],
  ['2026-09-28T00:18:25.912345-0400',LEASE],
  ['2026-09-28T23:50:00Z','2026-09-29T00:10:00Z'],
 ])assert.equal(productionCredentialLeaseDeadline('neondb','content_read',await clock('content_read','neondb',now)).deadline,deadline);
 for(const bad of ['2026-09-28 04:18:25','not a time','2026-09-28T99:00:00Z','']){
  const c=await clock('content_read','neondb',bad);
  assert.throws(()=>productionCredentialLeaseDeadline('neondb','content_read',c),/DATABASE_TIME_INVALID/);
 }
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const proof=await lease(service);
  assert.equal(proof.leaseMinutes,20);assert.equal(proof.role,roleOf(service));assert.equal(proof.database,'neondb');
  const sql=productionCredentialActivationSql('neondb',service,neon(service),proof);
  assert.deepEqual(sql,['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "${roleOf(service)}" LOGIN VALID UNTIL '${LEASE}'`]);
  assert.doesNotMatch(sql.join('\n'),/PASSWORD|infinity|SCRAM/i);
 }
 const proof=await lease();
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('guest'),proof),/COMPLETED_NEON_RESET_REQUIRED/,'another role');
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',{role:'neondb_content_read',password:'n'.repeat(32),operationIds:[],completed:true},proof),/COMPLETED_NEON_RESET_REQUIRED/,'forged');
});

test('only the exact database and service lease reaches activation SQL, and only once',async()=>{
 const proof=await lease();
 for(const bad of [LEASE,'2099-12-31T23:59:59Z','infinity',"2026-09-28T04:38:25Z'; --",'',undefined,null,
  {deadline:LEASE},{...proof},{...proof,deadline:'2099-12-31T23:59:59Z'},Object.freeze({...proof}),await clock()])
  assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('content_read'),bad as never),/LEASE_PROOF_REQUIRED/);
 const guestLease=await lease('guest'),otherDatabaseLease=await lease('content_read','anotherdb');
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('content_read'),guestLease),/LEASE_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('content_read'),otherDatabaseLease),/LEASE_PROOF_REQUIRED/);
 assert.throws(()=>{(proof as {deadline:string}).deadline='2099-12-31T23:59:59Z';},TypeError,'the proof is frozen');
 assert.equal(productionCredentialActivationSql('neondb','content_read',neon('content_read'),proof)[1],`ALTER ROLE "neondb_content_read" LOGIN VALID UNTIL '${LEASE}'`);
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('content_read'),proof),/LEASE_PROOF_REQUIRED/,'a lease proof is spent by one activation');
 const refused=await lease();
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('guest'),refused),/COMPLETED_NEON_RESET_REQUIRED/);
 assert.ok(productionCredentialActivationSql('neondb','content_read',neon('content_read'),refused),'a refusal for another reason does not burn the proof');
});

test('canary sink cannot accept a completed or merely probe-proven credential; it requires restart persistence proof',()=>{
 assert.throws(()=>productionCredentialSink('neondb','content_read',neon('content_read') as never),/SINK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialSink('neondb','content_read',probed('content_read')),/SINK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialSink('neondb','content_read',TEMP as never),/SINK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialSink('neondb','content_read',pending('content_read') as never),/SINK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialSink('neondb','content_read',{role:'neondb_content_read',password:TEMP,stage:'RESTART_PROVEN'}),/SINK_PROOF_REQUIRED/,'forged');
 const sink=productionCredentialSink('neondb','content_read',restarted());
 assert.deepEqual({...sink},{key:'PRODUCTION_DB_PASSWORD_CONTENT_READ',target:'production',type:'sensitive',value:'n'.repeat(32)});
 assert.ok(COMMERCIAL_ALLOWLISTED_KEYS.includes(sink.key)&&COMMERCIAL_SECRET_KEYS.includes(sink.key));
});

test('restart proof requires the same credential identity, the exact role and a proven restart; canary only',()=>{
 const p=probed('content_read');
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:true,authenticatedWith:probed('content_read')}),/RESTART_EVIDENCE_INVALID/,'another credential object');
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:false,authenticatedWith:p}),/RESTART_EVIDENCE_INVALID/);
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read',{negativeSqlState:null}),restartProven:true,authenticatedWith:p}),/PROBE_EVIDENCE_INVALID/);
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read',{currentUser:'neondb_guest'}),restartProven:true,authenticatedWith:p}),/PROBE_EVIDENCE_INVALID/);
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',neon('content_read') as never,{...evidence('content_read'),restartProven:true,authenticatedWith:p}),/PROBE_PROOF_REQUIRED/);
 const g=probed('guest');
 assert.throws(()=>productionCredentialRestartProven('neondb','guest',g,{...evidence('guest'),restartProven:true,authenticatedWith:g}),/CANARY_ONLY/);
 const r=productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:true,authenticatedWith:p});
 assert.equal(r.stage,'RESTART_PROVEN');assert.equal(r.role,'neondb_content_read');
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:true,authenticatedWith:p}),/PROBE_PROOF_REQUIRED/,'probe proof is consumed once');
 for(const bad of [evidence('content_read',{tlsVerifyFull:false}),evidence('content_read',{positive:'FAIL 42501'}),evidence('content_read',{postureUnchanged:false}),evidence('content_read',{sessionUser:'neondb_owner'})])
  assert.throws(()=>productionCredentialProbeProven('neondb','content_read',neon('content_read'),bad as never),/PROBE_EVIDENCE_INVALID/);
});

test('restart operation readiness classifies each provider state without polling terminal states',()=>{
 const cases={finished:'TERMINAL_SUCCESS',failed:'TERMINAL_FAILURE',error:'TERMINAL_FAILURE',cancelled:'TERMINAL_FAILURE',scheduling:'PENDING',running:'PENDING',cancelling:'PENDING'};
 for(const [status,expected] of Object.entries(cases))assert.equal(productionCredentialRestartOperationClass(status),expected,status);
 for(const error of [undefined,null,''])assert.equal(productionCredentialRestartOperationClass('skipped',error,0),'TERMINAL_SUCCESS');
});

test('skipped restart operations require explicit zero failures and an empty or missing error',()=>{
 for(const error of ['provider failure',' ',{},[],0,false])assert.equal(productionCredentialRestartOperationClass('skipped',error,0),'ANOMALOUS');
 for(const failures of [undefined,null,1,-1,'0',false,NaN])assert.equal(productionCredentialRestartOperationClass('skipped','',failures),'ANOMALOUS');
});

test('unknown restart operation status fails closed instead of polling',()=>{
 for(const status of [undefined,null,'','FINISHED','queued','unknown',0,{},[]])assert.equal(productionCredentialRestartOperationClass(status,'',0),'ANOMALOUS');
});

test('restart skipped readiness does not broaden reset completion or prove password persistence',()=>{
 assert.equal(productionCredentialRestartOperationClass('skipped','',0),'TERMINAL_SUCCESS');
 assert.throws(()=>productionCredentialCompleteReset(pending('content_read'),{[OP]:'skipped'}),/RESET_NOT_COMPLETED/);
 const p=probed('content_read');
 assert.throws(()=>productionCredentialSink('neondb','content_read',p),/SINK_PROOF_REQUIRED/);
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:true,authenticatedWith:p,positive:'FAIL'}),/PROBE_EVIDENCE_INVALID/);
 assert.throws(()=>productionCredentialRestartProven('neondb','content_read',p,{...evidence('content_read'),restartProven:false,authenticatedWith:p}),/RESTART_EVIDENCE_INVALID/);
});

test('non-canary roles reach their sink with probe proof and no restart',()=>{
 for(const service of PRODUCTION_CREDENTIAL_REMAINING_ORDER){
  assert.throws(()=>productionCredentialSink('neondb',service,neon(service) as never),/SINK_PROOF_REQUIRED/);
  const sink=productionCredentialSink('neondb',service,probed(service));
  assert.equal(sink.key,`PRODUCTION_DB_PASSWORD_${service.toUpperCase()}`);
 }
});

test('finalization to VALID UNTIL infinity only after sink metadata proof; a bad readback is an activation failure',()=>{
 const r=restarted();
 assert.throws(()=>productionCredentialFinalizationSql('neondb','content_read',r as never),/SINK_CONFIRMATION_REQUIRED/);
 for(const bad of [[],[{key:'PRODUCTION_DB_PASSWORD_CONTENT_READ',type:'encrypted',target:['production']}],[{key:'PRODUCTION_DB_PASSWORD_CONTENT_READ',type:'sensitive',target:['production','preview']}],[...META('content_read'),...META('content_read')],META('guest')])
  assert.throws(()=>productionCredentialSinkConfirmed('neondb','content_read',r,bad),/SINK_NOT_CONFIRMED/,JSON.stringify(bad));
 const confirmed=productionCredentialSinkConfirmed('neondb','content_read',r,META('content_read'));
 assert.ok(!('password' in confirmed),'the confirmation carries no password');
 assert.throws(()=>productionCredentialSink('neondb','content_read',r),/SINK_PROOF_REQUIRED/,'the password-bearing proof is consumed');
 const attempt=productionCredentialFinalizationSql('neondb','content_read',confirmed);
 assert.deepEqual([...attempt.sql],['SET LOCAL ROLE "neondb_role_admin"',"ALTER ROLE \"neondb_content_read\" VALID UNTIL 'infinity'"]);
 assert.ok(!('password' in attempt),'the attempt carries no password');
 assert.throws(()=>productionCredentialFinalizationSql('neondb','content_read',confirmed),/SINK_CONFIRMATION_REQUIRED/,'issuing the infinity SQL consumes the sink confirmation');
 assert.throws(()=>productionCredentialFinalized('neondb','content_read',confirmed as never,{rolcanlogin:true,rolvaliduntil:'infinity'}),/FINALIZATION_ATTEMPT_REQUIRED/,'a sink confirmation is not an attempt');
 assert.deepEqual({...productionCredentialFinalized('neondb','content_read',attempt,{rolcanlogin:true,rolvaliduntil:'infinity'})},{role:'neondb_content_read',sinkKey:'PRODUCTION_DB_PASSWORD_CONTENT_READ',result:'ACTIVE'});
 assert.throws(()=>productionCredentialFinalized('neondb','content_read',attempt,{rolcanlogin:true,rolvaliduntil:'infinity'}),/FINALIZATION_ATTEMPT_REQUIRED/,'one readback per attempt');
 const plan=productionCredentialActivationPlan('neondb');
 assert.equal(plan.finalizationFailure,'DELETE_SINK_CONTAIN_STOP');
 assert.equal(plan.finalizationAttempts,'ONE_SHOT');
 assert.match(plan.proofContract.finalization.join(' '),/failed finalization or readback is an activation failure: delete the sink, contain, stop/);
});

test('a failed finalization readback is terminal: neither the confirmation nor the attempt can be reused; containment only',()=>{
 const confirmedChain=()=>productionCredentialSinkConfirmed('neondb','content_read',restarted(),META('content_read'));
 for(const bad of [null,undefined,{rolcanlogin:true,rolvaliduntil:LEASE},{rolcanlogin:true,rolvaliduntil:null},{rolcanlogin:false,rolvaliduntil:'infinity'},{rolcanlogin:'true',rolvaliduntil:'infinity'}]){
  const confirmed=confirmedChain(),attempt=productionCredentialFinalizationSql('neondb','content_read',confirmed);
  assert.throws(()=>productionCredentialFinalized('neondb','content_read',attempt,bad as never),/FINALIZATION_FAILED/,JSON.stringify(bad));
  // The v4 defect: the same proof must not be able to succeed after a failed readback.
  assert.throws(()=>productionCredentialFinalized('neondb','content_read',attempt,{rolcanlogin:true,rolvaliduntil:'infinity'}),/FINALIZATION_ATTEMPT_REQUIRED/,'the failed attempt is spent');
  assert.throws(()=>productionCredentialFinalizationSql('neondb','content_read',confirmed),/SINK_CONFIRMATION_REQUIRED/,'no second infinity SQL from the same confirmation');
  assert.throws(()=>productionCredentialFinalized('neondb','content_read',confirmed as never,{rolcanlogin:true,rolvaliduntil:'infinity'}),/FINALIZATION_ATTEMPT_REQUIRED/);
  // Containment needs no proof and is always available.
  assert.deepEqual(productionCredentialRollbackSql('neondb','content_read'),['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "neondb_content_read" NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`]);
 }
 const attempt=productionCredentialFinalizationSql('neondb','content_read',confirmedChain());
 assert.throws(()=>productionCredentialFinalized('neondb','guest',attempt,{rolcanlogin:true,rolvaliduntil:'infinity'}),/FINALIZATION_ATTEMPT_REQUIRED/,'another role');
 assert.throws(()=>productionCredentialFinalized('neondb','content_read',{role:'neondb_content_read',stage:'FINALIZATION_ATTEMPT',sinkKey:'PRODUCTION_DB_PASSWORD_CONTENT_READ',sql:[]},{rolcanlogin:true,rolvaliduntil:'infinity'}),/FINALIZATION_ATTEMPT_REQUIRED/,'forged');
});

test('rollback is the manager SET plus NOLOGIN PASSWORD NULL VALID UNTIL infinity, classified idempotent and retriable with bounded backoff',()=>{
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const sql=productionCredentialRollbackSql('neondb',service);
  assert.deepEqual(sql,['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "${roleOf(service)}" NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`]);
  assert.doesNotMatch(sql.join('\n'),/(?<!NO)LOGIN\b/);
 }
 assert.equal(PRODUCTION_CREDENTIAL_CONTAINMENT.sql,'NOLOGIN_PASSWORD_NULL_VALID_UNTIL_INFINITY_IDEMPOTENT');
 assert.equal(PRODUCTION_CREDENTIAL_CONTAINMENT.retry,'BOUNDED_UNTIL_CONFIRMED');
 assert.equal(PRODUCTION_CREDENTIAL_CONTAINMENT.confirmation,'LOGIN_FALSE_READBACK');
 assert.equal(PRODUCTION_CREDENTIAL_CONTAINMENT.sinkDeletion,'IDEMPOTENT_ABSENT_IS_SUCCESS');
 assert.deepEqual([...PRODUCTION_CREDENTIAL_CONTAINMENT.neverRepeated],['reset_password','endpoint_restart']);
 const s=productionCredentialContainmentSchedule();
 assert.deepEqual(s.slice(0,5),[5,10,20,30,30]);
 assert.ok(s.reduce((a,b)=>a+b,0)<=600&&s.reduce((a,b)=>a+b,0)>570);
});

test('reset and restart stay single non-idempotent calls with no blind retry or resend',()=>{
 const r=productionCredentialResetPasswordRequest('curly-union-23141081','br-long-king-azkou4fy','neondb','content_read');
 assert.deepEqual({...r},{method:'POST',path:'/projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_content_read/reset_password',idempotent:false,maxCalls:1});
 assert.throws(()=>productionCredentialResetPasswordRequest('bad id','br-x','neondb','content_read'),/TARGET_INVALID/);
 assert.throws(()=>productionCredentialResetPasswordRequest('curly-union-23141081','ep-x','neondb','content_read'),/TARGET_INVALID/);
 const x=productionCredentialRestartRequest('curly-union-23141081','ep-spring-thunder-az40hfn9');
 assert.deepEqual({...x},{method:'POST',path:'/projects/curly-union-23141081/endpoints/ep-spring-thunder-az40hfn9/restart',idempotent:false,maxCalls:1,blindResendAfterUnknown:false});
 assert.throws(()=>productionCredentialRestartRequest('curly-union-23141081','br-long-king-azkou4fy'),/TARGET_INVALID/);
 const plan=productionCredentialActivationPlan('neondb');
 assert.equal(plan.passwordReset.maxCallsPerRole,1);assert.equal(plan.passwordReset.blindRetry,false);
 assert.deepEqual(plan.restart,{method:'POST',path:'/projects/{project_id}/endpoints/{endpoint_id}/restart',idempotent:false,maxCalls:1,blindResendAfterUnknown:false,scope:'CANARY_ONLY'});
});

test('v4 carries no SCRAM helper and no v3 direct-sink shortcut',()=>{
 for(const removed of ['buildScramSha256Verifier','assertScramSha256Verifier','generateProductionCredentialPassword','productionCredentialPasswordFromEntropy','PRODUCTION_CREDENTIAL_PASSWORD_AUTHORITY'])
  assert.equal((contract as Record<string,unknown>)[removed],undefined,removed);
});

test('all ten probes are unchanged: one read-only positive and one 42501 negative each',()=>{
 assert.deepEqual(Object.keys(COMMERCIAL_CREDENTIAL_PROBES),[...COMMERCIAL_CREDENTIAL_SERVICES]);
 assert.deepEqual(COMMERCIAL_CREDENTIAL_PROBES.content_read,{positive:'SELECT count(*) FROM content_public_policies',negative:'SELECT 1 FROM ledger_poles LIMIT 1',negativeSqlState:'42501'});
 assert.equal(COMMERCIAL_CREDENTIAL_PROBES.booking_access.positive,"SELECT booking_access.read('nonexistent')");
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const p=COMMERCIAL_CREDENTIAL_PROBES[service];
  assert.ok(p.positive.startsWith('SELECT ')&&p.negative.startsWith('SELECT '),service);
  assert.equal(p.negativeSqlState,'42501');
  assert.doesNotMatch(p.positive+p.negative,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
 }
});

test('v5 plan is exact, deterministic and secret-free; sink follows restart proof and infinity follows sink metadata',()=>{
 const p=productionCredentialActivationPlan('neondb');
 assert.equal(p.version,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION);
 assert.equal(p.version,'production-credential-activation/5');
 assert.equal(p.initialPasswordAuthority,'SQL_TEMPORARY_PLAINTEXT_NOLOGIN');
 assert.equal(PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,'SQL_TEMPORARY_PLAINTEXT_NOLOGIN');
 assert.equal(p.steadyStatePasswordAuthority,'NEON_ROLE_RESET_PASSWORD_API');
 assert.equal(PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,'NEON_ROLE_RESET_PASSWORD_API');
 assert.equal(p.roleAttributeAuthority,'neondb_role_admin');
 assert.equal(p.temporaryPasswordRoleState,'NOLOGIN');
 assert.equal(p.finalPasswordSource,'NEON_RESET_RESPONSE');
 assert.equal(p.temporaryPasswordInstalledInVercel,false);
 assert.equal(p.preFinalizationPasswordLease,'REQUIRED');
 assert.equal(p.passwordLeaseMinutes,20);
 assert.equal(p.leaseClock,'DATABASE_CLOCK_TIMESTAMP');
 assert.equal(p.leaseEnforcementProof,'NEW_CONNECTION_REJECTED_AFTER_EXPIRY');
 assert.equal(p.existingSessionsTerminatedByExpiry,'NOT_ASSUMED');
 assert.equal(p.sinkOrdering,'AFTER_RESTART_PERSISTENCE');
 assert.equal(p.containmentSql,'NOLOGIN_PASSWORD_NULL_VALID_UNTIL_INFINITY_IDEMPOTENT');
 assert.equal(p.temporaryPassword.sql,'NOLOGIN_PASSWORD_VALID_UNTIL_INFINITY_ONE_STATEMENT');
 assert.deepEqual(p.cleanBaselines,['READY_PRISTINE','READY_NORMALIZED']);assert.equal(p.staleLeaseBaseline,'NOT_CLEAN');
 assert.equal(p.containmentRetry,'BOUNDED_UNTIL_CONFIRMED');
 assert.equal(p.finalization,'SINK_CONFIRMED_THEN_VALID_UNTIL_INFINITY');
 assert.equal(p.futureRotation,'FUTURE_LIVE_ROTATION_REQUIRES_SEPARATE_COORDINATION');
 assert.deepEqual(p.canarySequence,['TEMPORARY_PASSWORD_WHILE_NOLOGIN','RESET_PASSWORD_ONCE','WAIT_RESET_OPERATIONS','DROP_TEMP_REFERENCE','LOGIN_WITH_BOUNDED_VALID_UNTIL','TLS_AND_PROBES','RESTART_ONCE_IF_CANARY','TLS_AND_PROBES_AFTER_RESTART','SINK_NEON_PASSWORD','VERIFY_SINK_METADATA','VALID_UNTIL_INFINITY']);
 const at=(s:readonly string[],x:string)=>s.indexOf(x);
 assert.ok(at(p.canarySequence,'TLS_AND_PROBES_AFTER_RESTART')<at(p.canarySequence,'SINK_NEON_PASSWORD'));
 assert.ok(at(p.canarySequence,'VERIFY_SINK_METADATA')<at(p.canarySequence,'VALID_UNTIL_INFINITY'));
 assert.ok(at(p.canarySequence,'WAIT_RESET_OPERATIONS')<at(p.canarySequence,'LOGIN_WITH_BOUNDED_VALID_UNTIL'));
 assert.ok(!p.remainingSequence.includes('RESTART_ONCE_IF_CANARY'));
 assert.ok(at(p.remainingSequence,'VERIFY_SINK_METADATA')<at(p.remainingSequence,'VALID_UNTIL_INFINITY'));
 assert.deepEqual(p.remainingOrder,['booking_access','recommendation','pricing','guest','ledger','hold','transfer','auth','operations']);
 assert.equal(p.remainingExecution,'SERIAL_STOP_ON_FIRST_FAILURE');
 assert.deepEqual([...p.remainingOrder,p.canary].sort(),[...COMMERCIAL_CREDENTIAL_SERVICES].sort());
 assert.equal(p.canary,'content_read');
 assert.equal(p.services.length,10);
 assert.equal(Object.keys(p.sinks).length,10);
 assert.equal(p.remainingOperationalRolesStayNoLogin,true);
 assert.match(p.planSha256,/^[a-f0-9]{64}$/);
 assert.equal(productionCredentialActivationPlan('neondb').planSha256,p.planSha256);
 assert.notEqual(productionCredentialActivationPlan('zao_rental_other').planSha256,p.planSha256);
 assert.doesNotMatch(JSON.stringify(p),/PASSWORD '|SCRAM-SHA-256\$|memory|eras/i);
 assert.ok(!JSON.stringify(p).includes(TEMP));
 assert.doesNotMatch(JSON.stringify(p),/NEON_RESET_PASSWORD_ONLY/);
});

test('baseline: untouched NULL and normalized infinity are clean; any finite VALID UNTIL, expired or future, is a stale lease',()=>{
 const ro=(rolvaliduntil:unknown)=>({rolcanlogin:false,passwordIsNull:true,rolvaliduntil});
 assert.equal(productionCredentialBaseline(ro(null)),'READY_PRISTINE');
 assert.equal(productionCredentialBaseline(ro('infinity')),'READY_NORMALIZED');
 for(const finite of ['2026-09-28 13:32:16.818847+00','2999-01-01 00:00:00+00',LEASE])assert.equal(productionCredentialBaseline(ro(finite)),'STALE_LEASE');
 for(const bad of [null,undefined,{rolcanlogin:true,passwordIsNull:true,rolvaliduntil:null},{rolcanlogin:false,passwordIsNull:false,rolvaliduntil:null},
  {rolcanlogin:'false',passwordIsNull:true,rolvaliduntil:null},ro(undefined),ro(''),ro(new Date()),ro(0)])assert.equal(productionCredentialBaseline(bad as never),'NOT_READY');
 assert.deepEqual([...PRODUCTION_CREDENTIAL_CLEAN_BASELINES],['READY_PRISTINE','READY_NORMALIZED']);
 assert.ok(!(PRODUCTION_CREDENTIAL_CLEAN_BASELINES as readonly string[]).includes('STALE_LEASE'));
});

test('infinity on a LOGIN-capable role comes only from finalization; bootstrap and containment pair infinity with NOLOGIN, the lease stays finite',async()=>{
 const temp=productionCredentialTemporaryPasswordSql('neondb','content_read',TEMP)[1]!,rollback=productionCredentialRollbackSql('neondb','content_read')[1]!;
 for(const sql of [temp,rollback])assert.match(sql,/^ALTER ROLE "neondb_content_read" NOLOGIN PASSWORD .* VALID UNTIL 'infinity'$/);
 const login=productionCredentialActivationSql('neondb','content_read',neon('content_read'),await lease())[1]!;
 assert.equal(login,`ALTER ROLE "neondb_content_read" LOGIN VALID UNTIL '${LEASE}'`);assert.doesNotMatch(login,/infinity/);
 const final=productionCredentialFinalizationSql('neondb','content_read',productionCredentialSinkConfirmed('neondb','content_read',restarted(),META('content_read'))).sql[1]!;
 assert.equal(final,`ALTER ROLE "neondb_content_read" VALID UNTIL 'infinity'`);
 assert.deepEqual([temp,rollback,login,final].filter(s=>/infinity/.test(s)&&!/NOLOGIN/.test(s)),[final]);
});
