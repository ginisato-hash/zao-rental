import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_DB_SERVICES} from '../../packages/core/src/guest/production-commercial-composition';
import * as contract from '../../scripts/production-credential-activation';
import {
 COMMERCIAL_CREDENTIAL_PROBES,COMMERCIAL_CREDENTIAL_SERVICES,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,PRODUCTION_CREDENTIAL_PASSWORD_AUTHORITY,
 commercialCredentialRoleNames,productionCredentialActivationPlan,productionCredentialActivationSql,productionCredentialRollbackSql,
 productionCredentialResetPasswordRequest,productionCredentialPasswordFromResetResponse,
} from '../../scripts/production-credential-activation';

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

test('activation SQL is exactly the manager SET plus a LOGIN toggle; no password or verifier ever enters SQL',()=>{
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const role=commercialCredentialRoleNames('neondb')[service],activate=productionCredentialActivationSql('neondb',service);
  assert.deepEqual(activate,['SET LOCAL ROLE "neondb_role_admin"',`ALTER ROLE "${role}" LOGIN`]);
  assert.doesNotMatch(activate.join('\n'),/PASSWORD|SCRAM|VALID UNTIL|ENCRYPTED/i);
 }
 assert.equal(productionCredentialActivationSql.length,2,'v2 takes no verifier argument');
});

test('rollback remains the manager SET plus NOLOGIN PASSWORD NULL',()=>{
 assert.deepEqual(productionCredentialRollbackSql('neondb','content_read'),['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_content_read" NOLOGIN PASSWORD NULL']);
});

test('password authority is the Neon reset_password API: one non-idempotent POST per role',()=>{
 const r=productionCredentialResetPasswordRequest('curly-union-23141081','br-long-king-azkou4fy','neondb','content_read');
 assert.deepEqual({...r},{method:'POST',path:'/projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_content_read/reset_password',idempotent:false,maxCalls:1});
 assert.equal(PRODUCTION_CREDENTIAL_PASSWORD_AUTHORITY,'NEON_ROLE_RESET_PASSWORD_API');
 assert.throws(()=>productionCredentialResetPasswordRequest('bad id','br-x','neondb','content_read'),/TARGET_INVALID/);
 assert.throws(()=>productionCredentialResetPasswordRequest('curly-union-23141081','ep-x','neondb','content_read'),/TARGET_INVALID/);
 assert.doesNotMatch(r.path,/reveal_password/);
});

test('reset response parsing takes only the exact role password and operation ids',()=>{
 const ok={role:{name:'neondb_content_read',password:'x'.repeat(24),branch_id:'br-a'},operations:[{id:'054c34ce-9b64-46f4-9aad-4093067f640f',action:'apply_config'}]};
 assert.deepEqual(productionCredentialPasswordFromResetResponse(ok,'neondb_content_read'),{password:'x'.repeat(24),operationIds:['054c34ce-9b64-46f4-9aad-4093067f640f']});
 for(const bad of [null,{},{role:{name:'neondb_guest',password:'x'.repeat(24)}},{role:{name:'neondb_content_read',password:'short'}},{role:{name:'neondb_content_read',password:'x'.repeat(24)},operations:[{id:'not-an-op'}]}])
  assert.throws(()=>productionCredentialPasswordFromResetResponse(bad,'neondb_content_read'),/RESET_RESPONSE_INVALID/);
});

test('v2 carries no SCRAM or local password generator',()=>{
 for(const removed of ['buildScramSha256Verifier','assertScramSha256Verifier','generateProductionCredentialPassword','productionCredentialPasswordFromEntropy'])
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

test('secret-free activation plan is deterministic and names the Neon-native authorities',()=>{
 const p=productionCredentialActivationPlan('neondb');
 assert.equal(p.version,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION);
 assert.equal(p.version,'production-credential-activation/2');
 assert.equal(p.passwordAuthority,'NEON_ROLE_RESET_PASSWORD_API');
 assert.equal(p.roleAttributeAuthority,'neondb_role_admin');
 assert.equal(p.passwordSqlTransport,'NONE');
 assert.deepEqual(p.passwordReset,{method:'POST',path:'/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password',idempotent:false,maxCallsPerRole:1,blindRetry:false,responseHandling:'MEMORY_ONLY',revealPassword:'NOT_USED'});
 assert.equal(p.managerRole,'neondb_role_admin');
 assert.equal(p.canary,'content_read');
 assert.equal(p.services.length,10);
 assert.equal(p.remainingOperationalRolesStayNoLogin,true);
 assert.match(p.planSha256,/^[a-f0-9]{64}$/);
 assert.equal(productionCredentialActivationPlan('neondb').planSha256,p.planSha256);
 assert.notEqual(productionCredentialActivationPlan('zao_rental_other').planSha256,p.planSha256);
 assert.doesNotMatch(JSON.stringify(p),/PASSWORD '|SCRAM-SHA-256\$/);
});
