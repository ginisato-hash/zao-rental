import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_ALLOWLISTED_KEYS,COMMERCIAL_DB_SERVICES,COMMERCIAL_SECRET_KEYS} from '../../packages/core/src/guest/production-commercial-composition';
import {productionAppRoleNames} from '../../scripts/production-app-roles';
import * as contract from '../../scripts/production-credential-activation';
import {
 COMMERCIAL_CREDENTIAL_PROBES,COMMERCIAL_CREDENTIAL_SERVICES,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,
 assertProductionCredentialTemporaryPassword,commercialCredentialRoleNames,productionCredentialActivationPlan,productionCredentialActivationSql,productionCredentialRollbackSql,
 productionCredentialResetPasswordRequest,productionCredentialPasswordFromResetResponse,productionCredentialSink,productionCredentialTemporaryPassword,productionCredentialTemporaryPasswordSql,
} from '../../scripts/production-credential-activation';

const TEMP='A'.repeat(21)+'_'+'b'.repeat(20)+'-',OP='054c34ce-9b64-46f4-9aad-4093067f640f';
const reset=(role:string,password='n'.repeat(32))=>({role:{name:role,password,branch_id:'br-a'},operations:[{id:OP,action:'apply_config'}]});
const neon=(service:typeof COMMERCIAL_CREDENTIAL_SERVICES[number])=>{const role=commercialCredentialRoleNames('neondb')[service];return productionCredentialPasswordFromResetResponse(reset(role),role,TEMP);};

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

test('initial bootstrap SQL is manager SET plus the temporary password and never contains LOGIN',()=>{
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const role=commercialCredentialRoleNames('neondb')[service],sql=productionCredentialTemporaryPasswordSql('neondb',service,TEMP);
  assert.deepEqual(sql,['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "${role}" PASSWORD '${TEMP}'`]);
  assert.doesNotMatch(sql.join('\n'),/\bLOGIN\b|\bNOLOGIN\b|VALID UNTIL|SCRAM/i);
 }
});

test('LOGIN requires a Neon reset credential for the exact role: LOGIN before reset is impossible through the API',()=>{
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',undefined as never),/NEON_RESET_REQUIRED/);
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',TEMP as never),/NEON_RESET_REQUIRED/);
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',{role:'neondb_content_read',password:'n'.repeat(32),operationIds:[]}),/NEON_RESET_REQUIRED/,'forged object');
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read',neon('guest')),/NEON_RESET_REQUIRED/,'another role credential');
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const role=commercialCredentialRoleNames('neondb')[service],activate=productionCredentialActivationSql('neondb',service,neon(service));
  assert.deepEqual(activate,['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "${role}" LOGIN`]);
  assert.doesNotMatch(activate.join('\n'),/PASSWORD|SCRAM|VALID UNTIL|ENCRYPTED/i);
 }
});

test('rollback remains the manager SET plus NOLOGIN PASSWORD NULL',()=>{
 assert.deepEqual(productionCredentialRollbackSql('neondb','content_read'),['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_content_read" NOLOGIN PASSWORD NULL']);
});

test('steady-state authority is the Neon reset_password API: one non-idempotent POST per role',()=>{
 const r=productionCredentialResetPasswordRequest('curly-union-23141081','br-long-king-azkou4fy','neondb','content_read');
 assert.deepEqual({...r},{method:'POST',path:'/projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_content_read/reset_password',idempotent:false,maxCalls:1});
 assert.equal(PRODUCTION_CREDENTIAL_INITIAL_PASSWORD_AUTHORITY,'SQL_TEMPORARY_PLAINTEXT_NOLOGIN');
 assert.equal(PRODUCTION_CREDENTIAL_STEADY_STATE_PASSWORD_AUTHORITY,'NEON_ROLE_RESET_PASSWORD_API');
 assert.throws(()=>productionCredentialResetPasswordRequest('bad id','br-x','neondb','content_read'),/TARGET_INVALID/);
 assert.throws(()=>productionCredentialResetPasswordRequest('curly-union-23141081','ep-x','neondb','content_read'),/TARGET_INVALID/);
 assert.doesNotMatch(r.path,/reveal_password/);
});

test('final password authority is Neon: the response is parsed for the exact role and may not echo the temporary password',()=>{
 const c=productionCredentialPasswordFromResetResponse(reset('neondb_content_read'),'neondb_content_read',TEMP);
 assert.deepEqual({...c,operationIds:[...c.operationIds]},{role:'neondb_content_read',password:'n'.repeat(32),operationIds:[OP]});
 assert.ok(Object.isFrozen(c));
 for(const bad of [null,{},reset('neondb_guest'),reset('neondb_content_read','short'),reset('neondb_content_read',TEMP),{role:{name:'neondb_content_read',password:'n'.repeat(32)},operations:[{id:'not-an-op'}]}])
  assert.throws(()=>productionCredentialPasswordFromResetResponse(bad,'neondb_content_read',TEMP),/RESET_RESPONSE_INVALID/);
 assert.throws(()=>productionCredentialPasswordFromResetResponse(reset('neondb_content_read'),'neondb_content_read','short'),/TEMPORARY_PASSWORD_INVALID/);
});

test('only the Neon password maps to the Vercel sink; the temporary password never can',()=>{
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const sink=productionCredentialSink('neondb',service,neon(service));
  assert.deepEqual({...sink},{key:`PRODUCTION_DB_PASSWORD_${service.toUpperCase()}`,target:'production',type:'sensitive',value:'n'.repeat(32)});
  assert.ok(COMMERCIAL_ALLOWLISTED_KEYS.includes(sink.key)&&COMMERCIAL_SECRET_KEYS.includes(sink.key),sink.key);
 }
 assert.throws(()=>productionCredentialSink('neondb','content_read',TEMP as never),/NEON_RESET_REQUIRED/);
 assert.throws(()=>productionCredentialSink('neondb','content_read',{role:'neondb_content_read',password:TEMP,operationIds:[]}),/NEON_RESET_REQUIRED/);
 assert.throws(()=>productionCredentialSink('neondb','content_read',neon('auth')),/NEON_RESET_REQUIRED/);
});

test('v3 carries no SCRAM helper',()=>{
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

test('secret-free activation plan is deterministic and names the hybrid authorities in order',()=>{
 const p=productionCredentialActivationPlan('neondb');
 assert.equal(p.version,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION);
 assert.equal(p.version,'production-credential-activation/3');
 assert.equal(p.initialPasswordAuthority,'SQL_TEMPORARY_PLAINTEXT_NOLOGIN');
 assert.equal(p.steadyStatePasswordAuthority,'NEON_ROLE_RESET_PASSWORD_API');
 assert.equal(p.roleAttributeAuthority,'neondb_role_admin');
 assert.equal(p.temporaryPasswordRoleState,'NOLOGIN');
 assert.equal(p.finalPasswordSource,'NEON_RESET_RESPONSE');
 assert.equal(p.temporaryPasswordInstalledInVercel,false);
 assert.equal(p.futureRotation,'NEON_RESET_PASSWORD_ONLY');
 assert.deepEqual(p.sequence,['TEMPORARY_PASSWORD_WHILE_NOLOGIN','RESET_PASSWORD_ONCE','ERASE_TEMPORARY','LOGIN_WITHOUT_PASSWORD_CLAUSE','TLS_AND_PROBES','SINK_NEON_PASSWORD']);
 assert.ok(p.sequence.indexOf('RESET_PASSWORD_ONCE')<p.sequence.indexOf('LOGIN_WITHOUT_PASSWORD_CLAUSE'));
 assert.deepEqual(p.passwordReset,{method:'POST',path:'/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password',idempotent:false,maxCallsPerRole:1,blindRetry:false,responseHandling:'MEMORY_ONLY',revealPassword:'NOT_USED'});
 assert.equal(p.managerRole,'neondb_role_admin');
 assert.equal(p.canary,'content_read');
 assert.equal(p.services.length,10);
 assert.equal(Object.keys(p.sinks).length,10);
 assert.equal(p.remainingOperationalRolesStayNoLogin,true);
 assert.match(p.planSha256,/^[a-f0-9]{64}$/);
 assert.equal(productionCredentialActivationPlan('neondb').planSha256,p.planSha256);
 assert.notEqual(productionCredentialActivationPlan('zao_rental_other').planSha256,p.planSha256);
 assert.doesNotMatch(JSON.stringify(p),/PASSWORD '|SCRAM-SHA-256\$/);
 assert.ok(!JSON.stringify(p).includes(TEMP));
});
